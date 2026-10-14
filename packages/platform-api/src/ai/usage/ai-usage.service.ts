import { BadRequestException, Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { Prisma } from '../data/prisma';

import type { AiPrisma } from '../data/ai-db';
import { PLATFORM_PRISMA } from '../../core/index';
import type { AiSystemPrisma } from '../data/ai-db';
import { AI_PRICING, AI_SYSTEM_PRISMA, type AiCost, type AiPricing, type AiPricingUsage } from '../ports';
import { getAiOperation } from '../core/operation-registry';
import { getAiFeature } from '../features/ai-feature.registry';
import { AiProviderRegistry } from '../core/provider-registry';
import {
  DEFAULT_AI_USAGE_RANGE_DAYS,
  MAX_AI_USAGE_RANGE_DAYS,
  type AiUsageBucket,
  type AiUsageGroupBy,
  type AiUsageReport,
  type AiUsageSeriesItem,
} from './dto/ai-usage.dto';
import type { AiUsageCost } from '@marinoscar/platform-contract/ai';

// =============================================================================
// AiUsageService — aggregates over `ai_usage_events` (issue #443, epic #420)
// =============================================================================
//
// Two `SELECT`s per report, both over the same `WHERE` and both `GROUP BY
// GROUPING SETS ((key), ())` so the totals row and the per-group rows come
// from ONE scan and always add up (the `job-insights.service.ts` pattern):
//
//   1. counts and token sums per group, with the org-key subtotal as FILTERed
//      aggregates;
//   2. `units` summed per (group, unit name) via `jsonb_each` — the JSONB
//      column is free-form by design, so its keys are only known at read time.
//
// The window is on `created_at`, which the `(created_at)` index serves for the
// admin report and the `(user_id, created_at)` index for a user's own.
//
// ⚠ THE GROUP KEY IS A FIXED SQL FRAGMENT PICKED FROM `GROUP_KEY_SQL` BY AN
// ENUM THE DTO VALIDATED — never text from the request. It must also contain
// no bound parameter: it appears three times in each statement, and Postgres
// only matches `GROUPING(expr)` / `SELECT expr` to `GROUP BY expr` when the
// three are textually the same expression.
//
// Every count/sum is cast at the database (`::int`, `::float8`): `count(*)` is
// `bigint` and `sum(int)` is `bigint`/`numeric`, which Prisma returns as a JS
// `bigint`/`Decimal` that `JSON.stringify` refuses or mangles.
//
// OWNER SCOPING is the caller's job, by passing `userId`: the per-user route
// always passes the authenticated user and has no way to pass anyone else.
// =============================================================================

const DAY_MS = 24 * 60 * 60 * 1000;

/** The key a `user` group takes for events with no user (e.g. catalog discovery). */
export const AI_USAGE_NO_USER_KEY = 'system';

/** Stable reason code for an unusable range (in `details.reason`). */
export const AI_USAGE_RANGE_INVALID = 'AI_USAGE_RANGE_INVALID';

const GROUP_KEY_SQL: Record<AiUsageGroupBy, Prisma.Sql> = {
  day: Prisma.raw(`to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')`),
  user: Prisma.raw(`user_id::text`),
  model: Prisma.raw(`provider || ':' || model_id`),
  provider: Prisma.raw(`provider`),
  keySource: Prisma.raw(`key_source`),
  // #739: per organization (the system report only).
  org: Prisma.raw(`org_id::text`),
  // PP-14.17 (#935): per registered AI feature, and per operation.
  feature: Prisma.raw(`feature`),
  operation: Prisma.raw(`operation`),
};

/** The key an `org` group takes for events with no organization (catalog discovery). */
export const AI_USAGE_NO_ORG_KEY = 'none';

/** The key a `feature` group takes for events recorded without a feature (PP-14.17). */
export const AI_USAGE_NO_FEATURE_KEY = 'none';

const KEY_SOURCE_LABELS: Record<string, string> = {
  user: "User's own key",
  org: 'Organization key',
  admin_discovery: 'Admin key (catalog discovery)',
  none: 'No key (keyless server)',
};

export interface AiUsageQuery {
  from?: string;
  to?: string;
  groupBy: AiUsageGroupBy;
  /** Restrict to one user. The per-user route always sets this to the caller. */
  userId?: string;
  provider?: string;
  model?: string;
  /** #739: restrict to one organization. */
  orgId?: string;
  /** PP-14.17: restrict to one registered AI feature. */
  feature?: string;
  /**
   * Price the report with the bound pricing port (`AI_PRICING`). Set by the
   * administrator's and the organization administrator's reports, never by a
   * user's own.
   */
  withCost?: boolean;
}

/** A resolved window: `from`/`to` inclusive UTC days, `start`/`end` the half-open instants. */
export interface AiUsageRange {
  from: string;
  to: string;
  start: Date;
  end: Date;
}

interface AggregateRow {
  is_total: number;
  key: string | null;
  requests: number;
  failed: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cached_input_tokens: number;
  org_requests: number;
  org_input_tokens: number;
  org_output_tokens: number;
}

interface SliceRow {
  key: string | null;
  provider: string;
  model_id: string;
  operation: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cached_input_tokens: number;
}

interface SliceUnitsRow {
  key: string | null;
  provider: string;
  model_id: string;
  operation: string;
  unit: string;
  amount: number;
}

interface CostSum {
  amount: number;
  currencies: Set<string>;
}

/** The identity of one priced slice within a report group. */
function sliceId(row: { key: string | null; provider: string; model_id: string; operation: string }): string {
  return JSON.stringify([row.key, row.provider, row.model_id, row.operation]);
}

/** A summed cost, or null when nothing was priced or the currencies differ. */
function toCost(sum: CostSum): AiUsageCost | null {
  return sum.currencies.size === 1 ? { amount: sum.amount, currency: [...sum.currencies][0] } : null;
}

interface UnitsRow {
  is_total: number;
  key: string | null;
  unit: string;
  amount: number;
}

/**
 * Exported for the reference app's wiring and tests (route discovery, contract
 * and egress suites); not part of the slice's documented surface.
 *
 * @internal
 */
@Injectable()
export class AiUsageService {
  private readonly logger = new Logger(AiUsageService.name);

  constructor(
    @Inject(PLATFORM_PRISMA) private readonly prisma: AiPrisma,
    private readonly registry: AiProviderRegistry,
    // The ADMINISTRATOR's report is a DEPLOYMENT-WIDE aggregate over every
    // organization's usage rows (`ai_usage_events` is under row-level
    // security, #725): the SYSTEM client, reason `admin-aggregate`. A user's
    // own view reads through `prisma.forOrg(orgId)` instead.
    @Inject(AI_SYSTEM_PRISMA) private readonly system: AiSystemPrisma,
    // PP-14.17 (#935), rung 3: the deployment's price list, bound through
    // `AiModule.forRoot({ pricing })`. Optional: absent, no report carries a cost.
    @Optional() @Inject(AI_PRICING) private readonly pricing?: AiPricing,
  ) {}

  /**
   * The usage report. With `orgId` (a per-user view: `GET /api/ai/usage/me`)
   * it reads through a client scoped to that organization, so it can only see
   * that organization's rows; without it (the administrator's report) it reads
   * every organization's through the system client.
   */
  async report(query: AiUsageQuery, now: Date = new Date(), orgId?: string): Promise<AiUsageReport> {
    const range = resolveAiUsageRange(query.from, query.to, now);
    const key = GROUP_KEY_SQL[query.groupBy];
    const where = whereSql(range, query);

    const db = orgId ? this.prisma.forOrg(orgId) : this.system.asSystem('admin-aggregate');
    const [rows, unitRows] = await Promise.all([
      db.$queryRaw<AggregateRow[]>(Prisma.sql`
        SELECT
          GROUPING(${key})::int AS is_total,
          ${key} AS key,
          count(*)::int AS requests,
          (count(*) FILTER (WHERE status = 'failed'))::int AS failed,
          coalesce(sum(input_tokens), 0)::float8 AS input_tokens,
          coalesce(sum(output_tokens), 0)::float8 AS output_tokens,
          coalesce(sum(reasoning_tokens), 0)::float8 AS reasoning_tokens,
          coalesce(sum(cached_input_tokens), 0)::float8 AS cached_input_tokens,
          (count(*) FILTER (WHERE key_source = 'org'))::int AS org_requests,
          coalesce(sum(input_tokens) FILTER (WHERE key_source = 'org'), 0)::float8 AS org_input_tokens,
          coalesce(sum(output_tokens) FILTER (WHERE key_source = 'org'), 0)::float8 AS org_output_tokens
        FROM ai_usage_events
        ${where}
        GROUP BY GROUPING SETS ((${key}), ())
      `),
      // `CASE` rather than a WHERE on `jsonb_typeof`: `jsonb_each` raises on a
      // non-object, and a CASE inside the call is the only placement whose
      // evaluation order Postgres guarantees.
      db.$queryRaw<UnitsRow[]>(Prisma.sql`
        SELECT
          GROUPING(${key})::int AS is_total,
          ${key} AS key,
          u.unit AS unit,
          sum((u.amount)::numeric)::float8 AS amount
        FROM ai_usage_events,
          LATERAL jsonb_each(
            CASE WHEN jsonb_typeof(units) = 'object' THEN units ELSE '{}'::jsonb END
          ) AS u(unit, amount)
        ${where}
          AND jsonb_typeof(u.amount) = 'number'
        GROUP BY GROUPING SETS ((${key}, u.unit), (u.unit))
      `),
    ]);

    const units = new Map<string | null, Record<string, number>>();
    let totalUnits: Record<string, number> = {};

    for (const row of unitRows ?? []) {
      const amount = Number(row.amount);
      if (Number(row.is_total) === 1) {
        totalUnits = { ...totalUnits, [row.unit]: amount };
        continue;
      }
      const bucket = units.get(row.key) ?? {};
      bucket[row.unit] = amount;
      units.set(row.key, bucket);
    }

    let totals = emptyBucket();
    const groups: Array<{ key: string | null; bucket: AiUsageBucket }> = [];

    for (const row of rows ?? []) {
      if (Number(row.is_total) === 1) {
        totals = toBucket(row, totalUnits);
      } else {
        groups.push({ key: row.key, bucket: toBucket(row, units.get(row.key) ?? {}) });
      }
    }

    const priced = query.withCost === true && this.pricing !== undefined;

    if (priced) {
      const costs = await this.costs(db, key, where);

      totals = { ...totals, cost: costs.total };
      for (const group of groups) group.bucket = { ...group.bucket, cost: costs.byKey.get(group.key) ?? null };
    }

    const series =
      query.groupBy === 'day'
        ? zeroFilledDays(range, groups)
        : await this.labelled(query.groupBy, groups);

    return {
      range: { from: range.from, to: range.to },
      groupBy: query.groupBy,
      ...(query.withCost === true ? { priced } : {}),
      totals,
      series,
    };
  }

  /** Non-day groups, labelled, most requests first (ties by key, so the order is stable). */
  private async labelled(
    groupBy: Exclude<AiUsageGroupBy, 'day'>,
    groups: Array<{ key: string | null; bucket: AiUsageBucket }>,
  ): Promise<AiUsageSeriesItem[]> {
    const emails = groupBy === 'user' ? await this.emailsFor(groups) : new Map<string, string>();
    const orgNames = groupBy === 'org' ? await this.orgNamesFor(groups) : new Map<string, string>();

    const series = groups.map(({ key, bucket }) => {
      switch (groupBy) {
        case 'user':
          return key === null
            ? { key: AI_USAGE_NO_USER_KEY, label: 'System (no user)', ...bucket }
            : { key, label: emails.get(key) ?? key, ...bucket };
        case 'model': {
          const k = key ?? '';
          const sep = k.indexOf(':');
          return { key: k, label: sep >= 0 ? k.slice(sep + 1) : k, ...bucket };
        }
        case 'provider': {
          const k = key ?? '';
          return { key: k, label: this.registry.get(k)?.displayName ?? k, ...bucket };
        }
        case 'org':
          return key === null
            ? { key: AI_USAGE_NO_ORG_KEY, label: 'No organization', ...bucket }
            : { key, label: orgNames.get(key) ?? key, ...bucket };
        case 'keySource': {
          const k = key ?? '';
          return { key: k, label: KEY_SOURCE_LABELS[k] ?? k, ...bucket };
        }
        case 'feature':
          return key === null
            ? { key: AI_USAGE_NO_FEATURE_KEY, label: 'No feature', ...bucket }
            : { key, label: getAiFeature(key)?.label ?? key, ...bucket };
        case 'operation': {
          const k = key ?? '';
          return { key: k, label: getAiOperation(k)?.label ?? k, ...bucket };
        }
      }
    });

    return series.sort((a, b) => b.requests - a.requests || a.key.localeCompare(b.key));
  }

  /**
   * The cost of every group and of the whole report, from the pricing port
   * (PP-14.17, #935). The port prices a `(provider, model, operation)` slice,
   * so each group is re-aggregated at that grain (one scan for counts and
   * tokens, one for units) and the port is called once per slice. A group's
   * cost is the sum of its priced slices, `null` when none is priced or the
   * priced ones use more than one currency. The total is the sum of every
   * slice, not of the group costs, so it is right when groups overlap (they
   * do not here, but `day` and `user` reports are different cuts of the same
   * slices).
   */
  private async costs(
    db: { $queryRaw<T = unknown>(query: unknown, ...values: unknown[]): Promise<T> },
    key: Prisma.Sql,
    where: Prisma.Sql,
  ): Promise<{ byKey: Map<string | null, AiUsageCost | null>; total: AiUsageCost | null }> {
    const pricing = this.pricing as AiPricing;
    const [rows, unitRows] = await Promise.all([
      db.$queryRaw<SliceRow[]>(Prisma.sql`
        SELECT
          ${key} AS key,
          provider,
          model_id,
          operation,
          count(*)::int AS requests,
          coalesce(sum(input_tokens), 0)::float8 AS input_tokens,
          coalesce(sum(output_tokens), 0)::float8 AS output_tokens,
          coalesce(sum(reasoning_tokens), 0)::float8 AS reasoning_tokens,
          coalesce(sum(cached_input_tokens), 0)::float8 AS cached_input_tokens
        FROM ai_usage_events
        ${where}
        GROUP BY ${key}, provider, model_id, operation
      `),
      db.$queryRaw<SliceUnitsRow[]>(Prisma.sql`
        SELECT
          ${key} AS key,
          provider,
          model_id,
          operation,
          u.unit AS unit,
          sum((u.amount)::numeric)::float8 AS amount
        FROM ai_usage_events,
          LATERAL jsonb_each(
            CASE WHEN jsonb_typeof(units) = 'object' THEN units ELSE '{}'::jsonb END
          ) AS u(unit, amount)
        ${where}
          AND jsonb_typeof(u.amount) = 'number'
        GROUP BY ${key}, provider, model_id, operation, u.unit
      `),
    ]);

    const unitsOf = new Map<string, Record<string, number>>();

    for (const row of unitRows ?? []) {
      const id = sliceId(row);
      unitsOf.set(id, { ...(unitsOf.get(id) ?? {}), [row.unit]: Number(row.amount) });
    }

    const perKey = new Map<string | null, CostSum>();
    const overall: CostSum = { amount: 0, currencies: new Set() };

    for (const row of rows ?? []) {
      const usage: AiPricingUsage = {
        provider: row.provider,
        modelId: row.model_id,
        operation: row.operation,
        requests: Number(row.requests),
        inputTokens: Number(row.input_tokens),
        outputTokens: Number(row.output_tokens),
        reasoningTokens: Number(row.reasoning_tokens),
        cachedInputTokens: Number(row.cached_input_tokens),
        units: unitsOf.get(sliceId(row)) ?? {},
      };
      const cost = await this.priceSlice(pricing, usage);

      if (!cost) continue;

      const bucket = perKey.get(row.key) ?? { amount: 0, currencies: new Set<string>() };

      bucket.amount += cost.amount;
      bucket.currencies.add(cost.currency);
      perKey.set(row.key, bucket);
      overall.amount += cost.amount;
      overall.currencies.add(cost.currency);
    }

    return {
      byKey: new Map([...perKey].map(([k, sum]) => [k, toCost(sum)])),
      total: toCost(overall),
    };
  }

  /** One slice's price; a throwing or malformed port is a missing price, logged without the usage. */
  private async priceSlice(pricing: AiPricing, usage: AiPricingUsage): Promise<AiCost | null> {
    try {
      const cost = await pricing.costFor(usage);

      return cost !== null &&
        cost !== undefined &&
        Number.isFinite(cost.amount) &&
        typeof cost.currency === 'string' &&
        cost.currency.length > 0 &&
        cost.currency.length <= 8
        ? { amount: cost.amount, currency: cost.currency }
        : null;
    } catch (error) {
      this.logger.warn(`The AI pricing port threw for ${usage.provider}/${usage.modelId}: ${error instanceof Error ? error.name : 'error'}`);

      return null;
    }
  }

  private async orgNamesFor(groups: Array<{ key: string | null }>): Promise<Map<string, string>> {
    const ids = groups.map((g) => g.key).filter((id): id is string => id !== null);

    if (ids.length === 0) return new Map();

    const orgs = await this.prisma.organization.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });

    return new Map(orgs.map((o) => [o.id, o.name]));
  }

  private async emailsFor(
    groups: Array<{ key: string | null }>,
  ): Promise<Map<string, string>> {
    const ids = groups.map((g) => g.key).filter((id): id is string => id !== null);

    if (ids.length === 0) return new Map();

    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, email: true },
    });

    return new Map(users.map((u) => [u.id, u.email]));
  }
}

function whereSql(range: AiUsageRange, query: AiUsageQuery): Prisma.Sql {
  const clauses: Prisma.Sql[] = [
    Prisma.sql`created_at >= ${range.start}::timestamptz`,
    Prisma.sql`created_at < ${range.end}::timestamptz`,
  ];

  if (query.userId) clauses.push(Prisma.sql`user_id = ${query.userId}::uuid`);
  if (query.provider) clauses.push(Prisma.sql`provider = ${query.provider}`);
  if (query.model) clauses.push(Prisma.sql`model_id = ${query.model}`);
  if (query.orgId) clauses.push(Prisma.sql`org_id = ${query.orgId}::uuid`);
  if (query.feature) clauses.push(Prisma.sql`feature = ${query.feature}`);

  return Prisma.sql`WHERE ${Prisma.join(clauses, ' AND ')}`;
}

/**
 * The window a report covers. Pure, so the defaults and bounds are unit
 * testable without a database.
 *
 * Defaults: `to` = today (UTC); `from` = `to` minus 29 days (30 days
 * inclusive). Refused with 400 `AI_USAGE_RANGE_INVALID` when `from` is after
 * `to` or the span exceeds `MAX_AI_USAGE_RANGE_DAYS` — refused, not clamped:
 * a caller who asked for a year and silently got a quarter would compare the
 * wrong numbers (the job-insights argument).
 */
export function resolveAiUsageRange(from: string | undefined, to: string | undefined, now: Date): AiUsageRange {
  const toDay = to ? parseDay(to) : startOfUtcDay(now);
  const fromDay = from ? parseDay(from) : new Date(toDay.getTime() - (DEFAULT_AI_USAGE_RANGE_DAYS - 1) * DAY_MS);

  if (fromDay.getTime() > toDay.getTime()) {
    throw rangeError('`from` must not be after `to`.');
  }

  const days = Math.round((toDay.getTime() - fromDay.getTime()) / DAY_MS) + 1;

  if (days > MAX_AI_USAGE_RANGE_DAYS) {
    throw rangeError(`The range covers ${days} days; at most ${MAX_AI_USAGE_RANGE_DAYS} are allowed.`);
  }

  return {
    from: isoDay(fromDay),
    to: isoDay(toDay),
    start: fromDay,
    end: new Date(toDay.getTime() + DAY_MS),
  };
}

function parseDay(day: string): Date {
  const parsed = new Date(`${day}T00:00:00.000Z`);

  if (Number.isNaN(parsed.getTime()) || isoDay(parsed) !== day) {
    throw rangeError(`"${day}" is not a valid date (YYYY-MM-DD).`);
  }

  return parsed;
}

function rangeError(message: string): BadRequestException {
  return new BadRequestException({ message, details: { reason: AI_USAGE_RANGE_INVALID } });
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function emptyBucket(): AiUsageBucket {
  return {
    requests: 0,
    failed: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedInputTokens: 0,
    units: {},
    orgKeyRequests: 0,
    orgKeyInputTokens: 0,
    orgKeyOutputTokens: 0,
  };
}

function toBucket(row: AggregateRow, units: Record<string, number>): AiUsageBucket {
  return {
    requests: Number(row.requests),
    failed: Number(row.failed),
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    reasoningTokens: Number(row.reasoning_tokens),
    cachedInputTokens: Number(row.cached_input_tokens),
    units,
    orgKeyRequests: Number(row.org_requests),
    orgKeyInputTokens: Number(row.org_input_tokens),
    orgKeyOutputTokens: Number(row.org_output_tokens),
  };
}

/** Every day of the range, in order, with a zero bucket where nothing was recorded. */
function zeroFilledDays(
  range: AiUsageRange,
  groups: Array<{ key: string | null; bucket: AiUsageBucket }>,
): AiUsageSeriesItem[] {
  const byDay = new Map(groups.map((g) => [g.key, g.bucket]));
  const series: AiUsageSeriesItem[] = [];

  for (let t = range.start.getTime(); t < range.end.getTime(); t += DAY_MS) {
    const day = isoDay(new Date(t));
    series.push({ key: day, label: day, ...(byDay.get(day) ?? emptyBucket()) });
  }

  return series;
}

import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  ALERT_ERROR_CODES,
  ALERT_SEVERITIES,
  type AlertIncident,
  type AlertIncidentListQuery,
  type AlertSummary,
} from '@marinoscar/platform-contract/alerts';

import { PLATFORM_PRISMA } from '../core/index';
import type { AlertIncidentRow, AlertsPrisma } from './data/alerts-db';

/**
 * An incident row with its rule's name and kind.
 *
 * @stability experimental
 */
export interface IncidentWithRule extends AlertIncidentRow {
  /** The rule's display fields. */
  rule: AlertIncidentRule;
}

/**
 * The rule fields an incident listing carries.
 *
 * @stability experimental
 */
export interface AlertIncidentRule {
  /** The rule's display name. */
  name: string;
  /** The rule's kind id. */
  kind: string;
}

/**
 * One page of incidents (the flat paginated envelope).
 *
 * @stability experimental
 */
export interface AlertIncidentPage {
  /** The incidents of this page. */
  items: AlertIncident[];
  /** Incidents across all pages. */
  total: number;
  /** The 1-based page. */
  page: number;
  /** Rows per page. */
  pageSize: number;
  /** Pages across all rows. */
  totalPages: number;
}

const WITH_RULE = { rule: { select: { name: true, kind: true } } } as const;

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

/**
 * Maps an incident row (with its rule's name and kind) to the wire shape.
 *
 * @param row - the row.
 * @returns the incident.
 *
 * @stability experimental
 */
export function toAlertIncident(row: IncidentWithRule): AlertIncident {
  const labels = row.labels && typeof row.labels === 'object' ? (row.labels as Record<string, string>) : {};
  return {
    id: row.id,
    ruleId: row.ruleId,
    ruleName: row.rule.name,
    ruleKind: row.rule.kind,
    labels,
    state: row.state as AlertIncident['state'],
    severity: row.severity as AlertIncident['severity'],
    pendingSince: iso(row.pendingSince),
    firedAt: iso(row.firedAt),
    resolvedAt: iso(row.resolvedAt),
    lastValue: row.lastValue,
    lastSeenAt: row.lastSeenAt.toISOString(),
    summary: row.summary,
    acknowledgedAt: iso(row.acknowledgedAt),
    acknowledgedById: row.acknowledgedById,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Reads incidents, acknowledges them and builds the firing summary.
 *
 * @stability experimental
 */
@Injectable()
export class AlertsIncidentsService {
  constructor(@Inject(PLATFORM_PRISMA) private readonly prisma: AlertsPrisma) {}

  /**
   * A page of incidents, newest first.
   *
   * @param query - filters and paging.
   * @returns the flat paginated list.
   */
  async list(query: AlertIncidentListQuery): Promise<AlertIncidentPage> {
    const where = {
      ...(query.state ? { state: query.state } : {}),
      ...(query.severity ? { severity: query.severity } : {}),
      ...(query.ruleId ? { ruleId: query.ruleId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.alertIncident.findMany({
        where,
        include: WITH_RULE,
        orderBy: [{ createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.alertIncident.count({ where }),
    ]);
    return {
      items: (rows as IncidentWithRule[]).map(toAlertIncident),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  /**
   * One incident.
   *
   * @param id - the incident id.
   * @throws NotFoundException `ALERT_INCIDENT_NOT_FOUND`.
   */
  async get(id: string): Promise<AlertIncident> {
    const row = (await this.prisma.alertIncident.findUnique({ where: { id }, include: WITH_RULE })) as IncidentWithRule | null;
    if (!row) throw new NotFoundException({ message: 'There is no such alert incident.', details: { reason: ALERT_ERROR_CODES.INCIDENT_NOT_FOUND } });
    return toAlertIncident(row);
  }

  /**
   * Acknowledges an incident. Idempotent: a second call keeps the first
   * acknowledgement.
   *
   * @param id - the incident id.
   * @param userId - the administrator.
   * @throws NotFoundException `ALERT_INCIDENT_NOT_FOUND`.
   */
  async acknowledge(id: string, userId: string | null): Promise<AlertIncident> {
    await this.get(id);
    await this.prisma.alertIncident.updateMany({
      where: { id, acknowledgedAt: null },
      data: { acknowledgedAt: new Date(), acknowledgedById: userId },
    });
    return this.get(id);
  }

  /**
   * What the dashboard banner shows: incidents firing now by severity and the
   * newest evaluation among the enabled rules.
   */
  async summary(): Promise<AlertSummary> {
    const counts = await Promise.all(
      ALERT_SEVERITIES.map(async (level) => [level, await this.prisma.alertIncident.count({ where: { state: 'firing', severity: level } })] as const),
    );
    const latest = await this.prisma.alertRule.findFirst({
      where: { enabled: true, lastEvaluatedAt: { not: null } },
      orderBy: { lastEvaluatedAt: 'desc' },
      select: { lastEvaluatedAt: true },
    });
    return {
      firing: Object.fromEntries(counts) as AlertSummary['firing'],
      lastEvaluatedAt: iso(latest?.lastEvaluatedAt ?? null),
    };
  }
}

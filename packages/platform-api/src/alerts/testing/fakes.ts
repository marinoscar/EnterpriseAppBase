import { randomUUID } from 'node:crypto';

import { AlertStoreUnavailableError } from '../alerts.errors';
import type {
  AlertIncidentRow,
  AlertNodeEventRow,
  AlertNodeRow,
  AlertRuleRow,
  AlertsPrisma,
} from '../data/alerts-db';
import type { AlertEvaluationContext, AlertMetricTable, AlertRuleKind, AlertTelemetryAccess, AlertVerdict } from '../alerts.types';

// =============================================================================
// In-memory fakes for the alerts slice (issue #1047)
// =============================================================================
//
// `createInMemoryAlertsPrisma` is a small Prisma stand-in: enough `where`
// operators (equality, `in`, `not`, `lt/lte/gt/gte`, `startsWith`, `OR`), the
// `orderBy`/`skip`/`take` the services use, `include: { rule }` and the partial
// unique index `alert_incidents_open_uniq_idx` (a second open incident for a
// rule and labels throws a `P2002`-shaped error). It lets the evaluator, the
// services and the conformance suite run without a database.
// =============================================================================

type Row = Record<string, any>;

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([field, cond]) => {
    if (field === 'OR') return (cond as Row[]).some((branch) => matches(row, branch));
    if (field === 'AND') return (cond as Row[]).every((branch) => matches(row, branch));
    const value = row[field];
    if (cond instanceof Date || cond === null || typeof cond !== 'object') {
      return cond instanceof Date ? value instanceof Date && value.getTime() === cond.getTime() : value === cond;
    }
    const c = cond as Row;
    if ('in' in c && !(c.in as unknown[]).includes(value)) return false;
    if ('not' in c && (c.not === null ? value === null : value === c.not)) return false;
    if ('startsWith' in c && !(typeof value === 'string' && value.startsWith(c.startsWith))) return false;
    for (const op of ['lt', 'lte', 'gt', 'gte'] as const) {
      if (!(op in c)) continue;
      if (value === null || value === undefined) return false;
      const a = value instanceof Date ? value.getTime() : value;
      const b = c[op] instanceof Date ? c[op].getTime() : c[op];
      if (op === 'lt' && !(a < b)) return false;
      if (op === 'lte' && !(a <= b)) return false;
      if (op === 'gt' && !(a > b)) return false;
      if (op === 'gte' && !(a >= b)) return false;
    }
    return true;
  });
}

function sorted(rows: Row[], orderBy: Row | Row[] | undefined): Row[] {
  const keys = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []).flatMap((o) => Object.entries(o));
  if (keys.length === 0) return rows;
  return [...rows].sort((x, y) => {
    for (const [field, dir] of keys) {
      const a = x[field] instanceof Date ? x[field].getTime() : x[field];
      const b = y[field] instanceof Date ? y[field].getTime() : y[field];
      if (a === b) continue;
      if (a === null || a === undefined) return 1;
      if (b === null || b === undefined) return -1;
      return (a < b ? -1 : 1) * (dir === 'desc' ? -1 : 1);
    }
    return 0;
  });
}

function delegate(
  rows: Row[],
  defaults: () => Row,
  guard?: (candidate: Row, all: Row[]) => void,
  decorate?: (row: Row, args: Row) => Row,
) {
  const out = (row: Row, args: Row = {}) => (decorate ? decorate(row, args) : row);
  const find = (args: Row = {}) => {
    const hit = sorted(rows.filter((r) => matches(r, args.where)), args.orderBy);
    const skipped = args.skip ? hit.slice(args.skip) : hit;
    return args.take ? skipped.slice(0, args.take) : skipped;
  };
  return {
    rows,
    findMany: async (args: Row = {}) => find(args).map((r) => out(r, args)),
    findFirst: async (args: Row = {}) => {
      const [first] = find(args);
      return first ? out(first, args) : null;
    },
    findUnique: async (args: Row) => {
      const [first] = rows.filter((r) => matches(r, args.where));
      return first ? out(first, args) : null;
    },
    create: async (args: Row) => {
      const row = { ...defaults(), ...args.data };
      guard?.(row, rows);
      rows.push(row);
      return out(row, args);
    },
    update: async (args: Row) => {
      const row = rows.find((r) => matches(r, args.where));
      if (!row) throw Object.assign(new Error('Record not found'), { code: 'P2025' });
      Object.assign(row, args.data);
      return out(row, args);
    },
    updateMany: async (args: Row) => {
      const hit = rows.filter((r) => matches(r, args.where));
      hit.forEach((r) => Object.assign(r, args.data));
      return { count: hit.length };
    },
    delete: async (args: Row) => {
      const index = rows.findIndex((r) => matches(r, args.where));
      if (index < 0) throw Object.assign(new Error('Record not found'), { code: 'P2025' });
      const [row] = rows.splice(index, 1);
      return row;
    },
    deleteMany: async (args: Row = {}) => {
      const hit = rows.filter((r) => matches(r, args.where));
      for (const r of hit) rows.splice(rows.indexOf(r), 1);
      return { count: hit.length };
    },
    count: async (args: Row = {}) => rows.filter((r) => matches(r, args.where)).length,
  };
}

/**
 * The in-memory client: the typed {@link AlertsPrisma} plus the backing arrays.
 *
 * @stability experimental
 */
export interface InMemoryAlertsPrisma extends AlertsPrisma {
  /** `alert_rules`. */
  readonly rules: AlertRuleRow[];
  /** `alert_incidents`. */
  readonly incidents: AlertIncidentRow[];
  /** `worker_node_events`. */
  readonly nodeEvents: AlertNodeEventRow[];
  /** `worker_nodes`. */
  readonly nodes: AlertNodeRow[];
  /** Adds a rule with sensible defaults; returns the stored row. */
  addRule(partial: Partial<AlertRuleRow> & Pick<AlertRuleRow, 'kind'>): AlertRuleRow;
}

/**
 * Builds the in-memory client.
 *
 * @returns an empty client.
 *
 * @stability experimental
 */
export function createInMemoryAlertsPrisma(): InMemoryAlertsPrisma {
  const rules: AlertRuleRow[] = [];
  const incidents: AlertIncidentRow[] = [];
  const nodeEvents: AlertNodeEventRow[] = [];
  const nodes: AlertNodeRow[] = [];
  const now = () => new Date();

  const ruleDelegate = delegate(
    rules as Row[],
    () => ({
      id: randomUUID(), orgId: null, key: null, description: null, enabled: false, severity: 'warning', config: {}, forSeconds: 0,
      cooldownSeconds: 900, notifyChannels: [], webhook: true, createdById: null, createdAt: now(), updatedAt: now(),
      lastEvaluatedAt: null, lastError: null,
    }),
    (candidate, all) => {
      if (candidate.key && all.some((r) => r.key === candidate.key)) throw Object.assign(new Error('Unique constraint failed on key'), { code: 'P2002' });
    },
  );

  const incidentDelegate = delegate(
    incidents as Row[],
    () => ({
      id: randomUUID(), labels: {}, pendingSince: null, firedAt: null, resolvedAt: null, lastValue: null, acknowledgedAt: null,
      acknowledgedById: null, createdAt: now(),
    }),
    (candidate, all) => {
      const open = ['pending', 'firing'];
      if (open.includes(candidate.state) && all.some((r) => open.includes(r.state) && r.ruleId === candidate.ruleId && r.labelsKey === candidate.labelsKey)) {
        throw Object.assign(new Error('Unique constraint failed on alert_incidents_open_uniq_idx'), { code: 'P2002' });
      }
    },
    (row, args) => (args.include?.rule ? { ...row, rule: { name: rules.find((r) => r.id === row.ruleId)?.name ?? '', kind: rules.find((r) => r.id === row.ruleId)?.kind ?? '' } } : row),
  );
  // A cascade, as the foreign key does it.
  const deleteRule = ruleDelegate.delete;
  ruleDelegate.delete = async (args: Row) => {
    const row = await deleteRule(args);
    for (const i of incidents.filter((x) => x.ruleId === row.id)) incidents.splice(incidents.indexOf(i), 1);
    return row;
  };

  return {
    rules,
    incidents,
    nodeEvents,
    nodes,
    alertRule: ruleDelegate as never,
    alertIncident: incidentDelegate as never,
    workerNodeEvent: delegate(nodeEvents as Row[], () => ({ id: randomUUID(), attrs: {}, receivedAt: now(), occurredAt: now() })) as never,
    workerNode: delegate(nodes as Row[], () => ({ id: randomUUID(), lastHeartbeatAt: null })) as never,
    addRule(partial) {
      const base: AlertRuleRow = {
        id: randomUUID(), orgId: null, key: null, name: 'Rule A', description: null, enabled: true, severity: 'warning', config: {},
        forSeconds: 0, cooldownSeconds: 900, notifyChannels: [], webhook: true, createdById: null, createdAt: now(), updatedAt: now(),
        lastEvaluatedAt: null, lastError: null, ...partial,
      };
      rules.push(base);
      return base;
    },
  };
}

/**
 * A scripted kind for tests: `evaluate` returns what `script.next` holds, or
 * throws it when it is an Error.
 *
 * @stability experimental
 */
export interface FakeKindScript {
  /** What the next evaluation returns (an Error is thrown). */
  next: ReadonlyArray<import('../alerts.types').AlertObservation> | Error;
  /** How many times it ran. */
  calls: number;
}

/**
 * A scripted kind and its script.
 *
 * @stability experimental
 */
export interface FakeKind {
  /** The kind, ready for `registerAlertRuleKind`. */
  kind: AlertRuleKind;
  /** What it returns next, and how often it ran. */
  script: FakeKindScript;
}

/**
 * Builds a scripted rule kind, `eventDriven` when asked.
 *
 * @param id - the kind id.
 * @param configSchema - the config schema (any object by default).
 * @returns the kind and its script.
 *
 * @stability experimental
 */
export function createFakeKind(
  id: string,
  configSchema: AlertRuleKind['configSchema'],
  options: { eventDriven?: boolean } = {},
): FakeKind {
  const script: FakeKindScript = { next: [], calls: 0 };
  const kind: AlertRuleKind = {
    id,
    label: `Fake ${id}`,
    description: 'A scripted kind for tests.',
    configSchema,
    eventDriven: options.eventDriven,
    async evaluate() {
      script.calls += 1;
      if (script.next instanceof Error) throw script.next;
      return [...script.next];
    },
    describe: () => `fake ${id}`,
  };
  return { kind, script };
}

/**
 * An evaluation context over the given database and fakes; every optional
 * source throws `AlertStoreUnavailableError` unless supplied.
 *
 * @param db - the database.
 * @param parts - what the test supplies.
 * @returns the context.
 *
 * @stability experimental
 */
export function createFakeContext(
  db: AlertsPrisma,
  parts: { now?: Date; telemetry?: AlertTelemetryAccess; verdict?: AlertVerdict; staleHeartbeatSeconds?: number; tables?: AlertMetricTable[] } = {},
): AlertEvaluationContext {
  return {
    now: parts.now ?? new Date(),
    signal: new AbortController().signal,
    db,
    telemetry: async () => {
      if (!parts.telemetry) throw new AlertStoreUnavailableError('no telemetry in this test');
      return parts.telemetry;
    },
    verdict: async () => {
      if (!parts.verdict) throw new AlertStoreUnavailableError('no verdict in this test');
      return parts.verdict;
    },
    staleHeartbeatSeconds: async () => parts.staleHeartbeatSeconds ?? 90,
  };
}

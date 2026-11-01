// =============================================================================
// The data the alerts slice reads and writes, structurally (issue #1047)
// =============================================================================
//
// Like every other slice, alerts never imports a generated Prisma client: the
// package is built and tested before any app's `prisma generate`. The client
// arrives through the core port `PLATFORM_PRISMA` and is seen as
// {@link AlertsPrisma}. Every delegate method takes Prisma's arguments untyped
// and returns the model's row; the rows mirror the `alerts` fragment of
// `@marinoscar/platform-db` column for column (a column added there is added
// here in the same change).
//
// `worker_nodes` and `worker_node_events` are the nodes slice's tables; only
// the columns the `node_event` and `node_offline` kinds read are named.
// =============================================================================

/**
 * Prisma's arguments for one delegate call, untyped on purpose: the app's
 * client checks them at run time.
 *
 * @stability experimental
 */
export type AlertsQueryArgs = any;

/**
 * One `alert_rules` row.
 *
 * @stability experimental
 */
export interface AlertRuleRow {
  /** Primary key. */
  id: string;
  /** Reserved for organization-scoped rules; `null` for a deployment rule. */
  orgId: string | null;
  /** Stable key of a seeded starter rule, else `null`. */
  key: string | null;
  /** Display name. */
  name: string;
  /** Free text, or `null`. */
  description: string | null;
  /** Whether the evaluator runs it. */
  enabled: boolean;
  /** The kind id (`registerAlertRuleKind`). */
  kind: string;
  /** `info`, `warning` or `critical`. */
  severity: string;
  /** The kind's config (validated by the kind's schema). */
  config: unknown;
  /** The condition must hold this long before firing. */
  forSeconds: number;
  /** Minimum gap between notifications for the same label set. */
  cooldownSeconds: number;
  /** Notification channel ids; empty means no restriction. */
  notifyChannels: string[];
  /** Also emit the webhook events. */
  webhook: boolean;
  /** The creating administrator, or `null`. */
  createdById: string | null;
  /** Creation time. */
  createdAt: Date;
  /** Last update. */
  updatedAt: Date;
  /** The last evaluation. */
  lastEvaluatedAt: Date | null;
  /** The last evaluation error. */
  lastError: string | null;
}

/**
 * One `alert_incidents` row.
 *
 * @stability experimental
 */
export interface AlertIncidentRow {
  /** Primary key. */
  id: string;
  /** The rule. */
  ruleId: string;
  /** Canonical sorted `k=v,k=v`; `''` when unlabelled. */
  labelsKey: string;
  /** The label set. */
  labels: unknown;
  /** `pending`, `firing` or `resolved`. */
  state: string;
  /** The rule's severity when the incident was last touched. */
  severity: string;
  /** When the condition first held (pending). */
  pendingSince: Date | null;
  /** When it fired. */
  firedAt: Date | null;
  /** When it resolved. */
  resolvedAt: Date | null;
  /** The last observed value. */
  lastValue: number | null;
  /** The last evaluation that saw it breached. */
  lastSeenAt: Date;
  /** One human sentence. */
  summary: string;
  /** When an administrator acknowledged it. */
  acknowledgedAt: Date | null;
  /** Who. */
  acknowledgedById: string | null;
  /** Creation time. */
  createdAt: Date;
}

/**
 * The columns of `worker_node_events` the `node_event` kind reads.
 *
 * @stability experimental
 */
export interface AlertNodeEventRow {
  /** Primary key. */
  id: string;
  /** The node. */
  nodeId: string;
  /** Dotted event type. */
  type: string;
  /** `info`, `warning` or `critical`. */
  severity: string;
  /** The node's scalar attributes. */
  attrs: unknown;
  /** The node's clock. */
  occurredAt: Date;
  /** The server's clock. */
  receivedAt: Date;
}

/**
 * The columns of `worker_nodes` the `node_offline` kind reads.
 *
 * @stability experimental
 */
export interface AlertNodeRow {
  /** Primary key. */
  id: string;
  /** Operator-facing name. */
  name: string;
  /** `online`, `draining`, `offline` or `disabled`. */
  status: string;
  /** The last heartbeat, or `null`. */
  lastHeartbeatAt: Date | null;
}

/**
 * The result of a bulk write.
 *
 * @stability experimental
 */
export interface AlertsBatchResult {
  /** Rows affected. */
  count: number;
}

/** The delegate methods the slice calls on one model. @stability experimental */
export interface AlertsDelegate<Row> {
  /** Reads rows. */
  findMany(args?: AlertsQueryArgs): Promise<Row[]>;
  /** Reads one row. */
  findUnique(args: AlertsQueryArgs): Promise<Row | null>;
  /** Reads the first matching row. */
  findFirst(args?: AlertsQueryArgs): Promise<Row | null>;
  /** Creates a row. */
  create(args: AlertsQueryArgs): Promise<Row>;
  /** Updates one row. */
  update(args: AlertsQueryArgs): Promise<Row>;
  /** Updates many rows. */
  updateMany(args: AlertsQueryArgs): Promise<AlertsBatchResult>;
  /** Deletes one row. */
  delete(args: AlertsQueryArgs): Promise<Row>;
  /** Deletes many rows. */
  deleteMany(args?: AlertsQueryArgs): Promise<AlertsBatchResult>;
  /** Counts rows. */
  count(args?: AlertsQueryArgs): Promise<number>;
}

/**
 * The models the alerts slice touches, as one client sees them.
 *
 * @stability experimental
 */
export interface AlertsPrisma {
  /** `alert_rules`. */
  alertRule: AlertsDelegate<AlertRuleRow>;
  /** `alert_incidents`. */
  alertIncident: AlertsDelegate<AlertIncidentRow>;
  /** `worker_node_events` (the nodes slice). */
  workerNodeEvent: Pick<AlertsDelegate<AlertNodeEventRow>, 'findMany'>;
  /** `worker_nodes` (the nodes slice). */
  workerNode: Pick<AlertsDelegate<AlertNodeRow>, 'findMany'>;
}

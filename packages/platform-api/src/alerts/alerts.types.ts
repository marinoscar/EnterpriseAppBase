import type { z } from 'zod';
import type { AlertObservation, AlertSeverity } from '@marinoscar/platform-contract/alerts';

import type { TelemetryQueryFacade } from '../telemetry/index';
import type { AlertsPrisma } from './data/alerts-db';

export type { AlertObservation } from '@marinoscar/platform-contract/alerts';

/**
 * The rule a kind evaluates: the row's identity and the kind's parsed config.
 *
 * @typeParam C - the kind's config type.
 *
 * @stability experimental
 */
export interface AlertRuleView<C = unknown> {
  /** The rule id. */
  readonly id: string;
  /** The stable key of a starter rule, else `null`. */
  readonly key: string | null;
  /** Display name, for summaries. */
  readonly name: string;
  /** The rule's severity. */
  readonly severity: AlertSeverity;
  /** The kind id. */
  readonly kind: string;
  /** The config, already parsed by the kind's `configSchema`. */
  readonly config: C;
}

/**
 * One metric table of the telemetry store, as the `metric_threshold` kind sees it.
 *
 * @stability experimental
 */
export interface AlertMetricTable {
  /** The table name. */
  readonly name: string;
  /** Every column. */
  readonly columns: ReadonlySet<string>;
  /** The series-identifying columns (tags), sorted. */
  readonly tags: readonly string[];
}

/**
 * What a kind may read from the telemetry store.
 *
 * @stability experimental
 */
export interface AlertTelemetryAccess {
  /** The guarded query facade (SQL guard, row cap, timeout). */
  readonly query: TelemetryQueryFacade;
  /** The metric tables the store has, by table name. */
  readonly tables: ReadonlyMap<string, AlertMetricTable>;
}

/**
 * The dashboard verdict, as the `verdict` kind reads it.
 *
 * @stability experimental
 */
export interface AlertVerdict {
  /** `healthy`, `degraded`, `critical` or `no_data`. */
  readonly level: string;
  /** One line per rule that fired. */
  readonly reasons: readonly string[];
}

/**
 * Everything a kind may touch while evaluating. Kinds are functions of this
 * context, so they run against fakes in a test.
 *
 * @stability experimental
 */
export interface AlertEvaluationContext {
  /** The instant the evaluation is for. */
  readonly now: Date;
  /** Aborted when the rule's time budget is spent. */
  readonly signal: AbortSignal;
  /** The database (the nodes tables included), read-only for a kind. */
  readonly db: AlertsPrisma;
  /**
   * The telemetry store.
   *
   * @throws AlertStoreUnavailableError when it is not configured, disabled or unreachable.
   */
  telemetry(): Promise<AlertTelemetryAccess>;
  /**
   * The dashboard verdict, computed in-process.
   *
   * @throws AlertStoreUnavailableError when it cannot be computed.
   */
  verdict(): Promise<AlertVerdict>;
  /** The fleet's stale-heartbeat window in seconds (the `nodes` policy). */
  staleHeartbeatSeconds(): Promise<number>;
}

/**
 * A node event, as the event path hands it to a kind.
 *
 * @stability experimental
 */
export interface AlertNodeEventPayload {
  /** The node. */
  readonly nodeId: string;
  /** Its name. */
  readonly nodeName: string;
  /** The dotted event type. */
  readonly type: string;
  /** `info`, `warning` or `critical`. */
  readonly severity: string;
  /** The node's scalar attributes. */
  readonly attrs: Readonly<Record<string, string | number | boolean>>;
  /** When it happened (ISO 8601). */
  readonly occurredAt: string;
}

/**
 * One rule kind: how a rule of this kind is validated, evaluated and described.
 *
 * @typeParam C - the parsed config type.
 *
 * @example
 * ```ts
 * registerAlertRuleKind({
 *   id: 'queue_stuck',
 *   label: 'Queue stuck',
 *   description: 'The queue has pending jobs and nothing is running.',
 *   configSchema: z.object({}).strict(),
 *   evaluate: async (ctx) => [{ labels: {}, value: null, breached: false, summary: 'ok' }],
 *   describe: () => 'The queue has pending jobs and nothing is running.',
 * });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export interface AlertRuleKind<C = any> {
  /** Lower snake case id; PERMANENT once rules of this kind exist. */
  readonly id: string;
  /** Short label for the rule editor. */
  readonly label: string;
  /** One sentence on what the kind watches. */
  readonly description: string;
  /** Validates (and defaults) a rule's `config`. */
  readonly configSchema: z.ZodType<C>;
  /** The kind reacts to node events as well as to the periodic evaluation. */
  readonly eventDriven?: boolean;
  /**
   * Evaluates one rule now. Returns one observation per label set it can
   * tell about, breached or not; a label set that was breached and is not
   * returned any more counts as clear. Throws `AlertStoreUnavailableError`
   * when its data source is down.
   */
  evaluate(ctx: AlertEvaluationContext, rule: AlertRuleView<C>): Promise<AlertObservation[]>;
  /**
   * For an `eventDriven` kind: whether `event` can change this rule's
   * observations (the event path skips the rule when it cannot). Pure.
   */
  matchesEvent?(config: C, event: AlertNodeEventPayload): boolean;
  /** A one-line description of what a rule of this kind with this config watches. */
  describe(rule: AlertRuleView<C>): string;
}

/**
 * The OPTIONAL webhook port: a way to emit an event to webhook subscribers.
 * Bind it to the webhooks slice's emitter (or any function) with
 * {@link ALERTS_WEBHOOK_EMITTER}; without a binding the alerts slice emits
 * nothing and compiles without the webhooks slice.
 *
 * @extensionPoint token
 * @stability experimental
 */
export interface AlertsWebhookEmitter {
  /**
   * Emits one event.
   *
   * @param eventKey - `alerts.alert.fired` or `alerts.alert.resolved`.
   * @param data - the event data (`alertWebhookDataSchema`).
   * @param ctx - the audience: `orgId: null` is the system audience.
   */
  emit(eventKey: string, data: Record<string, unknown>, ctx: { orgId: string | null }): Promise<void>;
  /** Optional: called once so the emitter can register the event keys it will be asked to emit. */
  registerEvents?(events: ReadonlyArray<{ key: string; label: string; description: string }>): void;
}

// =============================================================================
// The rule editor's model (issue #1047): a form draft and the payload it builds
// =============================================================================
//
// The editor edits a flat, string-friendly DRAFT; `buildAlertRulePayload`
// turns it into the wire body (`CreateAlertRule` / `UpdateAlertRule`) with the
// kind's config, checked against the contract's schemas so a field error is
// shown before the request. The API validates again and decides: this check
// only spares a round trip.
// =============================================================================

import {
  ALERT_COOLDOWN_SECONDS_DEFAULT,
  ALERT_KIND_IDS,
  ALERT_NODE_EVENT_RESOLVE_AFTER_DEFAULT,
  createAlertRuleSchema,
  emptyAlertConfigSchema,
  metricThresholdConfigSchema,
  nodeEventConfigSchema,
  verdictConfigSchema,
} from '@marinoscar/platform-contract/alerts';
import type {
  AlertAggregation,
  AlertComparator,
  AlertFilterOp,
  AlertRule,
  AlertSeverity,
  CreateAlertRule,
  UpdateAlertRule,
} from '@marinoscar/platform-contract/alerts';

/**
 * One key and value pair of the editor (event attributes).
 *
 * @stability experimental
 */
export interface AlertAttrDraft {
  /** The attribute name. */
  key: string;
  /** The value, compared as text by the API. */
  value: string;
}

/**
 * The `metric_threshold` part of a draft.
 *
 * @stability experimental
 */
export interface MetricThresholdDraft {
  /** The metric or table name. */
  metric: string;
  /** How the window's points are reduced. */
  aggregation: AlertAggregation;
  /** The window, in seconds. */
  windowSeconds: number;
  /** How the value is compared. */
  comparator: AlertComparator;
  /** The threshold as typed (parsed when the payload is built). */
  threshold: string;
  /** Attribute columns to group by. */
  groupBy: string[];
  /** Attribute filters. */
  filters: Array<{
    /** The attribute (column) to compare. */
    attr: string;
    /** `eq` or `neq`. */
    op: AlertFilterOp;
    /** The value, compared as text. */
    value: string;
  }>;
}

/**
 * The `node_event` part of a draft.
 *
 * @stability experimental
 */
export interface NodeEventDraft {
  /** Event types (or a `prefix.*`). */
  eventTypes: string[];
  /** The least severity that counts; `''` for any. */
  minSeverity: AlertSeverity | '';
  /** Only these node ids; empty for every node. */
  nodeIds: string[];
  /** Attributes the event must carry. */
  attrs: AlertAttrDraft[];
  /** Event types that resolve the incident; empty for none. */
  recoveryEventTypes: string[];
  /** Attributes the recovery event must carry. */
  recoveryAttrs: AlertAttrDraft[];
  /** Seconds until an incident resolves on its own. */
  resolveAfterSeconds: number;
}

/**
 * The editor's state for one rule.
 *
 * @stability experimental
 */
export interface AlertRuleDraft {
  /** The rule name. */
  name: string;
  /** The description; `''` for none. */
  description: string;
  /** Whether the rule is evaluated. */
  enabled: boolean;
  /** The kind id (fixed once the rule exists). */
  kind: string;
  /** The severity of its incidents. */
  severity: AlertSeverity;
  /** Seconds the condition must hold before firing. */
  forSeconds: number;
  /** Minimum seconds between two fires of the same labels. */
  cooldownSeconds: number;
  /** Notification channel ids; empty for every channel. */
  notifyChannels: string[];
  /** Whether webhooks are also emitted. */
  webhook: boolean;
  /** The `metric_threshold` config. */
  metric: MetricThresholdDraft;
  /** The `node_event` config. */
  nodeEvent: NodeEventDraft;
  /** The `verdict` config. */
  verdict: {
    /** The least verdict level that fires. */
    minLevel: 'degraded' | 'critical';
  };
  /** The config of a kind the editor has no form for, as JSON text. */
  rawConfig: string;
}

/**
 * The result of {@link buildAlertRulePayload}: the body, or the field errors.
 *
 * @stability experimental
 */
export type AlertRulePayloadResult<T> =
  | {
      /** The draft is valid. */
      ok: true;
      /** The request body. */
      value: T;
    }
  | {
      /** The draft is not valid. */
      ok: false;
      /** One sentence per field (`name`, `metric`, `threshold`, `eventTypes`, `config`, ...). */
      errors: Record<string, string>;
    };

/**
 * The kinds the editor has a dedicated form for. Any other kind (an app's
 * own, registered with `registerAlertRuleKind`) is edited as JSON.
 *
 * @stability experimental
 */
export const ALERT_FORM_KINDS: readonly string[] = Object.freeze([
  ALERT_KIND_IDS.METRIC_THRESHOLD,
  ALERT_KIND_IDS.NODE_EVENT,
  ALERT_KIND_IDS.VERDICT,
  ALERT_KIND_IDS.NODE_OFFLINE,
  ALERT_KIND_IDS.TELEMETRY_UNAVAILABLE,
]);

/** Kinds whose config is always `{}`. */
const EMPTY_CONFIG_KINDS: ReadonlySet<string> = new Set([ALERT_KIND_IDS.NODE_OFFLINE, ALERT_KIND_IDS.TELEMETRY_UNAVAILABLE]);

/**
 * Whether a kind takes no configuration (`node_offline`, `telemetry_unavailable`).
 *
 * @param kind - the kind id.
 * @returns `true` when the config is always `{}`.
 *
 * @stability experimental
 */
export function alertKindHasNoConfig(kind: string): boolean {
  return EMPTY_CONFIG_KINDS.has(kind);
}

/**
 * A blank draft of a kind, with the API's defaults.
 *
 * @param kind - the kind id; default `metric_threshold`.
 * @returns the draft.
 *
 * @stability experimental
 */
export function emptyAlertRuleDraft(kind: string = ALERT_KIND_IDS.METRIC_THRESHOLD): AlertRuleDraft {
  return {
    name: '',
    description: '',
    enabled: false,
    kind,
    severity: 'warning',
    forSeconds: 0,
    cooldownSeconds: ALERT_COOLDOWN_SECONDS_DEFAULT,
    notifyChannels: [],
    webhook: true,
    metric: {
      metric: '',
      aggregation: 'avg',
      windowSeconds: 300,
      comparator: 'gt',
      threshold: '',
      groupBy: [],
      filters: [],
    },
    nodeEvent: {
      eventTypes: [],
      minSeverity: '',
      nodeIds: [],
      attrs: [],
      recoveryEventTypes: [],
      recoveryAttrs: [],
      resolveAfterSeconds: ALERT_NODE_EVENT_RESOLVE_AFTER_DEFAULT,
    },
    verdict: { minLevel: 'critical' },
    rawConfig: '{}',
  };
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function attrsOf(value: unknown): AlertAttrDraft[] {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).map(([key, raw]) => ({ key, value: String(raw) }));
}

/**
 * The draft of an existing rule, its config spread into the kind's form.
 *
 * @param rule - the rule as the API returned it.
 * @returns the draft.
 *
 * @stability experimental
 */
export function alertRuleDraftFromRule(rule: AlertRule): AlertRuleDraft {
  const draft = emptyAlertRuleDraft(rule.kind);
  const config = rule.config;
  draft.name = rule.name;
  draft.description = rule.description ?? '';
  draft.enabled = rule.enabled;
  draft.severity = rule.severity;
  draft.forSeconds = rule.forSeconds;
  draft.cooldownSeconds = rule.cooldownSeconds;
  draft.notifyChannels = [...rule.notifyChannels];
  draft.webhook = rule.webhook;
  draft.rawConfig = JSON.stringify(config, null, 2);
  if (rule.kind === ALERT_KIND_IDS.METRIC_THRESHOLD) {
    const filters = Array.isArray(config['filters']) ? (config['filters'] as Array<Record<string, unknown>>) : [];
    draft.metric = {
      metric: typeof config['metric'] === 'string' ? config['metric'] : '',
      aggregation: (config['aggregation'] as AlertAggregation | undefined) ?? 'avg',
      windowSeconds: typeof config['windowSeconds'] === 'number' ? config['windowSeconds'] : 300,
      comparator: (config['comparator'] as AlertComparator | undefined) ?? 'gt',
      threshold: typeof config['threshold'] === 'number' ? String(config['threshold']) : '',
      groupBy: strings(config['groupBy']),
      filters: filters.map((filter) => ({
        attr: String(filter['attr'] ?? ''),
        op: filter['op'] === 'neq' ? 'neq' : 'eq',
        value: String(filter['value'] ?? ''),
      })),
    };
  } else if (rule.kind === ALERT_KIND_IDS.NODE_EVENT) {
    const recovery = (config['recovery'] ?? null) as Record<string, unknown> | null;
    draft.nodeEvent = {
      eventTypes: strings(config['eventTypes']),
      minSeverity: (config['minSeverity'] as AlertSeverity | undefined) ?? '',
      nodeIds: strings(config['nodeIds']),
      attrs: attrsOf(config['attrs']),
      recoveryEventTypes: recovery ? strings(recovery['eventTypes']) : [],
      recoveryAttrs: recovery ? attrsOf(recovery['attrs']) : [],
      resolveAfterSeconds:
        typeof config['resolveAfterSeconds'] === 'number' ? config['resolveAfterSeconds'] : ALERT_NODE_EVENT_RESOLVE_AFTER_DEFAULT,
    };
  } else if (rule.kind === ALERT_KIND_IDS.VERDICT) {
    draft.verdict = { minLevel: config['minLevel'] === 'degraded' ? 'degraded' : 'critical' };
  }
  return draft;
}

function attrsRecord(attrs: readonly AlertAttrDraft[]): Record<string, string> | undefined {
  const entries = attrs.filter((attr) => attr.key.trim() !== '').map((attr) => [attr.key.trim(), attr.value] as const);
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

/** Field names the config's zod issues map onto, by their first path segment. */
function issueErrors(issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const field = issue.path.length > 0 ? String(issue.path[0]) : 'config';
    errors[field] ??= issue.message;
  }
  return errors;
}

/**
 * The config of a draft's kind, checked against the contract's schema.
 *
 * @param draft - the editor state.
 * @returns the config, or the field errors.
 *
 * @stability experimental
 */
export function buildAlertRuleConfig(draft: AlertRuleDraft): AlertRulePayloadResult<Record<string, unknown>> {
  if (draft.kind === ALERT_KIND_IDS.METRIC_THRESHOLD) {
    const m = draft.metric;
    const thresholdText = m.threshold.trim();
    const threshold = thresholdText === '' ? Number.NaN : Number(thresholdText);
    const filters = m.filters.filter((filter) => filter.attr.trim() !== '');
    const config = {
      metric: m.metric.trim(),
      aggregation: m.aggregation,
      windowSeconds: m.windowSeconds,
      comparator: m.comparator,
      threshold,
      ...(m.groupBy.length > 0 ? { groupBy: m.groupBy } : {}),
      ...(filters.length > 0 ? { filters: filters.map((f) => ({ attr: f.attr.trim(), op: f.op, value: f.value })) } : {}),
    };
    const errors: Record<string, string> = {};
    if (config.metric === '') errors['metric'] = 'Choose a metric.';
    if (!Number.isFinite(threshold)) errors['threshold'] = 'Enter a number.';
    const parsed = metricThresholdConfigSchema.safeParse(config);
    if (!parsed.success) Object.assign(errors, { ...issueErrors(parsed.error.issues), ...errors });
    return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value: config };
  }
  if (draft.kind === ALERT_KIND_IDS.NODE_EVENT) {
    const n = draft.nodeEvent;
    const attrs = attrsRecord(n.attrs);
    const recoveryAttrs = attrsRecord(n.recoveryAttrs);
    const config = {
      eventTypes: n.eventTypes,
      ...(n.minSeverity ? { minSeverity: n.minSeverity } : {}),
      ...(n.nodeIds.length > 0 ? { nodeIds: n.nodeIds } : {}),
      ...(attrs ? { attrs } : {}),
      ...(n.recoveryEventTypes.length > 0
        ? { recovery: { eventTypes: n.recoveryEventTypes, ...(recoveryAttrs ? { attrs: recoveryAttrs } : {}) } }
        : {}),
      resolveAfterSeconds: n.resolveAfterSeconds,
    };
    const errors: Record<string, string> = {};
    if (n.eventTypes.length === 0) errors['eventTypes'] = 'Choose at least one event type.';
    const parsed = nodeEventConfigSchema.safeParse(config);
    if (!parsed.success) Object.assign(errors, { ...issueErrors(parsed.error.issues), ...errors });
    return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value: config };
  }
  if (draft.kind === ALERT_KIND_IDS.VERDICT) {
    const config = { minLevel: draft.verdict.minLevel };
    const parsed = verdictConfigSchema.safeParse(config);
    return parsed.success ? { ok: true, value: config } : { ok: false, errors: issueErrors(parsed.error.issues) };
  }
  if (alertKindHasNoConfig(draft.kind)) {
    const parsed = emptyAlertConfigSchema.safeParse({});
    return parsed.success ? { ok: true, value: {} } : { ok: false, errors: { config: 'Invalid configuration.' } };
  }
  try {
    const value: unknown = JSON.parse(draft.rawConfig === '' ? '{}' : draft.rawConfig);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, errors: { config: 'The configuration must be a JSON object.' } };
    }
    return { ok: true, value: value as Record<string, unknown> };
  } catch {
    return { ok: false, errors: { config: 'The configuration is not valid JSON.' } };
  }
}

/**
 * The request body of a draft: `create` for a new rule (with the kind),
 * `update` for an existing one (every editable field, never the kind).
 *
 * @param draft - the editor state.
 * @param mode - `create` or `update`.
 * @returns the body, or the field errors.
 *
 * @example
 * ```ts
 * const result = buildAlertRulePayload(draft, 'create');
 * if (result.ok) await alerts.createRule(result.value);
 * ```
 *
 * @stability experimental
 */
export function buildAlertRulePayload(draft: AlertRuleDraft, mode: 'create'): AlertRulePayloadResult<CreateAlertRule>;
export function buildAlertRulePayload(draft: AlertRuleDraft, mode: 'update'): AlertRulePayloadResult<UpdateAlertRule>;
export function buildAlertRulePayload(
  draft: AlertRuleDraft,
  mode: 'create' | 'update',
): AlertRulePayloadResult<CreateAlertRule | UpdateAlertRule> {
  const errors: Record<string, string> = {};
  const config = buildAlertRuleConfig(draft);
  if (!config.ok) Object.assign(errors, config.errors);
  const name = draft.name.trim();
  if (name === '') errors['name'] = 'Enter a name.';
  if (!Number.isInteger(draft.forSeconds) || draft.forSeconds < 0) errors['forSeconds'] = 'Enter whole seconds, 0 or more.';
  if (!Number.isInteger(draft.cooldownSeconds) || draft.cooldownSeconds < 0) {
    errors['cooldownSeconds'] = 'Enter whole seconds, 0 or more.';
  }
  const common = {
    name,
    description: draft.description.trim() === '' ? null : draft.description.trim(),
    enabled: draft.enabled,
    severity: draft.severity,
    config: config.ok ? config.value : {},
    forSeconds: draft.forSeconds,
    cooldownSeconds: draft.cooldownSeconds,
    notifyChannels: draft.notifyChannels,
    webhook: draft.webhook,
  };
  if (Object.keys(errors).length === 0) {
    const parsed = createAlertRuleSchema.safeParse({ ...common, kind: draft.kind });
    if (!parsed.success) Object.assign(errors, issueErrors(parsed.error.issues));
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: mode === 'create' ? { ...common, kind: draft.kind } : common };
}

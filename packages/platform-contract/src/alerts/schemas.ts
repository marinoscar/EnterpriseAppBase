// =============================================================================
// The alerts slice's wire shapes (issue #1047)
// =============================================================================
//
// Rules, the per-kind configs of the built-in kinds, incidents, the dry-run
// response, the kind catalog, the dashboard summary and the webhook payload.
// Dates are ISO 8601 strings. A rule's `config` is validated by its KIND's own
// schema in the API (the kind id is an open string); the schemas here are the
// built-in kinds' and what the generic routes accept.
// =============================================================================

import { z } from 'zod';

import { wireEnum } from './enum.js';
import {
  ALERT_AGGREGATIONS,
  ALERT_ATTRIBUTE_PATTERN,
  ALERT_COMPARATORS,
  ALERT_COOLDOWN_SECONDS_DEFAULT,
  ALERT_COOLDOWN_SECONDS_MAX,
  ALERT_DESCRIPTION_MAX,
  ALERT_FILTERS_MAX,
  ALERT_FILTER_OPS,
  ALERT_FOR_SECONDS_MAX,
  ALERT_GROUP_BY_MAX,
  ALERT_INCIDENT_STATES,
  ALERT_KEY_MAX,
  ALERT_KEY_PATTERN,
  ALERT_KIND_MAX,
  ALERT_KIND_PATTERN,
  ALERT_METRIC_NAME_PATTERN,
  ALERT_NAME_MAX,
  ALERT_NODE_EVENT_RESOLVE_AFTER_DEFAULT,
  ALERT_NOTIFY_CHANNELS_MAX,
  ALERT_PAGE_SIZE_DEFAULT,
  ALERT_PAGE_SIZE_MAX,
  ALERT_SEVERITIES,
  ALERT_SUMMARY_MAX,
  ALERT_WINDOW_SECONDS_MAX,
  ALERT_WINDOW_SECONDS_MIN,
} from './constants.js';

const isoDate = z.string();

/** One of `info`, `warning`, `critical`. @stability experimental */
export const alertSeveritySchema = wireEnum(ALERT_SEVERITIES);

/** One of `pending`, `firing`, `resolved`. @stability experimental */
export const alertIncidentStateSchema = wireEnum(ALERT_INCIDENT_STATES);

/** One comparator. @stability experimental */
export const alertComparatorSchema = wireEnum(ALERT_COMPARATORS);

/** One aggregation. @stability experimental */
export const alertAggregationSchema = wireEnum(ALERT_AGGREGATIONS);

/** A rule kind id: an open vocabulary, lower snake case. @stability experimental */
export const alertKindIdSchema = z.string().max(ALERT_KIND_MAX).regex(ALERT_KIND_PATTERN);

// ---- per-kind configs -----------------------------------------------------

/**
 * One attribute filter of a `metric_threshold` rule.
 *
 * @stability experimental
 */
export const alertMetricFilterSchema = z
  .object({
    /** The attribute (column) to match. */
    attr: z.string().regex(ALERT_ATTRIBUTE_PATTERN),
    /** `eq` or `neq`. */
    op: wireEnum(ALERT_FILTER_OPS),
    /** The value (the observed number, or the filter value). */
    value: z.string().max(200),
  })
  .strict();

/**
 * `metric_threshold`: an aggregate of one metric over a window compared to a
 * threshold, per group. `metric` is the dotted metric name (`app.nodes.host.cpu.utilization`)
 * or its table name; the API resolves it against the store's schema.
 *
 * @stability experimental
 */
export const metricThresholdConfigSchema = z
  .object({
    /** The dotted metric name or its table name. */
    metric: z.string().regex(ALERT_METRIC_NAME_PATTERN),
    /** How the points in the window are reduced to one number. */
    aggregation: alertAggregationSchema,
    /** The window, in seconds. */
    windowSeconds: z.number().int().min(ALERT_WINDOW_SECONDS_MIN).max(ALERT_WINDOW_SECONDS_MAX),
    /** How the value is compared to the threshold. */
    comparator: alertComparatorSchema,
    /** The threshold the value is compared with. */
    threshold: z.number().finite(),
    /** Attribute columns to group by; one incident per group. */
    groupBy: z.array(z.string().regex(ALERT_ATTRIBUTE_PATTERN)).max(ALERT_GROUP_BY_MAX).optional(),
    /** Attribute filters applied before aggregating. */
    filters: z.array(alertMetricFilterSchema).max(ALERT_FILTERS_MAX).optional(),
  })
  .strict();

/** The parsed config of a `metric_threshold` rule. @stability experimental */
export type MetricThresholdConfig = z.infer<typeof metricThresholdConfigSchema>;

/**
 * An attribute match of a `node_event` rule: every entry must equal the
 * event's attribute (compared as text).
 *
 * @stability experimental
 */
export const alertEventAttrsSchema = z
  .record(z.string().regex(ALERT_ATTRIBUTE_PATTERN), z.union([z.string().max(200), z.number(), z.boolean()]))
  .refine((attrs) => Object.keys(attrs).length <= 5, 'At most 5 attributes');

/**
 * `node_event`: a worker node reported a matching event. `eventTypes` are node
 * event types or a prefix such as `power.*`. The incident resolves when a
 * `recovery` event arrives for the same node, or after `resolveAfterSeconds`.
 *
 * @stability experimental
 */
export const nodeEventConfigSchema = z
  .object({
    /** Node event types or prefixes such as `power.*`. */
    eventTypes: z.array(z.string().min(1).max(64)).min(1).max(20),
    /** The lowest event severity that counts. */
    minSeverity: alertSeveritySchema.optional(),
    /** Only these nodes. */
    nodeIds: z.array(z.string().max(64)).max(100).optional(),
    /** Attributes the event must carry, compared as text. */
    attrs: alertEventAttrsSchema.optional(),
    /** The events that clear the incident. */
    recovery: z
      .object({
        /** Node event types or prefixes such as `power.*`. */
        eventTypes: z.array(z.string().min(1).max(64)).min(1).max(20),
        /** Attributes the event must carry, compared as text. */
        attrs: alertEventAttrsSchema.optional(),
      })
      .strict()
      .optional(),
    /** Seconds after which the incident clears without a recovery event. */
    resolveAfterSeconds: z.number().int().min(60).max(604_800).default(ALERT_NODE_EVENT_RESOLVE_AFTER_DEFAULT),
  })
  .strict();

/** The parsed config of a `node_event` rule. @stability experimental */
export type NodeEventConfig = z.infer<typeof nodeEventConfigSchema>;

/**
 * `verdict`: the telemetry dashboard verdict is at or past `minLevel`.
 *
 * @stability experimental
 */
export const verdictConfigSchema = z
  .object({
    /** The verdict level at or past which the rule breaches. */
    minLevel: wireEnum(['degraded', 'critical']),
  })
  .strict();

/** The parsed config of a `verdict` rule. @stability experimental */
export type VerdictConfig = z.infer<typeof verdictConfigSchema>;

/**
 * `node_offline` and `telemetry_unavailable` take no configuration.
 *
 * @stability experimental
 */
export const emptyAlertConfigSchema = z.object({}).strict();

// ---- rules ------------------------------------------------------------------

const notifyChannelsSchema = z
  .array(z.string().min(1).max(32))
  .max(ALERT_NOTIFY_CHANNELS_MAX)
  .refine((ids) => new Set(ids).size === ids.length, 'Channels must be unique');

/**
 * An alert rule as the API returns it.
 *
 * @stability experimental
 */
export const alertRuleSchema = z.object({
  /** The id. */
  id: z.string(),
  /** The stable key of a seeded starter rule, else `null`. */
  key: z.string().nullable(),
  /** `true` for a seeded starter rule (it may be edited and disabled, not deleted). */
  starter: z.boolean(),
  /** The display name. */
  name: z.string(),
  /** Free text, or `null`. */
  description: z.string().nullable(),
  /** Whether the evaluator runs the rule. */
  enabled: z.boolean(),
  /** The rule kind id. */
  kind: z.string(),
  /** How serious the incidents are. */
  severity: alertSeveritySchema,
  /** The kind-specific configuration. */
  config: z.record(z.string(), z.unknown()),
  /** Seconds the condition must hold before the rule fires. */
  forSeconds: z.number().int().min(0),
  /** Seconds after a resolve in which a re-fire is not notified. */
  cooldownSeconds: z.number().int().min(0),
  /** Notification channel ids the alert is sent over; empty means every channel the recipient has on. */
  notifyChannels: z.array(z.string()),
  /** Also emit the `alerts.alert.*` webhook events. */
  webhook: z.boolean(),
  /** The administrator who created the rule, or `null`. */
  createdById: z.string().nullable(),
  /** When it was created. */
  createdAt: isoDate,
  /** When it was last updated. */
  updatedAt: isoDate,
  /** When the rule was last evaluated, or `null`. */
  lastEvaluatedAt: isoDate.nullable(),
  /** The last evaluation error (kept until the next clean evaluation), else `null`. */
  lastError: z.string().nullable(),
  /** Incidents currently `pending` or `firing`. */
  openIncidents: z.number().int().min(0),
});

/** One rule. @stability experimental */
export type AlertRule = z.infer<typeof alertRuleSchema>;

/**
 * `POST /api/admin/alerts/rules` body. `config` is validated against the
 * kind's schema; a rule is created disabled unless `enabled` says otherwise.
 *
 * @stability experimental
 */
export const createAlertRuleSchema = z.object({
  /** The display name. */
  name: z.string().trim().min(1).max(ALERT_NAME_MAX),
  /** Free text, or `null`. */
  description: z.string().trim().max(ALERT_DESCRIPTION_MAX).nullable().optional(),
  /** Whether the evaluator runs the rule. */
  enabled: z.boolean().default(false),
  /** The rule kind id. */
  kind: alertKindIdSchema,
  /** How serious the incidents are. */
  severity: alertSeveritySchema,
  /** The kind-specific configuration. */
  config: z.record(z.string(), z.unknown()).default({}),
  /** Seconds the condition must hold before the rule fires. */
  forSeconds: z.number().int().min(0).max(ALERT_FOR_SECONDS_MAX).default(0),
  /** Seconds after a resolve in which a re-fire is not notified. */
  cooldownSeconds: z.number().int().min(0).max(ALERT_COOLDOWN_SECONDS_MAX).default(ALERT_COOLDOWN_SECONDS_DEFAULT),
  /** Notification channel ids; empty means no restriction. */
  notifyChannels: notifyChannelsSchema.default([]),
  /** Also emit the `alerts.alert.*` webhook events. */
  webhook: z.boolean().default(true),
});

/** The parsed create body. @stability experimental */
export type CreateAlertRule = z.infer<typeof createAlertRuleSchema>;

/**
 * `PATCH /api/admin/alerts/rules/:id` body. The kind cannot change; a new
 * `config` is validated against the rule's kind.
 *
 * @stability experimental
 */
export const updateAlertRuleSchema = z
  .object({
    /** The display name. */
    name: z.string().trim().min(1).max(ALERT_NAME_MAX),
    /** Free text, or `null`. */
    description: z.string().trim().max(ALERT_DESCRIPTION_MAX).nullable(),
    /** Whether the evaluator runs the rule. */
    enabled: z.boolean(),
    /** How serious the incidents are. */
    severity: alertSeveritySchema,
    /** The kind-specific configuration. */
    config: z.record(z.string(), z.unknown()),
    /** Seconds the condition must hold before the rule fires. */
    forSeconds: z.number().int().min(0).max(ALERT_FOR_SECONDS_MAX),
    /** Seconds after a resolve in which a re-fire is not notified. */
    cooldownSeconds: z.number().int().min(0).max(ALERT_COOLDOWN_SECONDS_MAX),
    /** Notification channel ids; empty means no restriction. */
    notifyChannels: notifyChannelsSchema,
    /** Also emit the `alerts.alert.*` webhook events. */
    webhook: z.boolean(),
  })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Send at least one field');

/** The parsed update body. @stability experimental */
export type UpdateAlertRule = z.infer<typeof updateAlertRuleSchema>;

/** A rule key, for a seeded starter rule. @stability experimental */
export const alertRuleKeySchema = z.string().max(ALERT_KEY_MAX).regex(ALERT_KEY_PATTERN);

/**
 * `GET /api/admin/alerts/rules` query.
 *
 * @stability experimental
 */
export const alertRuleListQuerySchema = z.object({
  /** The rule kind id. */
  kind: alertKindIdSchema.optional(),
  /** How serious the incidents are. */
  severity: alertSeveritySchema.optional(),
  /** Whether the evaluator runs the rule. */
  enabled: wireEnum(['true', 'false'] as const)
    .transform((value) => value === 'true')
    .optional(),
});

/** The parsed rule list query. @stability experimental */
export type AlertRuleListQuery = z.output<typeof alertRuleListQuerySchema>;

/** `GET /api/admin/alerts/rules` response data. @stability experimental */
export const alertRuleListSchema = z.array(alertRuleSchema);

// ---- incidents ----------------------------------------------------------------

/**
 * One incident: one rule breached for one label set.
 *
 * @stability experimental
 */
export const alertIncidentSchema = z.object({
  /** The id. */
  id: z.string(),
  /** The rule. */
  ruleId: z.string(),
  /** The rule name. */
  ruleName: z.string(),
  /** The rule kind. */
  ruleKind: z.string(),
  /** The label set that identifies the incident within its rule. */
  labels: z.record(z.string(), z.string()),
  /** `pending`, `firing` or `resolved`. */
  state: alertIncidentStateSchema,
  /** How serious the incidents are. */
  severity: alertSeveritySchema,
  /** When the condition first held, or `null`. */
  pendingSince: isoDate.nullable(),
  /** When it fired, or `null`. */
  firedAt: isoDate.nullable(),
  /** When it resolved, or `null`. */
  resolvedAt: isoDate.nullable(),
  /** The last observed value, or `null`. */
  lastValue: z.number().nullable(),
  /** The last evaluation that saw it breached. */
  lastSeenAt: isoDate,
  /** One human sentence. */
  summary: z.string().max(ALERT_SUMMARY_MAX),
  /** When an administrator acknowledged it, or `null`. */
  acknowledgedAt: isoDate.nullable(),
  /** Who acknowledged it, or `null`. */
  acknowledgedById: z.string().nullable(),
  /** When it was created. */
  createdAt: isoDate,
});

/** One incident. @stability experimental */
export type AlertIncident = z.infer<typeof alertIncidentSchema>;

/**
 * `GET /api/admin/alerts/incidents` query.
 *
 * @stability experimental
 */
export const alertIncidentListQuerySchema = z.object({
  /** `pending`, `firing` or `resolved`. */
  state: alertIncidentStateSchema.optional(),
  /** How serious the incidents are. */
  severity: alertSeveritySchema.optional(),
  /** The rule. */
  ruleId: z.uuid().optional(),
  /** The 1-based page. */
  page: z.coerce.number().int().min(1).default(1),
  /** Rows per page. */
  pageSize: z.coerce.number().int().min(1).max(ALERT_PAGE_SIZE_MAX).default(ALERT_PAGE_SIZE_DEFAULT),
});

/** The parsed incident list query. @stability experimental */
export type AlertIncidentListQuery = z.output<typeof alertIncidentListQuerySchema>;

/** `GET /api/admin/alerts/incidents` response data. @stability experimental */
export const alertIncidentListSchema = z.object({
  /** The rows of this page. */
  items: z.array(alertIncidentSchema),
  /** Rows across all pages. */
  total: z.number().int().min(0),
  /** The 1-based page. */
  page: z.number().int().min(1),
  /** Rows per page. */
  pageSize: z.number().int().min(1),
  /** Pages across all rows. */
  totalPages: z.number().int().min(0),
});

// ---- dry run, kinds, summary ----------------------------------------------------

/**
 * One observation a kind produced: a label set, its value and whether it
 * breaches the rule.
 *
 * @stability experimental
 */
export const alertObservationSchema = z.object({
  /** The label set that identifies the incident within its rule. */
  labels: z.record(z.string(), z.string()),
  /** The value (the observed number, or the filter value). */
  value: z.number().nullable(),
  /** Whether the observation breaches the rule. */
  breached: z.boolean(),
  /** One human sentence. */
  summary: z.string().max(ALERT_SUMMARY_MAX),
});

/** One observation. @stability experimental */
export type AlertObservation = z.infer<typeof alertObservationSchema>;

/**
 * `POST /api/admin/alerts/rules/:id/test` response: the rule evaluated now.
 * Nothing is stored and nothing is dispatched.
 *
 * @stability experimental
 */
export const alertRuleTestResponseSchema = z.object({
  /** The rule. */
  ruleId: z.string(),
  /** The rule kind id. */
  kind: z.string(),
  /** When the evaluation ran. */
  evaluatedAt: isoDate,
  /** How long it took, in milliseconds. */
  durationMs: z.number().int().min(0),
  /** What the kind observed, per label set. */
  observations: z.array(alertObservationSchema),
  /** Why the evaluation failed (for instance the store is unreachable), else `null`. */
  error: z.string().nullable(),
});

/** The dry-run response. @stability experimental */
export type AlertRuleTestResponse = z.infer<typeof alertRuleTestResponseSchema>;

/**
 * One registered rule kind and the JSON Schema of its config.
 *
 * @stability experimental
 */
export const alertKindSchema = z.object({
  /** The id. */
  id: z.string(),
  /** Short display label. */
  label: z.string(),
  /** Free text, or `null`. */
  description: z.string(),
  /** The kind reacts to events (it is also evaluated when one arrives). */
  eventDriven: z.boolean(),
  /** One of the kinds the slice ships. */
  builtin: z.boolean(),
  /** JSON Schema (draft 2020-12) of the kind's `config`. */
  configSchema: z.record(z.string(), z.unknown()),
});

/** One kind. @stability experimental */
export type AlertKind = z.infer<typeof alertKindSchema>;

/** `GET /api/admin/alerts/kinds` response data. @stability experimental */
export const alertKindListSchema = z.array(alertKindSchema);

/**
 * `GET /api/admin/alerts/summary` response: what the dashboard banner shows.
 *
 * @stability experimental
 */
export const alertSummarySchema = z.object({
  /** Incidents firing now, by severity. */
  firing: z.object({
    /** Critical incidents. */
    critical: z.number().int().min(0),
    /** Warning incidents. */
    warning: z.number().int().min(0),
    /** Info incidents. */
    info: z.number().int().min(0),
  }),
  /** Newest `lastEvaluatedAt` among the enabled rules, else `null`. */
  lastEvaluatedAt: isoDate.nullable(),
});

/** The summary. @stability experimental */
export type AlertSummary = z.infer<typeof alertSummarySchema>;

/**
 * The `data` of the `alerts.alert.fired` and `alerts.alert.resolved` webhook
 * events.
 *
 * @stability experimental
 */
export const alertWebhookDataSchema = z.object({
  /** The incident. */
  incidentId: z.string(),
  /** The rule that produced it. */
  rule: z.object({
    /** The id. */
    id: z.string(),
    /** The stable key of a seeded starter rule, else `null`. */
    key: z.string().nullable(),
    /** The display name. */
    name: z.string(),
    /** The rule kind id. */
    kind: z.string(),
    /** How serious the incidents are. */
    severity: alertSeveritySchema,
  }),
  /** The label set that identifies the incident within its rule. */
  labels: z.record(z.string(), z.string()),
  /** The value (the observed number, or the filter value). */
  value: z.number().nullable(),
  /** One human sentence. */
  summary: z.string(),
  /** When it fired, or `null`. */
  firedAt: isoDate.nullable(),
  /** When it resolved, or `null`. */
  resolvedAt: isoDate.nullable(),
});

/** The webhook event data. @stability experimental */
export type AlertWebhookData = z.infer<typeof alertWebhookDataSchema>;

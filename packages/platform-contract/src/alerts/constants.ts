// =============================================================================
// The alerts slice's zod-free constants (issue #1047)
// =============================================================================
//
// Plain values and string-literal unions only (no zod), so a browser that needs
// a constant or a type never bundles zod (test/no-zod-in-constants.test.ts).
// =============================================================================

/**
 * The entries type `z.enum` builds for a list of values, named so the API
 * reference shows one type instead of an anonymous object per property.
 *
 * @typeParam V - the values.
 * @stability experimental
 */
export type AlertEnumEntries<V extends string> = { readonly [K in V]: K };

/**
 * The permission strings the alerts routes enforce. Both are system
 * permissions held by the `admin` role.
 *
 * @stability experimental
 */
export const ALERT_PERMISSIONS = {
  /** View rules, incidents and the summary. */
  READ: 'alerts:read',
  /** Create, edit, delete, test and acknowledge. */
  WRITE: 'alerts:write',
} as const;

/**
 * How serious a rule's incidents are.
 *
 * @stability experimental
 */
export const ALERT_SEVERITIES = ['info', 'warning', 'critical'] as const;

/**
 * One alert severity.
 *
 * @stability experimental
 */
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

/**
 * The lifecycle of one incident: `pending` (the condition holds but has not
 * held for the rule's `forSeconds` yet), `firing` and `resolved`.
 *
 * @stability experimental
 */
export const ALERT_INCIDENT_STATES = ['pending', 'firing', 'resolved'] as const;

/**
 * One incident state.
 *
 * @stability experimental
 */
export type AlertIncidentState = (typeof ALERT_INCIDENT_STATES)[number];

/**
 * How a metric value is compared to the threshold.
 *
 * @stability experimental
 */
export const ALERT_COMPARATORS = ['gt', 'gte', 'lt', 'lte', 'eq', 'neq'] as const;

/**
 * One comparator.
 *
 * @stability experimental
 */
export type AlertComparator = (typeof ALERT_COMPARATORS)[number];

/**
 * How a metric's points inside the window are reduced to one number. `rate`
 * is the increase of a counter per MINUTE over the window.
 *
 * @stability experimental
 */
export const ALERT_AGGREGATIONS = ['avg', 'max', 'min', 'sum', 'last', 'rate'] as const;

/**
 * One aggregation.
 *
 * @stability experimental
 */
export type AlertAggregation = (typeof ALERT_AGGREGATIONS)[number];

/**
 * The operators of a metric attribute filter.
 *
 * @stability experimental
 */
export const ALERT_FILTER_OPS = ['eq', 'neq'] as const;

/**
 * One filter operator.
 *
 * @stability experimental
 */
export type AlertFilterOp = (typeof ALERT_FILTER_OPS)[number];

/**
 * The ids of the rule kinds the slice ships. The kind id on the wire is an
 * OPEN string (an app adds its own with `registerAlertRuleKind`); these are
 * only the ones the platform knows by name.
 *
 * @stability experimental
 */
export const ALERT_KIND_IDS = {
  /** An aggregate of one telemetry metric compared to a threshold. */
  METRIC_THRESHOLD: 'metric_threshold',
  /** A worker node reported a matching event. */
  NODE_EVENT: 'node_event',
  /** The telemetry dashboard verdict is at or past a level. */
  VERDICT: 'verdict',
  /** A worker node is stale or offline. */
  NODE_OFFLINE: 'node_offline',
  /** The telemetry store cannot be queried. */
  TELEMETRY_UNAVAILABLE: 'telemetry_unavailable',
} as const;

/**
 * The stable keys of the starter rules the slice seeds (disabled).
 *
 * @stability experimental
 */
export const ALERT_STARTER_RULE_KEYS = {
  /** A node switched to battery. */
  NODES_ON_BATTERY: 'nodes.on_battery',
  /** A node reported a low or critical battery. */
  NODES_BATTERY_LOW: 'nodes.battery_low',
  /** A worker host CPU is high. */
  NODES_HOST_CPU_HIGH: 'nodes.host_cpu_high',
  /** A worker host has little memory available. */
  NODES_HOST_MEMORY_LOW: 'nodes.host_memory_low',
  /** A worker node is offline. */
  NODES_OFFLINE: 'nodes.offline',
  /** Jobs are failing faster than usual. */
  JOBS_FAILURE_SPIKE: 'jobs.failure_spike',
  /** The dashboard verdict is critical. */
  TELEMETRY_VERDICT_CRITICAL: 'telemetry.verdict_critical',
  /** The telemetry store cannot be queried. */
  TELEMETRY_UNAVAILABLE: 'telemetry.unavailable',
} as const;

/**
 * The webhook event keys the slice emits through the optional webhook port.
 *
 * @stability experimental
 */
export const ALERT_WEBHOOK_EVENTS = {
  /** The event emitted when an alert fires. */
  FIRED: 'alerts.alert.fired',
  /** The event emitted when an alert resolves. */
  RESOLVED: 'alerts.alert.resolved',
} as const;

/**
 * The refusal codes (`details.reason`) of the alerts routes.
 *
 * @stability experimental
 */
export const ALERT_ERROR_CODES = {
  /** No rule has this id (404). */
  RULE_NOT_FOUND: 'ALERT_RULE_NOT_FOUND',
  /** No incident has this id (404). */
  INCIDENT_NOT_FOUND: 'ALERT_INCIDENT_NOT_FOUND',
  /** The rule kind is not registered (400). */
  UNKNOWN_KIND: 'ALERT_UNKNOWN_KIND',
  /** The config does not match the kind (400). */
  INVALID_CONFIG: 'ALERT_INVALID_CONFIG',
  /** A starter rule cannot be deleted (409). */
  STARTER_RULE_PROTECTED: 'ALERT_STARTER_RULE_PROTECTED',
} as const;

/** Longest rule name. @stability experimental */
export const ALERT_NAME_MAX = 120;
/** Longest rule description. @stability experimental */
export const ALERT_DESCRIPTION_MAX = 500;
/** Longest incident summary. @stability experimental */
export const ALERT_SUMMARY_MAX = 500;
/** Longest rule key. @stability experimental */
export const ALERT_KEY_MAX = 64;
/** Longest kind id. @stability experimental */
export const ALERT_KIND_MAX = 32;
/** Most notification channels one rule names. @stability experimental */
export const ALERT_NOTIFY_CHANNELS_MAX = 8;
/** Longest `for` duration of a rule, in seconds (one day). @stability experimental */
export const ALERT_FOR_SECONDS_MAX = 86_400;
/** Longest cooldown of a rule, in seconds (one week). @stability experimental */
export const ALERT_COOLDOWN_SECONDS_MAX = 604_800;
/** Shortest metric window, in seconds. @stability experimental */
export const ALERT_WINDOW_SECONDS_MIN = 60;
/** Longest metric window, in seconds. @stability experimental */
export const ALERT_WINDOW_SECONDS_MAX = 86_400;
/** Most group-by columns of a metric rule. @stability experimental */
export const ALERT_GROUP_BY_MAX = 3;
/** Most attribute filters of a metric rule. @stability experimental */
export const ALERT_FILTERS_MAX = 5;
/** Default seconds a `node_event` incident stays open without a recovery event. @stability experimental */
export const ALERT_NODE_EVENT_RESOLVE_AFTER_DEFAULT = 3_600;
/** Default cooldown of a new rule, in seconds. @stability experimental */
export const ALERT_COOLDOWN_SECONDS_DEFAULT = 900;
/** Largest incident page. @stability experimental */
export const ALERT_PAGE_SIZE_MAX = 100;
/** Default incident page size. @stability experimental */
export const ALERT_PAGE_SIZE_DEFAULT = 20;
/** Metric name or table name accepted by `metric_threshold`. @stability experimental */
export const ALERT_METRIC_NAME_PATTERN = /^[a-z][a-z0-9_.]{0,127}$/;
/** A telemetry attribute (column) identifier. @stability experimental */
export const ALERT_ATTRIBUTE_PATTERN = /^[A-Za-z_][A-Za-z0-9_.]{0,63}$/;
/** What a rule key looks like. @stability experimental */
export const ALERT_KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/;
/** What a rule kind id looks like. @stability experimental */
export const ALERT_KIND_PATTERN = /^[a-z][a-z0-9_]*$/;

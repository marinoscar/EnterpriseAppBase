// The alerts slice's permanent strings and injection tokens.

/**
 * The job type of the periodic evaluation. PERMANENT once jobs of it exist.
 *
 * @stability experimental
 */
export const ALERTS_EVALUATE_TYPE = 'alerts.evaluate';

/**
 * The job type of the event-driven evaluation (one node event). PERMANENT.
 *
 * @stability experimental
 */
export const ALERTS_EVALUATE_EVENT_TYPE = 'alerts.evaluate_event';

/**
 * The job type of the resolved-incident purge. PERMANENT.
 *
 * @stability experimental
 */
export const ALERTS_INCIDENTS_PURGE_TYPE = 'alerts.incidents_purge';

/**
 * The notification event raised when an alert fires. PERMANENT: preferences
 * and delivery rows name it.
 *
 * @stability experimental
 */
export const ALERT_FIRED_NOTIFICATION = 'alerts.alert_fired';

/**
 * The notification event raised when an alert resolves. PERMANENT.
 *
 * @stability experimental
 */
export const ALERT_RESOLVED_NOTIFICATION = 'alerts.alert_resolved';

/**
 * Injection token of the OPTIONAL webhook emitter port ({@link AlertsWebhookEmitter}).
 * The webhooks slice, or the app, binds it; the alerts slice compiles and runs
 * without it.
 *
 * @extensionPoint token
 * @stability experimental
 */
export const ALERTS_WEBHOOK_EMITTER: unique symbol = Symbol.for('@marinoscar/platform/alerts/WEBHOOK_EMITTER');

/**
 * Injection token of the resolved module options.
 *
 * @stability experimental
 */
export const ALERTS_OPTIONS: unique symbol = Symbol.for('@marinoscar/platform/alerts/OPTIONS');

/**
 * Name of the raw-SQL partial unique index: one open incident per rule and label set.
 *
 * @stability experimental
 */
export const ALERT_OPEN_INCIDENT_INDEX = 'alert_incidents_open_uniq_idx';

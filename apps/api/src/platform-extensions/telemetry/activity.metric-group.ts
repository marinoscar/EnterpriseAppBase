import type { MetricGroupDef } from '@marinoscar/platform-api/telemetry';

// =============================================================================
// The reference app's own dashboard metric group: "App activity" (PP-4.6)
// =============================================================================
//
// The worked example of the telemetry slice's rung-2 extension point, and the
// answer to "what does an app add to put its own numbers on the dashboard":
// ONE file like this one and ONE option, `metricGroups`, in
// `platform/telemetry/telemetry.config.ts`. No platform file, no web file and
// no collector change: the dashboard renders any group the API reports.
//
// WHAT IT CHARTS. Counters this API already emits and no platform group shows
// (declared in `common/otel/platform-app-metrics.ts`, named by the table rule
// of docs/specs/telemetry.md §11.13: dots become `_`, `_total` is appended):
//
//   app.auth.logins              provider, outcome   app_auth_logins_total
//   app.auth.refreshes           outcome             app_auth_refreshes_total
//   app.ai.requests              status, ...         app_ai_requests_total
//   app.ai.tokens                token_type, ...     app_ai_tokens_total
//   app.notifications.deliveries channel, event,     app_notifications_deliveries_total
//                                outcome
//
// A family is skipped, never an error, while its table does not exist: a fresh
// stack, or a deployment with AI off, shows the section as "no data yet".
//
// A FORK'S OWN GROUP follows the same shape (EvoPath's `coach` group does):
// copy this file, change the id, the tables and the labels, and list the group
// in `metricGroups`. Entries of the app's own registration file
// (`app-registrations/telemetry.ts`, empty upstream) are appended after this one.
// =============================================================================

declare module '@marinoscar/platform-api/telemetry' {
  interface MetricGroupIds {
    /** The reference app's sign-in, token refresh, AI and notification counters. */
    activity: true;
  }
}

/**
 * Filters every family honours: the API's `app_*` tables carry the service and
 * the instance (their `host_name` is the API container, not a host).
 */
const FILTERS = ['service', 'instance'] as const;

/**
 * "App activity": sign-ins and token refreshes by outcome, AI requests and
 * tokens, and notification deliveries by outcome, over the window.
 *
 * Served by `GET /api/admin/telemetry/dashboard/metrics?group=activity`.
 */
export const ACTIVITY_METRIC_GROUP: MetricGroupDef = {
  id: 'activity',
  label: 'App activity',
  title: 'App activity',
  // The platform's six groups use 10 to 60; an app's go after them.
  order: 70,
  description: 'sign-ins and token refreshes by outcome, AI requests and tokens, notification deliveries by outcome',
  families: [
    {
      key: 'authLogins',
      group: 'activity',
      label: 'Sign-ins',
      table: 'app_auth_logins_total',
      kind: 'counter',
      unit: 'count',
      rate: 'count',
      groupBy: 'outcome',
      requiredColumns: ['outcome'],
      filters: FILTERS,
    },
    {
      key: 'authRefreshes',
      group: 'activity',
      label: 'Token refreshes',
      table: 'app_auth_refreshes_total',
      kind: 'counter',
      unit: 'count',
      rate: 'count',
      groupBy: 'outcome',
      requiredColumns: ['outcome'],
      filters: FILTERS,
    },
    {
      key: 'aiRequests',
      group: 'activity',
      label: 'AI requests',
      table: 'app_ai_requests_total',
      kind: 'counter',
      unit: 'count',
      rate: 'count',
      requiredColumns: [],
      filters: FILTERS,
    },
    {
      key: 'aiTokens',
      group: 'activity',
      label: 'AI tokens',
      table: 'app_ai_tokens_total',
      kind: 'counter',
      unit: 'count',
      rate: 'count',
      groupBy: 'token_type',
      requiredColumns: ['token_type'],
      filters: FILTERS,
    },
    {
      key: 'notificationDeliveries',
      group: 'activity',
      label: 'Notification deliveries',
      table: 'app_notifications_deliveries_total',
      kind: 'counter',
      unit: 'count',
      rate: 'count',
      groupBy: 'outcome',
      requiredColumns: ['outcome'],
      filters: FILTERS,
    },
  ],
};

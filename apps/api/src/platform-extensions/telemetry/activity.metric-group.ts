import { registerMetricUnit, type MetricGroupDef, type MetricUnitDef } from '@marinoscar/platform-api/telemetry';

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
// (declared in the host slice's `PLATFORM_APP_METRICS`, named by the table rule
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
//
// HOW IT LOOKS (PP-14.18). The group also declares its `presentation`, data the
// dashboard renders with no web change: which tiles and in what order, a theme
// colour per outcome on the charts, and a "Top 5" table with a computed failure
// -rate column. And one app UNIT, `usd`, registered below with
// `registerMetricUnit`: the tile "AI spend (estimate)" is in US dollars, formatted
// by the browser from the descriptor `/metric-groups` serves with the group. The
// docs walk through all of it end to end: docs/EXTENDING.md, "Add a metric, a
// group and its UI".
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
 * The app's own unit (PP-14.18): US dollars, to the cent. Registered at import
 * time, before `TelemetryModule.forRoot` registers a group that uses it.
 */
export const USD_UNIT: MetricUnitDef = { id: 'usd', label: 'US dollars', format: 'currency', currency: 'USD', decimals: 2 };
registerMetricUnit(USD_UNIT);

/**
 * The flat price the "AI spend (estimate)" tile applies to every token, in US
 * dollars per million. ILLUSTRATIVE: a real deployment multiplies by its
 * provider's price per model (or emits its own `app.ai.cost` counter and
 * points the family at it).
 */
export const ESTIMATED_USD_PER_MILLION_TOKENS = 2;

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
    {
      // The same table as `aiTokens`, read as money: the increase times a flat price per token.
      key: 'aiSpend',
      group: 'activity',
      label: 'AI spend (estimate)',
      table: 'app_ai_tokens_total',
      kind: 'counter',
      unit: 'usd',
      rate: 'count',
      scale: ESTIMATED_USD_PER_MILLION_TOKENS / 1_000_000,
      requiredColumns: [],
      filters: FILTERS,
    },
  ],
  tables: [
    {
      // One row per notification event: attempts and failures over the window.
      key: 'notificationEvents',
      group: 'activity',
      label: 'Notification events',
      keyColumn: 'event',
      keyLabel: 'Event',
      filters: FILTERS,
      parts: [
        {
          column: 'attempts',
          label: 'Attempts',
          unit: 'count',
          table: 'app_notifications_deliveries_total',
          seriesAggregate: 'sum',
          over: 'increase',
        },
        {
          column: 'failed',
          label: 'Failed',
          unit: 'count',
          table: 'app_notifications_deliveries_total',
          requiredColumns: ['outcome'],
          where: [{ column: 'outcome', op: '=', value: 'failed' }],
          seriesAggregate: 'sum',
          over: 'increase',
        },
      ],
    },
  ],
  presentation: {
    // Tiles in this order; the spend tile in the app's own unit and a theme colour (a token, never a CSS colour).
    tiles: [
      { metric: 'authLogins', label: 'Sign-ins' },
      { metric: 'authRefreshes' },
      { metric: 'aiRequests' },
      { metric: 'aiSpend', color: 'info' },
      { metric: 'notificationDeliveries' },
    ],
    // Outcomes in the colour of what they mean (status tokens), one chart per question.
    series: [
      {
        title: 'Sign-ins by outcome',
        metrics: ['authLogins'],
        colors: { success: 'ok', allowlist_rejected: 'warn', disabled: 'warn', no_organization: 'warn' },
      },
      {
        title: 'Notification deliveries by outcome',
        metrics: ['notificationDeliveries'],
        colors: { sent: 'ok', failed: 'crit', rate_limited: 'warn', error: 'crit' },
      },
      { title: 'AI spend (estimate)', metrics: ['aiSpend'] },
    ],
    // The five busiest events, largest first, with "All" one click away; the ratio is computed in the browser.
    tables: [{ metric: 'notificationEvents', topN: 5, sort: 'value-desc' }],
    virtualColumns: [{ id: 'failureRate', label: 'Failure rate', expression: 'ratio', of: ['failed', 'attempts'], table: 'notificationEvents' }],
  },
};

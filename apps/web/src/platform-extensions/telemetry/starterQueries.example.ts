import { STARTER_QUERIES } from '@marinoscar/platform-web/telemetry/headless';
import type { StarterQuery } from '@marinoscar/platform-web/telemetry/headless';

/**
 * The reference app's own Telemetry Explorer starter queries (PP-14.18).
 *
 * The worked example of the explorer's `starterQueries` prop: the platform's
 * list stays first, and the app's own questions follow it. The statements are
 * ordinary read-only SQL the API's guard checks like any the user types; the
 * app tables are the ones `apps/api/src/platform-extensions/telemetry/activity.metric-group.ts`
 * reads.
 *
 * To use it, pass the list to the page where the route is declared:
 * `<TelemetryExplorerPage starterQueries={APP_STARTER_QUERIES} />`.
 */
export const APP_STARTER_QUERIES: readonly StarterQuery[] = [
  ...STARTER_QUERIES,
  {
    id: 'app-sign-ins-by-outcome',
    title: 'Sign-ins by outcome (24h)',
    sql: "SELECT outcome, sum(greptime_value) AS sign_ins FROM app_auth_logins_total WHERE greptime_timestamp > now() - INTERVAL '24 hours' GROUP BY outcome ORDER BY sign_ins DESC LIMIT 20",
  },
];

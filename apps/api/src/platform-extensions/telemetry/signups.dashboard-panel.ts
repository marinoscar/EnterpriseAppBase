import {
  TELEMETRY_ERROR_REASONS,
  TelemetryHttpError,
  type DashboardPanelDef,
} from '@marinoscar/platform-api/telemetry';

// =============================================================================
// The reference app's dashboard panel: "Sign-ups" (PP-14.18)
// =============================================================================
//
// The worked example of `registerDashboardPanel`, the API half of an app's own
// Telemetry Dashboard card. The web half is
// `apps/web/src/platform-extensions/telemetry/SignupsPanelView.example.tsx`
// (`registerDashboardPanelView('signups', ...)`); the dashboard draws the card
// when the API lists the panel AND the web registered a view for the same id.
//
// WHAT IT READS. This API has no sign-up counter, so the panel reads the closest
// signal it does have: successful sign-ins (`app.auth.logins`, outcome `success`,
// table `app_auth_logins_total`). A fork with its own counter points `TABLE` and
// the outcome predicate at it.
//
// HOW IT READS. Through `ctx.query`, the guarded query facade: one read-only
// statement at a time through the explorer's SQL guard, row cap, timeout and
// audit trail (source `panel`). The counter is cumulative, so the increase per
// bucket is computed the way the platform's metric groups compute it: the
// difference between a point and the previous one of the SAME series (a series
// is one combination of tag values, discovered here from `information_schema`),
// a drop counted as a reset, the first point of a series contributing nothing.
// Values go into SQL through `ctx.query.sql` (`literal`, `ident`, `between`).
//
// WHAT IT RETURNS. Plain JSON the web view draws, with the statement it ran in
// `sql`, which makes the dashboard offer "Open in Explorer" on the card.
// =============================================================================

const TABLE = 'app_auth_logins_total';
const BUCKET_ROWS = 400;

/** The panel's payload: what the web view receives. */
export interface SignupsPayload {
  /** The metric table exists in the store. `false` on a fresh stack: the view says "no data yet". */
  available: boolean;
  /** Successful sign-ins over the window. */
  total: number;
  /** One entry per bucket of the window that saw any. */
  buckets: Array<{ t: string; signIns: number }>;
  /** The bucket size in seconds. */
  bucketSeconds: number;
  /** The statement that produced `buckets` (for "Open in Explorer"). */
  sql?: string;
}

/** A store instant (`2026-09-27 22:21:00.000000`, UTC) as ISO text. */
function toIso(value: unknown): string {
  const text = String(value);
  const ms = Date.parse(`${text.replace(' ', 'T')}${/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? '' : 'Z'}`);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : text;
}

/**
 * "Sign-ups": successful sign-ins per bucket over the dashboard's window.
 *
 * Registered from `app-registrations/telemetry.ts`.
 */
export const SIGNUPS_DASHBOARD_PANEL: DashboardPanelDef = {
  id: 'signups',
  label: 'Sign-ups',
  // The platform's api and logs panels use 10 and 20; an app's go after.
  order: 100,
  async data(ctx): Promise<SignupsPayload> {
    const { query, window, filters } = ctx;
    const { sql } = query;
    const empty: SignupsPayload = { available: false, total: 0, buckets: [], bucketSeconds: window.bucketSeconds };

    // The series identity: every tag column of the table (none when the table does not exist yet).
    let tags: string[];
    try {
      const described = await query.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = ${sql.literal(TABLE)} AND semantic_type = 'TAG'`,
        { maxRows: 100 },
      );
      tags = described.rows.map((row) => String(row[0]));
    } catch (error) {
      // A store that is off or unreachable says so (503/409); anything else is "no data yet".
      if (error instanceof TelemetryHttpError && error.reason !== TELEMETRY_ERROR_REASONS.QUERY_FAILED) throw error;
      return empty;
    }
    if (tags.length === 0 || !tags.includes('outcome')) return empty;

    const where = [
      sql.between('greptime_timestamp', window.from, window.to),
      `${sql.ident('outcome')} = ${sql.literal('success')}`,
      // The dashboard's service filter, already checked against the values the store has seen.
      ...(filters.service && tags.includes('service_name') ? [`${sql.ident('service_name')} = ${sql.literal(filters.service)}`] : []),
      ...(filters.instance && tags.includes('app_instance_id')
        ? [`${sql.ident('app_instance_id')} = ${sql.literal(filters.instance)}`]
        : []),
    ].join(' AND ');
    const statement =
      `SELECT ${query.dialect.timeBucket('ts', window.bucketSeconds)} AS t, ` +
      `sum(CASE WHEN p IS NULL THEN 0 WHEN v >= p THEN v - p ELSE v END) AS sign_ins ` +
      `FROM (SELECT ${sql.ident('greptime_timestamp')} AS ts, ${sql.ident('greptime_value')} AS v, ` +
      `lag(${sql.ident('greptime_value')}) OVER (PARTITION BY ${tags.map(sql.ident).join(', ')} ORDER BY ${sql.ident('greptime_timestamp')}) AS p ` +
      `FROM ${sql.ident(TABLE)} WHERE ${where}) GROUP BY t ORDER BY t ${query.dialect.limit(BUCKET_ROWS)}`;

    const result = await query.query(statement, { maxRows: BUCKET_ROWS });
    const buckets = result.rows
      .map((row) => ({ t: toIso(row[0]), signIns: Number(row[1]) }))
      .filter((bucket) => Number.isFinite(bucket.signIns) && bucket.signIns > 0);
    return {
      available: true,
      total: buckets.reduce((sum, bucket) => sum + bucket.signIns, 0),
      buckets,
      bucketSeconds: window.bucketSeconds,
      sql: statement,
    };
  },
};

import { TelemetryConnectionService } from '../../connection/telemetry-connection.service';
import { describeTelemetryStoreConformance } from '../../testing/store-conformance';
import './greptime.store';

// =============================================================================
// The telemetry store conformance kit, on a REAL GreptimeDB (PP-14.11)
// =============================================================================
//
// Excluded from `npm test`; run with `npm run test:greptime` and
// GREPTIME_TEST_URL=postgres://reader:<pw>@host:4003/public (a `readonly` user),
// as in ../../telemetry.greptime.spec.ts. Without GREPTIME_TEST_URL every case
// is skipped.
//
// Two scenarios are skipped, each for a stated reason:
//
//   timeout    the kit needs a statement that outlasts a short ceiling, and
//              GreptimeDB has no portable sleep. The client-side timeout (the
//              connection is destroyed, a typed error thrown) is proven against
//              a fake pool in greptime.client.spec.ts.
//   dashboard  the dashboard's statements run against the store's OWN
//              telemetry in ../../dashboard/telemetry-dashboard.greptime.spec.ts
//              (every template whose table exists), so a fixture dataset here
//              would only repeat it.
// =============================================================================

const READER_URL = process.env.GREPTIME_TEST_URL;

function connectionFor(readerUrl: string): TelemetryConnectionService {
  const reader = new URL(readerUrl);
  const config = {
    host: reader.hostname,
    pgPort: Number(reader.port || 4003),
    database: reader.pathname.replace(/^\//, '') || 'public',
    readerUser: decodeURIComponent(reader.username),
    readerPassword: decodeURIComponent(reader.password),
    adminUser: '',
    adminPassword: '',
    available: true,
  };

  return new TelemetryConnectionService({ get: () => config } as never, {} as never, {} as never);
}

/**
 * A connection with nothing configured. Its configuration is an explicit empty
 * `greptime` block served by a stub `ConfigService`, so no `GREPTIME_*`
 * variable of the ambient environment (this job sets `GREPTIME_TEST_URL`) can
 * leak in: an empty host is the "no store" state.
 */
function unconfiguredConnection(): TelemetryConnectionService {
  return new TelemetryConnectionService({ get: () => ({}) } as never, {} as never, {} as never);
}

describeTelemetryStoreConformance('greptime', {
  describe: READER_URL ? describe : describe.skip,
  it,
  expect,
  connection: connectionFor(READER_URL ?? 'postgres://reader:reader@localhost:4003/public'),
  // The reader login cannot write; these tables need not exist for it to refuse.
  writeStatements: [
    "INSERT INTO opentelemetry_logs (body) VALUES ('conformance')",
    'DELETE FROM opentelemetry_logs',
    'DROP TABLE opentelemetry_logs',
  ],
  unconfigured: { connection: unconfiguredConnection() },
  skip: ['timeout', 'dashboard'],
});

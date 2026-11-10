// =============================================================================
// The eight built-in restore gates (PP-14.12)
// =============================================================================
//
// The platform's own gates, registered through `registerRestoreGate` exactly as
// an app's are (no private fast path), in the order they are evaluated and
// reported: the client/server version pair, the cluster admin connection,
// `CREATEDB`, extensions, row-level-security bypass, free disk, connected
// clients and schema compatibility (`BUILTIN_RESTORE_GATE_IDS`).
//
// The gate functions are the pre-flight's own, moved here verbatim from
// `restore-preflight.service.ts` with their design comments; each is a pure
// function of the probes the pre-flight ran once (`RestorePreflightFacts`), so
// NONE of them touches the cluster, the database or the disk. The registered
// `check` wraps one in the registry's `{ status, message }` shape.
//
// Importing this file registers the eight; the pre-flight service imports it.
// =============================================================================

import type { SystemDatabaseBackupValue } from '@marinoscar/platform-contract/db-backup';

import { RLS_BYPASS_PGOPTIONS } from './pg-dump.util';
import { quoteIdentifier } from './admin-connection.util';
import type { PgVersionCheck } from './pg-version.util';
import {
  registerRestoreGate,
  restoreGateRegistry,
  type RestoreClusterFacts,
  type RestoreGateContext,
  type RestoreGateDefinition,
  type RestoreGateKind,
  type RestoreGateOutcome,
  type RestoreGateResult,
  type RestorePreflightFacts,
} from './restore-gate.registry';

/**
 * Where the operator-facing instructions live. Referenced, never restated.
 *
 * @stability experimental
 */
export const RESTORE_RUNBOOK_PATH = 'docs/runbooks/database-restore.md';

/**
 * Roughly what a restore needs on the server's data volume.
 *
 * One copy for the scratch database the archive is replayed into, plus one for
 * the displaced database when it is retained. "Roughly" is honest: a restored
 * database is usually a little SMALLER than the original (no bloat, fresh
 * indexes) and WAL, sort files and index builds all want space this does not
 * model. The number exists to catch "there is nowhere near enough", which is
 * the case that matters, and it never blocks — see {@link
 * DatabaseRestorePreflightService.diskGate}.
 */
export function requiredDiskBytes(
  databaseSizeBytes: bigint,
  rollbackMode: SystemDatabaseBackupValue['restoreRollbackMode']
): bigint {
  return rollbackMode === 'retain_database' ? databaseSizeBytes * 2n : databaseSizeBytes;
}

/**
 * A byte count a human can read, from a `bigint`.
 *
 * Hand-rolled rather than reached for from a dependency, and `bigint`
 * throughout until the final division: a database size crossing 2^53 is not
 * reachable today, but the whole reason these columns are `BigInt` is that
 * somebody assumed the same thing about 2^31.
 */
export function formatBytes(bytes: bigint): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let index = 0;
  let value = bytes < 0n ? -bytes : bytes;

  while (value >= 1024n && index < units.length - 1) {
    value /= 1024n;
    index += 1;
  }

  return `${value.toString()} ${units[index]}`;
}


/**
 * The client/server major pair.
 *
 * ⚠ THE ONE CAPABILITY GATE THAT BLOCKS RATHER THAN GUIDES. Every other
 * capability failure has a manual answer — a superuser can create the
 * database the API's role may not — but the guided block's `pg_restore` is
 * still a `pg_restore`, and a client older than the server refuses to read
 * the archive whoever runs it. The fix is an image rebuild, documented in
 * `docs/runbooks/postgres-client-version.md`, not a command to paste. It is
 * not overridable for the same reason: overriding it produces a restore that
 * fails on the first byte, having already stopped the application.
 *
 * `unknown` PROCEEDS, exactly as it does for a backup. An unparseable version
 * banner is not evidence that a restore would fail, and it must never be the
 * reason a recovery did not happen.
 */
export function versionGate(version: PgVersionCheck): RestoreGateResult {
  if (version.status === 'blocked') {
    return {
      id: 'pg_client_version',
      kind: 'capability',
      verdict: 'block',
      title: 'PostgreSQL client version',
      detail: version.message,
      action:
        'Rebuild the API image with a newer postgresql client package, then run this ' +
        'pre-flight again. See docs/runbooks/postgres-client-version.md.',
    };
  }

  if (version.status === 'unknown') {
    return {
      id: 'pg_client_version',
      kind: 'capability',
      verdict: 'warning',
      title: 'PostgreSQL client version',
      detail: version.message,
      action:
        'Check the client and server majors by hand before restoring: ' +
        'docs/runbooks/postgres-client-version.md.',
    };
  }

  return {
    id: 'pg_client_version',
    kind: 'capability',
    verdict: 'pass',
    title: 'PostgreSQL client version',
    detail: version.message,
    action: null,
  };
}

/**
 * Whether the maintenance database can be reached at all.
 *
 * Its failure is a `warning` verdict and not a `block`, which looks wrong
 * until you read {@link decide}: a `capability` warning IS the `guided`
 * trigger. Nothing about an unreachable maintenance database says the
 * archive is bad or that a human with a `psql` prompt cannot restore it — so
 * the honest answer is the manual path, not a refusal.
 */
export function adminConnectionGate(
  cluster: RestoreClusterFacts,
  connection: RestorePreflightFacts['connection']
): RestoreGateResult {
  if (cluster.reachable) {
    return {
      id: 'admin_connection',
      kind: 'capability',
      verdict: 'pass',
      title: 'Cluster admin connection',
      detail:
        `Connected to the "${connection.database}" maintenance database at ` +
        `${connection.host}:${connection.port} as "${connection.user}".`,
      action: null,
    };
  }

  return {
    id: 'admin_connection',
    kind: 'capability',
    verdict: 'warning',
    title: 'Cluster admin connection',
    detail:
      `This deployment could not open a session on the "${connection.database}" maintenance ` +
      `database at ${connection.host}:${connection.port}, which an automated restore needs ` +
      'in order to create and rename databases' +
      (cluster.error === null ? '.' : `: ${cluster.error}`),
    action:
      `Restore by hand from a host that can reach ${connection.host}:${connection.port}, ` +
      `or make the "${connection.database}" database reachable by this role and try again.`,
  };
}

/**
 * `CREATEDB`, PROBED.
 *
 * The reason the guided path exists at all. Managed PostgreSQL withholds
 * this attribute from application roles as a matter of course, and #285's
 * restore begins with `CREATE DATABASE`. Assuming it would mean discovering
 * the truth at the moment a restore starts — after the operator has
 * committed to it, during an incident.
 */
export function createDatabaseGate(cluster: RestoreClusterFacts): RestoreGateResult {
  if (!cluster.reachable) {
    return {
      id: 'createdb_privilege',
      kind: 'capability',
      // NOT a second `warning`: the admin-connection gate has already sent
      // this to `guided`, and two findings for one cause would read as two
      // separate problems to fix.
      verdict: 'pass',
      title: 'CREATE DATABASE privilege',
      detail: 'Not checked: the maintenance connection could not be opened.',
      action: null,
    };
  }

  if (cluster.canCreateDatabase === true) {
    return {
      id: 'createdb_privilege',
      kind: 'capability',
      verdict: 'pass',
      title: 'CREATE DATABASE privilege',
      detail: 'This deployment\'s database role may create databases.',
      action: null,
    };
  }

  return {
    id: 'createdb_privilege',
    kind: 'capability',
    verdict: 'warning',
    title: 'CREATE DATABASE privilege',
    detail:
      'This deployment\'s database role may not create databases, so it cannot restore into ' +
      'a scratch database and swap it in. This is the normal configuration on managed ' +
      'PostgreSQL and does not mean the archive cannot be restored.',
    action:
      'Restore by hand with a role that holds CREATEDB (or a superuser), using the commands ' +
      'below — or grant CREATEDB to this role and run the pre-flight again.',
  };
}

/**
 * Whether every extension the live database has is available to the cluster.
 *
 * TWO CATALOGS, AND BOTH ARE NEEDED. `pg_extension` (read from the live
 * database) is what the archive will try to `CREATE EXTENSION`;
 * `pg_available_extensions` is what the server's filesystem can offer. An
 * archive is dumped and restored inside one cluster in the ordinary case, so
 * this normally passes — it earns its place on the day the restore target is
 * a NEW server, provisioned from a different image, where `pgcrypto` or
 * `postgis` simply is not installed. `pg_restore --exit-on-error` would then
 * stop on the `CREATE EXTENSION` line, having already created a scratch
 * database.
 */
export function rlsBypassGate(cluster: RestoreClusterFacts, connection: RestorePreflightFacts['connection']): RestoreGateResult {
  const title = 'Row-level security bypass';
  if (!cluster.reachable) {
    return {
      id: 'rls_bypass',
      kind: 'capability',
      // NOT a second `warning`, for the reason the CREATEDB gate gives.
      verdict: 'pass',
      title,
      detail: 'Not checked: the maintenance connection could not be opened.',
      action: null,
    };
  }

  const probe = cluster.rlsBypass;
  if (probe !== null && (probe.superuser || probe.bypassRls)) {
    return {
      id: 'rls_bypass',
      kind: 'capability',
      verdict: 'pass',
      title,
      detail: `The role "${connection.user}" bypasses row-level security outright (${probe.superuser ? 'SUPERUSER' : 'BYPASSRLS'}), so pg_restore writes every organization's rows.`,
      action: null,
    };
  }

  if (probe !== null && probe.optionApplied) {
    return {
      id: 'rls_bypass',
      kind: 'capability',
      verdict: 'pass',
      title,
      detail:
        'pg_restore lifts row-level security per session with --enable-row-security and ' +
        `PGOPTIONS="${RLS_BYPASS_PGOPTIONS}", and this connection carried that option to the server.`,
      action: null,
    };
  }

  return {
    id: 'rls_bypass',
    kind: 'capability',
    verdict: 'warning',
    title,
    detail:
      probe === null
        ? `The role "${connection.user}" could not be read from pg_roles, so whether a restore can write every organization's rows is unknown.`
        : `The startup option "${RLS_BYPASS_PGOPTIONS}" did not take effect on this connection, and the role "${connection.user}" ` +
          'does not bypass row-level security: an automated restore would write the tables without their organization-owned rows.',
    action:
      'Connect directly to the database (not through a transaction-mode pooler, which drops startup options), ' +
      `or restore by hand with a role that bypasses row-level security: ALTER ROLE ${quoteIdentifier(connection.user)} BYPASSRLS; ` +
      '(run as a superuser, for a dedicated restore role only: the API role itself must stay NOBYPASSRLS).',
  };
}

export function extensionsGate(cluster: RestoreClusterFacts): RestoreGateResult {
  if (!cluster.reachable || cluster.checkedExtensions === null) {
    return {
      id: 'extensions',
      kind: 'capability',
      verdict: 'pass',
      title: 'Required extensions',
      detail: 'Not checked: the installed extensions or the cluster catalog could not be read.',
      action: null,
    };
  }

  if (cluster.missingExtensions.length === 0) {
    return {
      id: 'extensions',
      kind: 'capability',
      verdict: 'pass',
      title: 'Required extensions',
      detail:
        `All ${cluster.checkedExtensions} extension(s) installed in this database are ` +
        'available on this server.',
      action: null,
    };
  }

  return {
    id: 'extensions',
    kind: 'capability',
    verdict: 'warning',
    title: 'Required extensions',
    detail:
      `This server does not offer ${cluster.missingExtensions.join(', ')}, which the ` +
      'database uses. A restore stops at the CREATE EXTENSION statement, after the scratch ' +
      'database has been created.',
    action:
      `Install the extension package(s) for ${cluster.missingExtensions.join(', ')} on the ` +
      'PostgreSQL server, then run the pre-flight again.',
  };
}

/**
 * Free disk against the size of the database.
 *
 * ⚠ RETURNS AN ARRAY, AND SOMETIMES AN EMPTY-BUT-FOR-ONE list, because this
 * is the only gate whose verdict and whose CONSEQUENCE (the rollback
 * downgrade) are computed from the same two numbers. Keeping them in one
 * method is what stops the reported verdict and the applied plan from
 * disagreeing — see {@link planRollback}, which reads the same inputs.
 *
 * NOTHING HERE EVER BLOCKS. A restore needs roughly one copy of the database
 * for the scratch replay, and a second copy if the displaced database is
 * retained. When there is not room, the rollback mode downgrades and says
 * so; when the numbers cannot be read at all — the ordinary case for an
 * external server this container cannot see the disk of — it warns. A false
 * block here would refuse a recovery on the strength of a `statfs` against a
 * path that belongs to another host.
 */
export function diskGate(
  cluster: RestoreClusterFacts,
  freeDiskBytes: bigint | null,
  policy: SystemDatabaseBackupValue
): RestoreGateResult[] {
  if (cluster.databaseSizeBytes === null || freeDiskBytes === null) {
    return [
      {
        id: 'disk_space',
        kind: 'disk',
        verdict: 'warning',
        title: 'Free disk space',
        detail:
          cluster.dataDirectory === null
            ? 'The server\'s data directory is not visible from this process (the usual case ' +
              'for a managed or remote PostgreSQL), so free disk space could not be checked.'
            : `Free space at "${cluster.dataDirectory}" could not be read from this process.`,
        action:
          'Check by hand that the server has room for a full copy of the database' +
          (policy.restoreRollbackMode === 'retain_database' ? ' twice over.' : '.'),
      },
    ];
  }

  const required = requiredDiskBytes(cluster.databaseSizeBytes, policy.restoreRollbackMode);

  if (freeDiskBytes >= required) {
    return [
      {
        id: 'disk_space',
        kind: 'disk',
        verdict: 'pass',
        title: 'Free disk space',
        detail:
          `${formatBytes(freeDiskBytes)} free, and this restore needs about ` +
          `${formatBytes(required)}.`,
        action: null,
      },
    ];
  }

  return [
    {
      id: 'disk_space',
      kind: 'disk',
      verdict: 'warning',
      title: 'Free disk space',
      detail:
        `${formatBytes(freeDiskBytes)} free, and this restore needs about ` +
        `${formatBytes(required)} (the database is ${formatBytes(cluster.databaseSizeBytes)}).` +
        (policy.restoreRollbackMode === 'retain_database'
          ? ' The displaced database will therefore be dropped instead of kept, and the way ' +
            'back becomes the pre-restore archive rather than a rename.'
          : ''),
      action:
        policy.restoreRollbackMode === 'retain_database'
          ? 'Free disk on the database server if you want the seconds-long rollback that ' +
            'retaining the displaced database gives you.'
          : 'Free disk on the database server before restoring; the scratch database needs ' +
            'a full copy of the data.',
    },
  ];
}

/**
 * How many distinct client addresses hold sessions on the live database.
 *
 * ⚠ WARNING ONLY, FOREVER. It is a heuristic for "more than one API replica
 * is connected", and #285's swap assumes exactly one: the maintenance flag is
 * per-process, so a second replica keeps serving traffic, gets terminated
 * mid-request by the swap, and then talks to a database that has been renamed
 * out from under it. That is worth telling an operator. It is NOT worth
 * blocking on, because the count also rises for a bastion host, a `psql`
 * session, a metrics exporter or a migration runner — and refusing a
 * legitimate recovery because somebody left a query window open would be
 * indefensible.
 */
export function replicaGate(
  cluster: RestoreClusterFacts,
  connection: RestorePreflightFacts['connection']
): RestoreGateResult {
  const count = cluster.distinctClientAddresses;

  if (!cluster.reachable || count === null) {
    return {
      id: 'replicas',
      kind: 'replicas',
      verdict: 'pass',
      title: 'Connected clients',
      detail: 'Not checked: the cluster could not be read.',
      action: null,
    };
  }

  if (count <= 1) {
    return {
      id: 'replicas',
      kind: 'replicas',
      verdict: 'pass',
      title: 'Connected clients',
      detail: `${count} client address is connected to "${connection.liveDatabase}".`,
      action: null,
    };
  }

  return {
    id: 'replicas',
    kind: 'replicas',
    verdict: 'warning',
    title: 'Connected clients',
    detail:
      `${count} distinct client addresses are connected to "${connection.liveDatabase}". ` +
      'A restore assumes one API instance: the maintenance flag is per-process, so any other ' +
      'instance keeps serving, is terminated mid-request by the swap, and then talks to a ' +
      'renamed database. This count also rises for a psql session or an exporter, so it is a ' +
      'hint, not a verdict.',
    action:
      `Scale the application to a single instance for the restore. See ${RESTORE_RUNBOOK_PATH}.`,
  };
}

/**
 * The archive's schema against the live one, IN BOTH DIRECTIONS.
 *
 * The only overridable gate. Blocking by default is the point: a restore
 * across a schema boundary is a decision — it means running
 * `prisma migrate deploy` afterwards, or accepting a database with columns
 * the running code has never seen — and a decision has to be made by a
 * person, once, deliberately. See `migration-state.util.ts` for why
 * `archive_newer` is the more dangerous of the two despite looking harmless.
 */
export function schemaGate(
  comparison: RestorePreflightFacts['migrationComparison'],
  archiveMigration: string | null,
  liveMigration: string | null,
  options: { overrideSchemaMismatch?: boolean },
): RestoreGateResult {
  if (comparison === 'match') {
    return {
      id: 'schema_compatibility',
      kind: 'overridable',
      verdict: 'pass',
      title: 'Schema compatibility',
      detail: `The archive and this database are both at migration "${liveMigration}".`,
      action: null,
    };
  }

  if (comparison === 'unknown') {
    return {
      id: 'schema_compatibility',
      kind: 'overridable',
      // A warning, not a block: #281 records the migration name best-effort,
      // so an archive from a run whose audit read failed has a null here
      // through no fault of its own. Refusing to restore it would make a
      // best-effort field load-bearing after the fact.
      verdict: 'warning',
      title: 'Schema compatibility',
      detail:
        'The archive does not record which migration it was taken at' +
        (liveMigration === null ? ', and this database\'s migration could not be read' : '') +
        ', so schema compatibility could not be checked.',
      action:
        'Confirm by hand that the archive matches the running code, and be ready to run ' +
        'the migrations afterwards.',
    };
  }

  const detail =
    comparison === 'archive_older'
      ? `The archive was taken at migration "${archiveMigration}", but this database is at ` +
        `"${liveMigration}". Restoring it rolls the schema back, and the running code expects ` +
        'columns the restored database will not have.'
      : `The archive was taken at migration "${archiveMigration}", which is ahead of this ` +
        `database's "${liveMigration}". The running code has never seen that schema, and ` +
        'the migration runner will consider it up to date and apply nothing.';

  if (options.overrideSchemaMismatch === true) {
    return {
      id: 'schema_compatibility',
      kind: 'overridable',
      verdict: 'warning',
      title: 'Schema compatibility',
      detail: `${detail} Overridden by the caller.`,
      action:
        'Run the migrations against the restored database as soon as the swap completes ' +
        `(see ${RESTORE_RUNBOOK_PATH}).`,
    };
  }

  return {
    id: 'schema_compatibility',
    kind: 'overridable',
    verdict: 'block',
    title: 'Schema compatibility',
    detail,
    action:
      'Re-send the request with overrideSchemaMismatch to accept the mismatch and take the ' +
      'restore-then-migrate path.',
  };
}


// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** A built-in gate's legacy result, as the registry's outcome. */
function outcomeOf(result: RestoreGateResult): RestoreGateOutcome {
  return {
    status: result.verdict === 'block' ? 'fail' : result.verdict === 'warning' ? 'warn' : 'pass',
    message: result.detail,
    action: result.action,
  };
}

function builtin(
  id: string,
  label: string,
  kind: RestoreGateKind,
  evaluate: (ctx: RestoreGateContext) => RestoreGateResult,
): RestoreGateDefinition {
  return { id, label, kind, check: async (ctx) => outcomeOf(evaluate(ctx)) };
}

/**
 * The eight built-in gate definitions, in evaluation order.
 *
 * @stability experimental
 */
export const BUILTIN_RESTORE_GATES: readonly RestoreGateDefinition[] = Object.freeze([
  builtin('pg_client_version', 'PostgreSQL client version', 'capability', (ctx) => versionGate(ctx.facts.version)),
  builtin('admin_connection', 'Cluster admin connection', 'capability', (ctx) =>
    adminConnectionGate(ctx.facts.cluster, ctx.facts.connection),
  ),
  builtin('createdb_privilege', 'CREATE DATABASE privilege', 'capability', (ctx) => createDatabaseGate(ctx.facts.cluster)),
  builtin('extensions', 'Required extensions', 'capability', (ctx) => extensionsGate(ctx.facts.cluster)),
  builtin('rls_bypass', 'Row-level security bypass', 'capability', (ctx) =>
    rlsBypassGate(ctx.facts.cluster, ctx.facts.connection),
  ),
  builtin('disk_space', 'Free disk space', 'disk', (ctx) => diskGate(ctx.facts.cluster, ctx.facts.freeDiskBytes, ctx.policy)[0]),
  builtin('replicas', 'Connected clients', 'replicas', (ctx) => replicaGate(ctx.facts.cluster, ctx.facts.connection)),
  builtin('schema_compatibility', 'Schema compatibility', 'overridable', (ctx) =>
    schemaGate(ctx.facts.migrationComparison, ctx.run.migrationName, ctx.liveMigration, {
      overrideSchemaMismatch: ctx.overrideSchemaMismatch,
    }),
  ),
]);

for (const gate of BUILTIN_RESTORE_GATES) {
  if (!restoreGateRegistry.has(gate.id)) registerRestoreGate(gate);
}

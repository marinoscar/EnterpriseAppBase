import { statfs } from 'node:fs/promises';

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { DatabaseBackupRun } from './data/db-backup-db';

import {
  BUILTIN_RESTORE_GATE_IDS,
  RESTORE_GATE_IDS,
  RESTORE_SCHEMA_OVERRIDE_FIELD,
  type RestoreGateId,
  type SystemDatabaseBackupValue,
} from '@marinoscar/platform-contract/db-backup';
import { PLATFORM_PRISMA } from '../core/index';
import type { DbBackupPrisma } from './data/db-backup-db';
import { SystemSettingsService } from '../settings/index';
import {
  buildOldDatabaseName,
  buildScratchDatabaseName,
  countDistinctClientAddresses,
  probeCreateDatabasePrivilege,
  probePgExtensionAvailable,
  quoteIdentifier,
  readDataDirectory,
  readDatabaseSizeBytes,
  readRlsBypassCapability,
  resolveAdminConnection,
  withAdminConnection,
  type AdminConnection,
  type AdminQueryClient,
} from './admin-connection.util';
import { compareMigrationNames, readLatestAppliedMigration } from './migration-state.util';
import {
  evaluateRestoreGates,
  type RestoreClusterFacts,
  type RestoreGateContext,
  type RestoreGateKind,
  type RestoreGateResult,
  type RestoreGateVerdict,
  type RestorePreflightFacts,
} from './restore-gate.registry';
import { formatBytes, requiredDiskBytes, RESTORE_RUNBOOK_PATH } from './restore-gates.builtin';
import { RLS_BYPASS_PGOPTIONS } from './pg-dump.util';
import {
  checkPgClientVersion,
  readServerVersionNumWithPgClient,
  type PgVersionCheck,
} from './pg-version.util';

// =============================================================================
// Restore pre-flight (issue #284, epic #254)
// =============================================================================
//
// A restore either works or it destroys the production database, and ALMOST
// EVERYTHING THAT CAN GO WRONG IS KNOWABLE BEFORE ANYTHING IS CREATED. This
// file is the knowing.
//
// ⚠ NO PATH THROUGH THIS SERVICE CREATES, DROPS OR RENAMES ANYTHING. Every
// cluster call it makes is a `SELECT` or a `SHOW`; the four mutating helpers in
// `admin-connection.util.ts` are #285's alone, and the colocated spec asserts
// with spies that none of them is reached on any outcome. The rule is not
// hygiene: an operator asks "can I restore this?" precisely when they have not
// decided to, and a question that leaves a half-created database behind is a
// question nobody can afford to ask.
//
// -----------------------------------------------------------------------------
// THREE OUTCOMES, AND ALL THREE ARE NORMAL
// -----------------------------------------------------------------------------
//
//   `ok`       Proceed. Some gates may still carry warnings; #287's dialog
//              renders every verdict, not just the failures.
//
//   `guided`   A CAPABILITY gate failed, so the answer is a ready-to-paste,
//              fully parameterised command block and a runbook link INSTEAD OF
//              AN ERROR. This is a designed-in path, not a fallback. Managed
//              PostgreSQL routinely denies `CREATEDB` to the role an
//              application connects with, and an operator on such a platform
//              must still be able to restore — with a superuser, by hand, from
//              the same archive. A 4xx here would tell them their platform is
//              unsupported when it is not, in the middle of an incident.
//
//   `blocked`  Something would make the restore fail or silently corrupt the
//              deployment. Only the SCHEMA gate is overridable, and overriding
//              it means accepting the restore-then-`migrate deploy` path.
//
// PRECEDENCE, when more than one gate fails: a non-overridable block first,
// then `guided`, then the schema block. `guided` outranking the schema block is
// deliberate — a `blocked` result tells the operator to re-send with the
// override, and if the automated path could not run anyway (no `CREATEDB`)
// that instruction sends them round a loop. The guided instructions carry the
// schema warning as an extra step instead, and the schema gate's own verdict is
// still in `gates` for the dialog to render.
//
// -----------------------------------------------------------------------------
// A SHORT DISK DOWNGRADES; IT NEVER REFUSES
// -----------------------------------------------------------------------------
//
// `databaseBackup.restoreRollbackMode: retain_database` keeps the displaced
// database on disk, which costs a second full copy and buys a rollback
// measured in seconds (one `ALTER DATABASE ... RENAME`). When there is not
// room for it, pre-flight downgrades the EFFECTIVE mode to `pre_restore_dump`
// — the safety backup #285 takes immediately before swapping — and SAYS SO.
//
// An administrator mid-incident must never be left with no path forward. What
// the downgrade costs them is a real thing and it is reported in those terms:
// the recovery guarantee changes from seconds to hours, because rolling back
// now means restoring an archive rather than renaming a database. That is a
// decision they can act on. "Not enough disk, refused" is not.
//
// -----------------------------------------------------------------------------
// WHAT IS DELIBERATELY NOT CHECKED HERE
// -----------------------------------------------------------------------------
//
// ⚠ THE ARCHIVE'S BYTES ARE NOT VERIFIED BY PRE-FLIGHT, AND MUST NOT BE. Proving
// an archive is readable means streaming the whole object back out of storage
// through `pg_restore --list` (#281 does exactly that after an upload), and
// that object is the size of the database — gigabytes, minutes to hours. An
// HTTP request cannot wait on it, and a pre-flight that sometimes takes an hour
// is a pre-flight nobody runs. It is the FIRST PHASE of #285's asynchronous
// restore run, where there is a row to record progress on and a heartbeat to
// prove it is alive. Do not move it here.
//
// The single-active-run slot, the `completed`-only rule, the 404 for a run that
// does not exist and the permission check all belong to #286's endpoint, for
// the same reason `getDownloadUrl`'s do: this service takes a row and answers a
// question about it.
// =============================================================================

export { RESTORE_RUNBOOK_PATH };

/**
 * Wall-clock bound on the cluster probes, in milliseconds.
 *
 * Pre-flight runs inside an HTTP request and every query it issues is a
 * trivial catalog read, so anything approaching this is a network that accepts
 * a TCP connection and then swallows packets — the shape a firewall rule
 * change produces. Without the bound that request hangs until the proxy gives
 * up, and the operator learns nothing.
 *
 * ⚠ IT IS NOT `statement_timeout`, WHICH STAYS 0. See
 * `admin-connection.util.ts`: a timeout that abandons a `CREATE DATABASE`
 * halfway buys only ambiguity. Nothing in this service creates anything, which
 * is exactly why this one is safe to set here and nowhere else.
 *
 * @stability experimental
 */
export const PREFLIGHT_PROBE_TIMEOUT_MS = 15_000;

/**
 * Parallel jobs suggested in the guided `pg_restore` command.
 *
 * A suggestion in a command an operator can edit, not a policy — but it must
 * be a real number rather than a placeholder, because the whole value of the
 * guided path is that it can be pasted. Four is safe on any server that can
 * host this application and well short of `MAX_RESTORE_JOBS`.
 *
 * @stability experimental
 */
export const GUIDED_RESTORE_JOBS = 4;

/**
 * The REQUEST FIELD that clears the schema-compatibility block.
 *
 * ⚠ IT IS THE API'S FIELD NAME, NOT THIS SERVICE'S OPTION NAME, and the
 * difference is the whole point. {@link RestoreBlock.overrideParameter} exists
 * to tell a CLIENT which field to set on its next request, so publishing the
 * internal option name (`overrideSchemaMismatch`) would hand an operator a
 * parameter the endpoint rejects — the most frustrating possible failure, where
 * the server has said exactly what to do and refuses when you do it.
 *
 * Declared here rather than in #286's DTO so that this service, which is what
 * actually emits the block, owns the string; the DTO imports it and ties its
 * own schema to it at compile time (`RestoreOverrideFieldIsReal`) and at run
 * time in its spec, so the two cannot drift into naming different things.
 */
// The value lives in `@marinoscar/platform-contract/db-backup` since #740, so
// the web client and the DTO read the same string; re-exported here.
export { RESTORE_SCHEMA_OVERRIDE_FIELD };

// -----------------------------------------------------------------------------
// The result model
// -----------------------------------------------------------------------------

// The built-in gates, in the order they are evaluated and reported: the list
// lives in `@marinoscar/platform-contract/db-backup` (`BUILTIN_RESTORE_GATE_IDS`;
// `RESTORE_GATE_IDS` is its deprecated alias), re-exported here. The gates
// themselves are a registry (`restore-gate.registry.ts`): the eight built-ins
// register through it (`restore-gates.builtin.ts`) and an app adds its own with
// `registerRestoreGate`.
export { BUILTIN_RESTORE_GATE_IDS, RESTORE_GATE_IDS };
/** @stability experimental */
export type { RestoreGateId };

/**
 * The gates whose failure means "this deployment cannot do this automatically,
 * and here is how a human can".
 *
 * ⚠ `pg_client_version` IS A CAPABILITY GATE AND IS DELIBERATELY NOT IN THIS
 * LIST. Its only actionable failure is the block (see
 * {@link DatabaseRestorePreflightService.versionGate}), and its other non-pass
 * verdict is `unknown` — an unparseable version banner, which is not evidence
 * that anything is wrong. Routing that to `guided` would send an operator into
 * a manual restore, during an incident, because a string did not parse.
 *
 * A list rather than a predicate over `kind`, so that adding a gate is a
 * decision about whether its failure has a manual answer, taken here, once.
 */
const GUIDED_GATE_IDS: readonly RestoreGateId[] = [
  'admin_connection',
  'createdb_privilege',
  'extensions',
  'rls_bypass',
];

export type { RestoreGateKind, RestoreGateResult, RestoreGateVerdict };

/**
 * The rollback mode a restore will actually use.
 *
 * `retain_database` and `drop_database` are what
 * `databaseBackup .restoreRollbackMode` stores; `pre_restore_dump` is what `drop_database`
 * MEANS once you ask what the way back is — the `pre_restore` archive #285
 * takes immediately before the swap. Naming the effective mode after the thing
 * that actually recovers you (rather than after the thing that is destroyed) is
 * what makes the downgrade message honest: "retain_database → pre_restore_dump"
 * says what you still have, where "retain_database → drop_database" would only
 * say what you lost.
 *
 * @stability experimental
 */
export type EffectiveRollbackMode = 'retain_database' | 'pre_restore_dump';

/**
 * What a restore's rollback story is, after pre-flight has had its say.
 *
 * @stability experimental
 */
export interface RestoreRollbackPlan {
  /** Configured. */
  configured: SystemDatabaseBackupValue['restoreRollbackMode'];
  /** Effective. */
  effective: EffectiveRollbackMode;
  /** `true` when disk pressure changed the answer. */
  downgraded: boolean;
  /** Why it changed, in the operator's terms. `null` when it did not. */
  reason: string | null;
}

/**
 * The ready-to-paste answer the `guided` outcome exists to deliver.
 *
 * @stability experimental
 */
export interface GuidedRestoreInstructions {
  /** Which gate(s) sent the operator here, in one sentence. */
  reason: string;
  /**
   * A complete shell block: real database names, real user, real host and
   * port, real run id. Asserted by string in the tests, because a command
   * block with a placeholder in it is not a deliverable — it is homework.
   */
  commands: string;
  /** Repository-relative path to the runbook that explains the block. */
  runbook: string;
}

/**
 * What blocked, and whether the caller can do anything about it.
 *
 * @stability experimental
 */
export interface RestoreBlock {
  /** Gate id. */
  gateId: RestoreGateId;
  /** Message. */
  message: string;
  /** `true` only for the schema gate. */
  overridable: boolean;
  /**
   * The request field that overrides it, or `null`.
   *
   * Named here rather than in #286's DTO so the API and this service cannot
   * disagree about what unblocks what.
   */
  overrideParameter: string | null;
}

/**
 * Everything every outcome carries.
 *
 * @stability experimental
 */
export interface RestorePreflightBase {
  /** The backup this was asked about. */
  runId: string;
  /** The application's database — the one a restore would displace. */
  targetDatabase: string;
  /** The database an archive would be replayed into, if a restore started now. */
  scratchDatabase: string;
  /** The name the live database would be renamed to. */
  oldDatabase: string;
  /** Gates. */
  gates: RestoreGateResult[];
  /** Rollback. */
  rollback: RestoreRollbackPlan;
  /** The migration recorded on the archive, and the one live right now. */
  archiveMigration: string | null;
  /** Live migration. */
  liveMigration: string | null;
  /**
   * The live database's on-disk size, as a DECIMAL STRING.
   *
   * A string because the value is a `bigint` — `pg_database_size` returns
   * `int8` and `JSON.stringify` refuses a `bigint` outright, which is the same
   * hazard `db-backup-run.dto.ts` converts around for `sizeBytes`. `null` when
   * the cluster could not be read.
   */
  databaseSizeBytes: string | null;
  /** Free bytes where the server keeps its data, as a decimal string, or `null`. */
  freeDiskBytes: string | null;
}

/** @stability experimental */
export type RestorePreflightResult =
  | (RestorePreflightBase & {
      /** Every gate passed (warnings included): the automated restore may run. */
      outcome: 'ok';
    })
  | (RestorePreflightBase & {
      /** This deployment cannot restore automatically; a human can. */
      outcome: 'guided';
      /** How. */
      guidance: GuidedRestoreInstructions;
    })
  | (RestorePreflightBase & {
      /** A gate refused the restore. */
      outcome: 'blocked';
      /** Which, and whether an override exists. */
      block: RestoreBlock;
    });

/** @stability experimental */
export interface RestorePreflightOptions {
  /**
   * Accepts a schema mismatch and proceeds.
   *
   * ⚠ IT UNBLOCKS EXACTLY ONE GATE. A capability failure is not a decision an
   * operator is entitled to override — no amount of accepting makes a role
   * without `CREATEDB` able to create a database — and an override that
   * silenced everything would turn the one deliberate escape hatch in this
   * subsystem into a way to skip all of it. There is an explicit negative test.
   */
  overrideSchemaMismatch?: boolean;
  /** Injected so a test can pin the derived names without moving the wall clock. */
  now?: Date;
}

// -----------------------------------------------------------------------------
// The seam
// -----------------------------------------------------------------------------

/**
 * Everything this service does that touches a real cluster or a real disk.
 *
 * ONE OBJECT, INJECTED AS A WHOLE, so a test substitutes a cluster rather than
 * four unrelated functions. The shape follows `DB_BACKUP_ENGINE` in
 * `db-backup-runner.service.ts` for the same reason it exists there: a suite
 * that needs a live PostgreSQL is a suite CI skips.
 *
 * @stability experimental
 */
export interface RestorePreflightSeam {
  /** Where the admin session goes, and what database it is about. */
  resolveConnection(): AdminConnection;
  /** Runs a read-only unit of work against the maintenance database. */
  withAdminConnection<T>(
    /** Config. */
    config: AdminConnection,
    /** Fn. */
    fn: (client: AdminQueryClient) => Promise<T>
  ): Promise<T>;
  /** The `pg_restore` client major against the server's. */
  checkClientVersion(): Promise<PgVersionCheck>;
  /**
   * Free bytes on the filesystem holding `path`, or `null` when this process
   * cannot see it.
   *
   * `null` IS THE COMMON CASE and not a failure: the database is external to
   * the compose stack (`infra/compose/base.compose.yml` declares no `db`
   * service), so the server's data directory is usually on a host this
   * container has never heard of. The disk gate turns that into a warning; see
   * {@link DatabaseRestorePreflightService} for why it must never block.
   */
  readFreeDiskBytes(path: string): Promise<bigint | null>;
}

/**
 * Injection token for {@link RestorePreflightSeam}.
 *
 * OPTIONAL, AND LEFT UNBOUND in `DbBackupModule` — the same discipline
 * `DB_BACKUP_ENGINE`, `DB_BACKUP_TIMERS`, `JOB_CLOCK` and `JOB_RANDOM` follow.
 * The application always probes the real cluster; only a test that constructs
 * this service directly can substitute one. A stubbed cluster in production
 * would report a clean pre-flight against nothing at all, which is the single
 * most dangerous lie this subsystem could tell.
 *
 * @stability experimental
 */
export const RESTORE_PREFLIGHT_SEAM = 'RESTORE_PREFLIGHT_SEAM';

/**
 * The real seam. Every member is a thin binding to the utility that owns it.
 *
 * @stability experimental
 */
export const defaultRestorePreflightSeam: RestorePreflightSeam = {
  resolveConnection: () => resolveAdminConnection(),

  withAdminConnection: (config, fn) =>
    withAdminConnection(config, fn, { timeoutMs: PREFLIGHT_PROBE_TIMEOUT_MS }),

  checkClientVersion: () =>
    checkPgClientVersion({
      // The `pg` seam rather than a Prisma query, matching the backup engine:
      // it answers "what major is the server" without going through an ORM
      // that is bound to a database a restore is about to rename.
      readServerVersionNum: () => readServerVersionNumWithPgClient(),
    }),

  readFreeDiskBytes: async (path: string) => {
    try {
      const stats = await statfs(path);

      // `bavail`, not `bfree`: the difference is the reserved blocks only root
      // may use, and a restore does not run as root. Reporting `bfree` would
      // promise space that `CREATE DATABASE` cannot actually have.
      return BigInt(stats.bsize) * BigInt(stats.bavail);
    } catch {
      return null;
    }
  },
};

// -----------------------------------------------------------------------------

/** What one round of cluster probes produced. Every field survives a failure. */
type ClusterProbeResult = RestoreClusterFacts;

/**
 * The restore pre-flight: every gate, read-only. It creates, drops, renames and alters nothing.
 *
 * @stability experimental
 */
@Injectable()
export class DatabaseRestorePreflightService {
  private readonly logger = new Logger(DatabaseRestorePreflightService.name);

  private readonly seam: RestorePreflightSeam;

  constructor(
    @Inject(PLATFORM_PRISMA) private readonly prisma: DbBackupPrisma,
    private readonly settings: SystemSettingsService,
    @Optional()
    @Inject(RESTORE_PREFLIGHT_SEAM)
    seam?: RestorePreflightSeam
  ) {
    this.seam = seam ?? defaultRestorePreflightSeam;
  }

  /**
   * Answers "can this backup be restored, and what will it cost?" without
   * changing anything.
   *
   * @param run - the backup row. Looked up, permission-checked and
   * `completed`-filtered by #286's endpoint — this service answers a question
   * about a row it is given, exactly as `getDownloadUrl` does about one it
   * fetched.
   */
  async check(
    run: DatabaseBackupRun,
    options: RestorePreflightOptions = {}
  ): Promise<RestorePreflightResult> {
    const now = options.now ?? new Date();
    const policy = await this.settings.getDatabaseBackupPolicy();
    const connection = this.seam.resolveConnection();

    const scratchDatabase = buildScratchDatabaseName(connection.liveDatabase, now);
    const oldDatabase = buildOldDatabaseName(connection.liveDatabase, now);

    // The version pair and the cluster probes are independent, and both are
    // network round trips; running them together keeps the whole pre-flight
    // inside one perceptible pause rather than two.
    const [version, cluster, liveMigration] = await Promise.all([
      this.readVersionCheck(),
      // The probe session carries the dump's and the restore's startup option
      // (#740), so the `rls_bypass` gate sees it reach the server; on the
      // maintenance database it changes nothing else.
      this.probeCluster({ ...connection, options: RLS_BYPASS_PGOPTIONS }),
      readLatestAppliedMigration(this.prisma),
    ]);

    const freeDiskBytes =
      cluster.dataDirectory === null
        ? null
        : await this.seam.readFreeDiskBytes(cluster.dataDirectory);

    const comparison = compareMigrationNames(run.migrationName, liveMigration);

    // The gates are a registry (`restore-gate.registry.ts`): the eight
    // built-ins in their historical order, then the app's. Every gate is
    // read-only and gets a read-only context; a gate that throws or hangs is a
    // `block` naming it (fail closed).
    const gates = await evaluateRestoreGates(
      this.gateContext({
        run,
        policy,
        now,
        connection,
        liveMigration,
        facts: {
          version,
          cluster,
          connection: {
            host: connection.host,
            port: connection.port,
            user: connection.user,
            database: connection.database,
            liveDatabase: connection.liveDatabase,
          },
          freeDiskBytes,
          migrationComparison: comparison,
        },
        overrideSchemaMismatch: options.overrideSchemaMismatch === true,
      })
    );

    const rollback = this.planRollback(policy, cluster, freeDiskBytes);

    const base: RestorePreflightBase = {
      runId: run.id,
      targetDatabase: connection.liveDatabase,
      scratchDatabase,
      oldDatabase,
      gates,
      rollback,
      archiveMigration: run.migrationName,
      liveMigration,
      databaseSizeBytes: cluster.databaseSizeBytes?.toString() ?? null,
      freeDiskBytes: freeDiskBytes?.toString() ?? null,
    };

    return this.decide(base, run, connection, comparison);
  }

  /** The read-only context every gate receives. No handle in it can write. */
  private gateContext(input: {
    run: DatabaseBackupRun;
    policy: SystemDatabaseBackupValue;
    now: Date;
    connection: AdminConnection;
    liveMigration: string | null;
    facts: RestorePreflightFacts;
    overrideSchemaMismatch: boolean;
  }): RestoreGateContext {
    const { run } = input;

    return Object.freeze({
      run: Object.freeze({
        id: run.id,
        storageKey: run.storageKey,
        storageProvider: run.storageProvider,
        sizeBytes: String(run.sizeBytes ?? 0),
        migrationName: run.migrationName ?? null,
        createdAt: run.createdAt,
      }),
      policy: input.policy,
      now: input.now,
      targetDatabase: input.connection.liveDatabase,
      liveMigration: input.liveMigration,
      overrideSchemaMismatch: input.overrideSchemaMismatch,
      settings: Object.freeze({
        get: async (namespace: string) => {
          try {
            const value = await (this.settings as unknown as { getNamespace(key: string): Promise<unknown> }).getNamespace(namespace);
            return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
          } catch {
            // An unregistered namespace: the app has not configured whatever
            // the gate depends on, which the gate reads as "not applicable".
            return undefined;
          }
        },
      }),
      facts: input.facts,
    });
  }

  // =========================================================================
  // Outcome
  // =========================================================================

  /**
   * Turns the gate verdicts into one of the three outcomes.
   *
   * The precedence — hard block, then guided, then the overridable block — is
   * argued in this file's header. It lives in one place so that adding a gate
   * cannot change it by accident.
   */
  private decide(
    base: RestorePreflightBase,
    run: DatabaseBackupRun,
    connection: AdminConnection,
    comparison: ReturnType<typeof compareMigrationNames>
  ): RestorePreflightResult {
    const blocking = base.gates.filter((gate) => gate.verdict === 'block');

    // 1. A non-overridable block. Today that is only the client/server version
    //    pair, and it comes first because nothing else matters if the binaries
    //    cannot speak to the server: the guided block would hand the operator
    //    commands run by the same `pg_restore` that cannot read it.
    const hard = blocking.find((gate) => gate.kind !== 'overridable');
    if (hard !== undefined) {
      return {
        ...base,
        outcome: 'blocked',
        block: {
          gateId: hard.id,
          message: hard.detail,
          overridable: false,
          overrideParameter: null,
        },
      };
    }

    // 2. A capability failure. `guided` outranks the schema block on purpose —
    //    see the header: telling an operator to re-send with an override when
    //    the automated path cannot run at all is a loop, not an instruction.
    const capabilityFailures = base.gates.filter(
      (gate) => gate.verdict === 'warning' && GUIDED_GATE_IDS.includes(gate.id)
    );

    if (capabilityFailures.length > 0) {
      return {
        ...base,
        outcome: 'guided',
        guidance: {
          reason: capabilityFailures.map((gate) => gate.detail).join(' '),
          commands: buildGuidedRestoreCommands({
            connection,
            run,
            scratchDatabase: base.scratchDatabase,
            oldDatabase: base.oldDatabase,
            schemaMismatch: comparison === 'archive_older' || comparison === 'archive_newer',
          }),
          runbook: RESTORE_RUNBOOK_PATH,
        },
      };
    }

    // 3. The schema gate, which a human may override.
    const overridable = blocking[0];
    if (overridable !== undefined) {
      return {
        ...base,
        outcome: 'blocked',
        block: {
          gateId: overridable.id,
          message: overridable.detail,
          overridable: true,
          overrideParameter: RESTORE_SCHEMA_OVERRIDE_FIELD,
        },
      };
    }

    return { ...base, outcome: 'ok' };
  }

  // =========================================================================
  // Probes
  // =========================================================================

  /** {@link checkPgClientVersion}, degraded to `unknown` rather than thrown. */
  private async readVersionCheck(): Promise<PgVersionCheck> {
    try {
      return await this.seam.checkClientVersion();
    } catch (error) {
      // The utility already fails open on every internal error; this catch
      // covers the seam itself. An unreadable version must never be the reason
      // a restore was refused, for the same reason it must never be the reason
      // a backup did not happen.
      this.logger.warn(
        `The PostgreSQL client/server version pair could not be read: ${describe(error)}`
      );

      return {
        status: 'unknown',
        clientMajor: null,
        serverMajor: null,
        message: 'The PostgreSQL client/server version pair could not be read.',
      };
    }
  }

  /**
   * Every cluster read, in ONE session.
   *
   * One connection rather than one per probe, because each of them is a
   * connection to the server whose `max_connections` a restore is about to
   * stress — and because a probe that leaks a session leaks it to the cluster
   * whose live database has to be free of sessions before a rename can succeed.
   *
   * NEVER THROWS. An unreachable cluster is a VERDICT (`guided`), not an
   * exception: the operator's next step is the manual path, which needs the
   * rest of this result to be built.
   */
  private async probeCluster(connection: AdminConnection): Promise<ClusterProbeResult> {
    const empty: ClusterProbeResult = {
      reachable: false,
      error: null,
      canCreateDatabase: null,
      missingExtensions: [],
      checkedExtensions: null,
      databaseSizeBytes: null,
      dataDirectory: null,
      distinctClientAddresses: null,
      rlsBypass: null,
    };

    // Read through Prisma, deliberately: `pg_extension` is PER-DATABASE, and
    // the admin session is attached to the maintenance database where the
    // application's extensions are not installed. What the archive will try to
    // create is what the LIVE database has.
    const installed = await this.readInstalledExtensions();

    try {
      return await this.seam.withAdminConnection(connection, async (client) => {
        const canCreateDatabase = await probeCreateDatabasePrivilege(client);
        const dataDirectory = await readDataDirectory(client);
        const databaseSizeBytes = await readDatabaseSizeBytes(client, connection.liveDatabase);
        const distinctClientAddresses = await countDistinctClientAddresses(
          client,
          connection.liveDatabase
        );

        const missingExtensions =
          installed === null ? [] : await findMissingExtensions(client, installed);
        const rlsBypass = await readRlsBypassCapability(client);

        return {
          reachable: true,
          error: null,
          canCreateDatabase,
          missingExtensions,
          checkedExtensions: installed?.length ?? null,
          databaseSizeBytes,
          dataDirectory,
          distinctClientAddresses,
          rlsBypass,
        };
      });
    } catch (error) {
      this.logger.warn(
        `The PostgreSQL maintenance connection could not be used for restore pre-flight, so ` +
          `the guided path is the answer: ${describe(error)}`
      );

      return { ...empty, error: describe(error) };
    }
  }

  /**
   * The extensions installed in the LIVE database.
   *
   * `null` when the read failed, which the gate reports as "could not check"
   * rather than "nothing to check" — the two are very different answers and
   * an empty array would quietly claim the safe one.
   */
  private async readInstalledExtensions(): Promise<string[] | null> {
    try {
      const rows = await this.prisma.$queryRaw<Array<{ extname: unknown }>>`
        SELECT extname FROM pg_extension ORDER BY extname
      `;

      return rows
        .map((row) => row.extname)
        .filter((name): name is string => typeof name === 'string' && name.length > 0);
    } catch {
      return null;
    }
  }

  // =========================================================================
  // Rollback plan
  // =========================================================================

  /**
   * What the way back will be, after disk has had its say.
   *
   * Reads the SAME two numbers {@link diskGate} does, so the verdict an
   * operator sees and the plan the restore would follow cannot disagree. When
   * the numbers are unreadable the configured mode stands: a downgrade on a
   * guess would silently remove a rollback guarantee the operator asked for.
   */
  private planRollback(
    policy: SystemDatabaseBackupValue,
    cluster: ClusterProbeResult,
    freeDiskBytes: bigint | null
  ): RestoreRollbackPlan {
    const configured = policy.restoreRollbackMode;

    if (configured !== 'retain_database') {
      return {
        configured,
        effective: 'pre_restore_dump',
        downgraded: false,
        reason: null,
      };
    }

    if (cluster.databaseSizeBytes === null || freeDiskBytes === null) {
      return { configured, effective: 'retain_database', downgraded: false, reason: null };
    }

    const required = requiredDiskBytes(cluster.databaseSizeBytes, configured);
    if (freeDiskBytes >= required) {
      return { configured, effective: 'retain_database', downgraded: false, reason: null };
    }

    return {
      configured,
      effective: 'pre_restore_dump',
      downgraded: true,
      reason:
        `Keeping the displaced database needs about ${formatBytes(required)} and only ` +
        `${formatBytes(freeDiskBytes)} is free, so it will be dropped and the pre-restore ` +
        'archive becomes the way back. Rolling this restore back would then mean restoring ' +
        'that archive — hours — rather than renaming a database — seconds.',
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Which of a database's installed extensions this cluster cannot offer. */
async function findMissingExtensions(
  client: AdminQueryClient,
  installed: string[]
): Promise<string[]> {
  const missing: string[] = [];

  // Serial rather than `Promise.all`: this is one connection, and node-postgres
  // queues concurrent queries on a single client anyway. Writing it as a race
  // would only make the order of the results — which is the order they are
  // reported to a human in — non-deterministic.
  for (const name of installed) {
    if (!(await probePgExtensionAvailable(client, name))) missing.push(name);
  }

  return missing;
}

/** Anything thrown, as a message. JavaScript lets you throw a string. */
function describe(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

/** Everything the guided command block needs to be complete. */
interface GuidedCommandContext {
  connection: AdminConnection;
  run: DatabaseBackupRun;
  scratchDatabase: string;
  oldDatabase: string;
  schemaMismatch: boolean;
}

/**
 * THE GUIDED PATH'S ENTIRE DELIVERABLE: a shell block an operator can paste.
 *
 * ⚠ IT MUST BE COMPLETE AND CORRECTLY PARAMETERISED. Real host, real port,
 * real user, real database names, real run id, real archive filename. A block
 * with `<your-host>` in it is not instructions — it is homework, handed to
 * somebody whose application is down, and every substitution they have to make
 * by hand is a chance to point a `DROP`/`RENAME` at the wrong database. The
 * tests assert this block BY STRING for exactly that reason.
 *
 * TWO VALUES ARE DELIBERATELY NOT INTERPOLATED, and neither is a placeholder in
 * the "fill this in" sense:
 *
 *   - THE PASSWORD. Printing it would put a live database credential into an
 *     HTTP response, a browser's memory, a screenshot and quite possibly a
 *     support ticket. It is exported from the environment the operator already
 *     has.
 *   - THE SIGNED DOWNLOAD URL. It does not exist yet — it is minted, with a
 *     five-minute expiry, by the command on the line above it.
 *
 * Nothing here hard-codes an application, product or repository name: every
 * name in the block is derived from this deployment's own configuration.
 *
 * @stability experimental
 */
export function buildGuidedRestoreCommands(context: GuidedCommandContext): string {
  const { connection, run, scratchDatabase, oldDatabase, schemaMismatch } = context;
  const { host, port, user, liveDatabase, database: maintenanceDatabase } = connection;

  const conn = `--host=${host} --port=${port} --username=${user}`;
  const archiveFile = `/tmp/${basename(run.storageKey)}`;
  const psql = `psql ${conn} --dbname=${maintenanceDatabase}`;

  const lines = [
    `# Manual restore of "${liveDatabase}" from backup run ${run.id}`,
    `# Archive: ${run.storageKey}`,
    '#',
    '# Run these from a host that can reach the database server, as a role that may',
    '# create databases (a superuser, or any role holding CREATEDB). The application',
    '# role could not, which is why you are reading this instead of pressing a button.',
    '#',
    '# The database password is not printed here on purpose - export the one this',
    '# deployment already uses before you start:',
    '#   export PGPASSWORD=...',
    '',
    '# 1. Mint a five-minute download URL for the archive, then fetch it.',
    `appctl api GET /api/admin/db-backup/runs/${run.id}/download`,
    `curl -fSL -o ${archiveFile} "<the url printed by the command above>"`,
    '',
    '# 2. Create the scratch database. This is the step the application role',
    '#    could not perform; nothing is touched in the live database yet.',
    `createdb ${conn} ${scratchDatabase}`,
    '',
    '# 3. Replay the archive into it. --exit-on-error is load-bearing: without it',
    '#    pg_restore logs failures, carries on, and exits 0 - and you would swap a',
    '#    half-populated database into place believing it worked.',
    '#    --enable-row-security with the app.rls_bypass startup option is the pair',
    '#    every restore carries: the tenant tables force row-level security, and a',
    '#    role that does not bypass it would otherwise write them without their rows.',
    `PGOPTIONS='${RLS_BYPASS_PGOPTIONS}' pg_restore ${conn} --dbname=${scratchDatabase} \\`,
    `  --no-owner --no-acl --exit-on-error --enable-row-security --jobs=${GUIDED_RESTORE_JOBS} \\`,
    `  ${archiveFile}`,
    '',
    '# 4. STOP THE APPLICATION. Everything below renames databases out from under',
    '#    any process still connected, and a rename fails while a session is open.',
    '',
    '# 5. Swap. Both renames are catalog updates: each one either happens or does not.',
    `${psql} \\`,
    `  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${liveDatabase}' AND pid <> pg_backend_pid();" \\`,
    `  -c 'ALTER DATABASE "${liveDatabase}" RENAME TO "${oldDatabase}";' \\`,
    `  -c 'ALTER DATABASE "${scratchDatabase}" RENAME TO "${liveDatabase}";'`,
  ];

  if (schemaMismatch) {
    lines.push(
      '',
      '# 6. The archive and the running code are at different migrations, so bring',
      '#    the restored database up to the schema the code expects before serving.',
      '#    Run this wherever you run migrations for this deployment:',
      '#      npm run prisma:migrate --workspace=api'
    );
  }

  lines.push(
    '',
    `# ${schemaMismatch ? 7 : 6}. Start the application, then verify before you delete anything.`,
    '#    The way back, while the displaced database still exists:',
    `#      ALTER DATABASE "${liveDatabase}" RENAME TO "${scratchDatabase}";`,
    `#      ALTER DATABASE "${oldDatabase}" RENAME TO "${liveDatabase}";`,
    '#',
    `# The whole procedure, with the failure cases, is in ${RESTORE_RUNBOOK_PATH}.`
  );

  return lines.join('\n');
}

/** The last `/`-separated segment of a storage key. */
function basename(storageKey: string): string {
  const parts = storageKey.split('/');

  return parts[parts.length - 1] || storageKey;
}

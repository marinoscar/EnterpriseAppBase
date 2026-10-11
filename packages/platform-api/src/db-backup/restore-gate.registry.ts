// =============================================================================
// The restore gate registry (PP-14.12)
// =============================================================================
//
// A restore either works or it destroys the production database, and almost
// everything that can go wrong is knowable BEFORE anything is created. The
// pre-flight (`restore-preflight.service.ts`) asks a list of GATES; each answers
// pass, warn or fail. The list is a registry, so an app adds a gate of its own
// ("is the CDN quiesced?", "is the nightly ETL idle?") without editing the
// pre-flight:
//
//   registerRestoreGate({
//     id: 'cdn-quiesced',
//     label: 'CDN quiesced',
//     async check(ctx) {
//       const cdn = await ctx.settings.get('cdn');
//       return cdn?.quiesced ? { status: 'pass', message: 'The CDN is quiesced.' }
//                            : { status: 'fail', message: 'Quiesce the CDN first.', action: 'Pause the CDN, then retry.' };
//     },
//   });
//
// The eight gates the platform ships (`BUILTIN_RESTORE_GATE_IDS`) register
// through the same function (`restore-gates.builtin.ts`), in their historical
// order; app gates run after them, in registration order.
//
// -----------------------------------------------------------------------------
// THE RULES A GATE HONOURS (the `describeRestoreGateConformance` kit asserts them)
// -----------------------------------------------------------------------------
//
//   1. A GATE IS READ-ONLY. It creates, drops, renames and alters nothing: not
//      in the database, not on disk, not in a remote system. An operator asks
//      "can I restore this?" precisely when they have not decided to, and a
//      question that leaves something half-changed is a question nobody can
//      afford to ask. The context hands a gate only read handles (`settings.get`,
//      `facts`); the kit runs it against a context whose every mutating member
//      records a violation, and against a client that records every SQL
//      statement it is given.
//   2. A GATE ANSWERS. It returns `pass`, `warn` or `fail` with a message an
//      operator can act on; it does not throw for an expected condition.
//   3. A THROW OR A TIMEOUT IS A `fail`. A gate that cannot be evaluated blocks
//      the restore (fail closed) with a message naming the gate: "unknown" must
//      not read as "safe" on the path that replaces the database. Every gate is
//      bounded by `RESTORE_GATE_TIMEOUT_MS`.
//   4. WHAT EACH STATUS DOES. `pass` and `warn` let the restore proceed (a warn
//      is a pass that says something and is shown to the operator). `fail` from
//      an app gate BLOCKS the restore, and cannot be overridden from the
//      request: the override (`overrideSchemaCheck`) answers the schema gate
//      only. A built-in gate's `fail` follows its own kind (see `RestoreGateKind`).
// =============================================================================

import { BUILTIN_RESTORE_GATE_IDS, RESTORE_GATE_ID_PATTERN } from '@marinoscar/platform-contract/db-backup';
import type { SystemDatabaseBackupValue } from '@marinoscar/platform-contract/db-backup';

import { defineRegistry, type Registry } from '../core/index';
import type { AdminConnection } from './admin-connection.util';
import type { PgVersionCheck } from './pg-version.util';

/**
 * Longest a single gate may take before the pre-flight records it as failed.
 *
 * @stability experimental
 */
export const RESTORE_GATE_TIMEOUT_MS = 10_000;

/**
 * What kind of problem a gate reports, which is what decides how a failure is
 * handled.
 *
 *  - `capability` — this deployment cannot perform the automated restore. Fails
 *    to `guided`, except the version pair; see that gate.
 *  - `disk` — there is not room for something. Downgrades, never refuses.
 *  - `replicas` — a heuristic about the deployment's shape. Warning only.
 *  - `overridable` — a correctness question a human may answer. Blocks until
 *    they do.
 *  - `app` — an app gate. A `fail` blocks the restore outright.
 *
 * @stability experimental
 */
export type RestoreGateKind = 'capability' | 'disk' | 'replicas' | 'overridable' | 'app';

/**
 * One gate's answer.
 *
 * @stability experimental
 */
export interface RestoreGateOutcome {
  /** `pass` and `warn` proceed (a warn is shown); `fail` blocks (see the file header for what a built-in `fail` does). */
  readonly status: 'pass' | 'fail' | 'warn';
  /** What was found, in one or two sentences an operator can act on. */
  readonly message: string;
  /** What to DO about it; absent or `null` when there is nothing to do. */
  readonly action?: string | null;
}

/**
 * One gate's verdict in the pre-flight result. `warning` is a pass that says
 * something. (A gate's own answer is a {@link RestoreGateOutcome}; this is that
 * answer as the result and the wire carry it: `pass`, `warn` -> `warning`,
 * `fail` -> `block`.)
 *
 * @stability experimental
 */
export type RestoreGateVerdict = 'pass' | 'warning' | 'block';

/**
 * One gate's finding in the pre-flight result.
 *
 * EVERY GATE PRODUCES ONE OF THESE, INCLUDING THE ONES THAT PASSED: the
 * restore dialog renders the whole list, so an operator about to replace their
 * production database sees what was checked, not only what failed.
 *
 * @stability experimental
 */
export interface RestoreGateResult {
  /** Id: a built-in's, or the id an app registered. */
  id: string;
  /** Kind. */
  kind: RestoreGateKind;
  /** Verdict. */
  verdict: RestoreGateVerdict;
  /** Short label, safe to render as a row heading. */
  title: string;
  /** What was found, in one or two sentences an operator can act on. */
  detail: string;
  /** What to DO about it, or `null` when there is nothing to do. */
  action: string | null;
}

/**
 * What a gate may know about the archive being restored: the run's fields,
 * read-only, as plain values.
 *
 * @stability experimental
 */
export interface RestoreGateRun {
  /** The backup run. */
  readonly id: string;
  /** The archive's key. */
  readonly storageKey: string;
  /** The target the archive lives on. */
  readonly storageProvider: string;
  /** The archive's size, as a decimal string. */
  readonly sizeBytes: string;
  /** The migration the archive was taken at, if recorded. */
  readonly migrationName: string | null;
  /** When the run was created. */
  readonly createdAt: Date;
}

/**
 * What the cluster probes found, for the built-in gates (and any app gate that
 * wants the same facts). Every field survives a failed probe.
 *
 * @stability experimental
 */
export interface RestoreClusterFacts {
  /** Whether the maintenance connection could be opened. */
  readonly reachable: boolean;
  /** Why it was not, when it was not. */
  readonly error: string | null;
  /** Whether the role may create databases; `null` when not read. */
  readonly canCreateDatabase: boolean | null;
  /** Extensions installed in the live database that this cluster cannot offer. */
  readonly missingExtensions: readonly string[];
  /** `null` when the extension check itself could not be performed. */
  readonly checkedExtensions: number | null;
  /** The live database's size, when read. */
  readonly databaseSizeBytes: bigint | null;
  /** The server's data directory, when visible. */
  readonly dataDirectory: string | null;
  /** Distinct client addresses holding sessions on the live database. */
  readonly distinctClientAddresses: number | null;
  /** How the session's role lifts row-level security; `null` when not read. */
  readonly rlsBypass: { readonly superuser: boolean; readonly bypassRls: boolean; readonly optionApplied: boolean } | null;
}

/**
 * The probes the pre-flight ran once, shared by every gate. A password is never
 * part of them.
 *
 * @stability experimental
 */
export interface RestorePreflightFacts {
  /** The PostgreSQL client/server version pair. */
  readonly version: PgVersionCheck;
  /** The cluster probes. */
  readonly cluster: RestoreClusterFacts;
  /** The admin connection's coordinates (host, port, user, databases): no password. */
  readonly connection: Pick<AdminConnection, 'host' | 'port' | 'user' | 'database' | 'liveDatabase'>;
  /** Free bytes where the server keeps its data, when readable from this process. */
  readonly freeDiskBytes: bigint | null;
  /** The archive's migration against the live one. */
  readonly migrationComparison: 'match' | 'archive_older' | 'archive_newer' | 'unknown';
}

/**
 * A read handle on the system settings a gate may consult. It cannot write.
 *
 * @stability experimental
 */
export interface RestoreGateSettings {
  /**
   * One system settings namespace's stored value, or `undefined` when no such
   * namespace is registered (a gate that depends on an app setting stays inert
   * until the app registers it).
   *
   * @param namespace - the namespace key.
   */
  get(namespace: string): Promise<Record<string, unknown> | undefined>;
}

/**
 * What a gate is given. Everything on it is read-only.
 *
 * @stability experimental
 */
export interface RestoreGateContext {
  /** The archive being restored. */
  readonly run: RestoreGateRun;
  /** The `databaseBackup` policy. */
  readonly policy: SystemDatabaseBackupValue;
  /** The pre-flight's clock. */
  readonly now: Date;
  /** The application's database: the one a restore would displace. */
  readonly targetDatabase: string;
  /** The migration live right now, if readable. */
  readonly liveMigration: string | null;
  /** Whether the caller asked to override the schema gate. */
  readonly overrideSchemaMismatch: boolean;
  /** Read-only system settings. */
  readonly settings: RestoreGateSettings;
  /** The probes the pre-flight already ran. */
  readonly facts: RestorePreflightFacts;
}

/**
 * One restore gate.
 *
 * @example
 * ```ts
 * registerRestoreGate({
 *   id: 'cdn-quiesced',
 *   label: 'CDN quiesced',
 *   check: async (ctx) => ({ status: 'pass', message: 'ok' }),
 * });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export interface RestoreGateDefinition {
  /** Lowercase id (letters, digits, `_`, `-`; starts with a letter): `cdn-quiesced`. Unique. */
  readonly id: string;
  /** Short label, the row heading in the restore dialog. */
  readonly label: string;
  /** How a failure is handled; default `'app'` (a hard block). The built-ins declare their own. */
  readonly kind?: RestoreGateKind;
  /**
   * Evaluates the gate. Read-only (see the file header); bounded by
   * {@link RESTORE_GATE_TIMEOUT_MS}.
   *
   * @param ctx - the read-only context.
   */
  check(ctx: RestoreGateContext): Promise<RestoreGateOutcome>;
}

function assertGate(gate: RestoreGateDefinition): void {
  if (!RESTORE_GATE_ID_PATTERN.test(gate.id)) {
    throw new Error(
      `restore gate id ${JSON.stringify(gate.id)} must match ${RESTORE_GATE_ID_PATTERN} (lowercase letters, digits, "_" and "-", starting with a letter)`,
    );
  }
  if (typeof gate.label !== 'string' || gate.label.trim() === '') {
    throw new Error(`restore gate "${gate.id}" needs a non-empty label`);
  }
  if (typeof gate.check !== 'function') {
    throw new Error(`restore gate "${gate.id}" needs a check(ctx) function`);
  }
  if (gate.kind !== undefined && !['capability', 'disk', 'replicas', 'overridable', 'app'].includes(gate.kind)) {
    throw new Error(`restore gate "${gate.id}" has an unknown kind ${JSON.stringify(gate.kind)}`);
  }
}

function gateRank(gate: RestoreGateDefinition): number {
  const index = (BUILTIN_RESTORE_GATE_IDS as readonly string[]).indexOf(gate.id);
  return index === -1 ? BUILTIN_RESTORE_GATE_IDS.length : index;
}

/**
 * The registry of {@link RestoreGateDefinition} entries: the eight built-ins in
 * their evaluation order, then the app's gates in registration order. A
 * duplicate id is refused; frozen after bootstrap.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const restoreGateRegistry: Registry<RestoreGateDefinition> = defineRegistry<RestoreGateDefinition>({
  name: 'db-backup-restore-gates',
  idOf: (gate) => gate.id,
  idPattern: RESTORE_GATE_ID_PATTERN,
  validate: (gate) => assertGate(gate),
  // The built-ins first, in their historical order, WHATEVER THE IMPORT ORDER
  // was; every other gate after them, in registration order (the sort is
  // stable, so equal ranks keep it).
  order: (a, b) => gateRank(a) - gateRank(b),
});

/**
 * Registers one restore gate. Call it at import time, from a file the app
 * imports before `NestFactory.create` (the reference app:
 * `apps/api/src/app-registrations/db-backup.ts`).
 *
 * @param gate - the gate.
 * @throws RegistryError on a duplicate id, an invalid gate or a frozen registry.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerRestoreGate(gate: RestoreGateDefinition): void {
  restoreGateRegistry.register(gate);
}

function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not answer within ${ms} ms`)), ms);
    timer.unref?.();
  });
  return Promise.race([work, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/**
 * One gate's outcome as the pre-flight's result row: a throw, a timeout or a
 * malformed answer is a `fail` naming the gate (fail closed).
 *
 * @param gate - the definition.
 * @param ctx - the read-only context.
 * @param timeoutMs - the bound on the check.
 * @returns the result row.
 *
 * @stability experimental
 */
export async function evaluateRestoreGate(
  gate: RestoreGateDefinition,
  ctx: RestoreGateContext,
  timeoutMs: number = RESTORE_GATE_TIMEOUT_MS,
): Promise<RestoreGateResult> {
  const kind = gate.kind ?? 'app';
  let outcome: RestoreGateOutcome;

  try {
    outcome = await withTimeout(Promise.resolve().then(() => gate.check(ctx)), timeoutMs, `Restore gate "${gate.id}"`);
    if (
      typeof outcome !== 'object' ||
      outcome === null ||
      !['pass', 'warn', 'fail'].includes(outcome.status) ||
      typeof outcome.message !== 'string'
    ) {
      throw new Error(`Restore gate "${gate.id}" returned an answer that is not { status: 'pass' | 'warn' | 'fail', message }`);
    }
  } catch (error) {
    return {
      id: gate.id,
      kind,
      verdict: 'block',
      title: gate.label,
      detail: `The "${gate.label}" check could not be evaluated, so the restore is held back: ${
        error instanceof Error ? error.message : String(error)
      }`,
      action: 'Fix the check, or ask whoever registered it, then run the pre-flight again.',
    };
  }

  return {
    id: gate.id,
    kind,
    verdict: outcome.status === 'fail' ? 'block' : outcome.status === 'warn' ? 'warning' : 'pass',
    title: gate.label,
    detail: outcome.message,
    action: outcome.action ?? null,
  };
}

/**
 * Evaluates every registered gate, in registration order (the built-ins, then
 * the app's), one at a time.
 *
 * @param ctx - the read-only context.
 * @returns one result row per gate.
 *
 * @stability experimental
 */
export async function evaluateRestoreGates(ctx: RestoreGateContext): Promise<RestoreGateResult[]> {
  const results: RestoreGateResult[] = [];
  for (const gate of restoreGateRegistry.list()) results.push(await evaluateRestoreGate(gate, ctx));
  return results;
}

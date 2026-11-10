// =============================================================================
// A recording Prisma client for read-only proofs (PP-14.26)
// =============================================================================
//
// Rule 3 of a Doctor check (`../doctor-check.interface.ts`) is that it is
// READ-ONLY: a run must be safe against production, by anyone holding
// `system_settings:read`, as often as they like. Convention alone does not hold
// that line, so the kit hands a check a Prisma client that remembers every
// operation and refuses every write.
//
// WHAT IT IS. A `Proxy` that answers any property path:
//   - `prisma.<model>.<operation>(...)`  a model delegate call. The write
//     operations (`create`, `update`, `upsert`, `delete`, the `*Many` forms) are
//     recorded as violations and REJECT; every other operation is a read and
//     resolves to a benign value (`[]` for `findMany`, `null` for `findFirst`,
//     `0` for `count`), or to the value the test scripted for it.
//   - `prisma.$executeRaw*`, `$runCommandRaw`  always a write: a violation.
//   - `prisma.$queryRaw*`  a read, unless the SQL text is a write statement
//     (INSERT, UPDATE, DELETE, TRUNCATE, DDL, GRANT...): then a violation.
//   - `prisma.$transaction(fn | [ops])`  runs the callback against the same
//     recording client, so a write inside a transaction is still seen.
//   - any other method on the client itself (`forOrg(id)`, `asSystem()`,
//     `runInOrg(id, fn)`) hands back the same recording client, or runs the
//     callback it was given against it.
//
// WHAT IT CANNOT SEE. A write that never reaches Prisma (an HTTP call to a
// provider, a write to the filesystem) is invisible here. The storage half is
// `createWriteFailingStorage`; a check that spends model tokens or sends mail is
// caught by NOT holding the side-effecting "test" services (see
// `doctor-read-only.suite.ts`), not by this proxy.
//
// No import of Prisma, Jest or Nest: the proxy is structural, so it stands in for
// the app's `PrismaService` and for any slice's narrowed client alike.
// =============================================================================

/**
 * One call the recording client saw.
 *
 * @stability experimental
 */
export interface RecordedPrismaOperation {
  /** The dotted call path: `user.findMany`, `$queryRaw`, `forOrg`. */
  readonly path: string;
  /** Whether it changes data (a write operation, a write statement, `$executeRaw`). */
  readonly write: boolean;
  /** For a raw query, the SQL text it carried (best effort), else `undefined`. */
  readonly sql?: string;
}

/**
 * Raised, and recorded, when a check writes through the recording client.
 *
 * @stability experimental
 */
export class ReadOnlyViolationError extends Error {
  /** Which double refused: the Prisma client or the storage provider. */
  readonly target: 'prisma' | 'storage';

  /** The operation path that was refused. */
  readonly operation: string;

  constructor(target: 'prisma' | 'storage', operation: string) {
    super(`Read-only violation: a Doctor check called ${target} ${operation}, which writes. Doctor checks are read-only.`);
    this.name = 'ReadOnlyViolationError';
    this.target = target;
    this.operation = operation;
  }
}

/**
 * What {@link createRecordingPrisma} accepts.
 *
 * @stability experimental
 */
export interface RecordingPrismaOptions {
  /**
   * Whether a write rejects with {@link ReadOnlyViolationError} (default true).
   * Off, a write is still recorded as a violation but resolves to `undefined`:
   * the `doctor-read-only` suite boots the app with it off, so a write the app
   * makes while starting does not stop it, then turns it on with
   * {@link RecordingPrisma.refuseWrites} and `reset()` before the checks run.
   */
  readonly refuseWrites?: boolean;
  /**
   * Scripted answers for reads, by dotted path: `{ 'job.count': 12, '$queryRaw': [{ ok: 1 }] }`.
   * A function is called with the call's arguments. A path with no entry answers
   * the default for its operation.
   */
  readonly results?: Readonly<Record<string, unknown | ((...args: unknown[]) => unknown)>>;
}

/**
 * A recording, write-refusing stand-in for a Prisma client.
 *
 * @stability experimental
 */
export interface RecordingPrisma {
  /** The client to hand to the check under test (and to any service it uses). Typed `any`: it stands in for every Prisma shape. */
  readonly client: any;
  /** Every call seen so far, in order. */
  operations(): readonly RecordedPrismaOperation[];
  /** The calls that write; empty means the check stayed read-only. */
  violations(): readonly RecordedPrismaOperation[];
  /** Turns the rejection of writes on or off (they are recorded either way). */
  refuseWrites(on: boolean): void;
  /** Forgets every recorded call. */
  reset(): void;
}

/** Model delegate operations that change data. */
const WRITE_OPERATIONS: ReadonlySet<string> = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
]);

/** Raw statements that always write. */
const RAW_WRITE_METHODS: ReadonlySet<string> = new Set(['$executeRaw', '$executeRawUnsafe', '$runCommandRaw']);

/** Raw queries that read, but whose SQL text must be looked at. */
const RAW_QUERY_METHODS: ReadonlySet<string> = new Set(['$queryRaw', '$queryRawUnsafe']);

/** A SQL statement that changes data or schema. `select set_config(...)` and `select ... for update` are reads. */
const WRITE_SQL = /^\s*(?:with\b[\s\S]*?\b)?(?:insert|update|delete|truncate|drop|alter|create|grant|revoke|merge|copy|vacuum|reindex|comment\s+on)\b/i;
const WRITE_SQL_ANYWHERE = /\b(?:insert\s+into|delete\s+from|update\s+["\w.]+\s+set|truncate\s+table|drop\s+(?:table|index|schema|role|database)|alter\s+(?:table|role|database)|create\s+(?:table|index|role|database))\b/i;

/** Properties a runner or a promise machinery may probe; they must not look like a method or a thenable. */
const INERT_PROPERTIES: ReadonlySet<string> = new Set([
  'then',
  'toJSON',
  'asymmetricMatch',
  'nodeType',
  'tagName',
  '$$typeof',
  '_isMockFunction',
  'constructor',
  'prototype',
  'inspect',
  'length',
  'name',
  // Nest calls a lifecycle hook on any provider object that has one; the client has none.
  'onModuleInit',
  'onApplicationBootstrap',
  'onModuleDestroy',
  'beforeApplicationShutdown',
  'onApplicationShutdown',
]);

/** Best-effort SQL text of the arguments of `$queryRaw(...)`: a tagged template, a `Prisma.sql` object or a string. */
function sqlOf(args: readonly unknown[]): string {
  const first = args[0];
  if (typeof first === 'string') return first;
  if (Array.isArray(first)) return first.join(' ');
  if (typeof first === 'object' && first !== null) {
    const candidate = first as { sql?: unknown; text?: unknown; strings?: unknown };
    if (typeof candidate.sql === 'string') return candidate.sql;
    if (typeof candidate.text === 'string') return candidate.text;
    if (Array.isArray(candidate.strings)) return candidate.strings.join(' ');
  }
  return '';
}

/** The benign answer to a read nobody scripted. */
function defaultReadResult(operation: string): unknown {
  switch (operation) {
    case 'findMany':
    case 'groupBy':
      return [];
    case 'count':
      return 0;
    case 'aggregate':
      return {};
    case 'findFirst':
    case 'findUnique':
    case 'findFirstOrThrow':
    case 'findUniqueOrThrow':
      return null;
    default:
      return undefined;
  }
}

/**
 * Builds a Prisma client double that records every operation and refuses every
 * write. Hand `.client` to the check (or install it under the app's Prisma
 * token) and read `.violations()` after the run.
 *
 * @param options - scripted read results.
 * @returns the client and its recorder.
 *
 * @example
 * ```ts
 * const prisma = createRecordingPrisma({ results: { 'job.count': 3 } });
 * const check = new BacklogDoctorCheck(registry, prisma.client);
 * await runDoctorCheck(check);
 * expect(prisma.violations()).toEqual([]);
 * ```
 *
 * @stability experimental
 */
export function createRecordingPrisma(options: RecordingPrismaOptions = {}): RecordingPrisma {
  const operations: RecordedPrismaOperation[] = [];
  let refusing = options.refuseWrites !== false;

  /** A refused write rejects; an allowed one is recorded and resolves to nothing. */
  const refuse = (target: string): Promise<undefined> =>
    refusing ? Promise.reject(new ReadOnlyViolationError('prisma', target)) : Promise.resolve(undefined);

  const record = (path: string, write: boolean, sql?: string): RecordedPrismaOperation => {
    const entry: RecordedPrismaOperation = sql === undefined ? { path, write } : { path, write, sql };
    operations.push(entry);
    return entry;
  };

  const scripted = (path: string, args: unknown[]): { found: boolean; value?: unknown } => {
    if (options.results === undefined || !Object.prototype.hasOwnProperty.call(options.results, path)) return { found: false };
    const value = options.results[path];
    return { found: true, value: typeof value === 'function' ? (value as (...a: unknown[]) => unknown)(...args) : value };
  };

  // `root` is assigned below; the handlers close over it so `forOrg(...)` and a
  // transaction callback keep recording on the one client.
  let root: unknown;

  // Synchronous for the client's own helpers (`forOrg(id)` returns the client at
  // once, as the real one does); a Promise for everything that is a query.
  const call = (segments: readonly string[], args: unknown[]): unknown => {
    const path = segments.join('.');

    if (segments.length === 0) return undefined;

    if (segments.length === 1) {
      const method = segments[0] as string;

      if (method === '$transaction') {
        record(path, false);
        const [work] = args;
        if (typeof work === 'function') return Promise.resolve().then(() => (work as (tx: unknown) => unknown)(root));
        if (Array.isArray(work)) return Promise.all(work);
        return Promise.resolve(undefined);
      }

      if (RAW_WRITE_METHODS.has(method)) {
        record(path, true, sqlOf(args) || undefined);
        return refuse(path);
      }

      if (RAW_QUERY_METHODS.has(method)) {
        const sql = sqlOf(args);
        const write = WRITE_SQL.test(sql) || WRITE_SQL_ANYWHERE.test(sql);
        record(path, write, sql || undefined);
        if (write) return refuse(`${path} (${sql.trim().slice(0, 60)})`);
        const answer = scripted(path, args);
        return Promise.resolve(answer.found ? answer.value : []);
      }

      if (method.startsWith('$')) {
        record(path, false);
        return method === '$extends' ? root : Promise.resolve(undefined);
      }

      // `forOrg(id)`, `asSystem()`, `runInOrg(id, fn)`, `runAsSystem(reason, fn)`: stay on the recording client.
      record(path, false);
      const callback = [...args].reverse().find((arg) => typeof arg === 'function') as ((tx: unknown) => unknown) | undefined;
      return callback ? Promise.resolve().then(() => callback(root)) : root;
    }

    const operation = segments[segments.length - 1] as string;

    if (WRITE_OPERATIONS.has(operation)) {
      record(path, true);
      return refuse(path);
    }

    record(path, false);
    const answer = scripted(path, args);
    return Promise.resolve(answer.found ? answer.value : defaultReadResult(operation));
  };

  const node = (segments: readonly string[]): unknown =>
    new Proxy(function recordingPrismaNode() {}, {
      get(_target, property) {
        if (typeof property === 'symbol' || INERT_PROPERTIES.has(property)) return undefined;
        return node([...segments, property]);
      },
      apply(_target, _this, args: unknown[]) {
        return call(segments, args);
      },
    });

  root = node([]);

  return {
    client: root,
    operations: () => [...operations],
    violations: () => operations.filter((operation) => operation.write),
    refuseWrites: (on) => {
      refusing = on;
    },
    reset: () => {
      operations.length = 0;
    },
  };
}

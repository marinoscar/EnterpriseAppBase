// =============================================================================
// The system access reason registry (PP-14.14)
// =============================================================================
//
// Every bypass of row-level security (`forSystem`, `runAsSystem`,
// `systemScopeExtension`) names a REASON: a short greppable id that is recorded
// on the active span (`db.access.reason`) and checked here. The platform's nine
// reasons register through the same `registerSystemAccessReason` an app uses
// (no private fast path), so an app can add its own (`transcript-reindex`) for
// its own jobs.
//
// ⚠ THIS OPENS WHICH REASON, NEVER WHO MAY BYPASS. A reason is a label on an
// acquisition, not a capability. Lifting row-level security needs the SYSTEM
// Prisma client (the app's `PrismaSystemService`), and which files may inject it
// is the allowlist in `apps/api/test/tenancy/system-injection-boundary.spec.ts`,
// which registering a reason does not touch. Registering a reason grants no
// access to anything; it only stops `validateReason` from refusing the label.
// The registry freezes once the application has bootstrapped, so nothing can add
// a reason at request time, and an unregistered or malformed reason still throws
// `ScopedAccessError` (fail closed).
//
// FRAMEWORK-FREE like the registry primitive: it imports no Nest and no Prisma.
// =============================================================================

import { defineRegistry, type Registry } from '../registry/registry';

/**
 * The platform's own access reasons, in the order they were introduced.
 *
 * - `backup` / `restore`: the database dump and its replay.
 * - `purge`: deleting rows across organisations (storage purge, user and
 *   factory reset).
 * - `doctor`: read-only health checks that count rows across organisations.
 * - `retention`: the retention purge handlers.
 * - `admin-aggregate`: deployment-wide administrator views and aggregates, and
 *   display-only reads such as another user's avatar.
 * - `migration-tooling`: seeds and migration helpers.
 * - `link-resolution`: resolving a link-share token: ONE row of `grants`, by
 *   its unique token hash, before any organization is known.
 * - `export`: the data-export sources and the export file lookups.
 *
 * @stability experimental
 */
export const BUILTIN_SYSTEM_ACCESS_REASONS = Object.freeze([
  'backup',
  'restore',
  'purge',
  'doctor',
  'retention',
  'admin-aggregate',
  'migration-tooling',
  'link-resolution',
  'export',
] as const);

/**
 * One of the platform's own access reasons. See {@link BUILTIN_SYSTEM_ACCESS_REASONS}.
 *
 * @stability experimental
 */
export type BuiltinSystemAccessReason = (typeof BUILTIN_SYSTEM_ACCESS_REASONS)[number];

/**
 * The pattern every access reason id matches: lower-case, 3 to 48 characters,
 * starting with a letter (`transcript-reindex`).
 *
 * @stability experimental
 */
export const SYSTEM_ACCESS_REASON_ID_PATTERN = /^[a-z][a-z0-9-]{2,47}$/;

/**
 * One registered access reason.
 *
 * @stability experimental
 * @example
 * ```ts
 * const reason: SystemAccessReasonDef = {
 *   id: 'transcript-reindex',
 *   description: 'The transcript re-index job rebuilds search rows across organizations.',
 * };
 * ```
 */
export interface SystemAccessReasonDef {
  /** The reason id. See {@link SYSTEM_ACCESS_REASON_ID_PATTERN}. */
  readonly id: string;
  /** One sentence: which work needs the bypass and why it cannot run scoped. Shown by the Doctor and in docs. */
  readonly description: string;
}

/**
 * Every registered access reason: the platform's nine first (in
 * {@link BUILTIN_SYSTEM_ACCESS_REASONS} order), then the app's. Frozen once the
 * application has bootstrapped.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const systemAccessReasonRegistry: Registry<SystemAccessReasonDef> = defineRegistry<SystemAccessReasonDef>({
  name: 'core.system-access-reasons',
  idOf: (reason) => reason.id,
  idPattern: SYSTEM_ACCESS_REASON_ID_PATTERN,
  validate: (reason) => {
    if (typeof reason.description !== 'string' || reason.description.trim() === '') {
      throw new Error(`system access reason "${reason.id}": description must be a non-empty string`);
    }
  },
});

/**
 * Registers an access reason an app's own system work runs under. Call it at
 * module load, before the application is created; a duplicate id (including a
 * built-in one) throws.
 *
 * This only makes the label valid. It does not let any file reach the system
 * Prisma client: that stays the allowlist in
 * `apps/api/test/tenancy/system-injection-boundary.spec.ts`.
 *
 * @param reason - the id and a one-sentence description.
 * @throws RegistryError `INVALID_ID`, `INVALID_ENTRY`, `DUPLICATE_ID` or `FROZEN`.
 *
 * @example
 * ```ts
 * // apps/api/src/app-registrations/core.ts
 * registerSystemAccessReason({
 *   id: 'transcript-reindex',
 *   description: 'Rebuilds the transcript search rows of every organization.',
 * });
 * // then, in a job handler: runAsSystem(systemPrisma, 'transcript-reindex', (tx) => ...)
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerSystemAccessReason(reason: SystemAccessReasonDef): void {
  systemAccessReasonRegistry.register(reason);
}

/**
 * Whether `value` is a registered access reason.
 *
 * @param value - anything; a non-string is never a reason.
 * @returns `true` for a registered id.
 *
 * @stability experimental
 */
export function isSystemAccessReason(value: unknown): value is string {
  return typeof value === 'string' && systemAccessReasonRegistry.has(value);
}

const BUILTIN_DESCRIPTIONS: Readonly<Record<BuiltinSystemAccessReason, string>> = {
  backup: 'The database dump.',
  restore: 'The replay of a database dump.',
  purge: 'Deleting rows across organizations (storage purge, user and factory reset).',
  doctor: 'Read-only health checks that count rows across organizations.',
  retention: 'The retention purge handlers.',
  'admin-aggregate': 'Deployment-wide administrator views and aggregates, and display-only reads such as another user\'s avatar.',
  'migration-tooling': 'Seeds and migration helpers.',
  'link-resolution': 'Resolving a link-share token: one grants row, by its unique token hash, before any organization is known.',
  export: 'The data-export sources and the export file lookups.',
};

for (const id of BUILTIN_SYSTEM_ACCESS_REASONS) {
  registerSystemAccessReason({ id, description: BUILTIN_DESCRIPTIONS[id] });
}

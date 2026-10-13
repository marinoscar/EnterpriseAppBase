// =============================================================================
// The retention policy registry: which tables the nightly retention governs
// =============================================================================
//
// The `retention` system-settings namespace used to be four fixed keys, so an
// app table could not join the nightly purge. A POLICY is now a registry entry:
// a key, the words an operator reads, the default window, the bounds an
// operator may set, and the purge job that enforces it. The namespace's
// schemas, defaults and PATCH merge are COMPOSED from this registry
// (`retention.system-settings.ts`), and the platform's own four register here
// through the same function an app uses.
//
// ORDER IS BEHAVIOUR. The built-ins register first (this file, at import), so
// they keep their stored key order, and an app's policies follow in
// registration order.
//
// IMPORT TIME, AND SEALED. A static registry: the app registers from
// `app-registrations/` before the application bootstraps. The composed
// namespace is built the first time anything reads it (the settings registry
// validates it when it registers it) and a policy registered AFTER that would
// be stored but never validated or returned, so `registerRetentionPolicy`
// throws once the namespace is composed, naming the fix.
//
// WHICH JOB RUNS IT is a separate, per-process fact (`RetentionPurgeRegistry`):
// the purge handler declares itself from `onModuleInit`, so the scheduler only
// enqueues a purge whose handler is mounted. A policy with no mounted handler
// is configurable and simply never queued.
// =============================================================================

import {
  BUILTIN_RETENTION_POLICY_KEYS,
  RETENTION_MAX_DAYS,
  RETENTION_MIN_DAYS,
  RETENTION_POLICY_KEY_PATTERN,
  type RetentionPolicyKey,
} from '@marinoscar/platform-contract/jobs';

import { defineRegistry } from '../../core/index';

/**
 * The purge job that enforces one retention policy: what the scheduler
 * enqueues. The handler itself is a normal `JobHandler` (the platform's
 * `runRetentionPolicyPurge` does the batched delete), mounted by the module that
 * owns the table.
 *
 * @extensionPoint option
 * @stability experimental
 */
export interface RetentionPurgeHandler {
  /**
   * The purge's job type, the handler's own `type`. PERMANENT once rows of it
   * exist. One policy per type.
   */
  type: string;
  /** A human phrase for the scheduler's log lines ("import row purge"). */
  what: string;
}

/**
 * One retention policy: a table that joins the nightly retention.
 *
 * @extensionPoint option
 * @stability experimental
 */
export interface RetentionPolicyDefinition {
  /**
   * The key in `system_settings.value.retention`. Matches
   * `RETENTION_POLICY_KEY_PATTERN` (2 to 48 letters and digits, a lower-case
   * letter first). PERMANENT: renaming it orphans the operator's setting.
   */
  key: string;
  /** What an operator reads for this table ("Import rows"). */
  label: string;
  /** Days kept before the policy is changed. 1 to 3650, within the bounds below. */
  defaultDays: number;
  /**
   * Whether the purge runs before an operator decides. Defaults to `false`:
   * deleting rows is an explicit decision, and the platform ships three of its
   * four on only because those tables had no retention at all.
   */
  defaultEnabled?: boolean | undefined;
  /** Smallest `days` an operator may set. Defaults to 1. */
  minDays?: number | undefined;
  /** Largest `days` an operator may set. Defaults to 3650 (ten years). */
  maxDays?: number | undefined;
  /** The job that enforces it. */
  purge: RetentionPurgeHandler;
}

/**
 * The registered retention policies, in registration order (the four built-ins first).
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const retentionPolicyRegistry = defineRegistry<RetentionPolicyDefinition>({
  name: 'retention-policies',
  idOf: (policy) => policy.key,
  idPattern: RETENTION_POLICY_KEY_PATTERN,
  validate: (policy, registry) => {
    if (typeof policy.label !== 'string' || policy.label.trim() === '') throw new Error('label must be a non-empty string');
    const min = policy.minDays ?? RETENTION_MIN_DAYS;
    const max = policy.maxDays ?? RETENTION_MAX_DAYS;
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < RETENTION_MIN_DAYS || max > RETENTION_MAX_DAYS || min > max) {
      throw new Error(`minDays/maxDays must be whole days with ${RETENTION_MIN_DAYS} <= minDays <= maxDays <= ${RETENTION_MAX_DAYS}`);
    }
    if (!Number.isInteger(policy.defaultDays) || policy.defaultDays < min || policy.defaultDays > max) {
      throw new Error(`defaultDays must be a whole number of days within ${min}..${max}`);
    }
    if (policy.defaultEnabled !== undefined && typeof policy.defaultEnabled !== 'boolean') throw new Error('defaultEnabled must be a boolean');
    const purge = policy.purge as Partial<RetentionPurgeHandler> | undefined;
    if (!purge?.type?.trim() || !purge.what?.trim()) throw new Error('purge needs a non-empty type and what');
    const clash = registry.list().find((other) => other.purge.type === purge.type);
    if (clash) throw new Error(`purge job type "${purge.type}" already enforces retention policy "${clash.key}"; a job type enforces exactly one policy`);
  },
  describeDuplicate: (_existing, incoming) =>
    `Retention policy "${incoming.key}" is already registered. A policy key is permanent and names the operator's setting; pick another key.`,
});

let sealedBy: string | undefined;

/**
 * Registers a retention policy: the table joins the nightly retention, the
 * `retention` settings namespace gains the key (schema, default and merge), and
 * the scheduler enqueues the policy's purge when its handler is mounted. Call it
 * at import time (an app's `app-registrations/`), before the application
 * bootstraps and before anything reads the composed namespace.
 *
 * @param policy - the key, label, window, bounds and purge job.
 * @throws RegistryError `INVALID_ID`, `INVALID_ENTRY`, `DUPLICATE_ID` or `FROZEN`; Error when the namespace was already composed.
 *
 * @example
 * ```ts
 * registerRetentionPolicy({
 *   key: 'importRows',
 *   label: 'Import rows',
 *   defaultDays: 30,
 *   minDays: 7,
 *   purge: { type: 'app.import-rows.purge', what: 'import row purge' },
 * });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerRetentionPolicy(policy: RetentionPolicyDefinition): void {
  if (sealedBy !== undefined) {
    throw new Error(
      `Retention policy "${String(policy?.key)}" was registered after ${sealedBy}: the retention namespace is composed once, ` +
        'from the policies registered by then. Register it at import time, before the settings registry reads RETENTION_SYSTEM_SETTINGS.',
    );
  }
  retentionPolicyRegistry.register({
    key: policy.key,
    label: policy.label,
    defaultDays: policy.defaultDays,
    ...(policy.defaultEnabled !== undefined ? { defaultEnabled: policy.defaultEnabled } : {}),
    ...(policy.minDays !== undefined ? { minDays: policy.minDays } : {}),
    ...(policy.maxDays !== undefined ? { maxDays: policy.maxDays } : {}),
    purge: { type: policy.purge.type, what: policy.purge.what },
  });
}

/**
 * Every registered policy, in registration order.
 *
 * @returns a fresh array.
 *
 * @stability experimental
 */
export function listRetentionPolicies(): RetentionPolicyDefinition[] {
  return retentionPolicyRegistry.list();
}

/**
 * Closes registration: the namespace is being composed from the policies
 * registered so far. Called by the composition; not for app code.
 *
 * @param by - what composed it, for the error a late registration gets.
 *
 * @internal
 */
export function sealRetentionPolicies(by: string): void {
  sealedBy ??= by;
}

/**
 * Whether `key` is a registered retention policy.
 *
 * @param key - a candidate key.
 * @returns true when registered.
 *
 * @stability experimental
 */
export function isRetentionPolicyKey(key: RetentionPolicyKey): boolean {
  return retentionPolicyRegistry.has(key);
}

// The platform's own four, through the same function an app uses. Their
// defaults are the shipped ones, byte for byte: three tables on, the audit
// trail (a compliance record) off.
//
// ⚠ ENABLED BY DEFAULT for three of the four, and that was a behaviour change
// on upgrade: the first 01:00 run after deploying deletes every existing row
// older than its window. That is the purpose; these tables had no retention at
// all. `docs/runbooks/data-retention.md` says so. `auditEvents` ships OFF.
const BUILTIN_POLICIES: Record<(typeof BUILTIN_RETENTION_POLICY_KEYS)[number], RetentionPolicyDefinition> = {
  notifications: {
    key: 'notifications',
    label: 'In-app inbox',
    defaultEnabled: true,
    defaultDays: 180,
    purge: { type: 'notifications.inbox.purge', what: 'notification inbox purge' },
  },
  notificationDeliveries: {
    key: 'notificationDeliveries',
    label: 'Delivery log',
    defaultEnabled: true,
    defaultDays: 90,
    purge: { type: 'notifications.deliveries.purge', what: 'delivery log purge' },
  },
  auditEvents: {
    key: 'auditEvents',
    label: 'Audit trail',
    defaultEnabled: false,
    defaultDays: 365,
    purge: { type: 'audit.events.purge', what: 'audit log purge' },
  },
  aiRuns: {
    key: 'aiRuns',
    label: 'Background AI runs',
    defaultEnabled: true,
    defaultDays: 90,
    purge: { type: 'ai.runs.purge', what: 'AI run purge' },
  },
};

for (const key of BUILTIN_RETENTION_POLICY_KEYS) registerRetentionPolicy(BUILTIN_POLICIES[key]);

// =============================================================================
// System settings namespace `retention` (issue #677; namespace #681, PP-1.10;
// jobs slice since #898)
// =============================================================================
//
// A declaration file: imports only leaf modules (the schemas are
// `@marinoscar/platform-contract/jobs`'s). `JobsModule.forRoot()` registers it
// when the app has not (`ensureSystemSettingsNamespaces`); an app that pins the
// stored key order lists it in its own manifest instead (the reference app's
// `settings/registry/system-settings.manifest.ts` does). Enforced by the
// batched purge jobs (each owned by the slice that owns the table) and the
// enqueue-only cron in this folder; see `docs/runbooks/data-retention.md`.
//
// COMPOSED FROM THE POLICY REGISTRY (`retention-policy.registry.ts`). The key
// set used to be four fixed fields; it is now whatever was registered by the
// time the settings registry first reads this declaration: the platform's four
// (in their shipped order, with their shipped defaults, so nothing an operator
// or a client sees changes) and then an app's. The declaration's members are
// lazy getters over ONE memoised composition, and reading any of them seals the
// policy registry (a later `registerRetentionPolicy` throws, loudly, instead of
// being stored and never validated).
//
// READ-COMPAT. A stored row is read policy by policy:
//   - a registered policy the row lacks (an app added it after the last write)
//     reads as its default, and nothing is written on read;
//   - a damaged policy falls back to its own default, not the others';
//   - a key nobody registered any more (a removed plugin) is IGNORED, with one
//     warning per process, and survives the next write untouched (the settings
//     service lays unknown nested keys back under the validated value), so
//     re-installing the plugin finds the operator's setting where it left it.
// =============================================================================

import { Logger } from '@nestjs/common';
import {
  buildRetentionSchemas,
  type RetentionPolicyValue,
  type RetentionSettingsPatchInput,
  type SystemRetentionValue,
} from '@marinoscar/platform-contract/jobs';
import type { SettingsReadHelpers, SystemSettingsNamespace } from '../../settings/index';
import { listRetentionPolicies, sealRetentionPolicies } from './retention-policy.registry';

/**
 * The stored `retention` namespace: the platform's four policies, typed, plus
 * any policy an app registered (`registerRetentionPolicy`), by key.
 *
 * @stability experimental
 */
export type RetentionSettingsValue = SystemRetentionValue & { [policyKey: string]: RetentionPolicyValue };

/**
 * The `retention` PATCH body, as the composed schema parses it: the platform's
 * four, typed, plus an app's policies by key.
 *
 * @stability experimental
 */
export type RetentionSettingsPatch = RetentionSettingsPatchInput & {
  [policyKey: string]: { enabled?: boolean | undefined; days?: number | undefined } | undefined;
};

const logger = new Logger('RetentionSettings');

// One warning per unregistered key per process: `read` runs on every settings
// read, and a removed plugin's key stays in the row on purpose.
const warnedUnregisteredKeys = new Set<string>();

function composeDefaults(): RetentionSettingsValue {
  const defaults: Record<string, RetentionPolicyValue> = {};
  for (const policy of listRetentionPolicies()) {
    defaults[policy.key] = { enabled: policy.defaultEnabled ?? false, days: policy.defaultDays };
  }

  return defaults as RetentionSettingsValue;
}

/**
 * The `retention` PATCH merge, leaf by leaf (there is deliberately no generic
 * deep merge for system settings):
 * `{ "retention": { "auditEvents": { "enabled": true } } }` changes that one
 * switch and nothing else. It runs over the REGISTERED policies, so a key
 * nobody registered is never written, and a registered policy the current
 * value lacks starts from its default.
 *
 * @param current - the stored value.
 * @param patch - the PATCH body's `retention` branch, when present.
 * @returns the merged value, never a reference into `current`.
 *
 * @stability experimental
 */
export function mergeRetentionSettings(
  current: SystemRetentionValue & Partial<Record<string, RetentionPolicyValue>>,
  patch?: RetentionSettingsPatchInput & Partial<Record<string, { enabled?: boolean | undefined; days?: number | undefined } | undefined>>,
): RetentionSettingsValue {
  const defaults = composeDefaults();
  const merged: Record<string, RetentionPolicyValue> = {};

  for (const policy of listRetentionPolicies()) {
    const base = current[policy.key] ?? defaults[policy.key]!;
    const change = patch?.[policy.key];
    merged[policy.key] = {
      enabled: change?.enabled ?? base.enabled,
      days: change?.days ?? base.days,
    };
  }

  return merged as RetentionSettingsValue;
}

function composeRetentionSystemSettings(): SystemSettingsNamespace<'retention', RetentionSettingsValue, RetentionSettingsPatch> {
  sealRetentionPolicies('RETENTION_SYSTEM_SETTINGS was composed');

  const policies = listRetentionPolicies();
  const schemas = buildRetentionSchemas(policies);
  const defaults = composeDefaults();

  return {
    key: 'retention',
    description: 'Retention policy: one { enabled, days } per growing table (inbox, delivery log, audit trail, AI runs, and any table an app registers).',
    storedSchema: schemas.stored as unknown as SystemSettingsNamespace<'retention', RetentionSettingsValue>['storedSchema'],
    patchSchema: schemas.patch,
    putSchema: schemas.put,
    wirePatchSchema: schemas.wirePatch,
    responseSchema: schemas.response,
    defaults,
    // Optional in a PUT body: omitting it keeps the stored value, never resets it.
    requiredOnPut: false,
    // Policy by policy: one damaged policy degrades to its own default and the
    // others stay as the operator set them; a row written before the namespace
    // existed reads as the defaults, and nothing is written on read.
    read(stored: unknown, helpers: SettingsReadHelpers): RetentionSettingsValue {
      const value = helpers.readNamespace(stored, schemas.stored, defaults as Record<string, unknown>) as RetentionSettingsValue;
      const root = helpers.asPlainObject(stored);
      for (const key of Object.keys(root ?? {})) {
        if (!(key in defaults) && !warnedUnregisteredKeys.has(key)) {
          warnedUnregisteredKeys.add(key);
          logger.warn(
            `Stored retention policy "${key}" is not registered in this process (a removed plugin?): ignored on read and kept in the row.`,
          );
        }
      }

      return value;
    },
    merge: mergeRetentionSettings,
  };
}

let composed: SystemSettingsNamespace<'retention', RetentionSettingsValue, RetentionSettingsPatch> | undefined;

function declaration(): SystemSettingsNamespace<'retention', RetentionSettingsValue, RetentionSettingsPatch> {
  composed ??= composeRetentionSystemSettings();

  return composed;
}

/**
 * The `retention` system-settings namespace (#681): one `{ enabled, days }` per
 * table that grows with every user action (the in-app inbox, the delivery log,
 * the audit trail, background AI runs, and any table an app registered with
 * `registerRetentionPolicy`). `auditEvents` ships OFF. The merge is leaf by
 * leaf ({@link mergeRetentionSettings}). `JobsModule.forRoot()` registers it
 * unless the app already did.
 *
 * Composed from the policy registry on first read; see the file header.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const RETENTION_SYSTEM_SETTINGS: SystemSettingsNamespace<'retention', RetentionSettingsValue, RetentionSettingsPatch> = {
  /** The namespace key (permanent). */
  key: 'retention',
  /** What it holds. */
  get description() {
    return declaration().description;
  },
  /** The stored shape. */
  get storedSchema() {
    return declaration().storedSchema;
  },
  /** The stored partial. */
  get patchSchema() {
    return declaration().patchSchema;
  },
  /** The PUT body's branch. */
  get putSchema() {
    return declaration().putSchema;
  },
  /** The PATCH body's branch. */
  get wirePatchSchema() {
    return declaration().wirePatchSchema;
  },
  /** The GET response's branch. */
  get responseSchema() {
    return declaration().responseSchema;
  },
  /** The shipped policy: three tables on, the audit trail off, plus an app's registered defaults. */
  get defaults() {
    return declaration().defaults;
  },
  /** Optional in a PUT body: omitting it keeps the stored value, never resets it. */
  requiredOnPut: false,
  /** Salvages a stored value policy by policy ({@link RETENTION_SYSTEM_SETTINGS}). */
  read(stored: unknown, helpers: SettingsReadHelpers): RetentionSettingsValue {
    return declaration().read!(stored, helpers);
  },
  /** The PATCH merge ({@link mergeRetentionSettings}). */
  merge: mergeRetentionSettings as SystemSettingsNamespace<'retention', RetentionSettingsValue, RetentionSettingsPatch>['merge'],
};

declare module '../../settings/index' {
  interface SystemSettingsNamespaces {
    /**
     * Retention policy (#681): one `{ enabled, days }` per table that grows with
     * every user action: the in-app inbox, the delivery log, the audit trail and
     * background AI runs, plus any table an app registered.
     */
    retention: RetentionSettingsValue;
  }
  interface SystemSettingsNamespaceDeclarations {
    /** The `retention` declaration. */
    retention: typeof RETENTION_SYSTEM_SETTINGS;
  }
}

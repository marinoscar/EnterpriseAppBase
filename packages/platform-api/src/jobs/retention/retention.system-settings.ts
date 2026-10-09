// =============================================================================
// System settings namespace `retention` (issue #677; namespace #681, PP-1.10;
// jobs slice since #898)
// =============================================================================
//
// A declaration file: pure data, imports only leaf modules (the schemas are
// `@marinoscar/platform-contract/jobs`'s). `JobsModule.forRoot()` registers it
// when the app has not (`ensureSystemSettingsNamespaces`); an app that pins the
// stored key order lists it in its own manifest instead (the reference app's
// `settings/registry/system-settings.manifest.ts` does). Enforced by the
// batched purge jobs (each owned by the slice that owns the table) and the
// enqueue-only cron in this folder; see `docs/runbooks/data-retention.md`.
// =============================================================================

import {
  retentionResponseSchema,
  retentionSettingsPatchSchema,
  retentionSettingsSchema,
  systemRetentionPatchSchema,
  systemRetentionSchema,
  type RetentionSettingsPatchInput,
  type SystemRetentionValue,
} from '@marinoscar/platform-contract/jobs';
import type { SystemSettingsNamespace } from '../../settings/index';

// ⚠ ENABLED BY DEFAULT for three of the four, and that is a behaviour change
// on upgrade: the first 01:00 run after deploying deletes every existing row
// older than its window. That is the purpose — these tables had no retention
// at all — and the runbook (`docs/runbooks/data-retention.md`) says so.
//
// `auditEvents` ships OFF. The audit trail is a compliance record, so
// deleting it is an explicit operator decision, never a default.
const RETENTION_SYSTEM_DEFAULTS: SystemRetentionValue = {
  notifications: { enabled: true, days: 180 },
  notificationDeliveries: { enabled: true, days: 90 },
  auditEvents: { enabled: false, days: 365 },
  aiRuns: { enabled: true, days: 90 },
};

type RetentionPatch = RetentionSettingsPatchInput;
type RetentionPolicy = SystemRetentionValue['notifications'];

function mergePolicy(
  current: RetentionPolicy,
  patch: RetentionPatch['notifications'],
): RetentionPolicy {
  return {
    enabled: patch?.enabled ?? current.enabled,
    days: patch?.days ?? current.days,
  };
}

/**
 * The `retention` system-settings namespace (#681): one `{ enabled, days }` per
 * table that grows with every user action (the in-app inbox, the delivery log,
 * the audit trail, background AI runs). `auditEvents` ships OFF. The merge is
 * leaf by leaf. `JobsModule.forRoot()` registers it unless the app already did.
 *
 * @stability experimental
 */
export const RETENTION_SYSTEM_SETTINGS = {
  key: 'retention',
  description: 'Retention policy: one { enabled, days } per growing table (inbox, delivery log, audit trail, AI runs).',
  storedSchema: systemRetentionSchema,
  patchSchema: systemRetentionPatchSchema,
  putSchema: retentionSettingsSchema,
  wirePatchSchema: retentionSettingsPatchSchema,
  responseSchema: retentionResponseSchema,
  defaults: RETENTION_SYSTEM_DEFAULTS,
  requiredOnPut: false,
  // The default `read` salvages each table's `{ enabled, days }` on its own,
  // so one damaged policy degrading to its default leaves the other three as
  // the operator set them. A row written before the namespace existed reads
  // as the defaults, and nothing is written on read.
  merge(current, patch) {
    // Leaf by leaf: `{ "retention": { "auditEvents": { "enabled": true } } }`
    // changes that one switch and nothing else.
    return {
      notifications: mergePolicy(current.notifications, patch?.notifications),
      notificationDeliveries: mergePolicy(current.notificationDeliveries, patch?.notificationDeliveries),
      auditEvents: mergePolicy(current.auditEvents, patch?.auditEvents),
      aiRuns: mergePolicy(current.aiRuns, patch?.aiRuns),
    };
  },
} satisfies SystemSettingsNamespace<'retention', SystemRetentionValue, RetentionPatch>;

declare module '../../settings/index' {
  interface SystemSettingsNamespaces {
    /**
     * Retention policy (#681): one `{ enabled, days }` per table that grows with
     * every user action — the in-app inbox, the delivery log, the audit trail
     * and background AI runs.
     */
    retention: SystemRetentionValue;
  }
  interface SystemSettingsNamespaceDeclarations {
    retention: typeof RETENTION_SYSTEM_SETTINGS;
  }
}

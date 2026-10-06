// =============================================================================
// System settings namespace `retention` (issue #677; namespace #681, PP-1.10)
// =============================================================================
//
// A declaration file: pure data, imports only leaf modules. Registered by
// `settings/registry/system-settings.manifest.ts`. Recipe:
// `settings/registry/README.md`. Enforced by the batched purge jobs and the
// enqueue-only cron in this folder; see `docs/runbooks/data-retention.md`.
// =============================================================================

import type { z } from 'zod';
import {
  systemRetentionPatchSchema,
  systemRetentionSchema,
  type SystemRetentionValue,
} from '../schemas/settings.schema';
import {
  retentionSettingsPatchSchema,
  retentionSettingsSchema,
} from '../../settings/dto/system-settings-wire.schemas';
import { retentionResponseSchema } from '../../settings/dto/system-settings-response.schemas';
import type { SystemSettingsNamespace } from '../../settings/registry/system-settings-namespace';

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

type RetentionPatch = z.infer<typeof retentionSettingsPatchSchema>;
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

declare module '../../settings/registry/system-settings-namespace' {
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

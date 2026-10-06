// =============================================================================
// System settings namespace `jobs` (issue #677; namespace #256, epic #254)
// =============================================================================
//
// A declaration file: pure data, imports only leaf modules. Registered by
// `settings/registry/system-settings.manifest.ts`. Recipe:
// `settings/registry/README.md`.
// =============================================================================

import type { z } from 'zod';
import {
  systemJobsPatchSchema,
  systemJobsSchema,
  type SystemJobsValue,
} from '../common/schemas/settings.schema';
import { jobsSettingsPatchSchema, jobsSettingsSchema } from '../settings/dto/system-settings-wire.schemas';
import { jobsResponseSchema } from '../settings/dto/system-settings-response.schemas';
import type { SystemSettingsNamespace } from '../settings/registry/system-settings-namespace';

// THE ONE PLACE THESE NUMBERS LIVE (the operations namespaces, #256). None of
// the schemas carries a `.default()`, deliberately: a default in zod is applied
// by whichever `parse` runs first, which makes "what does a fresh deployment
// do?" a question you answer by reading parse call sites. Here it is a question
// you answer by reading this object.
//
// Every operations default is chosen to be INERT. `history.purgeEnabled` is the
// only one that is on, and it only bounds a history table; backups ship
// disabled, and so does the maintenance window. A default that started doing
// something on upgrade would be a behaviour change smuggled in by a schema-only
// issue.
const JOBS_SYSTEM_DEFAULTS: SystemJobsValue = {
  history: {
    retentionDays: 30,
    purgeEnabled: true,
  },
  stuckThresholdMinutes: 30,
};

export const JOBS_SYSTEM_SETTINGS = {
  key: 'jobs',
  description: 'Job-queue policy: how long finished jobs are kept, whether they are purged, and when a claimed job counts as stuck.',
  storedSchema: systemJobsSchema,
  patchSchema: systemJobsPatchSchema,
  putSchema: jobsSettingsSchema,
  wirePatchSchema: jobsSettingsPatchSchema,
  responseSchema: jobsResponseSchema,
  defaults: JOBS_SYSTEM_DEFAULTS,
  // OPTIONAL on PUT: omitting it means "leave it as stored", never "reset it to
  // the defaults" (see `system-settings-wire.schemas.ts`).
  requiredOnPut: false,
  merge(current, patch) {
    // Written out field by field, and NOT with a spread, because there is
    // deliberately no generic deep merge for system settings. A generic one
    // would have to guess: whether an array replaces or concatenates, and
    // whether an explicit `null` means "clear this" or "no opinion" — and
    // `maintenance.startedAt` needs those to be different answers.
    return {
      history: {
        retentionDays: patch?.history?.retentionDays ?? current.history.retentionDays,
        purgeEnabled: patch?.history?.purgeEnabled ?? current.history.purgeEnabled,
      },
      stuckThresholdMinutes: patch?.stuckThresholdMinutes ?? current.stuckThresholdMinutes,
    };
  },
} satisfies SystemSettingsNamespace<'jobs', SystemJobsValue, z.infer<typeof jobsSettingsPatchSchema>>;

declare module '../settings/registry/system-settings-namespace' {
  interface SystemSettingsNamespaces {
    /**
     * Job-queue policy (#256, epic #254).
     *
     * REQUIRED, like every system namespace: this type describes the value this
     * code works with, and every read of the column goes through
     * `readKnownSettings`, which fills each block from `DEFAULT_SYSTEM_SETTINGS`
     * when storage has nothing. A consumer therefore never has to ask whether a
     * block is there — an optional field would push a `?? DEFAULT` into every
     * call site, and one of those would be forgotten.
     *
     * A row written before a namespace existed genuinely lacks its key on disk.
     * That is not a contradiction: `readKnownSettings` is the boundary where
     * "what is on disk" becomes "what this type promises", and the first write
     * materialises the block with its defaults.
     */
    jobs: SystemJobsValue;
  }
  interface SystemSettingsNamespaceDeclarations {
    jobs: typeof JOBS_SYSTEM_SETTINGS;
  }
}

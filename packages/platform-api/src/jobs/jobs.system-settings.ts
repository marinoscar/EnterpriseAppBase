// =============================================================================
// System settings namespace `jobs` (issue #865; namespace #256, epic #254)
// =============================================================================
//
// A declaration file: pure data, imports only leaf modules (the schemas are
// `@marinoscar/platform-contract/jobs`'s). `JobsModule.forRoot()` registers it
// when the app has not (`ensureSystemSettingsNamespaces`); an app that pins
// the stored key order lists it in its own manifest instead (the reference
// app's `settings/registry/system-settings.manifest.ts` does). Moved from the
// reference app's `platform/jobs/jobs.system-settings.ts`.
// =============================================================================

import {
  jobsResponseSchema,
  jobsSettingsPatchSchema,
  jobsSettingsSchema,
  systemJobsPatchSchema,
  systemJobsSchema,
  type JobsSettingsPatchInput,
  type SystemJobsValue,
} from '@marinoscar/platform-contract/jobs';
import type { SystemSettingsNamespace } from '../settings/index';
import { DEFAULT_JOBS_POLICY } from './jobs.policy';

// THE ONE PLACE THESE NUMBERS LIVE: `DEFAULT_JOBS_POLICY`, so what the reaper
// and the purge fall back on and what a fresh row is written with are one
// definition. Inert: `history.purgeEnabled` is the only switch that is on, and
// it only bounds a history table.
const JOBS_SYSTEM_DEFAULTS: SystemJobsValue = {
  history: { ...DEFAULT_JOBS_POLICY.history },
  stuckThresholdMinutes: DEFAULT_JOBS_POLICY.stuckThresholdMinutes,
};

/**
 * The `jobs` PATCH merge, field by field (there is deliberately no generic
 * deep merge for system settings): a field the patch names replaces the stored
 * one, an absent field is kept.
 *
 * @param current - the stored value.
 * @param patch - the PATCH body's `jobs` branch, when present.
 * @returns the merged value, never a reference into `current`.
 *
 * @stability experimental
 */
export function mergeJobsSettings(current: SystemJobsValue, patch?: JobsSettingsPatchInput): SystemJobsValue {
  return {
    history: {
      retentionDays: patch?.history?.retentionDays ?? current.history.retentionDays,
      purgeEnabled: patch?.history?.purgeEnabled ?? current.history.purgeEnabled,
    },
    stuckThresholdMinutes: patch?.stuckThresholdMinutes ?? current.stuckThresholdMinutes,
  };
}

/**
 * The `jobs` system-settings namespace (#256, epic #254): how long finished
 * jobs are kept, whether the nightly purge runs, and when a claimed job counts
 * as stuck. Its defaults are {@link DEFAULT_JOBS_POLICY}. `JobsModule.forRoot()`
 * registers it unless the app already did.
 *
 * @stability experimental
 */
export const JOBS_SYSTEM_SETTINGS = {
  /** The namespace key (permanent). */
  key: 'jobs',
  /** What it holds. */
  description: 'Job-queue policy: how long finished jobs are kept, whether they are purged, and when a claimed job counts as stuck.',
  /** The stored shape. */
  storedSchema: systemJobsSchema,
  /** The stored partial. */
  patchSchema: systemJobsPatchSchema,
  /** The PUT body's branch. */
  putSchema: jobsSettingsSchema,
  /** The PATCH body's branch. */
  wirePatchSchema: jobsSettingsPatchSchema,
  /** The GET response's branch. */
  responseSchema: jobsResponseSchema,
  /** `DEFAULT_JOBS_POLICY`. */
  defaults: JOBS_SYSTEM_DEFAULTS,
  /** Optional in a PUT body: omitting it keeps the stored value, never resets it. */
  requiredOnPut: false,
  /** The PATCH merge (`mergeJobsSettings`). */
  merge: mergeJobsSettings,
} satisfies SystemSettingsNamespace<'jobs', SystemJobsValue, JobsSettingsPatchInput>;

declare module '../settings/index' {
  interface SystemSettingsNamespaces {
    /**
     * Job-queue policy (#256, epic #254). REQUIRED, like every system
     * namespace: every read goes through `readKnownSettings`, which fills the
     * block from its defaults when storage has nothing.
     */
    jobs: SystemJobsValue;
  }
  interface SystemSettingsNamespaceDeclarations {
    /** The `jobs` declaration. */
    jobs: typeof JOBS_SYSTEM_SETTINGS;
  }
}

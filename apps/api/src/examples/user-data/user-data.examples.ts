// =============================================================================
// Reference examples: one per extension point of the user-data slice (#743)
// =============================================================================
//
// Compiled and exercised by ./user-data.examples.spec.ts, NEVER registered by
// the running app (upstream has no domain model to delete): a fork copies the
// shape it needs into `app-registrations/user-data.ts`. The examples use the
// platform's own `AiRun` and `Job` tables so they run against this schema.
//
//   EXAMPLE_USER_DATA_CATEGORY      registerUserDataCategory   a category (kvox's `transcripts`)
//   EXAMPLE_USER_DATA_SCOPE         registerUserDataScope      a narrow scope with an upper-cased phrase
//   EXAMPLE_CONTENT_SCOPE_OVERRIDE  registerUserDataScope      kvox's explicit override of the built-in `content`
//   EXAMPLE_USER_DATA_MODELS        registerUserDataModels     hints: category, storageObjectColumns, keepWhenReferenced, delegate
//   EXAMPLE_FACTORY_RESET_STEP      registerFactoryResetStep   app deployment-level work (EvoPath's custom catalog)
//   EXAMPLE_OFFBOARDING_PRECONDITION registerOffboardingPrecondition  a check before an organization goes
//   EXAMPLE_LEGACY_JOB_TYPES        UserDataModule legacyJobTypes      EvoPath's `user.data_reset`
// =============================================================================

import type {
  FactoryResetStepDef,
  LegacyUserDataJobType,
  OffboardingPreconditionDef,
  UserDataCategoryDef,
  UserDataModelHint,
  UserDataScopeDef,
} from '@marinoscar/platform-api/user-data';

/** A category: the Danger Zone row and what a narrow scope selects. */
export const EXAMPLE_USER_DATA_CATEGORY: UserDataCategoryDef = {
  id: 'transcripts',
  label: 'Transcripts',
  description: 'Your transcripts and their audio.',
  content: true,
  order: 60,
};

/** A narrow scope, rendered as a "Delete specific data" row (kvox's phrase rule: the id upper-cased). */
export const EXAMPLE_USER_DATA_SCOPE: UserDataScopeDef = {
  id: 'transcripts',
  label: 'Delete my transcripts',
  description: 'Every transcript and its audio. Notes and settings stay.',
  categories: ['transcripts'],
  confirmation: 'transcripts'.toUpperCase(),
  layer: 'specific',
};

/** kvox keeps its own phrase for `content`: an EXPLICIT override of the built-in. */
export const EXAMPLE_CONTENT_SCOPE_OVERRIDE: UserDataScopeDef = {
  id: 'content',
  label: 'Delete all my content',
  description: 'Transcripts, notes and files. Your account and settings stay.',
  categories: 'content',
  confirmation: 'CONTENT',
  layer: 'danger',
  overrideBuiltIn: true,
};

/**
 * Model hints. A fork names its own models; here `AiRun` stands in for a
 * domain model (EvoPath's `Workout`) deleted in the example category.
 */
export const EXAMPLE_USER_DATA_MODELS: readonly UserDataModelHint[] = [
  // A row with a file: the file's id is collected before the row goes.
  //   { model: 'Transcript', category: 'transcripts', storageObjectColumns: ['audioObjectId'] },
  // EvoPath's custom exercises: kept while another user's workout references one.
  //   { model: 'Exercise', category: 'workouts', keepWhenReferenced: true },
  // kvox's graph: another job purges it.
  //   { model: 'GraphNode', category: 'graph', delegate: { jobType: 'kg.purge', payload: (userId) => ({ userId }) } },
];

/** The delegate hint kvox uses, as a value the spec can call. */
export const EXAMPLE_DELEGATE: NonNullable<UserDataModelHint['delegate']> = {
  jobType: 'kg.purge',
  payload: (userId) => ({ userId }),
};

/**
 * App deployment-level work of the factory reset: here, the finished jobs of
 * the example types (`example.*`), which no user owns.
 */
export const EXAMPLE_FACTORY_RESET_STEP: FactoryResetStepDef = {
  id: 'examples.jobs',
  phase: 'deployment',
  description: 'Finished example jobs.',
  async run(tx) {
    const { count } = await tx.job.deleteMany({ where: { type: { startsWith: 'example.' }, status: { in: ['succeeded', 'failed'] } } });
    return { jobs: count };
  },
};

/** A check before an organization is offboarded: none of its jobs is still running. */
export const EXAMPLE_OFFBOARDING_PRECONDITION: OffboardingPreconditionDef = {
  id: 'examples.no-running-jobs',
  label: 'No job of the organization is running',
  async check({ orgId }, db) {
    const running = await db.job.count({ where: { orgId, status: 'running' } });
    return running === 0 ? { passed: true } : { passed: false, message: `${running} job(s) of the organization are still running` };
  },
};

/** EvoPath's queued `user.data_reset` jobs keep running after adoption. */
export const EXAMPLE_LEGACY_JOB_TYPES: readonly LegacyUserDataJobType[] = [
  { type: 'user.data_reset', toPayload: (old) => ({ userId: String((old as { userId?: unknown }).userId), scope: 'everything' }) },
];

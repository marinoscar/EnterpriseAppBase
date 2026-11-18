import type { FactoryResetStepDef, OffboardingPreconditionDef, UserDataCategoryDef, UserDataModelHint, UserDataScopeDef } from '@marinoscar/platform-api/user-data';
import type { Prisma } from '@prisma/client';

// =============================================================================
// This app's own user-data declarations (issue #743)
// =============================================================================
//
// Upstream keeps every array empty: the platform's categories, hints and
// factory reset steps are registered first by `registerPlatformUserData()`
// (platform/user-data/user-data.manifest.ts). A fork adds, per domain model
// with an owner column, a keep-or-delete hint; the `user-data` conformance
// suite (test/user-data/user-data-conformance.spec.ts) fails until it does.
// Worked examples of every extension point: src/examples/user-data/.
// =============================================================================

/**
 * This app's categories (the Danger Zone rows and what scopes select).
 *
 * @example
 * ```ts
 * export const APP_USER_DATA_CATEGORIES: readonly UserDataCategoryDef[] = [
 *   { id: 'workouts', label: 'Workouts', description: 'Your logged workouts and sets.', content: true },
 * ];
 * ```
 */
export const APP_USER_DATA_CATEGORIES: readonly UserDataCategoryDef[] = [];

/** This app's model hints, one per domain model with an owner column. */
export const APP_USER_DATA_MODELS: readonly UserDataModelHint<Prisma.ModelName>[] = [];

/** This app's narrow scopes (kvox's `transcripts`, `notes`...). */
export const APP_USER_DATA_SCOPES: readonly UserDataScopeDef[] = [];

/** This app's factory reset steps (EvoPath's custom catalog rows). */
export const APP_FACTORY_RESET_STEPS: readonly FactoryResetStepDef[] = [];

/** This app's offboarding preconditions (the export slice registers its own). */
export const APP_OFFBOARDING_PRECONDITIONS: readonly OffboardingPreconditionDef[] = [];

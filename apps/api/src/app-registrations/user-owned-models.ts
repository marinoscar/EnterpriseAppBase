import type { UserOwnedModelDef } from '../prisma/ownership/user-owned-model.registry';

/**
 * This app's own models with a foreign key to `User`. Upstream keeps this
 * array empty forever; a fork adds one entry per domain model that holds a
 * `User` relation, or the ownership tripwire
 * (`test/prisma/user-owned-models.spec.ts`) fails.
 *
 * Recipe and policies: `apps/api/src/prisma/ownership/README.md`.
 *
 * @example
 * ```ts
 * export const APP_USER_OWNED_MODELS: readonly UserOwnedModelDef[] = [
 *   { model: 'Workout', ownerField: 'userId', purge: 'delete', export: 'include',
 *     rationale: "A workout is the user's own log." },
 * ];
 * ```
 */
export const APP_USER_OWNED_MODELS: readonly UserOwnedModelDef[] = [];

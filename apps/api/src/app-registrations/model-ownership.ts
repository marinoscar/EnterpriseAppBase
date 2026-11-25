import type { ModelOwnershipDef } from '@marinoscar/platform-api/core';
import type { Prisma } from '@prisma/client';

/**
 * Ownership kinds of this app's own models. Upstream keeps this array empty
 * forever; a fork classifies every model it adds (`org`, `org-optional`,
 * `user` or `system`), or the model ownership tripwire
 * (`test/tenancy/model-ownership.spec.ts`) fails.
 *
 * An `org` model also needs `org_id`, the standard policy and an entry in the
 * app's own policy list: see `apps/api/src/prisma/ownership/README.md`.
 *
 * @example
 * ```ts
 * export const APP_MODEL_OWNERSHIP: readonly ModelOwnershipDef<Prisma.ModelName>[] = [
 *   { model: 'Workout', kind: 'org', rationale: 'A workout belongs to its organisation.' },
 * ];
 * ```
 */
export const APP_MODEL_OWNERSHIP: readonly ModelOwnershipDef<Prisma.ModelName>[] = [];

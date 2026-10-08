import { registerUserOwnedModels, type UserOwnedModelDef } from '@marinoscar/platform-api/core';

/**
 * The app's user-owned models (core's user-owned data registry). Every
 * foreign key to `User` in `prisma/fragments/` needs an entry whose `purge`
 * matches the relation's `onDelete` (`Cascade` is `delete`); the
 * `userOwnedData` conformance suite fails otherwise. `forUser()` clients
 * confine queries on these models to the caller.
 */
export const APP_USER_OWNED_MODELS: readonly UserOwnedModelDef<'Note'>[] = [
  {
    model: 'Note',
    ownerField: 'userId',
    purge: 'delete',
    export: 'include',
    rationale: "The user's own notes: deleted with the user, and part of the user's data export.",
  },
];

registerUserOwnedModels(APP_USER_OWNED_MODELS);

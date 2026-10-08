// The roles and permissions this app seeds, as options for the platform's
// packaged registry (`@marinoscar/platform-api/manifest`): the permission sets
// of the slices this app mounts, in the platform's seed order, then the app's
// own. The identity slice's four roles always come first. Pure data, no side
// effect: `prisma/seed.ts` composes the catalog from it
// (`platformPermissionCatalog`) and `./registrations.ts` fills the registries
// with it (`registerPlatformPermissions`), so the two never disagree.
//
// MOUNTING ANOTHER SLICE adds its name to `slices` (for example `'storage'`),
// so the seed writes the rows its routes check. A slice without permissions of
// its own (credentials, email, android-app) enforces the `settings` slice's.
import type { PlatformPermissionOptions } from '@marinoscar/platform-api/manifest';

import { NOTES_PERMISSIONS } from '../notes/notes.permissions';

export const PERMISSION_OPTIONS = {
  slices: ['identity', 'settings', 'jobs', 'nodes'],
  app: { permissions: [NOTES_PERMISSIONS] },
} satisfies PlatformPermissionOptions;

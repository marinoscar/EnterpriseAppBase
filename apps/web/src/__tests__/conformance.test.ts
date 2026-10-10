// =============================================================================
// THE REFERENCE WEB APP'S CONFORMANCE ENTRY (issue #742)
// =============================================================================
//
// The web counterpart of `apps/api/test/conformance.spec.ts`. Every invariant
// the platform enforces over what the web app DECLARES (its settings registries,
// its route table, its destinations) runs HERE through
// `runPlatformWebConformance()`, so the suite ids and their cases are the same in
// every app that consumes `@marinoscar/platform-web`. This file passes the
// reference app's DATA; the cases live in the package
// (`packages/platform-web/src/settings/README.md`, "Conformance suite").
//
// What the suites read is the LIVE data:
//   - the registries are the arrays the hub, the rail and the AppBar title run;
//   - the route table is the text of `App.tsx`, parsed for its `<Route>`
//     elements (never a copy of the list);
//   - the permission ids are the generated catalog the API seeds from
//     (`apps/api/prisma/catalog/permissions.json`), so no API source file is
//     read to learn what a controller enforces.
//
// Reference-app-specific pins (which group the Broadcasts card lives in, that
// Console is pinned) stay in `config/settingsCards.test.ts` and
// `config/destinations.test.ts`: they are this app's data, not platform
// invariants.
// =============================================================================

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runPlatformWebConformance } from '@marinoscar/platform-web/testing';
// Importing a slice's testing entry REGISTERS its suites with the harness.
import '@marinoscar/platform-web/settings/testing';

import { ADMIN_HUB_PATH, ADMIN_HUB_TITLE, ADMIN_SECTIONS } from '../config/adminSections';
import {
  DESTINATIONS,
  DESTINATION_ROUTES,
  UNOWNED_ROUTES,
  owns,
  resolveActiveDestination,
} from '../config/destinations';
import { USER_HUB_PATH, USER_HUB_TITLE, USER_SETTINGS_SECTIONS } from '../config/userSettingsSections';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_TSX = resolve(HERE, '../App.tsx');
const PERMISSION_CATALOG = resolve(HERE, '../../../api/prisma/catalog/permissions.json');

const catalog = JSON.parse(readFileSync(PERMISSION_CATALOG, 'utf8')) as { permissions: Array<{ name: string }> };

runPlatformWebConformance({
  adminSections: ADMIN_SECTIONS,
  userSettingsSections: USER_SETTINGS_SECTIONS,
  hubs: {
    admin: { path: ADMIN_HUB_PATH, title: ADMIN_HUB_TITLE },
    user: { path: USER_HUB_PATH, title: USER_HUB_TITLE },
  },
  routes: { appTsx: readFileSync(APP_TSX, 'utf8') },
  apiPermissions: catalog.permissions.map((permission) => permission.name),
  destinations: {
    routes: DESTINATION_ROUTES,
    unowned: UNOWNED_ROUTES,
    owns,
    resolveActive: resolveActiveDestination,
    destinations: DESTINATIONS.map((destination) => ({ key: destination.key, path: destination.path })),
  },
});

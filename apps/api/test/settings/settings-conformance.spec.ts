import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { runPlatformConformance } from '@marinoscar/platform-api/testing';
// Importing the testing entry REGISTERS the `settings` suite with the harness.
import '@marinoscar/platform-api/settings/testing';

// The app's namespaces: the manifests fill the registries the suite reads.
import '../../src/settings/registry';
import { permissionRegistry } from '../../src/common/permissions';
import {
  SETTINGS_CATALOG_STALE_MESSAGE,
  SYSTEM_SETTINGS_CATALOG_RELATIVE_PATH,
} from '../../src/settings/registry/settings-catalog';
import { API_SOURCE_ROOT } from '../jobs/cron-source-roots';

// =============================================================================
// The settings slice's conformance suite, run in the reference app (#733)
// =============================================================================
//
// The invariants of `@marinoscar/platform-api/settings` (its README,
// "Conformance suite"), checked against THIS application's registered
// namespaces: no secret-named field anywhere, every default valid, every org
// layer gated by a registered org-scope permission, and the committed
// defaults catalog current. What stays here is the app's data.
// =============================================================================

const catalogPath = join(__dirname, '..', '..', SYSTEM_SETTINGS_CATALOG_RELATIVE_PATH);

runPlatformConformance({
  sourceRoots: [API_SOURCE_ROOT],
  suites: {
    settings: {
      permissions: permissionRegistry.list(),
      catalog: {
        contents: existsSync(catalogPath) ? readFileSync(catalogPath, 'utf8') : undefined,
        staleMessage: SETTINGS_CATALOG_STALE_MESSAGE,
      },
      minSystemNamespaces: 9,
    },
  },
});

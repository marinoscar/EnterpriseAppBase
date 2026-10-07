import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCli } from '@marinoscar/platform-cli';
import { PLATFORM_DOCUMENTED_OPTIONAL_KEYS, resetCliForTests, runPlatformConformance } from '@marinoscar/platform-cli/testing';
import { describe, expect, it } from 'vitest';

import { APP_CLI_OPTIONS } from './app.js';

// =============================================================================
// The platform CLI's conformance suite, over this app  (#715)
// =============================================================================
//
// The env template fragments this app's `.env.example` is composed from, and
// every executor its worker would run (the platform's plus the app's, so the
// CLI is built first), checked by the package. The app supplies the data.
// =============================================================================

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (path: string): string => readFileSync(join(REPO, path), 'utf8');

resetCliForTests();
createCli(APP_CLI_OPTIONS);

runPlatformConformance({
  suites: {
    cli: {
      envFragments: [
        {
          name: '@marinoscar/platform-infra/env/base.env.example',
          text: read('packages/platform-infra/env/base.env.example'),
          allowCommented: PLATFORM_DOCUMENTED_OPTIONAL_KEYS,
        },
        { name: 'infra/compose/app.env.example', text: read('infra/compose/app.env.example') },
      ],
    },
  },
  testApi: { describe, it, expect },
});

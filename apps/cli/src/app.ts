import { ANDROID_IDENTITY_SOURCE } from '@app/shared';
import type { CreateCliOptions } from '@marinoscar/platform-cli';
import { androidCommand, androidDeployStep, androidTuiScreen } from '@marinoscar/platform-cli/android';

import { CLI_IDENTITY } from './branding.js';
import { CLI_VERSION } from './package-info.js';

// =============================================================================
// The reference app's CLI composition  (PP-8.9, #715)
// =============================================================================
//
// Every platform command (`init`, `login`, `api`, `config`, `node`, `deploy`),
// the TUI, the deploy pipeline and the worker-node engine come from
// `@marinoscar/platform-cli`. What makes this CLI THIS app's is the options
// below: its identity, its version, and whatever it adds through the
// platform's registries. `cli.ts` passes them to `createCli`.
//
// A fork adds its own here, in the same arrays (or with the matching
// `register*` call before `createCli`; the two are equivalent):
//
//   extraCommands     a command after the built-ins       examples/hello.command.ts
//   tuiScreens        a screen in the TUI menu            examples/about.screen.tsx
//   deploySteps       a step in the install/update plan   examples/announce.deploy-step.ts
//   nodeExecutors     a node-eligible job type            examples/echo.executor.ts
//   envSpecFragments  metadata for app.env.example keys
//
// The examples are compiled and tested (examples/*.test.ts) but NOT wired
// here, so `appctl --help` and the TUI menu stay the platform's.
//
// THE ANDROID COMPANION (#746) IS WIRED: the reference app ships `apps/android`,
// so its CLI carries the platform's `android` group (`@marinoscar/platform-cli/android`),
// the Android TUI screen, and the optional deploy step (after `verify` on
// install and update; it runs only with `APPCTL_DEPLOY_ANDROID=1` and never
// fails a deploy). A fork without an Android app removes these three lines.
// =============================================================================

/** The options `cli.ts` builds this app's CLI with. */
export const APP_CLI_OPTIONS: CreateCliOptions = {
  identity: CLI_IDENTITY,
  version: CLI_VERSION,
  extraCommands: [androidCommand({ identity: ANDROID_IDENTITY_SOURCE })],
  tuiScreens: [androidTuiScreen],
  deploySteps: [androidDeployStep({ pipeline: 'install' }), androidDeployStep({ pipeline: 'update' })],
  envSpecFragments: [],
};

import type { CreateCliOptions } from '@marinoscar/platform-cli';

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
// =============================================================================

/** The options `cli.ts` builds this app's CLI with. */
export const APP_CLI_OPTIONS: CreateCliOptions = {
  identity: CLI_IDENTITY,
  version: CLI_VERSION,
  extraCommands: [],
  envSpecFragments: [],
};

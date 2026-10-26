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
//                     one that needs ffmpeg, emits a
//                     job.app.* span and an app vital     examples/transcode.executor.ts
//   envSpecFragments  metadata for app.env.example keys
//   envGroups         an opt-in group of env keys          examples/coach.env-group.ts
//   envGenerators     a kind of generated env value        examples/coach.env-generator.ts
//   envAnnotations    fixed / help for a platform env key  examples/coach.env-annotation.ts
//   deployChecks      a doctor / preflight check           examples/coach.deploy-check.ts
//   deploySteps       also before / replaces / skipWhen    examples/coach.deploy-step-placement.ts
//   proxy             stream paths for the VPS host proxy  examples/coach.proxy-stream.ts
//   edgeConfigFiles   a single-file nginx mount to check   examples/coach.edge-config.ts
//   tuiSections       a section of the node/deploy screens examples/fleet-note.tui-section.tsx
//   deploy            manifests the version step writes    examples/coach.versioned-manifests.ts
//
// The CLI conformance suites (`registerCliConformanceSuite`, examples/coach.conformance-suite.ts)
// and the compose modes (`registerComposeMode` of @marinoscar/platform-infra,
// examples/staging.compose-mode.ts) are registered from tests and tooling,
// not from the options.
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

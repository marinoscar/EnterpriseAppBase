import { githubRawManifest, type UpdateNoticeOptions } from '@marinoscar/platform-cli';

// =============================================================================
// EXAMPLE, NOT WIRED: tell the operator a newer CLI exists (issue #1033)
// =============================================================================
//
// THE PRODUCTION PROBLEM THIS FIXES. Operators run an old app CLI on a server
// without knowing a newer one exists, and several production failures (a compose
// project name, port clashes) had already been fixed in a newer CLI the server
// did not have. Nothing told the operator.
//
// Declare where the newest version is and how to update:
//
//   createCli({ ..., updateNotice: COACH_UPDATE_NOTICE })
//
// When the CLI starts it checks (at most once every 24 hours, cached in
// `~/.<cli>/update-check.json`) in parallel with the command, and after the
// command's output writes ONE line to stderr, only when the newest version is
// semver-greater than the running one:
//
//   appctl 1.11.0 is available (you have 1.10.7). Update: git pull && npm ci && npm run build
//
// `githubRawManifest` reads `version` from a JSON manifest over HTTPS: no
// credentials, no redirects, a 1.5 s deadline, the body capped at 256 KiB, and
// only a valid semver string accepted. Any other source is a function that
// returns the version (or `undefined`):
//
//   latestVersion: async (signal) => (await fetchMyRegistry(signal)).cli
//
// Never shown, and never a change to stdout or the exit code: when `CI` is set,
// when stderr is not a terminal, for `--json`, `--version` and `--help`, for the
// worker daemon (`node start`), or when the operator sets `APPCTL_NO_UPDATE_CHECK=1`
// (the prefix follows the CLI's identity). Failure, timeout and offline are silent.
//
// Left unset, the CLI does no check at all and nothing changes. A bad option
// (an empty or multi-line `upgradeHint`, no `latestVersion`) throws at `createCli`.
// =============================================================================

/** Where the app's CLI version lives, for `githubRawManifest`. */
export const COACH_MANIFEST = { repo: 'kappa/coach', ref: 'main', path: 'apps/cli/package.json' } as const;

/** The update notice of an app whose CLI is released from its repository's default branch. */
export const COACH_UPDATE_NOTICE: UpdateNoticeOptions = {
  latestVersion: githubRawManifest(COACH_MANIFEST),
  upgradeHint: 'git pull && npm ci && npm run build',
};

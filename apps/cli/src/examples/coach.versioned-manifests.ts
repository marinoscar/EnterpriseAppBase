// =============================================================================
// EXAMPLE, NOT WIRED: an app whose CLI keeps its own version (issue #1030)
// =============================================================================
//
// THE PRODUCTION BUG THIS FIXES. `deploy install` / `deploy update` choose a
// release version, write it into the app's workspace manifests and the
// lockfile's workspace entries, and commit it (the `version` step). The list of
// manifests was closed: `apps/api`, `apps/web`, `apps/cli`, `packages/shared`.
// An app whose CLI is versioned on its own (the CLI's version is recorded in the
// deploy state, in the deploy-info document and in every request's User-Agent,
// and is bumped per CLI change) had it overwritten by the app release: a
// production commit `chore(release): 1.2.3` moved such a CLI from 1.10.7 to 1.2.3.
//
// Name the manifests the release owns, and leave the CLI out:
//
//   createCli({ ..., deploy: { versionedManifests: COACH_VERSIONED_MANIFESTS } })
//
// THE FIRST ENTRY IS THE VERSION SOURCE. The current version, and so the
// suggested patch bump, is read from it; the others are written to match. Only
// the listed manifests and only their lockfile workspace entries are touched.
//
// Left unset, the list is the four above and nothing changes. A bad list (empty,
// a duplicate, `..`, a file that is not a `package.json`) throws at `createCli`.
// =============================================================================

/** The release-owned workspaces of an app whose `apps/cli` has its own version. */
export const COACH_VERSIONED_MANIFESTS = [
  'apps/api/package.json',
  'apps/web/package.json',
  'packages/shared/package.json',
] as const;

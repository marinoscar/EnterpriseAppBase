import { APP_NAME, REPO_SLUG } from '@app/shared';

import type { CliIdentity } from '@marinoscar/platform-cli';

// =============================================================================
// CLI identity — the one constant a fork renames  (issue #140, epic #110)
// =============================================================================
//
// This repository is a TEMPLATE. Somebody clones it, calls their product
// something else, and every user-visible string carrying "appctl" is now
// wrong. The whole point of this module is that renaming is a one-line edit
// here rather than a grep across the package, so three separate things are
// DERIVED from `CLI_NAME` instead of being written out again:
//
//   1. the executable name shown in `--help` and in error messages
//   2. the config directory, `~/.appctl/` (consumed by #143)
//   3. the environment-variable prefix, `APPCTL_` (consumed by #143/#144)
//
// If those three were three literals, a rename would leave a binary called
// `acmectl` reading `~/.appctl/config.json` and answering to `APPCTL_TOKEN` —
// and nothing would fail, which is what makes that class of bug expensive.
//
// TWO IDENTITIES, NOT ONE (issue #165, epic #161). The three things above are
// the BINARY's identity and are still seeded by `CLI_NAME` right here. The
// PRODUCT's display name is a different fact with a different blast radius —
// it appears in the browser wordmark and in email templates too — so it now
// comes from `@app/shared`, and `CLI_DISPLAY_NAME` is derived from it. A fork
// renaming its product edits that one constant and the CLI banner follows;
// renaming the executable is still an edit here, and the two are deliberately
// independent.
//
// THE ONE PLACE THIS CONSTANT CANNOT REACH is the `bin` key in package.json.
// npm reads that file before any code runs, so the name is necessarily written
// there a second time. A test asserting `packageJson.bin` has exactly one key
// and that it equals `CLI_NAME` is the guard for that duplication, and it is
// the reason the duplication is acceptable rather than merely tolerated.
// =============================================================================

/**
 * The name of the executable, and the seed for everything else in this file.
 *
 * WHY `appctl` AND NOT `app`: a bare `app` is short enough to collide with
 * something already on a developer's PATH, and a CLI that silently shadows (or
 * is silently shadowed by) another binary is a support ticket nobody enjoys.
 * The `-ctl` suffix is the established convention for "the control client for
 * a service" (kubectl, systemctl, gcloud's various *ctl tools), it reads as
 * neutral rather than as a product name, and it is unlikely to already exist.
 *
 * WHY NOT DERIVE IT FROM package.json's `name`: that field is `cli`, because
 * it is the workspace name (`apps/api` is `api`, `apps/web` is `web`), and
 * `cli` is not a name anyone wants to type. The two are independent facts.
 *
 * CONSTRAINTS ON A REPLACEMENT VALUE: lowercase ASCII letters, digits and
 * hyphens. It becomes a filesystem path and an env-var prefix, so anything
 * else (spaces, dots, uppercase) produces a dotfile directory that is awkward
 * to type on one side and an unusable variable name on the other.
 */
export const CLI_NAME = 'appctl';

/**
 * The identity this app hands the platform CLI (#715). The platform reads it
 * through accessors (`cliName()`, `envVar()`, `configDirName()`...) and
 * derives the config directory (`~/.appctl`) and env prefix (`APPCTL_`) from
 * `name`; the product half comes from `@app/shared`.
 */
export const CLI_IDENTITY: CliIdentity = {
  name: CLI_NAME,
  displayName: `${APP_NAME} CLI`,
  productName: APP_NAME,
  repoSlug: REPO_SLUG,
};

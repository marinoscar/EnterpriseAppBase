# Changesets

This folder holds the pending release notes of the six `@marinoscar/platform-*`
packages. They share one version (a Changesets "fixed" group in
[`config.json`](config.json)) and release from `.github/workflows/release.yml`.

- Add one with `npx changeset` in any pull request that changes a platform
  package; `npx changeset --empty` when the change has no release impact.
- `pre.json` means the packages are in pre-release mode: releases are
  `x.y.z-next.N` on the `next` dist-tag.

Procedure, owner prerequisites and troubleshooting:
[docs/runbooks/release-platform-packages.md](../docs/runbooks/release-platform-packages.md).
When to add a changeset and what counts as breaking:
[docs/DEVELOPMENT.md](../docs/DEVELOPMENT.md#adding-a-changeset).

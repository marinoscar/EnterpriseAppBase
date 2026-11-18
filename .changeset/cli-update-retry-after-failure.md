---
"@marinoscar/platform-cli": patch
---

`deploy update` no longer treats a deployment as up to date just because the checkout did not move. `fetch` moves the checkout before build, migrate and restart, so after a failed run the next plain `update` found "nothing to do", skipped the environment drift heal, the build, the migration and the maintenance-off, and exited 0. The state now records `deployedHead` (the checkout HEAD when the last install or update SUCCEEDED, an optional field, so older state files read as before) and an update is a no-op only when the checkout did not move AND is still at that revision; an unchanged remote after a successful run stays a cheap no-op, including after a version bump that was pushed or rolled back. The rollback hint printed on failure names the last successfully deployed revision instead of the broken one, and `previousSha` and the history entry record it too.

A compose `required variable X is missing a value` refusal (update, install, uninstall and `deploy status`) now carries a plain-language hint: the CLI predates the revision or the `.env` lacks the key, and the exact recovery commands. A new test pins that every `${VAR:?}` in the shipped compose files is generated or recorded by the CLI.

A deployment whose CLI is older than this fix still needs that CLI updated first; it cannot be healed from the application side.

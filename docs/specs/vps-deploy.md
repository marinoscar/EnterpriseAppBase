# Design Spec: `appctl deploy` (VPS deployment)

This is the durable design for a new `appctl deploy` command family in
`apps/cli` that installs and updates this application on a single VPS: git
clone/pull, `docker compose build`, database migration and seeding, and TLS
via a shared host-level proxy. An epic and its child issues link here instead
of restating the design — read this first, then the issue you were sent to
implement.

Source of truth for every claim below:

- `apps/cli/src/program.ts` — command registration, the two stdout/stderr and
  non-zero-exit rules every command (including `deploy`) must keep.
- `apps/cli/src/errors.ts` — `CliError`, the `EXIT` table, and why `ApiError`
  and `NetworkError` are separate types.
- `apps/cli/src/device-login.ts` — the hooks pattern this design copies for
  `DeployHooks`.
- `apps/cli/src/config.ts` — `~/.appctl/config.json` and the atomic-write
  trick deploy state must repeat, in a different file, for the same reason.
- `apps/cli/src/prompt.ts` — the one prompt primitive that exists today
  (`prompt()`), and the TTY-or-fail rule the wizard inherits.
- `apps/cli/src/tui/tty.ts`, `apps/cli/src/tui/routes.ts`,
  `apps/cli/src/tui/scroll-box.tsx`, `apps/cli/src/tui/layout.tsx` — the TUI
  gate, the closed route union, and the bounded-viewport rule a live deploy
  log must obey.
- `apps/cli/src/commands/api.ts` — the "thin `register*`, real work in a
  separate `run*`" shape every deploy subcommand follows.
- `infra/compose/base.compose.yml`, `infra/compose/prod.compose.yml`,
  `infra/compose/.env.example` — the compose layering and the environment
  contract deploy generates a `.env` against.
- `infra/nginx/nginx.conf` — the in-compose single-origin proxy; the thing
  this design puts *behind* a second, host-level proxy, not the thing it
  replaces.
- `apps/api/scripts/prisma-env.js`, `apps/api/src/config/configuration.ts`,
  `apps/api/src/prisma/prisma.service.ts` — at design time, the three places
  `DATABASE_URL` got rebuilt from `POSTGRES_*`, inconsistently encoded. **No
  longer three implementations**: Phase 0 fix #4 (section 2) consolidated
  `configuration.ts` and `PrismaService` onto one shared
  `apps/api/src/common/database-url.ts` (`buildDatabaseUrl`); `prisma-env.js`
  remains separate but already encoded correctly and needed no change.
- `apps/api/prisma/seed.ts` — the idempotent seed the update pipeline
  deliberately re-runs by default.
- `apps/api/src/health/health.controller.ts` — `/api/health/ready`, and why
  it is not evidence a migration ran.
- `apps/api/scripts/smoke-test.mjs` — the closest existing thing to a
  deploy-verification script, and the model for `health.ts`'s external check.
- `.github/workflows/deploy.yml` — the GHCR build pipeline whose deploy jobs
  are `echo` stubs; the rejected-alternative section below explains why this
  design does not consume it yet.
- `docs/runbooks/rotate-secrets-encryption-key.md` — the house style this
  document follows, and the key model `env-metadata.ts`'s validator for
  `SECRETS_ENCRYPTION_KEY` must match.

**Status: epic #168 shipped.** Everything described past this line has been
built: `apps/cli/src/deploy/` exists (`executor.ts`, `journal.ts`, `state.ts`,
`hooks.ts`, `env-spec.ts`, `env-metadata.ts`, `env-wizard.ts`, `repo.ts`,
`proxy.ts`, `health.ts`, `install.ts`, `update.ts`, plus `checks/` and
`steps/`), `apps/cli/src/commands/deploy.ts` registers `deploy
doctor|install|update|status`, `apps/cli/src/tui/screens/deploy.tsx` and
`status.tsx` are the TUI surfaces, and `infra/compose/vps.compose.yml` is the
third compose overlay. All four Phase 0 infra fixes in section 2 landed too
(commits `c283330`/#189, `5ba9ef6`/#190, `1cc18fe`/#191, `93c8c33`/#192).

This document is now the **decision record** for that code, not a
pre-implementation brief: it keeps the rationale, the rejected alternatives,
and the account of what was wrong before, but every section below has been
walked against the shipped implementation and corrected where the build
diverged from the design — divergences are called out inline, next to the
contract they replace, rather than collected in one changelog. Nothing here
restates day-2 usage:

- **Operator runbook** (prerequisites, first login, troubleshooting):
  [`docs/deployment/vps.md`](../deployment/vps.md)
- **Command reference** (flags, exit codes, examples):
  [`apps/cli/README.md#deploying-to-a-server`](../../apps/cli/README.md#deploying-to-a-server)

Every fact cited above about the codebase *at design time* was verified
against the files named then; it may have moved since — the sections below
are the current source of truth for the *shipped* shape of each contract.

---

## 1. Scope and the four decisions already made

`appctl deploy` takes this repository (or, far more likely, a fork of it —
see the Architecture Principles in `CLAUDE.md`: this is a template) from "an
empty VPS with Docker installed" to "running, migrated, seeded, and served
over HTTPS at a real domain," and back again on every subsequent `update`.
Four decisions are locked in; do not re-open them in a child issue without
raising it back at the epic level, because each one shapes several modules
at once.

| Decision | What it means | What it rules out |
|---|---|---|
| **Runs on the VPS** | The operator SSHes in with their own credentials, then runs `appctl deploy install`. The CLI never dials out over SSH itself. | An SSH client or library (`ssh2`) in the CLI; a laptop-driven orchestrator; managing the operator's SSH keys. |
| **Code delivery is git + build** | `git clone`/`git fetch` + `docker compose build` on the server, every time. No image registry in the loop. | Pulling pre-built images from GHCR (see the rejected-alternatives table — the workflow that pushes them exists, but nothing downstream of it does). |
| **TLS via a shared host proxy** | A single nginx + certbot stack at `/opt/infra/proxy`, outside this repository, terminates TLS for every app on the box. The app stack binds `127.0.0.1` only. | Each app owning its own port 443, its own certbot timer, its own nginx process. |
| **External PostgreSQL** | The operator supplies `POSTGRES_*` for a database that already exists; deploy validates it, never creates or manages it. | A `postgres:` service in any compose file. `base.compose.yml` deliberately has none — see its header comment. |

The git-clone-on-server model is also the answer to "how does this stay safe
for a fork of the template": nothing about repo URL or ref is hardcoded
anywhere in the CLI. `repo.ts` (section 5) reads it from the operator's own
checkout, so a fork deploys itself, never the upstream template.

## 2. Phase 0: fix these first, in application code, not CLI code

**All four fixed — see the "what actually shipped" column.** These were
pre-existing gaps in `base.compose.yml`, `prod.compose.yml`,
`infra/nginx/nginx.conf`/`apps/web`, and `configuration.ts` that, at design
time, nobody had hit because nothing had run `base + prod` against a real
domain. That is no longer true of #1: the fix commit's own code comment
records that the mismatch *was* hit and diagnosed while working out the fix
("the result was a stack whose API answered normally while every page load
returned 502") — so treat the original "nobody hit yet" framing as a
description of the state before this section was acted on, not of today.

| # | Where | The defect | What was designed | What actually shipped |
|---|---|---|---|---|
| 1 | `infra/nginx/nginx.conf` (`web_upstream`) / `apps/web/Dockerfile` | Proxies `/` to `web:5173` — Vite's dev port. The `production` target of `apps/web/Dockerfile` serves the built static files from **nginx**. `base + prod` had a frontend upstream nothing listened on. | Add a second nginx config (`infra/nginx/nginx.prod.conf`) with `web:80` as the upstream, mounted by `prod.compose.yml`. | **Commit `c283330` / #189, differently than designed.** No second nginx config exists — `infra/nginx/nginx.conf` still has one `web_upstream` naming `web:5173`, used by both dev and prod. Instead, `apps/web/Dockerfile`'s `production` stage was changed to listen on **5173**, not 80 (`apps/web/nginx.conf`, baked into the production image), so the one existing proxy config is already correct for both modes. The file's own header explains why: one shared proxy config for both modes beats two copies of the SSE block, headers and CSP drifting apart. A regression test guards the port: `apps/web/src/__tests__/infra/nginx-upstream-port.test.ts`. |
| 2 | `base.compose.yml` (`api.environment`) | The `api` service's `environment:` block is a hand-maintained allowlist. It never passes `APP_URL`, `COOKIE_SECRET`, `SECRETS_ENCRYPTION_KEY`, `STORAGE_PROVIDER`, `S3_ENDPOINT`, `MAX_FILE_SIZE`, `ALLOWED_MIME_TYPES`, `SIGNED_URL_EXPIRY`, `STORAGE_PART_SIZE`, or any `DEVICE_*` variable — all of which `configuration.ts` reads. | Replace the allowlist with `env_file: .env` on the `api` service. | **Commit `5ba9ef6` / #190, as designed.** `api` now carries `env_file: [{ path: .env, required: false }]` (relative to `infra/compose/`, matching local dev), plus a slimmed `environment:` block kept **only** for compose-level defaults (`NODE_ENV`, `PORT`, the `POSTGRES_*` fallbacks, JWT TTLs, `OTEL_ENABLED`/`OTEL_SERVICE_NAME`) — each carrying a `:-default` specifically so it cannot blank out a value `.env` already supplied (`environment:` overrides `env_file:` in compose's merge order). `required: false` keeps a missing `.env` a soft condition, matching local dev's existing behaviour. |
| 3 | `base.compose.yml` (`nginx.ports`) | `"3535:80"` binds `0.0.0.0`. Fine for local dev; on a VPS behind a shared proxy it exposes the app stack directly on the public interface, bypassing the proxy and its TLS entirely. | Not fixed in `base.compose.yml` itself. Fixed by `vps.compose.yml` overriding it to `"127.0.0.1:3535:80"`. | **Commit `93c8c33` / #192, as designed** (see section 15 for the exact override and why it must use `!override`, and for the log-rotation additions this file also picked up that the design didn't foresee). |
| 4 | `apps/api/src/config/configuration.ts` | Its own inline `DATABASE_URL` construction did **not** URL-encode `POSTGRES_PASSWORD`, while `apps/api/scripts/prisma-env.js` and `PrismaService` both did. A password containing `@`, `:`, `/`, or `#` built a URL here that Prisma's own tooling would have encoded correctly, and the two could disagree about what host/port/db the connection string even meant. | Add `encodeURIComponent(password)` in `configuration.ts`, matching the other two call sites — three call sites, patched to agree. | **Commit `1cc18fe` / #191, better than designed.** Rather than patch three call sites to agree, all three were consolidated into one: `apps/api/src/common/database-url.ts` exports `buildDatabaseUrl()`, which both `configuration.ts` and `PrismaService` now call (the third site, `prisma-env.js`, already encoded correctly and is unaffected — see its own `constructDatabaseUrl`). One implementation instead of three in agreement removes the class of bug, not just this instance of it. |

## 3. Command surface and exit codes

**Shipped surface, corrected against `apps/cli/src/commands/deploy.ts`** — it
diverges from the design below in several places: `--path` shipped as
`--root` (and its default is not what section 5 proposed — see that
section); `doctor` has no `--all` (it always runs every check, required and
recommended together — see section 9); `status` uses `--json`, not `--raw`;
neither `install` nor `update` has `--dry-run`; and several flags were added
that the design did not anticipate (`--group`, `--email`, `--reinstall`,
`--resume`, `--skip-doctor`, `--skip-proxy`, `--no-cache`, `--staging`,
`--json` on every subcommand, `--proxy-root`, `--port`). The full reference,
including every flag's help text, is
[`apps/cli/README.md#deploying-to-a-server`](../../apps/cli/README.md#deploying-to-a-server);
this is not a duplicate of that table, just enough to keep this document's
other sections honest about what the CLI actually accepts:

```
appctl deploy doctor  [--root <path>] [--proxy-root <path>] [--port <port>]
                       [--domain <domain>] [--json] [--no-color]
appctl deploy install [--root <path>] [--domain <domain>] [--proxy-root <path>] [--port <port>]
                       [--repo <url>] [--ref <ref>] [--email <email>] [--group <name>...]
                       [--all] [--non-interactive] [--reinstall] [--resume]
                       [--skip-doctor] [--skip-proxy] [--skip-seed] [--no-cache]
                       [--force] [--staging] [--json]
appctl deploy update   [--root <path>] [--ref <ref>] [--force] [--no-cache]
                       [--non-interactive] [--skip-seed] [--skip-proxy] [--json]
appctl deploy status   [--root <path>] [--port <port>] [--domain <domain>] [--json] [--no-color]
```

Each is a thin `registerXCommand` delegating to a `runX` function (all four
live in `commands/deploy.ts` itself — `runDoctorCommand`, `runInstallCommand`,
`runUpdateCommand`, `runStatusCommand` — rather than in separate
`deploy/doctor.ts`/`deploy/status.ts` modules; see section 4), exactly like
`registerApiCommand`/`runApiCommand` in `commands/api.ts` — the split exists
so a test can call `runInstall(...)` directly without going through
commander's argument parsing.

**Resume is opt-in, not automatic — correcting this document's own earlier
framing.** `deploy install` is idempotent step-by-step (section 7), and
`state.ts` does track which steps completed (`completedSteps`, consulted only
when `--resume` is passed) specifically so a fixed-and-rerun install does not
redo finished work. But a bare re-run of `install` after a partial failure
does **not** pick this up automatically: `runInstall` checks for existing
state first and, unless `--reinstall` or `--resume` was passed, throws a
`UsageError` telling the operator to run `deploy update` or pass
`--reinstall` — deliberately, so an accidental second `install` cannot
silently redo a working deployment. The failure message from a real crashed
step names the exact remedy: `` `Fix the cause and re-run with --resume to
continue from this step.` `` `deploy update` is the day-2 command; it refuses
to run against a directory `install` has not already set up (section 8).

New exit code, additive per `errors.ts`'s own contract ("Add new codes; do
not renumber existing ones"):

```ts
export const EXIT = {
  OK: 0,
  FAILURE: 1,
  USAGE: 2,
  API: 3,
  NETWORK: 4,
  AUTH: 5,
  /**
   * A required doctor/preflight check failed before any destructive step ran.
   * Distinct from FAILURE because "your DB is unreachable" and "this CLI hit
   * a bug" have different owners and different next actions — a script
   * driving `deploy install` in a bootstrap pipeline should be able to tell
   * "environment isn't ready yet, retry after fixing DNS" apart from
   * "something is actually broken here."
   */
  PRECONDITION: 6,
} as const;
```

`PreconditionError extends CliError` with `exitCode = EXIT.PRECONDITION`, as
designed — thrown from `runDoctorCommand` (`commands/deploy.ts`, not a
standalone `doctor.ts`; see section 4) and from the preflight step of
`install.ts`/`update.ts`. **`DeployStepError` was not built.** A pipeline
step that runs and fails on its own terms (`runInstall`/`runUpdate`'s
`result.failed` path) throws a plain `Error`, not a `CliError` subclass, so
it falls through to `exitCodeFor`'s default and exits `FAILURE` (1) rather
than a step-specific code — the same outcome the design wanted, reached
without the extra class. Everything else deploy throws is an existing
`CliError` subclass where one fits (`UsageError` for a bad flag or a missing
deployment, `NetworkError` for an unreachable DB or registry).

## 4. Module map

**As shipped**, differing from the design in three ways: `doctor` and
`status` are not separate `deploy/doctor.ts`/`deploy/status.ts` modules —
their logic lives directly in `commands/deploy.ts` (`runDoctorCommand`,
`runStatusCommand`, alongside `runInstallCommand`/`runUpdateCommand`), reading
the same `checks/`/`health.ts` registries section 3 already points to;
`checks/` grew as one module **per check category** (`host.ts`, `database.ts`,
`dns.ts`, `tls.ts`, aggregated by `index.ts`), not one file per individual
check id — each category file exports several `Check`s; and `steps/` holds
only the generic pipeline runner (`pipeline.ts`, exporting `runPipeline` and
the `DeployStep<C>`/`StepContext` types), not one file per named step —
`install.ts` and `update.ts` each build their own array of step objects
inline and hand it to `runPipeline`.

```
apps/cli/src/deploy/
  executor.ts       # spawn wrapper: argv only, no shell, timeout, streamed capture
  journal.ts        # run log to disk (human .log + machine .jsonl), retention, redaction
  state.ts          # deploy state file (.appctl-deploy.json), separate from ~/.appctl/config.json
  hooks.ts          # DeployHooks — the CLI/TUI seam
  env-spec.ts       # parse .env.example -> EnvVarSpec[]
  env-metadata.ts   # annotations for the keys needing special handling
  env-wizard.ts     # prompt loop -> returns values; install.ts writes .env (0600)
  repo.ts           # resolve origin/ref dynamically; clone/fetch/checkout
  proxy.ts          # vhost render/install/validate/rollback + certbot webroot
  health.ts         # container status, /api/health/ready polling, external HTTPS
  checks/           # doctor check registry, one module per CATEGORY (see section 9)
  steps/            # the generic pipeline runner only (pipeline.ts); steps live inline
  install.ts
  update.ts
apps/cli/src/commands/deploy.ts     # registers doctor/install/update/status AND runs doctor/status
apps/cli/src/tui/screens/deploy.tsx # renders the same hooks as React state
apps/cli/src/tui/screens/status.tsx # the status screen
infra/compose/vps.compose.yml       # the third compose overlay (section 15)
```

The "single module with one job" framing mostly held: `checks/` and `steps/`
did grow to hold a registry rather than a long `switch`, just at a coarser
grain (category modules, a shared runner) than "one file per check" implied.

## 5. `repo.ts`: resolving the repo without hardcoding it

The operator's workflow is: SSH in, `git clone` (or already have cloned)
**their fork**, `cd` into it, build `appctl` from source
(`npm run build --workspace=cli`, per the CLI's own README), and run
`appctl deploy install` from inside that checkout. `repo.ts` leans on
exactly that: it walks upward from `process.cwd()` looking for a `.git`
directory (the same thing `git` itself does to find the repository root),
and when it finds one, reads:

```bash
git -C <root> remote get-url origin
git -C <root> rev-parse --abbrev-ref HEAD   # falls back to a symbolic-ref
                                             # lookup if HEAD is detached
```

as the defaults for `--repo` and `--ref`. This is what makes the tool fork-
safe with zero configuration: the template repository's URL never appears
anywhere in `apps/cli`, so a fork that has renamed everything still deploys
itself. `--repo`/`--ref` override the detected values outright; if `cwd` is
not inside a git working tree at all and neither flag is given, `install`
fails fast with a `UsageError` naming both flags — there is no silent
fallback to the template's own origin, because guessing wrong here means
deploying the wrong application.

**The deploy root's default shipped differently than designed.** The flag is
`--root`, not `--path` (see section 3), and its default
(`DEFAULT_DEPLOY_ROOT` in `commands/deploy.ts`) is the fixed constant
`/opt/infra/apps` — not `/opt/<repo-name>` derived per application. A second
app on the same box is not distinguished by the default at all; deploying a
second app to the same box means passing a second app's own `--root`
explicitly, or it collides with the first at that path. `--proxy-root`
defaults similarly to a fixed `/opt/infra/proxy`, which does match the design
(section 10). Whatever `--root` resolves to is where the CLI manages its own
clone and everything else it writes (`.env`, the state file, the run
journal); it is deliberately not required to be the same directory as the
checkout `repo.ts` read the defaults from — an operator who builds `appctl`
in `~/src/myfork` and deploys to `--root /opt/myapp` is a normal, supported
split. On a first `install`, `repo.ts` clones `--repo`/detected URL at
`--ref`/detected ref into `<deploy-root>/repo`; on `update`, it `git fetch`s
and compares the resolved ref's SHA against the state file's recorded
`commitSha` before doing anything else (section 8) — that file is
`<deploy-root>/.appctl-deploy.json`, not `state.json` (section 13).

`executor.ts` is what actually runs `git`, `docker`, `docker compose`,
`certbot`, and `openssl`-equivalent operations. It generalizes the one
existing subprocess precedent, `browser.ts`'s use of `spawn`: explicit
`argv` (never a shell string — the domain, repo URL and ref are all
operator-supplied and must never be interpolated into something a shell
re-parses), `shell: false`, `once('error')`/`once('spawn')` handling, and a
timeout. It adds two things `browser.ts` didn't need: **streamed capture**
(stdout/stderr are both relayed line-by-line to `DeployHooks.onLog` *and*
accumulated for the journal, because a `docker compose build` can run for
minutes and an operator watching it — in the plain command or the TUI —
needs to see it happen, not receive a wall of text after the fact) and an
`AbortSignal` that SIGTERMs the child (`executor.ts` line ~214, `SIGTERM` not
`SIGKILL` — a build killed outright can leave more mess than one asked to
stop). What listens for that signal is **ctrl-c**, not Esc — see section 14
for why the shipped TUI screen refuses Esc entirely rather than offering it
as a cancel key.

## 6. The env wizard: generated from `.env.example`, not hardcoded

This is the property that keeps the wizard correct against a fork's own
edits, for the same reason `commands/api.ts` is one generic command instead
of one hand-written subcommand per resource: a wizard with its own list of
34 field names goes stale the day a fork adds `STRIPE_SECRET_KEY` or removes
the Microsoft OAuth block. Instead:

**`env-spec.ts`** parses `infra/compose/.env.example` structurally, not with
a hardcoded key list:

- `# ---...---` banner pairs become section headers (`Application`,
  `Database (PostgreSQL)`, `JWT / Session`, ...).
- Consecutive `#`-prefixed lines immediately above a key become that key's
  help text (this is exactly the prose already in the file — e.g. the whole
  `SECRETS_ENCRYPTION_KEY` block explaining when it's optional).
- An active `KEY=value` line is a required-shape entry; a commented-out
  `# KEY=value` line (the Microsoft OAuth block) is an **optional** entry —
  present in the parsed spec, but not written to the generated `.env` unless
  the operator opts in.
- A trailing inline comment on the value (`MAX_FILE_SIZE=10737418240  # 10GB
  in bytes`) is stripped from the value and folded into the help text.
  Compose's own `.env` parser does not strip these — a `.env` written
  verbatim from a value that still carries `  # 10GB in bytes` would hand
  that whole string to the container as `MAX_FILE_SIZE`, and Node's
  `parseInt` would silently truncate it at the first non-digit rather than
  erroring, so this step is not cosmetic.

Result: `EnvVarSpec[]` (named `EnvSpec[]` in the original design), each entry
`{ key, section, defaultValue, help, optional: boolean, line: number }` — the
shipped field is `optional` (true for a commented-out key), not the design's
`required`/`commentedOut` pair, and it carries the source `line` for error
messages, which the design didn't ask for.

**`env-metadata.ts`** is the *only* hardcoded list in the whole subsystem, as
designed, but it grew three kinds of entry the design did not anticipate
(`fixed`, `group`, `never`), and the `essential` list shipped smaller and
different than proposed:

| Kind | Applies to (as shipped) | Behavior |
|---|---|---|
| `secret: true` | `POSTGRES_PASSWORD`, `JWT_SECRET`, `COOKIE_SECRET`, `SECRETS_ENCRYPTION_KEY`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_SECRET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and the `UPTRACE_*`/`CLICKHOUSE_PASSWORD` credentials | Masked input when typed (`promptSecret`, see below); the value feeds `journal.ts`'s redaction list (section 12) unconditionally, whether the operator typed it or the wizard generated it. |
| `generate: 'base64-32'` | `JWT_SECRET`, `COOKIE_SECRET`, `SECRETS_ENCRYPTION_KEY` | As designed: the wizard offers "generate one" using `node:crypto`'s `randomBytes(32).toString('base64')` **in-process**, never a shell-out to `openssl`. |
| `validate` | `JWT_SECRET`/`COOKIE_SECRET` (min length 32, plus a shared `rejectPlaceholder` check not in the original design — rejects a value that still looks like `.env.example`'s own placeholder, e.g. `your-...`, `change-me...`, `...example.com`); `SECRETS_ENCRYPTION_KEY` (`validateBase64Key32` — must decode to exactly 32 bytes for AES-256, matching the design); `POSTGRES_PORT` (a new port-range check the design didn't call out); `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (`rejectPlaceholder`); `INITIAL_ADMIN_EMAIL` (an email-shape check plus `rejectPlaceholder`). |
| `derive` | `APP_URL` from the domain (`https://<domain>`); `GOOGLE_CALLBACK_URL` and `MICROSOFT_CALLBACK_URL` (the design didn't mention Microsoft's) from the domain, each `https://<domain>/api/auth/<provider>/callback` | As designed: computed once from the one domain question, shown as an overridable default, never silently computed with no visibility. |
| `fixed` (**not in the design**) | `NODE_ENV` (`'production'`) | Forced, never offered, never overridable by a prompt — a VPS deployment is definitionally production. |
| `group: EnvGroup` (**not in the design**) | `'observability'` (all `OTEL_*`/`UPTRACE_*`/`CLICKHOUSE_*` keys), `'storage'` (`S3_*`, `AWS_*`), `'microsoft-oauth'` (the three `MICROSOFT_*` keys) | Skipped entirely unless the operator opts into that group with `--group <name>` (repeatable; see section 3) — a whole feature area is either asked about together or not asked about at all, rather than every key in it defaulting silently one at a time. This is the actual answer to "what happens to `UPTRACE_ADMIN_PASSWORD` on an install that doesn't want observability" — the design's `--all`-only mechanism (below) didn't have one. |
| `never` (**not in the design**) | `TEST_AUTH_ENABLED` | Never offered, never written, whatever the template says — setting it in production fails startup by design. |
| `essential: true` | `POSTGRES_HOST`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `JWT_SECRET`, `COOKIE_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `INITIAL_ADMIN_EMAIL` (**9 keys, not ~13**) | Prompted by default. **Not essential, contrary to the original design**: `SECRETS_ENCRYPTION_KEY` (optional per `CLAUDE.md`'s own `.env` documentation — asking for it unconditionally would have contradicted that), `GOOGLE_CALLBACK_URL` and `APP_URL` (both `derive`d, never asked directly), and `POSTGRES_PORT`/`POSTGRES_SSL` (only 4 of the 6 `POSTGRES_*` keys are essential, not all six). Everything else in the spec takes its template default silently unless `--all` is passed, in which case the wizard asks about **every** key (see `shouldAsk` below) — grouped keys still need their group opted into first. |

**A key with no `env-metadata.ts` entry is silently defaulted, full stop —
correcting the design's inference claim.** The design proposed that an
unknown key would still get a prompt "when it's essential by inference (no
safe non-empty default)". The shipped `shouldAsk(metadata, current, all)` has
no such inference: it asks only when `all` is true, or `metadata.essential
=== true`, or (`metadata.secret === true` and nothing is already known) —
nothing about a blank default enters the decision. A fork that adds
`STRIPE_SECRET_KEY` to `.env.example` and nothing to `env-metadata.ts` is
**not** asked about it on a normal run; it takes its template default (empty,
if the fork left it empty) exactly like every other unmarked key, and only
surfaces via `--all`. The metadata file's real leverage is narrowing
*behaviour* for known keys, as designed — it just does not, in practice,
change *visibility* the way the design described.

**`env-wizard.ts`** is the prompt loop. `prompt.ts` grew three primitives
beyond its original single `prompt()`, but not under the names proposed:

- **`confirm(question, default)`** (design proposed `promptConfirm`) — yes/no,
  same TTY-or-throw rule as `prompt()`.
- **`promptSecret(question)`** — shipped exactly as designed: a custom output
  `Writable` substituting `*` for each keystroke, restoring normal echo once
  submitted. **Only used for values a human types** (`GOOGLE_CLIENT_SECRET`,
  `POSTGRES_PASSWORD` when not already known) — generated secrets never go
  through a prompt at all.
- **`select<T>(question, choices, default)`** (design proposed `promptSelect`)
  — shipped as a generic fixed-choice prompt, and it is used elsewhere in the
  CLI (`commands/login.ts`), but **not** by `env-wizard.ts` or `install.ts`/
  `update.ts`. The design's "`--all` review loop's keep/edit/skip choice per
  key" was not built: `--all` simply asks every key in turn (secret ones
  masked, the rest plain `prompt()`), with no keep-default/edit/skip menu in
  between. `select()` remains available for a future version of that flow.

**The `.env` write is a plain `writeFileSync`, not the atomic pattern this
document treats as a hard requirement elsewhere.** `install.ts` writes the
finished file with `writeFileSync(path, serializeEnvFile(values, specs), {
mode: 0o600 })` directly — no temp-file-then-`renameSync`. That means the
`mode`-only-applies-at-creation gap this same document calls out for
`config.ts`'s `writeConfigFile` (section 13) and requires `state.ts` to avoid
is, as written, present here too: rewriting an existing `.env` (a `--resume`
or `--reinstall` re-run) does not reassert `0600` on a file whose permissions
were changed since it was created. In practice the file is almost always
freshly created by this same code with `0600` and nothing else touches it, so
the exposure is narrow, but it is a real, uncorrected gap against this
document's own stated standard, not a matter of taste. The write path itself
is confirmed as designed: `<deploy-root>/repo/infra/compose/.env`, the exact
path local development already uses.

## 7. Install pipeline

**Idempotent per step, as designed — but re-running the whole command is
opt-in, not automatic; see the correction in section 3.** The real step list
(`buildInstallSteps()` in `install.ts`, run through the generic
`runPipeline` from `steps/pipeline.ts`) is 11 steps, not 13 — "resolve
deploy root" is folded into the pipeline's own setup rather than a step of
its own, and "summary" is printed by `runInstallCommand` in
`commands/deploy.ts` after the pipeline returns, not a pipeline step. Ids and
order, matching the design closely:

1. **`preflight`** — every `required`-severity doctor check (section 9) must
   pass; recommended failures do not block it (doctor still runs the whole
   registry — see section 9's correction on `--all`). Throws
   `PreconditionError` (exit 6) on any required failure, before anything is
   written or fetched. Skippable with `--skip-doctor` (a flag the design
   didn't include).
2. **`checkout`** (`repo.ts`) — clones if `<deploy-root>/repo` doesn't exist;
   fetches and checks out instead of re-cloning otherwise. Creating
   `<deploy-root>` itself happens ahead of the pipeline, in `runInstall`, not
   as its own numbered step.
3. **`environment`** (`env-wizard.ts`) — collects and writes `.env`.
4. **`validate-environment`** — DB connectivity + credentials + "does this
   database exist" (a real query against the configured `POSTGRES_*`, not a
   syntax check on the connection string), format validation on every
   `env-metadata.ts` `validate` entry. **The design's "best-effort S3
   reachability (a warning, not a hard failure)" was not built** — there is
   no S3/storage check anywhere in `install.ts` or the doctor registry;
   storage configuration is validated only by whatever the application does
   with it at runtime.
5. **`build`** — `docker compose -f base.compose.yml -f prod.compose.yml -f
   vps.compose.yml build` (`--no-cache` when `--no-cache` was passed),
   streamed through `executor.ts`. Confirmed via `COMPOSE_FILES` in
   `install.ts` — the file list matches the design exactly.
6. **`migrate`** — `npm run prisma:migrate` inside the built `api` image
   (`docker compose run --rm --no-deps api npm run prisma:migrate`). The
   design's concern here (`prisma-env.js` only loads dotenv when `NODE_ENV
   !== 'production'`, so a migrate step relying on that would silently see no
   `POSTGRES_*`) is real and is called out verbatim in `install.ts`'s own
   header comment — but it needs **no explicit export from the CLI** to
   resolve, because Phase 0 fix #2 (section 2) already attaches `env_file:
   .env` to the `api` service definition itself: `docker compose run`
   inherits that the same way `up -d` does, so `POSTGRES_*` is already real
   environment by the time the container's entrypoint runs, independent of
   whether `prisma-env.js`'s own dotenv loading is skipped. This step's own
   exit code remains the only thing the pipeline trusts as proof migrations
   ran — see the note on `/api/health/ready` below.
7. **`seed`** — `docker compose run --rm --no-deps api npm run prisma:seed`.
   Skippable with `--skip-seed`. Safe to re-run: `apps/api/prisma/seed.ts` is
   fully idempotent (every write is an upsert).
8. **`start`** — `docker compose up -d`.
9. **`health`** — poll `http://127.0.0.1:<bound-port>/api/health/ready`
   (loopback, before the shared proxy is even touched) with backoff up to a
   timeout. **This step proves the process is up and can reach Postgres at
   all — nothing more.** `HealthController`'s Terminus check issues a bare
   `SELECT 1`, which **passes against an empty, unmigrated database**. It is
   not, and must never be treated as, evidence step 6 succeeded; step 6's own
   exit code is that evidence — this distinction is preserved verbatim in
   `install.ts`'s header comment. `appctl deploy status` (section 13) reports
   migration state separately from the health probes for the same reason.
10. **`publish`** — install vhost + issue certificate + validate + reload
    (`proxy.ts`, section 10 — corrected there: this step requires the shared
    proxy to already exist rather than bootstrapping it). Skippable with
    `--skip-proxy`. Rolled back on any validation failure.
11. **`verify`** — an outbound request to `https://<domain>/api/health/ready`,
    checking both the HTTP status and that the TLS handshake actually
    completed against a certificate for that name, as designed.

The command layer then prints the summary: domain, commit SHA, the journal
path, and the next step (log in as `INITIAL_ADMIN_EMAIL`) — see
`runInstallCommand`'s non-JSON branch in `commands/deploy.ts`.

## 8. Update pipeline

**Matches the design closely** (`buildUpdateSteps()` in `update.ts`, ids
`preflight`/`fetch`/`environment-drift`/`build`/`migrate`/`seed`/`restart`/
`health`/`publish`/`verify`), with the state file's name corrected
(`.appctl-deploy.json`, not `state.json` — section 13) and one real
refinement the design didn't call out:

```
require .appctl-deploy.json + <deploy-root>/repo + .env + the compose files
  -> else: NotInstalledError naming `appctl deploy install`, EXIT.USAGE
LIGHT preflight, not the full doctor registry — a deliberate refinement:
  only docker-installed, docker-daemon, docker-compose-v2, git-installed and
  disk-space run. DNS and TLS/certificate checks are treated as install-time
  concerns and are NOT re-run on every update, on the reasoning that a site
  already serving does not need them re-litigated each time.
fetch; compare resolved ref's SHA against the recorded commitSha
  -> unchanged and no --force/--no-cache: mark unchanged, every later step
     skips itself, exit 0, do nothing else
record previous SHA (for the summary; there is no automatic rollback — see below)
env drift check: any .env.example key with no counterpart in the existing .env
  -> a missing key with a usable default is added silently and the operator
     is told so
  -> a missing key that is `essential` or `secret` triggers the wizard,
     scoped to just the new keys (interactive), or a UsageError naming what's
     missing and that a domain is required to run the wizard at all
     (--non-interactive with nothing recorded)
build
migrate  (prisma migrate deploy is itself additive/idempotent against a DB
          already at a later state — this is Prisma's own guarantee, not
          something this pipeline adds)
seed, BY DEFAULT — a deliberate divergence from any shell-script precedent,
  which never re-seeds. The seed is idempotent, so this is how permissions
  or role rows added by a newer version of the seed actually land on an
  existing install. `--skip-seed` opts out for an operator who has hand-
  edited seeded rows and does not want them upserted back.
restart (`docker compose up -d`)
wait for health
publish: refresh vhost / renew certificate if within certbot's renewal window
  (proxy.ts owns "is this cert due"; update does not force-reissue every run).
  Skippable with --skip-proxy.
external verification
summary, including the previous SHA so a stuck update is easy to read as a diff
```

There is deliberately no automatic rollback on a failed `update`, as
designed. Recording the previous SHA is for the operator's own `git checkout
<previous-sha>` + re-run of `install`, not for the CLI to attempt unattended
— reverting a database migration safely is a decision that needs a human,
not a heuristic.

## 9. Doctor: the preflight check registry

`checks/` holds one module per check **category** (`host.ts`, `database.ts`,
`dns.ts`, `tls.ts` — see the correction in section 4), each check within it
exporting the same shape, aggregated by `checks/index.ts` into one ordered
`ALL_CHECKS` list — consumed by `appctl deploy doctor` directly and by
`install`'s preflight step (`requiredChecks(ALL_CHECKS)`; `update`'s
preflight is a deliberately smaller, hand-picked subset — section 8) — one
registry, at least two callers, the same pattern this codebase already uses
for `NOTIFICATION_EVENTS` and the settings-page registries: declare the check
once, let every consumer read the same list instead of maintaining a second
one that can drift.

The shipped contract, from `checks/types.ts`, differs from the design in
naming and adds a dependency mechanism the design didn't have:

```ts
interface Check {
  id: string;                              // e.g. 'docker-daemon', 'dns-resolves' — the design's own examples, both real
  title: string;                           // design called this `description`
  severity: 'required' | 'recommended';    // design called this `level`
  requires?: readonly string[];            // NOT IN THE DESIGN: ids that must pass first,
                                            // else this check reports `skip` rather than running
  run(context: CheckContext): Promise<CheckResult>;
}

// The design's discriminated union (`message` present only on warn/fail) was not
// built. `detail` is a plain required field on every status, and there is a
// fourth status, `skip`, for a check whose `requires` did not pass:
interface CheckResult {
  status: 'pass' | 'warn' | 'fail' | 'skip';
  detail: string;
  remedy?: string;
}
```

Checks actually registered (`ALL_CHECKS`, host-first "because everything else
depends on docker being usable"): `docker-installed`, `docker-daemon`,
`docker-compose-v2`, `git-installed`, `node-version`, `disk-space`, `memory`,
`bind-port-free`, `proxy-root`, `proxy-conf-writable`, `acme-webroot`,
`certbot-installed`, `proxy-config-valid` (`host.ts`); `database-reachable`,
`database-credentials`, `database-exists`, `database-privileges`,
`database-ssl` (`database.ts`); `dns-resolves`, `dns-points-here` (`dns.ts`);
`certificate-present`, `certificate-validity`, `certificate-renewal`
(`tls.ts`) — matching the design's "checks to include at minimum" almost
exactly, including its own two named examples.

**`--all` was not built on `doctor`, and doctor does not skip recommended
checks — correcting the design here.** `appctl deploy doctor` has no `--all`
flag (see section 3); it always runs every check in `ALL_CHECKS`, required
and recommended together, and reports both. Severity decides only the exit
code, exactly as the design's own rule 3 in `checks/types.ts` states ("both
are shown; only a failed required check makes doctor exit non-zero") — the
mechanism the design got right was *which checks run*, not *how the failure
is reported*, and what shipped is simpler than proposed: there is nothing to
opt into, because nothing is held back by default.

**The shared proxy is a required precondition, not something doctor or
install bootstraps** — a significant, deliberate change from section 10's
original design; see that section.

## 10. `proxy.ts`: the shared host proxy and the app's own vhost

`/opt/infra/proxy` is a second, independent Docker Compose project —
**outside this git repository**, living only on the VPS's filesystem. It is
not part of `infra/compose/` and is not versioned alongside the application;
it is host infrastructure, shared by every app deployed to that box.

**The shared proxy is a required precondition `appctl` checks for and
refuses to proceed without — it does not bootstrap one.** This is the single
largest divergence between this section and what shipped. The design
proposed that `proxy.ts` would write a minimal nginx + certbot compose
project and bring it up itself when `/opt/infra/proxy/docker-compose.yml`
was missing. That was not built: `proxy.ts` exports no bootstrap function at
all, and the doctor registry's `proxy-root` check (`checks/host.ts`, severity
`required`) instead **fails** when `--proxy-root` doesn't exist, with the
remedy `"Set up the shared reverse proxy first, or point at it with
--proxy-root."` — the same is true of the paired `proxy-conf-writable` and
`acme-webroot` checks. Setting up that first shared proxy on a box is
therefore an operator task outside `appctl` entirely; see
[`docs/deployment/vps.md`](../deployment/vps.md) for that procedure — it is
not restated here. `proxy.ts`'s actual job, once the proxy exists, matches
the design for everything **except** bootstrapping:

1. ~~Bootstrap if absent~~ — **not built; see above.**
2. **Render the vhost** for this app's domain into
   `<proxyRoot>/nginx/conf.d/<domain>.conf` (the design omitted the `nginx/`
   segment — `vhostPath()` in `proxy.ts` is the source of truth), proxying to
   `127.0.0.1:<bound-port>` (the port `vps.compose.yml`'s nginx service
   binds — default `3535`, matching local dev, but distinct per app on a box
   hosting more than one).
3. **Issue the certificate** via certbot's **webroot** method
   (`--webroot --webroot-path <proxyRoot>/webroot`) against the shared
   proxy's webroot mount — never the standalone/`--nginx` plugin method, as
   designed. Certificates land at `<proxyRoot>/letsencrypt/live/<domain>/`
   (`livePath()`), a detail the design left unspecified.
4. **Validate**: run `nginx -t` (in the proxy container when it is
   containerised, bare otherwise) against the newly rendered config before
   reloading anything — as designed, confirmed in `validateProxy`.
5. **Reload**, never restart (`nginx -s reload`, `docker exec` when
   containerised) — as designed, confirmed in `reloadProxy`.
6. **Roll back** on a failed validation: restore the previous vhost file (or
   remove it, on a first install with nothing to restore to) — as designed,
   confirmed in `installVhost`.

Illustrative shape of a rendered vhost (abbreviated — the real template also
carries the SSE-streaming location block for
`/api/notifications/stream` and a `client_max_body_size` matched to
`MAX_FILE_SIZE`, both omitted here; see `renderVhost` in `proxy.ts` for the
complete, current template):

```nginx
server {
    listen 80;
    server_name app.example.com;
    location /.well-known/acme-challenge/ { root <proxyRoot>/webroot; }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl;
    server_name app.example.com;
    ssl_certificate     <proxyRoot>/letsencrypt/live/app.example.com/fullchain.pem;
    ssl_certificate_key <proxyRoot>/letsencrypt/live/app.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3535;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

`X-Forwarded-Proto` is set **here**, at the shared proxy, to the fixed
string `https` rather than `$scheme` (this `location` block only ever lives
inside the `listen 443 ssl` server, so the two are equivalent in practice;
the shipped code writes the literal to say so directly). `renderVhost`'s own
comment states what's at stake plainly: "the application forwards `$scheme`
onward, so THIS is the value it ultimately sees. Get it wrong and OAuth
callbacks build `http://` URLs and the login redirect loops."

**Unverified: the design's claim that `apps/api/src/main.ts` has trust-proxy
configuration that makes NestJS honor this header could not be confirmed —
it appears not to exist.** `main.ts` constructs its `FastifyAdapter` with
only `{ logger: true }`; no `trustProxy` option (or any other trust-proxy
configuration, under any name) was found anywhere in `apps/api/src`. This
document cannot say what effect that has on the request object without
auditing how the API actually reads scheme/host — outside this document's
scope and this pass's remit — but the claim that this wiring exists should
be treated as unconfirmed rather than restated as fact.

## 11. The CLI/TUI seam: `DeployHooks`

This is the single most important pattern to get right, and it is not new —
it is `device-login.ts` copied faithfully. `apps/cli/src/device-login.ts`'s
own header states the rule: **nothing in the business-logic module writes
to a terminal.** Everything a human would see is delivered through a hooks
object; `commands/login.ts` renders those hooks as stderr lines and
`tui/screens/login.tsx` renders the identical callbacks as React state. Two
renderers, one sequence, and the sequence is the thing that gets tested.

**The shipped shape, from `hooks.ts`, differs from the design in naming and
in what each callback carries** — the split (nothing in `src/deploy/` writes
to a terminal; everything flows through this interface) is exactly as
designed:

```ts
export type StepOutcome = 'ok' | 'skipped' | 'failed';   // design called this `status`

export interface StepResult {
  id: string;             // NOT IN THE DESIGN'S StepResult — folded in here
  title: string;          // NOT IN THE DESIGN'S StepResult — folded in here; design called it `label`, on a separate DeployStep type
  outcome: StepOutcome;
  durationMs: number;
  detail?: string | undefined;   // design called this `message`
}

export interface DeployHooks {
  // The design's separate `DeployStep` type was not built; step identity is
  // inlined into the start-callback's parameter instead, with two fields
  // (index, total) the design didn't have:
  onStepStart?: ((step: { id: string; title: string; index: number; total: number }) => void) | undefined;
  // Takes the single StepResult (which already carries id/title), not
  // (step, result) as designed:
  onStepResult?: ((result: StepResult) => void) | undefined;
  /**
   * A line of subprocess output, already ANSI-stripped — NO `level` PARAMETER.
   * The design's `'info' | 'warn' | 'error'` distinction was not built; every
   * line is the same kind of line.
   */
  onLog?: ((line: string) => void) | undefined;
  /**
   * A free-text progress message ("waiting for certificate...") — NOT the
   * design's `{ completed: number; total: number }` structured progress.
   * Renderers print or replace a line; there is no numeric progress bar.
   */
  onProgress?: ((message: string) => void) | undefined;
}
```

`install.ts`/`update.ts` take `hooks?: DeployHooks` exactly like
`runDeviceLogin` takes `options.hooks`, and neither ever calls
`process.stdout.write`/`process.stderr.write` directly — `commands/deploy.ts`
does that. **It does not go through `formatStatusLine`** (`output.ts`) as the
design proposed — that function exists but is unused by the deploy surface;
`runInstallCommand`/`runUpdateCommand` render `onStepStart`/`onStepResult`/
`onProgress`/`onLog` with their own small inline template strings instead
(`` `\n  [${index + 1}/${total}] ${title}\n` ``, `` `  done
(${durationMs}ms)\n` ``, and so on). `tui/screens/deploy.tsx` accumulates
`onLog` lines into component state feeding a `ScrollBox` (section 14) and
renders `onStepResult` as a checklist, as designed.

## 12. Logging: the run journal

**Only `install` and `update` actually write a journal — `doctor` does
not, correcting the design's claim.** `openJournal` (`journal.ts`) is called
from exactly two places, `install.ts` and `update.ts`; `runDoctorCommand` and
`runStatusCommand` (`commands/deploy.ts`) never call it, so a `doctor` or
`status` run leaves no `.log`/`.jsonl` behind — its own output (or `--json`
report) is the only record. `OpenJournalOptions.command`'s own doc comment
still lists all four command names as illustrative filename values, which is
aspirational rather than a description of current call sites.

For the runs that do get one: two files under `<deploy-root>/logs/`, a
timestamped human-readable `.log` and a matching machine-readable `.jsonl` —
but the `.jsonl` is **not** "one JSON object per executed command" as
designed. It is one JSON object per *event*: `run.start`, `step.start`
(per pipeline step), `line` (free text), `command` (`{ argv, cwd, exitCode,
durationMs, timedOut, stdout, stderr }`, plus a shared `ts`/`type`), and
`run.finish`. Commands are one event kind among several, not the whole
schema. Retention keeps the newest **10** runs (`DEFAULT_RETAIN_RUNS`, not
the design's illustrative "e.g. 20") and deletes older `.log`/`.jsonl` pairs
together at the start of each run — "prune on write, not on a schedule", as
designed.

**Redaction is mandatory and happens before a single byte reaches disk, as
designed — with two mechanics the design didn't specify.** Every value
`env-metadata.ts` marks `secret: true` — whether generated by the wizard or
typed by the operator — is collected into a redaction list once the `.env`
is known, and `journal.ts` does a literal substring replace across every
line of captured stdout/stderr and every recorded `argv`, for both the
`.log` and the `.jsonl`. Two things the design left as "a fixed placeholder":

- Each secret is replaced with **`***REDACTED:<key>***`**, naming the
  variable (e.g. `***REDACTED:POSTGRES_PASSWORD***`) — a log stays
  diagnosable ("which credential is this") without ever showing the value —
  rather than one generic placeholder indistinguishable across secrets.
- Secrets are matched **longest value first**, because one secret can be a
  substring of another (a password embedded in a connection string), and
  redacting the short one first would leave the long one's tail exposed.
- A value shorter than 5 characters (`MIN_REDACTABLE_LENGTH`) is **never
  redacted at all** — the design didn't call this out, but it matters: an
  unusually short secret is a bigger problem than its appearance in a log,
  since redacting it would replace every occurrence of those few characters
  anywhere in the file and destroy the log's usefulness without saying what
  was wrong.

State the honest boundary the design already named: it is a substring match
against *known* secret values, not a pattern-based scan — a value
`env-metadata.ts` does not know to be secret (a fork's own newly added
credential with no metadata entry) will not be redacted, because there is
nothing to compare against. This is precisely why section 6 says a fork
adding a new secret-ish key should add a `secret: true` entry: doing so is
what makes both masking *and* redaction apply to it. Console output during a
run gets the *rendered* summary (via `DeployHooks`, already free of raw
secret material by construction — nothing puts a secret value into an
`onLog` line in the first place); the file gets the full captured output,
redacted the same way. The journal is also fault-tolerant in a way the
design didn't spell out: every write is guarded, and a log directory that
cannot be written degrades to a single stderr warning rather than aborting
the deployment — a journal failure is a nuisance, not a reason to fail an
install.

## 13. Deploy state

**The file name shipped differently than designed: `<deploy-root
>/.appctl-deploy.json` (`DEPLOY_STATE_FILENAME` in `state.ts`), not
`state.json`.** The requirement the design built this around is unchanged
and correctly honoured — this is **not** `~/.appctl/config.json`, and that is
still a hard requirement, not a style preference: `writeConfigFile` "replaces
the whole file and drops unknown keys" (`config.ts`'s own words); if deploy
state shared that file, the next `appctl login` on the same VPS would
silently erase every field deploy had written. `state.ts` does implement the
identical temp-file-then-rename, mode-at-creation pattern `writeConfigFile`
uses, as designed (`writeState`, `flag: 'wx'` on the temp file, `renameSync`
over the target) — though the design's identical requirement for `.env`
(section 6) was **not** carried through to `env-wizard.ts`'s actual write,
which uses a plain `writeFileSync`; see that section's correction.

The shape shipped with a version field, resumability support and a
recorded previous SHA the design didn't have, and dropped one field
(`lastSuccessAt` — `lastDeployedAt` already carries that information, updated
only on success):

```ts
export const DEPLOY_STATE_VERSION = 1;

interface DeployState {
  version: 1;                  // NOT IN THE DESIGN — refused if it doesn't match;
                                // a newer appctl having written the file is the
                                // likeliest reason for a mismatch
  repoUrl: string;
  ref: string;
  commitSha: string;           // as of the last successful install/update
  domain?: string | undefined;
  bindPort: number;            // design called this `boundPort`
  deployRoot: string;          // NOT IN THE DESIGN
  installedAt: string;         // ISO 8601, set once, never overwritten
  lastDeployedAt: string;      // ISO 8601 — design had this AND a separate `updatedAt`/`lastSuccessAt`
  lastCommand: 'install' | 'update';
  appctlVersion: string;       // CLI_VERSION at time of write
  previousSha?: string | undefined;      // NOT IN THE DESIGN — the revision this replaced, for a manual rollback
  completedSteps?: string[] | undefined; // NOT IN THE DESIGN — which steps finished, read only by --resume (section 3)
}
```

`commands/deploy.ts`'s `runStatusCommand` reads this file — **and, contrary
to the design's "reports that plainly, not as an error", treats a missing
one as an error**: it throws a `UsageError` ("No deployment found at
`<root>`...", `EXIT.USAGE`, i.e. exit 2), distinct from "installed but
unhealthy" (`DeploymentUnhealthyError`, `EXIT.FAILURE`, exit 1) — a monitoring
script can still tell the two apart, which was the design's real intent, just
via two different non-zero codes rather than one non-error report. It
augments the state with live data via `health.ts`'s `collectHealth`: `docker
compose ps` per-service state, the local liveness/readiness/frontend probes,
an external HTTPS probe when `--domain` is given, and **migration state
reported separately from the health probes** (`prisma migrate status`, since
`/api/health/ready`'s bare `SELECT 1` passes against an unmigrated database —
see section 7, step `health`). **The design's "how many commits the tracked
ref is ahead of `commitSha`" was not built** — `HealthReport` has no such
field, and neither `status.ts`'s logic (which lives in `runStatusCommand`,
not a separate `status.ts` module — section 4) nor `health.ts` compares the
remote ref against what's deployed; "is there an update available" is
answered today only by actually running `deploy update`.

## 14. TUI integration

A new route joined the closed union in `tui/routes.ts`, as designed
(member order differs trivially from what's shown below, which is not
meaningful):

```ts
export type Route = 'menu' | 'login' | 'invoke' | 'status' | 'deploy' | 'logout';
```

...listed in `screens/menu.tsx`, switched on in `app.tsx`, and
`tui/screens/deploy.tsx` follows the existing screen contract exactly: one
`onDone: () => void` prop, a discriminated-union state machine, an
`AbortController` in a ref aborted on unmount, `useInput` gated by
`isActive` whenever a child (a text field, the confirm prompt, the eventual
select list) owns the keyboard.

The live step/log view reuses `ScrollBox` — its own header already explains
why: ink redraws the *entire* frame on every state change, so an unbounded
list of `<Text>` lines behind a minutes-long `docker compose build` is
exactly the failure mode that component exists to prevent. **`followTail`
shipped exactly as designed** — an opt-in prop (`scroll-box.tsx`, off by
default, pinning the viewport to new lines while true unless the operator has
scrolled up) — confirmed in both `scroll-box.tsx` and its use in
`deploy.tsx` (`<ScrollBox lines={phase.lines} reservedRows={16} followTail
isActive={false} />`). ANSI-free input is likewise enforced exactly as
designed, in `executor.ts`.

**The abort-safety answer shipped, but differently than designed — and
stronger, not weaker.** The design proposed offering Esc as a cancel key with
a confirmation dialog naming the risk of a partial deployment. What shipped
instead **refuses Esc outright** while a deploy is running: `deploy.tsx`'s
own comments state the reasoning plainly — "Esc is REFUSED while running
rather than offered as a cancel that does not cancel" and "No 'esc cancel':
it would not cancel, and offering it would be a lie." The only way to abort
is **ctrl-c**, which the screen's own footer advertises (`hints={['ctrl-c
abort']}`) instead of an Esc hint, and which is load-bearing precisely
because — as the design correctly anticipated — a deploy step mid-flight
(`docker compose build`, a migration) is not uniformly safe to interrupt;
`executor.ts` SIGTERMs the child on abort (section 5), and an interrupted
build layer or migration statement can leave a genuinely partial state. The
design's underlying caveat ("everything is idempotent, so re-running is
always the fix" needs saying out loud at the moment it matters) is honoured
by refusing the softer, more discoverable key entirely rather than by a
confirmation prompt on it.

**The exit-code inversion shipped exactly as designed** — confirmed in
`tui/index.tsx`'s own header comment ("A NORMAL EXIT IS 0 EVEN AFTER A FAILED
LOGIN OR A 403. That is deliberate and it is the opposite of the rule for
subcommands"). `tui/index.tsx` today lets a
failed *interactive* operation still exit the process with 0 — the TUI
itself completed even though the thing it did failed. `appctl deploy
install` run as an explicit subcommand must not inherit that: a scripted
`appctl deploy install --non-interactive` in a bootstrap pipeline needs the
real exit code (0, or `PRECONDITION`/`FAILURE`/etc.), because that is
exactly the class of automation `program.ts`'s two binding rules exist to
serve. The TUI screen's own "operation failed" state can still return 0 to
`onDone` for the *menu* to keep working — but the explicit `deploy install`
command path, going through `program.ts`'s ordinary `run()`, must not.

## 15. `infra/compose/vps.compose.yml`

A third overlay, layered the same way `dev.compose.yml` and
`prod.compose.yml` already are:

```bash
docker compose -f base.compose.yml -f prod.compose.yml -f vps.compose.yml up -d
```

Its central job, with Phase 0's fixes landed in `base.compose.yml` and
`prod.compose.yml` themselves (section 2), is the one override that is
legitimately VPS-specific and wrong for local dev: binding nginx to loopback
only. The actual file:

```yaml
services:
  nginx:
    # `!override` REPLACES the inherited sequence instead of merging with it —
    # compose merges `ports:` across overlay files by default, so a plain
    # `ports:` here would ADD this mapping and leave base.compose.yml's
    # "3535:80" (0.0.0.0) in place too, looking fixed while it silently isn't.
    ports: !override
      - "127.0.0.1:${APP_BIND_PORT:-3535}:80"
    logging:
      driver: "json-file"
      options: { max-size: "10m", max-file: "3" }
  api:
    logging:
      driver: "json-file"
      options: { max-size: "10m", max-file: "3" }
  web:
    logging:
      driver: "json-file"
      options: { max-size: "10m", max-file: "3" }
```

**Two things beyond the loopback bind that the design's "nothing else belongs
in this file" did not anticipate, both legitimately VPS-specific:**

- **`!override` on `ports:`, not a plain key.** The design's illustrative
  snippet used a bare `ports:` list, which is a real correctness gap against
  compose's own merge semantics (sequences merge/append across `-f` overlays
  by default) — the shipped file's own comment calls this out as "the one
  line in it that fails silently when written wrong," and recommends
  verifying with `docker compose ... config` that there is exactly one
  `ports` entry with `host_ip 127.0.0.1`.
- **Log rotation for `nginx`, `api` and `web`** (`json-file`, capped at
  10MB × 3 files each). Not in the design at all, and justified precisely
  because it's a VPS-only concern: an unbounded `json-file` log is a
  slow-motion outage on a small VPS specifically (disk fills, and
  everything that writes fails at once — often surfacing first as Postgres
  or Docker refusing to work) in a way local dev's disk headroom does not
  reproduce, so it belongs here rather than in `base.compose.yml`.

The port itself is templated (`${APP_BIND_PORT:-3535}`), not the design's
hardcoded literal `3535` — `install.ts`'s `environment` step (section 7)
writes `APP_BIND_PORT` into the generated `.env` from `--port` (default
`3535`, matching local dev), so a second app on the same box can still
override just this one value via its own `--root`/`--port` pair. The
`env_file` fix and the memory limits remain in `base.compose.yml`/
`prod.compose.yml` as designed, because they are correct for *any*
production-like run, VPS or otherwise; the Phase 0 fix for the nginx/web
port mismatch (section 2, #1) did **not** end up as an `nginx.prod.conf`
mount here or anywhere — it was resolved on the image side instead, so there
was nothing left for this file to mount.

## 16. Rejected alternatives

| Alternative | Why it lost |
|---|---|
| **Drive the VPS over SSH from a laptop** | Requires bundling an SSH client/library (`ssh2` or a shell-out to system `ssh`), a private-key or agent-forwarding story, and turns ordinary network flakiness between the laptop and the VPS into deploy failures. The confirmed model instead reuses the operator's own already-authenticated interactive SSH session and never needs a second credential. |
| **Pull pre-built images from GHCR** | `.github/workflows/deploy.yml` already builds and pushes `ghcr.io/<repo>-api`/`-web` on every tag — but its `deploy-staging`/`deploy-production` jobs are literal `echo` stubs, no compose file anywhere uses `image:` (both `api` and `web` are `build:`-only), and consuming a GHCR image from a VPS needs registry credentials staged there too. This is the obvious next integration once `appctl deploy` exists — a `--from-registry` mode that skips the build step — but it is a second, separable piece of work, not part of v1. |
| **A self-contained per-app nginx + certbot** | A VPS hosting one app today is a VPS hosting a second one within a year. Per-app TLS termination means N certbot renewal timers and N nginx processes contending for port 443, with no coherent answer for "what's already bound there" the moment a second app deploys. The shared proxy owns 443 exactly once. |
| **PostgreSQL inside the app stack** | `base.compose.yml` deliberately ships no Postgres service — bundling one here would make the CLI additionally responsible for its backups, volumes, and version upgrades, none of which this repository does for any other stateful dependency (S3/storage is always external too). External-and-validated keeps deploy's blast radius to the stateless tier. |
| **A hardcoded env-var list in the wizard** | The same drift risk `commands/api.ts`'s "one generic command" design exists to avoid — a fork that edits `.env.example` would silently desync from a wizard that doesn't read it. Parsing the file at run time is the only shape that survives a fork's own edits. |
| **A single 34-field TUI form** | Most installs only ever touch the same dozen fields (domain, DB credentials, Google OAuth, admin email); stepping through all 34 including `UPTRACE_ADMIN_PASSWORD` on every single install is exactly the kind of form an operator abandons partway through. The essential-subset-plus-`--all` split targets the common path while keeping the full set one flag away. |

## 17. Suggested phasing (historical)

This was written as a non-binding suggestion for slicing the epic into child
issues, not a report of what happened — kept here for the record rather than
updated into a retrospective, since the module map (section 4), the check
registry (section 9) and the pipelines (sections 7–8) already say what the
grain of the shipped work actually was. Two corrections worth making so
nobody goes looking for files that were never built: item 3's `doctor.ts`
and item 8's `status.ts` do not exist as separate modules — that logic lives
in `commands/deploy.ts` (section 4) — and item 5's "shared-proxy bootstrap"
was not built at all (section 10).

1. Phase 0 fixes (section 2) — no CLI code, must land first.
2. Foundations: `executor.ts`, `journal.ts`, `state.ts`, `hooks.ts`, the
   `PRECONDITION` exit code, the three new `prompt.ts` primitives.
3. `repo.ts` + `checks/` + `doctor.ts`.
4. `env-spec.ts` + `env-metadata.ts` + `env-wizard.ts`.
5. `proxy.ts`, including the shared-proxy bootstrap.
6. `health.ts` + `steps/` + `install.ts` end to end.
7. `update.ts`.
8. `status.ts`.
9. `commands/deploy.ts` (stderr rendering for all four subcommands).
10. `tui/screens/deploy.tsx` + the route/menu wiring, including
    `ScrollBox`'s `followTail`.
11. `infra/compose/vps.compose.yml` + this document's own follow-up: once
    real usage exists, fold anything this design got wrong back into it —
    which is exactly what this revision of the document is.

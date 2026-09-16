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
  `apps/api/src/prisma/prisma.service.ts` — the three places `DATABASE_URL`
  gets rebuilt from `POSTGRES_*`, and the encoding inconsistency between them.
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

**Everything described past this line exists.** This paragraph used to say
the opposite — it was written before epic #168 (`appctl deploy`'s first
implementation) landed, and nobody came back to correct it once it had.
`apps/cli/src/deploy/` is a real directory with every module section 4 maps
out; `deploy doctor`/`install`/`update`/`status` are real subcommands (see
`apps/cli/src/commands/deploy.ts`); `infra/compose/vps.compose.yml` is a real
overlay; and the four Phase 0 fixes in section 2 all landed first, as this
document always said they had to. Treat every module path named below as
current, not aspirational, and read the file it names rather than trusting a
paraphrase here — that is also this document's own standing instruction to
whoever next changes this area of the code.

Epic #168 delivered sections 1–17 below essentially as designed; a handful of
flag names and defaults drifted during implementation (`--root` rather than
`--path`, `/opt/infra/apps` rather than `/opt/<repo-name>`, `--staging` for
Let's Encrypt's staging environment) and the command reference in
`apps/cli/README.md` is the authoritative source for those, not this
document. **Epic #388** (issues #389–#393) came after, once real review of
the shipped design found four defects the original design had not
anticipated: the shared proxy's two path spaces getting conflated (#389), a
missing account of *who* renews a certificate (#390), three preconditions
install could see but not act on — an absent proxy, a missing database, wrong
OAuth credentials (#391) — and a deploy state file nothing outside the CLI
could read (#392), which is also what a read-only `/api/admin/deployment`
endpoint and the `/admin/settings/deployment` admin page (#393) were built to
serve. Section 18 documents epic #388's additions in the same voice as
everything above it; sections 9 and 13 below are updated in place to match
what doctor's check registry and the deploy state file actually contain
today.

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

Four defects exist in the repository today that would make an otherwise
correct `deploy install` fail or silently misbehave. None of them are
deploy-specific bugs — they are pre-existing gaps in `base.compose.yml`,
`prod.compose.yml`, `infra/nginx/nginx.conf`, and `configuration.ts` that
nobody hit yet because nothing has run `base + prod` against a real domain
before. Fix these as ordinary `fix:`/`chore:` commits, independent of and
before the `deploy` command lands, because every later phase assumes they are
already fixed.

| # | Where | The defect | The fix |
|---|---|---|---|
| 1 | `infra/nginx/nginx.conf` (`web_upstream`) | Proxies `/` to `web:5173` — Vite's dev port. The `production` target of `apps/web/Dockerfile` serves the built static files from **nginx on port 80**. `base + prod` today has a frontend upstream nothing listens on. | Add a second nginx config, e.g. `infra/nginx/nginx.prod.conf`, with `web:80` as the upstream, and have `prod.compose.yml` mount it over the default. `dev.compose.yml` keeps using the existing file unchanged — it is correct for the dev target. |
| 2 | `base.compose.yml` (`api.environment`) | **Fixed** (`env_file: .env` landed on the `api` service — see `base.compose.yml`'s own comment on that block). The `api` service's `environment:` block *was* a hand-maintained allowlist that never passed `APP_URL`, `COOKIE_SECRET`, `SECRETS_ENCRYPTION_KEY`, `MAX_FILE_SIZE`, `ALLOWED_MIME_TYPES`, `SIGNED_URL_EXPIRY`, `STORAGE_PART_SIZE`, or any `DEVICE_*` variable — all of which `configuration.ts` reads. (Two of the original examples of a silently-dropped variable, `STORAGE_PROVIDER` and `S3_ENDPOINT`, no longer exist at all — epic #372 retired every storage environment variable in favor of the runtime-configurable `storage` settings namespace at `/admin/settings/storage`; see [`docs/specs/storage-providers.md`](storage-providers.md). Their removal is unrelated to this fix and would not have changed whether this row needed one.) | Replaced the allowlist with `env_file: .env` on the `api` service (docker compose resolves that path relative to the compose file's directory, i.e. `infra/compose/.env` — exactly where local dev already puts it). This is also what makes a fork's own added variables reach the container with zero compose-file changes. |
| 3 | `base.compose.yml` (`nginx.ports`) | `"3535:80"` binds `0.0.0.0`. Fine for local dev; on a VPS behind a shared proxy it exposes the app stack directly on the public interface, bypassing the proxy and its TLS entirely. | Not fixed in `base.compose.yml` itself, since local dev legitimately wants `0.0.0.0`. Fixed by `vps.compose.yml` (section 10) overriding it to `"127.0.0.1:3535:80"`. Listed here because it is the same family of bug as #1 and #2 and must be understood together with them. |
| 4 | `apps/api/src/config/configuration.ts` | `constructDatabaseUrl` does **not** URL-encode `POSTGRES_PASSWORD`, while `apps/api/scripts/prisma-env.js` and `PrismaService`'s `buildConnectionString` both do. A password containing `@`, `:`, `/`, or `#` builds a URL here that Prisma's own tooling would have encoded correctly, and the two can disagree about what host/port/db the connection string even means. | `encodeURIComponent(password)` in `configuration.ts`, matching the other two call sites. Low blast radius on generated passwords (unlikely to contain reserved characters) but a real trap for an operator who reuses an existing DB password that does. `env-wizard.ts` (section 6) should also warn, not silently accept, a password containing URL-reserved characters until this is fixed. |

## 3. Command surface and exit codes

```
appctl deploy install [--repo <url>] [--ref <ref>] [--path <dir>] [--domain <fqdn>]
                       [--all] [--non-interactive] [--dry-run] [--skip-seed]
appctl deploy update   [--force] [--skip-seed] [--dry-run]
appctl deploy status   [--raw]
appctl deploy doctor   [--all]
```

Each is a thin `registerXCommand` delegating to a `runX` function, exactly
like `registerApiCommand`/`runApiCommand` in `commands/api.ts` — the split
exists so a test can call `runInstall(...)` directly without going through
commander's argument parsing.

`deploy install` is idempotent and resumable by design (section 7): running
it again after a partial failure re-does only what has not already
succeeded, rather than requiring an operator to hand-diagnose which step to
resume from. `deploy update` is the day-2 command; it refuses to run against
a directory `install` has not already set up (section 8).

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

`PreconditionError extends CliError` with `exitCode = EXIT.PRECONDITION`,
thrown by `doctor.ts` and by the preflight step of `install.ts`/`update.ts`.
Everything else deploy throws is an existing `CliError` subclass where one
already fits (`UsageError` for a bad flag, `NetworkError` for an unreachable
DB or registry, a new narrow `DeployStepError` — see section 4 — for a step
that ran and failed on its own terms).

## 4. Module map

```
apps/cli/src/deploy/
  executor.ts       # spawn wrapper: argv only, no shell, timeout, streamed capture
  journal.ts        # run log to disk (human .log + machine .jsonl), retention, redaction
  state.ts          # deploy state file, separate from ~/.appctl/config.json
  hooks.ts          # DeployHooks — the CLI/TUI seam
  env-spec.ts       # parse .env.example -> EnvSpec[]
  env-metadata.ts   # annotations for the keys needing special handling
  env-wizard.ts     # prompt loop -> writes .env (0600)
  repo.ts           # resolve origin/ref dynamically; clone/fetch/checkout
  proxy.ts          # vhost render/install/validate/rollback + certbot webroot
  health.ts         # container status, /api/health/ready polling, external HTTPS
  checks/           # doctor check registry (one module per check, see section 9)
  steps/            # named steps consumed by install.ts and update.ts
  doctor.ts
  install.ts
  update.ts
  status.ts
apps/cli/src/commands/deploy.ts     # registers install/update/status/doctor, renders hooks to stderr
apps/cli/src/tui/screens/deploy.tsx # renders the same hooks as React state
infra/compose/vps.compose.yml       # the third compose overlay (section 10)
```

Every file above but `checks/` and `steps/` is a single module with one job;
`checks/` and `steps/` are directories because both are meant to grow by
adding a file and one registry entry, not by editing a long `switch`.

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

The **deploy root** (default `/opt/<repo-name>`, overridable with `--path`)
is where the CLI manages its own clone and everything else it writes (`.env`,
the state file, the run journal). It is deliberately not required to be the
same directory as the checkout `repo.ts` read the defaults from — an
operator who builds `appctl` in `~/src/myfork` and deploys to `/opt/myapp` is
a normal, supported split. On a first `install`, `repo.ts` clones
`--repo`/detected URL at `--ref`/detected ref into `<deploy-root>/repo`; on
`update`, it `git fetch`s and compares the resolved ref's SHA against
`state.json`'s recorded `commitSha` before doing anything else (section 8).

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
`AbortSignal` that SIGTERMs the child (the TUI's Esc-to-cancel, section 11,
depends on this).

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

Result: `EnvSpec[]`, each entry `{ key, section, defaultValue, help,
required: boolean, commentedOut: boolean }`.

**`env-metadata.ts`** is the *only* hardcoded list in the whole subsystem,
and it is deliberately small — annotations for keys that need behavior
`env-spec.ts` cannot infer from the file's own text:

| Kind | Applies to | Behavior |
|---|---|---|
| `secret: true` | `JWT_SECRET`, `COOKIE_SECRET`, `SECRETS_ENCRYPTION_KEY`, `GOOGLE_CLIENT_SECRET`, `POSTGRES_PASSWORD`, `AWS_SECRET_ACCESS_KEY`, the `UPTRACE_*`/`CLICKHOUSE_PASSWORD` credentials | Masked input when typed (see `promptSecret` below); the value feeds `journal.ts`'s redaction list (section 7) unconditionally, whether the operator typed it or the wizard generated it. |
| `generate: 'base64-32'` | `JWT_SECRET`, `COOKIE_SECRET`, `SECRETS_ENCRYPTION_KEY` | The wizard offers "generate one" as the default action, using `node:crypto`'s `randomBytes(32).toString('base64')` **in-process** — not a shell-out to `openssl`, even though the `.env.example` comment tells a *human* to run `openssl rand -base64 32`. Shelling out would make `openssl` a new precondition this doctor check would have to verify on every VPS; Node already has the primitive. |
| `validate: minLength(32)` | `JWT_SECRET`, `COOKIE_SECRET` | Matches the API's own documented minimum. |
| `validate: base64Decodes32Bytes` | `SECRETS_ENCRYPTION_KEY` | Must decode to exactly 32 bytes — this is the AES-256 key `secret-cipher.ts` expects (see `rotate-secrets-encryption-key.md` for the cipher this key feeds). A key that merely looks base64 but decodes to the wrong length must be rejected here, before it becomes a boot-time failure the operator sees an hour later. |
| `derivedFrom` | `GOOGLE_CALLBACK_URL` from `APP_URL`; `APP_URL` from the one domain question | The wizard asks for the public domain once ("What domain will this be served at?") and derives `APP_URL=https://<domain>` and `GOOGLE_CALLBACK_URL=https://<domain>/api/auth/google/callback`, showing both as defaults the operator can still override — never silently computed with no visibility. |
| `essential: true` | `APP_URL`, all six `POSTGRES_*`, `JWT_SECRET`, `COOKIE_SECRET`, `SECRETS_ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, `INITIAL_ADMIN_EMAIL` (~13 keys) | Prompted by default. Everything else in the spec takes its template default silently unless `--all` is passed, in which case the wizard walks every key — required and optional/commented-out alike — offering keep-default / edit / (for optional keys) skip. |

A key present in `.env.example` with no `env-metadata.ts` entry still gets a
prompt when it's `essential` by inference (no safe non-empty default) or is
silently defaulted otherwise — the metadata file narrows behavior for known
keys, it does not gate which keys the wizard can see. A fork that adds
`STRIPE_SECRET_KEY` to `.env.example` and nothing to `env-metadata.ts` still
gets asked for it (plain-text prompt, no masking, no generation) rather than
being invisible to the wizard; the fork can add a `secret: true` entry later
to upgrade that experience.

**`env-wizard.ts`** is the prompt loop, and it needs primitives `prompt.ts`
does not have today — that file has exactly one, free-text `prompt()`, by
design (see its own header: "this CLI asks exactly one question"). Deploy
needs three more, added to `prompt.ts` rather than duplicated in
`env-wizard.ts`, so the TUI's future rich equivalents (`ink-text-input` /
`ink-select-input`, already dependencies) have one command-line behavior to
match:

- **`promptConfirm(question, default)`** — yes/no, same TTY-or-throw rule as
  `prompt()`.
- **`promptSecret(question)`** — masked input. `node:readline` has no
  built-in echo suppression; the standard workaround is a custom output
  `Writable` (or overriding the `Interface`'s internal `_writeToOutput`)
  that substitutes `*` for each keystroke instead of echoing it, restoring
  normal output once the line is submitted. This is exactly the kind of
  fiddly terminal-mode code `prompt.ts`'s own header calls out as the reason
  a bare readline interface — not a dependency — was chosen for the simple
  case; it stays true here, it is just more work for this one case.
  **Only used for values a human types** (`GOOGLE_CLIENT_SECRET`,
  `POSTGRES_PASSWORD` when not already known) — generated secrets never go
  through a prompt at all.
- **`promptSelect(question, choices, default)`** — a fixed-choice prompt:
  type a number or the first few characters, or (in the ink TUI) an actual
  arrow-key list via the existing `ink-select-input` dependency. Used by the
  `--all` review loop's keep/edit/skip choice per key.

The finished `.env` is written to `<deploy-root>/repo/infra/compose/.env` —
the exact path local development already uses (`cp
infra/compose/.env.example infra/compose/.env`), which is also where docker
compose looks for a `.env` file by default when invoked from that directory
(the existing `Key Commands` in `CLAUDE.md` already `cd infra/compose`
before every `docker compose` invocation; deploy's `executor.ts` does the
same). It is written with the identical atomic-write discipline as
`config.ts`'s `writeConfigFile`: a freshly-created `wx`-flagged temp file at
mode `0600` in the same directory, then `renameSync` over the target — never
`writeFileSync` directly over an existing file, because (per that function's
own extensive comment) `mode` only applies to file *creation*, so overwriting
in place would silently leave a previously-`0644` `.env` world-readable
forever. `env-wizard.ts` should treat this as a library call into (or a
copy of the documented technique from) `config.ts`, not a new, weaker
reimplementation.

## 7. Install pipeline

Every step is individually idempotent and safe to re-run — `install`'s
whole contract is "run it again after any failure and it picks up where it
left off," not "resume from a saved cursor." Steps, in order:

1. **Preflight** — every `required`-level doctor check (section 9) must
   pass; a `recommended` failure prints a warning and continues. Throws
   `PreconditionError` (exit 6) on any required failure, before anything is
   written or fetched.
2. **Resolve deploy root** — create `<deploy-root>` if absent (`mkdir -p`).
3. **Clone/checkout at ref** (`repo.ts`) — clone if `<deploy-root>/repo`
   doesn't exist; if it does (a re-run after a partial failure), fetch and
   checkout instead of re-cloning.
4. **Env wizard** (`env-wizard.ts`) — skipped if a valid `.env` already
   exists at the target path *and* `--non-interactive` was passed; otherwise
   always offered, because a re-run is exactly when an operator fixes a
   typo'd credential.
5. **Validate env** — DB connectivity + credentials + "does this database
   exist" (a real `SELECT 1` against the configured `POSTGRES_*`, not a
   syntax check on the connection string), format validation on every
   `env-metadata.ts` `validate` entry, best-effort S3 reachability (a
   warning, not a hard failure — an admin can configure storage after first
   login).
6. **Build images** — `docker compose -f base.compose.yml -f prod.compose.yml
   -f vps.compose.yml build`, streamed through `executor.ts`.
7. **Migrate** — `npm run prisma:migrate` (i.e. `prisma migrate deploy`)
   run **inside the built `api` image** (`docker compose run --rm api npm
   run prisma:migrate`), with `POSTGRES_*` exported into that run's
   environment explicitly. This matters because `prisma-env.js` only loads
   `.env` files when `NODE_ENV !== 'production'` — a production migrate step
   that relied on dotenv loading would silently see no `POSTGRES_*` at all
   and fall back to the hardcoded `localhost`/`postgres`/`postgres`
   defaults, which is a believable way to migrate the wrong database. This
   step's own exit code is the only thing that step of the pipeline trusts
   as proof migrations ran — see the note on `/api/health/ready` below.
8. **Seed** — `docker compose run --rm api npm run prisma:seed`. Safe to
   re-run: `apps/api/prisma/seed.ts` is fully idempotent (every write is an
   upsert).
9. **`up -d`** — start `nginx`, `api`, `web` per the compose overlay.
10. **Wait for health** — poll `http://127.0.0.1:<bound-port>/api/health/ready`
    (loopback, before the shared proxy is even touched) with backoff up to a
    timeout. **This step proves the process is up and can reach Postgres at
    all — nothing more.** `HealthController`'s Terminus check issues a bare
    `SELECT 1`, which **passes against an empty, unmigrated database**. It
    is not, and must never be treated as, evidence step 7 succeeded; step
    7's own exit code is that evidence. Conflating the two is exactly the
    kind of "it looked healthy" false confidence this document exists to
    prevent someone from re-discovering the hard way.
11. **Install vhost + issue certificate + validate + reload** (`proxy.ts`,
    section 10). Rolled back on any validation failure — see that section
    for the mechanics.
12. **External HTTPS verification** — an outbound request to
    `https://<domain>/api/health/ready`, following redirects, checking both
    the HTTP status and that the TLS handshake actually completed against a
    certificate for that name (a self-signed fallback or a proxy
    misconfiguration can serve 200 over broken TLS just as easily as over
    good TLS — this check must fail on the second case too). Modeled on
    `apps/api/scripts/smoke-test.mjs`'s own "boot it and hit the health
    endpoints" verification, one layer further out.
13. **Summary** — print (stderr for the command, a final screen state for
    the TUI) the domain, the commit SHA deployed, and the exact next steps
    (log in as `INITIAL_ADMIN_EMAIL`, where the state/journal files live).

## 8. Update pipeline

```
require state.json + <deploy-root>/repo + .env + the compose files
  -> else: "not installed here, run `appctl deploy install`" (PreconditionError)
fetch; compare resolved ref's SHA against state.commitSha
  -> unchanged and no --force: print "already up to date at <sha>", exit 0, do nothing else
record previous SHA (for the summary; there is no automatic rollback — see below)
env drift check: any .env.example key with no counterpart in the existing .env
  -> interactive: offer to run the wizard for just the new keys
  -> --non-interactive: PreconditionError naming the missing keys
build
migrate  (prisma migrate deploy is itself additive/idempotent against a DB
          already at a later state — this is Prisma's own guarantee, not
          something this pipeline adds)
seed, BY DEFAULT — a deliberate divergence from any shell-script precedent,
  which never re-seeds. The seed is idempotent, so this is how permissions
  or role rows added by a newer version of the seed actually land on an
  existing install. `--skip-seed` opts out for an operator who has hand-
  edited seeded rows and does not want them upserted back.
up -d
wait for health
refresh vhost / renew certificate if within certbot's renewal window
  (proxy.ts owns "is this cert due"; update does not force-reissue every run)
external verification
summary, including the previous SHA so a stuck update is easy to read as a diff
```

There is deliberately no automatic rollback on a failed `update`. Recording
the previous SHA is for the operator's own `git checkout <previous-sha>` +
re-run of `install`, not for the CLI to attempt unattended — reverting a
database migration safely is a decision that needs a human, not a heuristic.

## 9. Doctor: the preflight check registry

`checks/` holds one module per check, each exporting the same shape
(`apps/cli/src/deploy/checks/types.ts`), consumed by both `appctl deploy
doctor` directly and by `install`/`update`'s own preflight step — one
registry, two callers, the same pattern this codebase already uses for
`NOTIFICATION_EVENTS` and the settings-page registries: declare the check
once, let every consumer read the same list instead of maintaining a second
one that can drift.

```ts
interface Check {
  id: string;                          // e.g. 'docker-daemon', 'dns-resolves'
  title: string;                       // shown in `doctor` output
  severity: 'required' | 'recommended';
  requires?: readonly string[];        // other check ids this one presupposes
  run(ctx: CheckContext): Promise<CheckResult>;
}

type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';
type CheckResult = { status: CheckStatus; detail: string; remedy?: string };
```

`ALL_CHECKS` (`checks/index.ts`) concatenates five modules, in the order they
run: `HOST_CHECKS` (Docker, Compose v2, git, Node, disk, memory, the loopback
port, the shared proxy's directory/container/webroot, certbot, ports 80/443,
`nginx -t` — 16 checks), `GH_CHECKS` (the GitHub CLI, 2 checks — see 18.4 for
why these two are `recommended` with a promoting `fail`), `DATABASE_CHECKS`
(reachability, credentials, existence, schema privilege, `CREATEDB`
privilege, TLS — 6 checks), `DNS_CHECKS` (resolves, points at this host — 2
checks) and `TLS_CHECKS` (certificate present, valid, renewed, the two #389
checks below — 5 checks). That is 31 checks today; the number moves as
checks are added; do not hand-transcribe the count into a script and expect
it to stay right — read `ALL_CHECKS.length` instead. Host runs first
deliberately: everything else assumes Docker is usable, and a server with no
Docker should say so before it starts probing a database it may never reach.

**`doctor` with no flags runs every check in the registry, required and
recommended alike, and prints every result.** There is no `--all` flag that
adds the recommended tier — that was this document's own original design and
it did not survive contact with the actual failure mode: a `doctor` that
silently withholds warnings unless asked is a `doctor` whose output looks
clean on a server that is not. What the severity actually gates is the exit
code: `checksPassed()` only consults `required` results, so `doctor` exits
`PRECONDITION` (6) precisely when a `required` check `fail`s, and every
`recommended` failure is a warning that is shown, not hidden, and never
non-zero on its own. `install`/`update`'s own preflight step runs
`requiredChecks(ALL_CHECKS)` — the `required` subset of the *same* list, not
a second one — before touching anything.

A check may declare `requires`, other check ids it presupposes; a `Check`
whose prerequisite did not `pass` is not run at all and reports `skip`
without spending the round trip (see, for example, `database-create-privilege
requires: ['database-credentials']`, or `proxy-conf-writable requires:
['proxy-root']`). `skip` is therefore not merely "not applicable" — it also
means "one of this check's own prerequisites already told you why."

## 10. `proxy.ts`: the shared host proxy and the app's own vhost

`/opt/infra/proxy` is a second, independent Docker Compose project —
**outside this git repository**, living only on the VPS's filesystem — that
this design assumes is either already running (a second app on the same box
deployed it first) or gets bootstrapped by the first `appctl deploy install`
to ever run on a given VPS. It is not part of `infra/compose/` and is not
versioned alongside the application; it is host infrastructure, shared by
every app deployed to that box. `proxy.ts`'s job:

1. **Bootstrap if absent** — check for `/opt/infra/proxy/docker-compose.yml`;
   if missing, write a minimal nginx + certbot compose project (an nginx
   container publishing `0.0.0.0:80` and `0.0.0.0:443`, a `conf.d/` directory
   mounted in for per-app vhosts, a `webroot/` directory mounted in for
   ACME HTTP-01 challenges, a certs volume) and `docker compose up -d` it.
   This is the **only** thing in the whole design that binds a public port —
   everything else in `vps.compose.yml` is loopback-only.
2. **Render the vhost** for this app's domain into
   `/opt/infra/proxy/conf.d/<domain>.conf`, proxying to
   `127.0.0.1:<bound-port>` (the port `vps.compose.yml`'s nginx service
   binds — default `3535`, matching local dev, but distinct per app on a box
   hosting more than one).
3. **Issue the certificate** via certbot's **webroot** method against the
   shared proxy's `webroot/` mount — never the standalone/`--nginx` plugin
   method, because that plugin wants to own nginx's config itself, which
   conflicts with a proxy shared across apps it doesn't know about.
4. **Validate**: run `nginx -t` *inside the proxy container* against the
   newly rendered config before reloading anything.
5. **Reload** (`docker exec <proxy-container> nginx -s reload`) only if
   validation passed.
6. **Roll back** on any failure in 3-4: restore the previous vhost file (or
   remove it, on a first install with nothing to restore to) and leave the
   previous, known-good nginx state serving traffic. A failed cert issuance
   or a bad vhost render must never take down every other app sharing that
   proxy.

Illustrative shape of a rendered vhost (abbreviated — the real template also
carries the standard TLS cipher/protocol hardening lines, omitted here):

```nginx
server {
    listen 80;
    server_name app.example.com;
    location /.well-known/acme-challenge/ { root /webroot; }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl;
    server_name app.example.com;
    ssl_certificate     /etc/letsencrypt/live/app.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3535;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

Note `X-Forwarded-Proto` is set **here**, at the shared proxy — the
in-compose `infra/nginx/nginx.conf` already forwards it onward
(`proxy_set_header X-Forwarded-Proto $scheme` in its own `/api` and `/`
blocks) but is itself sitting behind another proxy on a VPS, so the value it
sees and passes on must originate at the outermost hop, not be invented
partway through. `apps/api/src/main.ts`'s trust-proxy configuration (outside
this document's scope) is what makes NestJS honor it once it arrives.

## 11. The CLI/TUI seam: `DeployHooks`

This is the single most important pattern to get right, and it is not new —
it is `device-login.ts` copied faithfully. `apps/cli/src/device-login.ts`'s
own header states the rule: **nothing in the business-logic module writes
to a terminal.** Everything a human would see is delivered through a hooks
object; `commands/login.ts` renders those hooks as stderr lines and
`tui/screens/login.tsx` renders the identical callbacks as React state. Two
renderers, one sequence, and the sequence is the thing that gets tested.

```ts
export interface DeployStep {
  id: string;            // matches a steps/ module, e.g. 'migrate'
  label: string;          // "Running database migrations"
}

export interface StepResult {
  status: 'ok' | 'skipped' | 'failed';
  message?: string | undefined;
  durationMs: number;
}

export interface DeployHooks {
  onStepStart?: ((step: DeployStep) => void) | undefined;
  onStepResult?: ((step: DeployStep, result: StepResult) => void) | undefined;
  /** A line of subprocess output, already ANSI-stripped. */
  onLog?: ((line: string, level: 'info' | 'warn' | 'error') => void) | undefined;
  /** For a long step (build, migrate) that has no natural sub-steps to report. */
  onProgress?: ((info: { completed: number; total: number }) => void) | undefined;
}
```

`install.ts`/`update.ts` take `hooks?: DeployHooks` exactly like
`runDeviceLogin` takes `options.hooks`, and neither ever calls
`process.stdout.write`/`process.stderr.write` directly — `commands/deploy.ts`
does that, formatting `onLog` as a line and `onStepResult` as a
`✓ Migrated database (2.1s)`-shaped line, following `formatStatusLine`'s
existing precedent in `output.ts`. `tui/screens/deploy.tsx` instead
accumulates `onLog` lines into component state feeding a `ScrollBox`
(section 12) and renders `onStepResult` as a checklist.

## 12. Logging: the run journal

Every invocation of `install`/`update`/`doctor` writes two files under
`<deploy-root>/logs/`: a timestamped human-readable `.log` and a matching
machine-readable `.jsonl`, one JSON object per executed command —
`{ argv, cwd, exitCode, durationMs, stdout, stderr, startedAt }`. Retention
keeps the newest N runs (a small constant, e.g. 20) and deletes older ones
at the start of each run, the same "prune on write, not on a schedule"
approach as nothing needing a cron job.

**Redaction is mandatory and happens before a single byte reaches disk.**
Every value `env-metadata.ts` marks `secret: true` — whether generated by
the wizard or typed by the operator — is collected into a redaction list
once the `.env` is known, and `journal.ts` does a literal substring replace
of each value with a fixed placeholder across every line of captured
stdout/stderr and every recorded `argv`, for both the `.log` and the
`.jsonl`. State the honest boundary of this: it is a substring match against
*known* secret values, not a pattern-based scan — a value `env-metadata.ts`
does not know to be secret (a fork's own newly added credential with no
metadata entry) will not be redacted, because there is nothing to compare
against. This is precisely why section 6 says a fork adding a new secret-ish
key should add a `secret: true` entry: doing so is what makes both masking
*and* redaction apply to it. Console output during a run gets the *rendered*
summary (via `DeployHooks`, already free of raw secret material by
construction — nothing puts a secret value into an `onLog` line in the
first place); the file gets the full captured output, redacted the same
way.

## 13. Deploy state

`<deploy-root>/.appctl-deploy.json` (`state.ts`'s `DEPLOY_STATE_FILENAME`),
**not** `~/.appctl/config.json` — this is a hard requirement, not a style
preference. `writeConfigFile` "replaces the whole file and drops unknown
keys" (`config.ts`'s own words); if deploy state shared that file, the next
`appctl login` on the same VPS (an operator re-authenticating the CLI itself
against the API, entirely unrelated to deploy) would silently erase every
field deploy had written. `state.ts` implements the identical
temp-file-then-rename, mode-`0600`-at-creation pattern `writeConfigFile` uses
(section 6 makes the same requirement for `.env`), for the identical reason:
a crash or a full disk mid-write must leave the previous, valid state file
intact rather than a truncated one that reads as corrupt.

**Version 2** (`DEPLOY_STATE_VERSION`, issue #392, epic #388) is the shape
actually on disk today; see 18.6 for why it grew past the version 1 design
below.

```ts
interface DeployState {
  version: 2;
  repoUrl: string;             // resolved from the checkout's own git remote
  ref: string;
  commitSha: string;           // as of the last successful install/update
  domain?: string;
  bindPort: number;            // what vps.compose.yml bound nginx to, locally
  deployRoot: string;
  installedAt: string;         // ISO 8601, set once, never overwritten
  lastDeployedAt: string;      // ISO 8601, set on every successful run
  lastCommand: 'install' | 'update';
  appctlVersion: string;       // CLI_VERSION at time of write
  previousSha?: string;        // the revision this replaced, for a manual roll-back
  completedSteps?: string[];   // consulted by --resume
  host?: DeployHostFacts;      // see 18.6 — absent when unknown, never guessed
  proxy?: DeployProxyRecord;   // see 18.6 — absent under --skip-proxy or with no domain
  history?: DeploymentRecord[]; // newest first, capped at 20 — see 18.6
}
```

This is narrower than the original version 1 design (no separate `updatedAt`/
`lastSuccessAt` pair; `lastDeployedAt` is both), and a **version 1** file —
everything above except `host`/`proxy`/`history` — is still what every
deployment installed before v2 shipped has on disk. `readState` reads it
forward into the v2 shape rather than refusing it (see 18.6): the three new
sections come out absent, not empty, and the next successful `update` fills
them in.

`status.ts` reads this file (never required to exist — `status` on a
never-installed directory reports that plainly, not as an error, exiting `2`)
and augments it with live data via `health.ts`'s `collectHealth`: `docker
compose ps` per-service state, an immediate `/api/health/ready` poll, a
**separate** frontend probe, migration state reported as its own fact rather
than inferred from the health probe (section 7's step 10 explains why), an
external HTTPS check when `--domain` is given, and — since issue #391, and
only when the deployed `.env` can be read — a sign-in probe reusing
`oauth-check.ts`'s post-deploy layer (18.5). That last one is reported under
its own "Sign-in" heading and **does not affect `status`'s exit code**: a
deployment serving traffic correctly with a misconfigured OAuth client is a
settings problem for a person to fix, not an outage a monitoring script
should page on.

## 14. TUI integration

A new route joins the closed union in `tui/routes.ts`:

```ts
export type Route = 'menu' | 'login' | 'invoke' | 'status' | 'logout' | 'deploy';
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
exactly the failure mode that component exists to prevent. Two things
`ScrollBox` does not do today that this screen needs:

- **`followTail`** — a new prop, off by default (matching the existing
  behavior an operator scrolling old JSON output relies on) but the natural
  default *while a deploy step is actively running*: new log lines should
  keep the viewport pinned to the bottom unless the operator has manually
  scrolled up, at which point auto-follow disengages until they return to
  the bottom. This is genuinely new work, not a trivial prop threading.
- **ANSI-free input, still enforced** — `executor.ts` must strip ANSI
  escapes from captured output before it ever reaches a hook (section 5),
  which is what keeps this a non-issue for `ScrollBox` rather than a second
  place needing the same fix `screens/invoke.tsx`'s existing note about
  colour-run slicing already documents.

**The abort-safety honesty this screen must carry**: unlike
`device-login.ts`'s poll loop, which is safe to abort at any point because
polling has no side effect of its own, a deploy step mid-flight
(`docker compose build`, a migration) is not uniformly safe to interrupt.
`executor.ts` SIGTERMs the child on abort, and `docker compose build`
interrupted mid-layer or a migration interrupted mid-statement can leave a
genuinely partial state. The screen must say so on Esc — a confirmation
naming the risk ("this may leave a partial deployment; re-running install
will resume safely") — rather than implying cancellation is free the way it
is on the login screen. This is the one place this design's "everything is
idempotent, so re-running is always the fix" promise needs a caveat spoken
out loud to the operator at the moment it matters, not buried in this
document.

**The exit-code inversion also matters here.** `tui/index.tsx` today lets a
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

Its whole job, once Phase 0's fixes land in `base.compose.yml` and
`prod.compose.yml` themselves, is the one override that is legitimately
VPS-specific and wrong for local dev: binding nginx to loopback only.

```yaml
services:
  nginx:
    ports:
      - "127.0.0.1:3535:80"
```

Nothing else belongs in this file for the reason above — a VPS-only fact, not
a general production concern — with exactly one addition since: issue #392
(epic #388) also mounts the deploy root read-only into the `api` service and
sets `DEPLOY_STATE_FILE`, so the API container can read the record `appctl
deploy` leaves on disk. That earns its place in this file for the same test
as the loopback binding above — it is true of a shared-proxy VPS deployment
and of nothing else — and is justified at length in `vps.compose.yml`'s own
header comment rather than restated here. See 18.6 and
[`docs/runbooks/deployment-info.md`](../runbooks/deployment-info.md).

## 16. Rejected alternatives

| Alternative | Why it lost |
|---|---|
| **Drive the VPS over SSH from a laptop** | Requires bundling an SSH client/library (`ssh2` or a shell-out to system `ssh`), a private-key or agent-forwarding story, and turns ordinary network flakiness between the laptop and the VPS into deploy failures. The confirmed model instead reuses the operator's own already-authenticated interactive SSH session and never needs a second credential. |
| **Pull pre-built images from GHCR** | `.github/workflows/deploy.yml` already builds and pushes `ghcr.io/<repo>-api`/`-web` on every tag — but its `deploy-staging`/`deploy-production` jobs are literal `echo` stubs, no compose file anywhere uses `image:` (both `api` and `web` are `build:`-only), and consuming a GHCR image from a VPS needs registry credentials staged there too. This is the obvious next integration once `appctl deploy` exists — a `--from-registry` mode that skips the build step — but it is a second, separable piece of work, not part of v1. |
| **A self-contained per-app nginx + certbot** | A VPS hosting one app today is a VPS hosting a second one within a year. Per-app TLS termination means N certbot renewal timers and N nginx processes contending for port 443, with no coherent answer for "what's already bound there" the moment a second app deploys. The shared proxy owns 443 exactly once. |
| **PostgreSQL inside the app stack** | `base.compose.yml` deliberately ships no Postgres service — bundling one here would make the CLI additionally responsible for its backups, volumes, and version upgrades, none of which this repository does for any other stateful dependency (S3/storage is always external too). External-and-validated keeps deploy's blast radius to the stateless tier. |
| **A hardcoded env-var list in the wizard** | The same drift risk `commands/api.ts`'s "one generic command" design exists to avoid — a fork that edits `.env.example` would silently desync from a wizard that doesn't read it. Parsing the file at run time is the only shape that survives a fork's own edits. |
| **A single 34-field TUI form** | Most installs only ever touch the same dozen fields (domain, DB credentials, Google OAuth, admin email); stepping through all 34 including `UPTRACE_ADMIN_PASSWORD` on every single install is exactly the kind of form an operator abandons partway through. The essential-subset-plus-`--all` split targets the common path while keeping the full set one flag away. |

## 17. Suggested phasing (non-binding)

Not the actual issue list — the epic owns that — but a grouping that keeps
each piece reviewable on its own and roughly matches the module boundaries
above, for whoever slices this into the 17 child issues:

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
    real usage exists, fold anything this design got wrong back into it.

This is that follow-up. Section 11's own promise is section 18.

## 18. Epic #388: the container proxy runtime, renewal ownership, and the deployment page

Epic #168 shipped a working `appctl deploy`, and real review of it — not a
real VPS, which section 1 of the runbook is still honest about not having
had, but line-by-line review plus the unit suite — found four defects, all
in the same family: each one is invisible in the common configuration and
real in every other one. This section documents what closed them (issues
#389–#392) and the read-only surface built on top of the result (#393).

### 18.1 Two path spaces, and conflating them is the bug (#389)

The shared proxy is normally a *container*, and certbot is normally run as
one too. Both see the proxy's own directories only through bind mounts:

```
<proxyRoot>/letsencrypt  ->  /etc/letsencrypt      (CONTAINER_CERT_ROOT)
<proxyRoot>/webroot      ->  /var/www/certbot      (CONTAINER_WEBROOT)
```

so every path this tool produces belongs to exactly one of two spaces, and
`apps/cli/src/deploy/proxy.ts`'s own header now states them by name because
the original design (section 10 above) did not distinguish them at all:

- **Host paths** — what *this process* can `stat()`, and what `docker run -v`
  takes on the left of the colon. `livePath()` is the host accessor;
  `certificateStatus()` and the TLS doctor checks `existsSync()` it, correctly,
  because the bytes really are there.
- **Served paths** — what nginx and certbot resolve *inside* the container.
  `servedCertPath()` and `ProxyRuntime.certRoot`/`webroot` are these, and they
  are the only paths that may be written into a vhost or a certbot argv.

Before this fix, `renderVhost` wrote `root <proxyRoot>/webroot` and an
`ssl_certificate` under `<proxyRoot>/letsencrypt` — host paths — directly
into the vhost a *container* was going to load. Neither exists inside that
container, so the ACME challenge 404s and nginx cannot load the certificate.
Separately, a host-run certbot recorded host paths into
`letsencrypt/renewal/<domain>.conf`, which a *containerised* `certbot renew`
cannot follow — it fails with "expected
`/etc/letsencrypt/live/<domain>/cert.pem` to be a symlink" — and renewal
stops silently. Nothing reports that for up to ninety days, which is why
`certificate-renewal-paths` (18.1.1) and `certificate-served` (18.1.2) below
are checks and not just a comment.

**`ProxyRuntime` makes the mode explicit rather than assumed.** It carries
`mode: 'container' | 'host'`, the `container` name (absent in host mode), and
`certRoot`/`webroot` *as nginx and certbot see them* — resolved once, by
`resolveProxyRuntime()`, and threaded through `renderVhost`, `issueCertificate`,
`validateProxy`, `reloadProxy` and — since #391 — `ensureRenewal`
(18.3), so every one of them addresses the same proxy the same way.
`resolveProxyRuntime` never throws: `docker` missing, the daemon unreachable,
no such container or a probe that times out all resolve to host mode, because
a server running a host nginx must never have its install aborted by a probe
it never needed. An explicit `--proxy-mode container`/`--proxy-mode host`
(validated at the flag by `parseProxyMode` — a typo is a usage error, not a
silent fall-through to host paths) always wins over the probe, and
`--proxy-container <name>` states which container to address when it is not
`proxy-nginx`, `DEFAULT_PROXY_CONTAINER`'s default.

**Why container mode is the default, and why host mode makes the bug
invisible.** In host mode there is only one path space — `certRoot` and
`webroot` are both derived from `proxyRoot` directly (`hostProxyRuntime`) —
so a call site that assumed host paths everywhere was *correct* on a
host-mode server and wrong on every containerised one. That is precisely why
the conflation survived review: it worked on the developer's own test setup
and broke on the target one. Container is the default runtime this design
bootstraps (18.2) and the one the doctor checks and the rest of this document
assume unless stated otherwise.

**18.1.1 — `certificate-renewal-paths` (required).** Reads every
`*.conf` under `<proxyRoot>/letsencrypt/renewal/` and fails if any of them
contains `<proxyRoot>` as a substring — a renewal config a containerised
certbot cannot follow — naming the offending file and the exact symlink error
`certbot renew` will produce. Skipped in host mode, where recording the proxy
root is correct, and skipped when no certificate has been issued yet.

**18.1.2 — `certificate-served` (recommended).** Opens a TLS connection to
`127.0.0.1:443` with SNI set to the configured domain, extracts the leaf
certificate nginx is actually serving, and compares it — by PEM identity, not
by expiry date, because certbot only ever writes forward — against the
certificate on disk. A mismatch means a renewal wrote a new file and *nothing
reloaded the proxy*: nginx holds its certificate in memory, so the old one
keeps being served, on a server whose files on disk all look correct, until
the process happens to restart. The remedy is one line —
`docker exec <container> nginx -s reload` in container mode, `nginx -s
reload` in host mode — and the check names the exact command for the runtime
it detected. Never fails, only warns or skips: a server that cannot reach its
own 443 (a firewall, no `openssl`, the proxy bound elsewhere) says nothing
about whether the deployment is correct, only about this probe.

### 18.2 Why the bootstrapped proxy runs in the host network namespace

`docs/deployment/vps.md` told operators, since epic #168 shipped, that "if
this is the first app on this box, install bootstraps this for you" — and
until `proxy-bootstrap.ts` (#391), nothing implemented it: the `proxy-root`
doctor check simply failed as `required` and the pipeline stopped, which was
a documented promise the tool did not keep.

`bootstrapProxy()` writes a small nginx + certbot-adjacent compose project at
`<proxyRoot>` — `nginx/conf.d`, `nginx/snippets`, `letsencrypt`, `webroot`,
one default vhost answering only the ACME challenge and closing (`444`)
everything else — and brings it up with `docker compose up -d`. **The nginx
service runs with `network_mode: host`, and that is load-bearing rather than
a convenience.** Every vhost `renderVhost` writes proxies to
`http://127.0.0.1:<bindPort>`, because that is where `vps.compose.yml` binds
*this application's own* nginx — loopback only, on the host. Put the proxy
container on Docker's default bridge network instead, and `127.0.0.1` inside
that container is the *proxy container's own loopback*, not the host's: the
vhost renders, `nginx -t` validates it, the reload succeeds, and every
request 502s forever, with nothing in the pipeline's own output pointing at
why. Host networking is also what lets the bootstrap publish 80 and 443 with
no `ports:` list at all — one would be ignored under `network_mode: host`, so
there isn't one — and it is deliberately the *only* place in this whole
design that binds a public port.

**An existing proxy root is never touched, under any circumstance.**
`proxyRootPresent()` is the entire gate: if `<proxyRoot>` exists, `install`
treats it as belonging to whichever application got there first and stops,
full stop — no merge, no repair, no "does this look right" check. The
multi-app model this proxy exists to serve depends on that: rewriting the
compose file, the default server block or the mounts underneath a proxy that
is already serving somebody else's site takes every one of those sites down,
at the moment a completely unrelated deployment happened to run. Because
provisioning host infrastructure and binding public ports is the one thing
in this whole tool that is not reversible by re-running install, it **asks
first** — `--bootstrap-proxy` states the answer up front, and
`--non-interactive` with no `--bootstrap-proxy` is a `UsageError` naming the
flag rather than a silent decision either way.

### 18.3 Renewal ownership (#390, #391)

A certificate nobody renews is a ninety-day timer on an outage, and the
original design (section 10) never asked *who* renews it on a server this
tool did not bootstrap the proxy for. Two things closed that gap.

**`findRenewalOwner()` (`checks/tls.ts`) is the one probe**, called by both
the `certificate-renewal` doctor check and `ensureRenewal` (install's own
renewal step) — never reimplemented, so the answer an operator is shown and
the answer install acts on cannot disagree. It checks, in order: a
`certbot.timer` systemd unit that is enabled; `/etc/cron.d/certbot`; and a
central renewal script (`RENEWAL_SCRIPT_PATHS`, plus `<proxyRoot
>/renew-certs.sh`) that is *both* present on disk *and* invoked by an
uncommented line in root's crontab. Both halves of that last case are
required deliberately: a script nobody's crontab calls is not a schedule, and
a `#`-commented crontab line is not an owner — reporting either as "renewal
is handled" is the single most expensive way this check could be wrong,
because the obvious response to a *correct* "no renewal found" warning is to
install a second one, and two schedules renewing the same
`letsencrypt/live` tree spend a Let's-Encrypt rate-limit budget counted *per
registered domain*, shared with every other subdomain on the box.

**`ensureRenewal()` (`renewal.ts`) stands down when `findRenewalOwner`
returns anything at all.** Only when nothing owns renewal does it write
`/etc/cron.d/certbot` (mode `0644` — cron refuses to run a group-writable
file in `/etc/cron.d` and says nothing about why), twice daily at an odd
minute (`17 3,15 * * *` — twice because a thirty-day renewal window makes one
missed run matter more than it should; odd because every certbot client on
earth renewing at midnight is a load spike Let's Encrypt asks people not to
create). The installed command is `certbot renew --quiet && nginx -t &&
nginx -s reload` (containerised or not, per the resolved `ProxyRuntime`),
chained with `&&` on purpose: a reload only runs after both a successful
renewal *and* a config that still validates, because reloading a proxy whose
configuration does not validate is how one application's bad renewal becomes
every application's outage. `ensureRenewal` never throws — a server where
`/etc/cron.d` cannot be written has a real problem worth reporting, but not
one worth turning an otherwise-successful `install` into a failure over — and
`--skip-renewal` opts out of the whole step for an operator who wants to
manage it by hand.

### 18.4 `gh` and the database privileges: prerequisites install could not yet see

Two checks fill a gap doctor had no answer for.

**`gh-installed`/`gh-authenticated` (`checks/gh.ts`) are `recommended` with a
`fail` the check itself promotes**, not a hardcoded severity, because `gh` is
a prerequisite of *one* deployment — a private repository, reached over
`https`, on a server with no credential for it — and irrelevant to every
other one (a public repository, or an `ssh` remote backed by a deploy key).
`assessCredentialNeed()` answers with `git ls-remote --exit-code
--heads <url>` under `GIT_TERMINAL_PROMPT=0` — asking the actual question
rather than inferring it, and never blocking on a hidden username prompt —
and only an `https` URL git cannot already read promotes the check from
`warn` to `fail`. Nothing in this file names a forge, an owner or a
repository, matching `repo.ts`'s own guard: the promotion keys off the URL's
*shape*, not its host, so a fork on any forge behaves identically and the URL
itself — which may carry an embedded token — never reaches a `detail`, a
`remedy` or a log line, only the yes/no conclusion drawn from it.
`prepareGitCredentials()` is the acting half, called once before the first
clone: when a credential is genuinely needed and `gh` is authenticated, `gh
auth setup-git` configures git to use it; every other outcome (`not-needed`,
`unavailable`, `failed`) changes nothing and lets the clone fail — or
succeed — on its own terms, because `repo.ts`'s own checkout step already
turns an authentication failure into an actionable message.

**`database-create-privilege` (`checks/database.ts`, `recommended`)**
answers, before an install starts, whether the remedy `database-exists`
already prints (`createdb`) is even available to the configured role. It
reads `pg_roles` for `rolsuper OR rolcreatedb` against the `postgres`
maintenance database — inspection only, never a database actually created,
because checks are read-only by rule and a leftover probe database would be
worse than no check at all. A managed PostgreSQL far more often than not
hands out a role with neither, which is exactly the situation 18.5's
create-database prompt exists to route around cleanly rather than fail
confusingly mid-migration.

### 18.5 The database-creation prompt (#391)

`database-exists` already told an operator to run `createdb` for a missing
database; `ensureDatabase()` (`database.ts`) is what offers to run it — and
the reason it *asks* rather than acting is the interesting part, not the SQL.
"The database does not exist yet" and "you pointed `POSTGRES_DB` at the
wrong name" are **indistinguishable from the outside**: both present as
Postgres error `3D000`. Create it silently on either interpretation and a
typo produces a second, empty database that migrates cleanly, seeds cleanly,
and reports healthy — the operator's first evidence that anything is wrong
is an application with none of their data, sitting beside the real database
nobody touched. Only the person answering the prompt can tell those two
situations apart, so `ensureDatabase` is called only when
`classifyDatabase()` (reading the *same* `database-reachable`/
`database-credentials`/`database-exists` results the install pipeline's own
preflight already produced, not a second probe that could disagree) returns
`missing` — reachable, credentials good, database absent, the one case where
creating is even a candidate remedy.

Three rules, all non-negotiable, mirror `psql`'s own contract in
`checks/database.ts`: the password never appears in an argv (`PGPASSWORD` is
passed by name, its value only in the child's environment); the database
name is validated against a plain-identifier pattern and *then* quoted —
`CREATE DATABASE` takes an identifier, not a bind parameter, so there is no
placeholder to hide behind, and a name that is not a plain identifier is
refused outright rather than escaped; and this module has exactly one SQL
statement, `CREATE DATABASE`, and nothing here ever drops or alters anything
that already exists. `--create-database` states the answer up front;
`--non-interactive` with no `--create-database` is a `UsageError` explaining
exactly why it will not guess.

### 18.6 State file v2, and the read-only view built on it (#392, #393)

**The shape.** `DeployState` grew three optional members — `host`, `proxy`,
`history` — documented in full in section 13 above. All three exist because
this file stopped being the CLI's own private bookkeeping the moment
`/api/admin/deployment` (18.6.2) started reading it: "which machine is this,
behind which proxy, and what has run here" has to be written down by the one
process that actually knows it — `appctl`, at deploy time — because nothing
else on the server can reconstruct it afterwards (`git log` in the checkout
cannot say *when* a deploy ran, whether it succeeded, or which version of
`appctl` ran it). `collectHostFacts()` never throws and never lets one failed
probe cost the rest: every field is collected independently, and a probe
that cannot answer records the literal string `"unknown"` rather than
dropping its key, so the shape served to the API does not vary with how much
of the host happened to be readable. `publicIp` is the one exception — it is
read from the local routing table only, **never** from an outbound call to an
IP-echo service (a surprising, unannounced network request for a deploy tool
to make, and one that fails outright on an air-gapped host), so behind NAT
the field is simply absent rather than populated with a LAN address that
would misleadingly look like an answer.

**No secret may ever enter this file**, and as of v2 that is a security
property rather than a style preference: the file was always `0600` and
always described infrastructure, but v2's contents are now served over HTTP
and rendered in a browser. `state.test.ts` enforces this structurally, not by
spot check: it builds a value for every key the env-metadata registry knows
to be `secret: true`, seeds the journal's redactor from it, runs that
redactor over a written state file, and asserts the file is byte-identical —
so adding any new field to `DeployState` that happens to hold something
secret-shaped fails the test and forces the question of whether it belongs
in a document this application serves to a browser at all.

**The v1 upgrade is total, not partial.** `readState()` reads a
`version: 1` file forward into the v2 shape (`upgradeFromV1`, field by field,
never a spread) rather than refusing it — a plain `!== DEPLOY_STATE_VERSION`
check would have greeted every server deployed before this shipped with
"remove the file to re-install," over three fields it never had reason to
write. The three new sections come out **absent**, never empty: `history: []`
would claim "this deployment has no past" when the truth is "nothing was
keeping one," and the next successful `update` fills all three in for good.
A version from the *future* is still refused outright — reading it forward
would be a guess about fields this build has never seen, and misreading a
state file means reporting the wrong commit as deployed.

**18.6.1 — `GET /api/admin/deployment`** (`apps/api/src/deployment/`,
`deployment:read`) is the read-only endpoint this all serves. It answers
`200` even when there is no deployment record — every developer laptop, every
CI run and every plain `docker compose up` not driven by `appctl deploy`
legitimately has none, and that is the ordinary case, not a fault; a `404` or
`503` there would make "this is a local dev box" indistinguishable from "the
admin API is broken." `configured: false` plus `source.reason` — `not-found`
(nothing to read, the ordinary case off a VPS), `unreadable` (the path exists
but cannot be read — a permission problem, or a bind mount that produced a
directory instead of a file) or `invalid` (bytes were read and are not a
deployment record) — is the answer instead, following the same "status code
is not the answer, the body is" posture as the database-backup and
storage-config probes elsewhere in this application. `runtime` — this
process's own API version, start time, Node version and *container*
hostname, never the *host's* hostname, which lives at `deployment.host
.hostname` when a v2 record has one — is present on every response, because
the process can always describe itself regardless of whether the deploy
record can be read. The state file is untrusted input parsed through
`deploy-state.schema.ts`'s Zod discriminated union (unknown keys stripped,
strings bounded, a history array over 200 entries refused outright as
`invalid` — a memory bound on untrusted input — while anything from 21 to
200 parses fine and is *truncated* to the newest 20 by `DeploymentService`
afterward, because refusing a list a newer, more generous `appctl` legitimately
wrote would be this reader enforcing what the writer should have written
rather than what it will actually serve), because the file was written by a
different program, possibly a different version of it, on a host whose
filesystem anything with deploy-root write access can alter.

The full permission rationale (why `deployment:read` and not a reuse of
`system_settings:read`, and why there is no `deployment:write`) is documented
once, in `apps/api/src/common/constants/roles.constants.ts`'s own comment
beside the constant — read it there rather than here.

**18.6.2 — the mount, and why it is the deploy root and not the file.** See
section 15's note above and, for the full mechanics and the operator
consequence, [`docs/runbooks/deployment-info.md`](../runbooks/deployment-info.md).
In one sentence: `install.ts` calls `writeState()` *after* the stack is
already up, so on a first install the state file does not exist when
`vps.compose.yml`'s bind mount is created, and mounting the *file* directly
would either fail outright or pin the container to a stale inode past every
future `writeState()` rename — mounting the *directory* is what makes both
problems not exist.

**18.6.3 — `/admin/settings/deployment`**, the admin page. One card in
`ADMIN_SECTIONS`' `Operations` group (Settings UI Pattern rule 1), gated on
the literal `deployment:read` the controller enforces (rule 3), a separate
destination rather than a tab (rule 2), built on the shared `SettingsHub`
(rule 4). Its empty state carries as much weight as its populated one — see
CLAUDE.md's "Operations Admin Settings Group" section and
`docs/runbooks/deployment-info.md` for the operator-facing detail; this
document's job is the mechanism underneath, not the page.

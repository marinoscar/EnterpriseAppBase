# Runbook: Deploy to a VPS

This runbook covers taking a single Ubuntu VPS from nothing to a running,
migrated, seeded, HTTPS-served deployment of this application using `appctl
deploy`, and keeping it current afterward. It is the operator-facing
companion to [`docs/specs/vps-deploy.md`](../specs/vps-deploy.md): that
document explains why `appctl deploy` is built the way it is (why the CLI
never dials out over SSH, why TLS is terminated by a shared proxy instead of
per-app, why there is no `db` service, what was rejected and why); this one
tells you what to actually run, in order, on a real box. Read the spec first
if something here doesn't make sense — it almost certainly has the "why."

Source of truth for every claim below:

- `apps/cli/src/deploy/checks/` — the ~31 doctor checks across `host.ts`,
  `gh.ts`, `database.ts`, `dns.ts` and `tls.ts`, run standalone by `doctor`
  and as the required-only preflight of `install`/`update` — one registry,
  never a second list that could drift from it.
- `apps/cli/src/deploy/install.ts` — the install pipeline.
- `apps/cli/src/deploy/update.ts` — the update pipeline, its re-seed default,
  and why there is no automatic rollback.
- `apps/cli/src/deploy/health.ts` — what `status` reports, the frontend
  probe kept separate from `/api/health/ready`, and the sign-in probe added
  by issue #391.
- `apps/cli/src/deploy/proxy.ts` — the shared reverse proxy, the two path
  spaces (host vs. served) a container-mode proxy resolves through, vhost
  rendering, and certbot issuance (rate-limit handling included).
- `apps/cli/src/deploy/proxy-bootstrap.ts` — standing the shared proxy up
  from nothing, and why it runs in the host's own network namespace.
- `apps/cli/src/deploy/renewal.ts` — deciding whether anything already owns
  certificate renewal, and scheduling it only when nothing does.
- `apps/cli/src/deploy/database.ts` — the create-the-database prompt, and why
  it asks instead of acting.
- `apps/cli/src/deploy/oauth-check.ts` — the pre-install credential probe
  against Google (`invalid_grant` is the pass) and the post-deploy wiring
  smoke test `status`'s "Sign-in" section reports.
- `apps/cli/src/deploy/repo.ts` — resolving the repository and ref from the
  checkout's own git remote, with no fork-specific configuration anywhere.
- `apps/cli/src/deploy/journal.ts` — the run log and its redaction guarantee.
- `apps/cli/src/deploy/env-metadata.ts` — which environment variables are
  derived (`GOOGLE_CALLBACK_URL`, `APP_URL`), which are secrets, and which are
  essential.
- `apps/cli/src/deploy/state.ts` — the deploy state file (version 2: `host`,
  `proxy`, `history`), read by `apps/api/src/deployment/` for
  `/admin/settings/deployment` — see
  [`docs/runbooks/deployment-info.md`](../runbooks/deployment-info.md).
- `infra/compose/vps.compose.yml` — the loopback-only overlay a VPS deploy
  adds on top of `base.compose.yml` + `prod.compose.yml`, and the read-only
  deploy-root mount that feeds the admin deployment page.
- `apps/api/prisma/seed.ts` — the idempotent seed `install` and `update` both
  run; what it writes and, just as important, what it does not.
- `apps/api/src/health/health.controller.ts` — `/api/health/ready`, and why a
  green result there is not evidence a migration ran.
- `apps/cli/README.md`, section "Deploying to a server" — the command
  reference (flags, exit codes) this runbook assumes you have open alongside
  it.

**The full install has not been run end to end against a real VPS.** The
environment this was built in has no Docker daemon, so there has been no
opportunity to run `appctl deploy install` against an actual server with real
DNS and a real Let's Encrypt certificate. That was true when this runbook was
first written and it is **still true** after the container-proxy-runtime,
renewal-ownership and installer work in epic #388 — none of it changes what
could actually be exercised in this environment. What backs the claims in
this document, precisely: the unit test suite for every module listed above
(including the doctor checks, both pipelines, the proxy/certificate logic,
the proxy bootstrap, the renewal-ownership probe, the database-creation
prompt and the OAuth check — each has its own `*.test.ts`), `docker compose
-f base.compose.yml -f prod.compose.yml -f vps.compose.yml config` validating
cleanly, and a real `appctl deploy doctor` run. What that does **not**
include: an actual `install` against a real server, a real Let's Encrypt
certificate (staging or production), a real proxy bootstrap binding real
ports 80/443, a real renewal firing on its schedule, or the admin deployment
page rendering a state file written by a real install rather than one
constructed in a test. Treat the first real install on a new box as the
first true end-to-end exercise of this entire path, and lean on `doctor` and
`--staging` (section 8) accordingly.

---

## 1. Prerequisites

`appctl deploy doctor` checks all of the following, and running it is the
intended first step — before you've written a line of configuration, before
you've touched the shared proxy, before anything. Don't hand-verify this list
yourself; let doctor do it, and fix whatever it reports.

- An Ubuntu VPS you have root SSH access to.
- Docker Engine, with the **Compose v2 plugin** (`docker compose`, not the
  standalone `docker-compose` v1 binary — see the troubleshooting table).
- git and Node.js on the server, to clone the repository and build `appctl`.
- **The GitHub CLI (`gh`), authenticated — but only when it actually matters.**
  `doctor`'s `gh-installed`/`gh-authenticated` checks are `recommended`, not
  `required`, and only turn into a genuine failure in one situation: the
  repository you're deploying is cloned over `https` and this server has no
  credential for it already (`git ls-remote` fails unaided). A public
  repository and an `ssh` remote backed by a deploy key both need nothing
  from `gh` at all, and the checks say so as a warning rather than blocking
  you. If you do need it: `gh auth login`, once, before running `install` —
  the install pipeline calls `gh auth setup-git` itself so the clone picks up
  the credential with no further steps from you.
- A shared reverse proxy at `/opt/infra/proxy`, with `nginx/conf.d` and its
  ACME webroot both writable. **If this is the first app ever deployed to
  this box, `install --bootstrap-proxy` genuinely stands one up for you** —
  a minimal nginx + certbot-adjacent compose project, running in the host's
  own network namespace (not a bridge network — see the spec if you're
  curious why that specific detail matters), that then also serves any later
  app deployed to the same box. Under `--non-interactive` you must pass
  `--bootstrap-proxy` explicitly; interactively, `install` asks before doing
  it, because binding ports 80 and 443 on a shared server is not something a
  stray Enter should do. **If a different app got here first, its proxy
  already exists and `install` never touches it** — not to merge, not to
  repair, not even to check it looks right. That directory belongs to
  whichever application bootstrapped it first, full stop.
- certbot, for Let's Encrypt certificate issuance via the proxy's webroot —
  not needed at all when the proxy runs containerised (the default), because
  issuance then runs `certbot/certbot` as a one-off container instead.
- A DNS **A record** for your domain, already pointing at this server's
  public IP, before you run `install` — the certificate can't be issued
  otherwise, and issuance failures spend real rate-limit budget (section 8).
- An **external PostgreSQL** database, reachable from this server, with
  working credentials. This application ships no `db` service —
  `base.compose.yml` deliberately has none — so you are responsible for
  standing one up (managed or self-hosted) before you install. **The
  database itself does not have to exist yet**: if it's missing, `install`
  offers to create it (`--create-database`, or interactively) — see section 2
  below for why that's a prompt rather than something it just does. A role
  with `CREATEDB` makes that offer usable; `doctor`'s
  `database-create-privilege` check tells you in advance whether yours has
  it (most managed Postgres offerings don't, by default).
- Google OAuth credentials whose **redirect URI matches
  `https://<domain>/api/auth/google/callback`** — the exact domain you're
  about to deploy under, not a placeholder. `install` checks these against
  Google itself before building anything (section 2) — see the
  troubleshooting table if you're staring at a check reporting
  `invalid_grant` and wondering why that counts as a pass.

```bash
appctl deploy doctor
appctl deploy doctor --domain app.example.com
```

Nothing is installed, written, or started by `doctor` — it's read-only, so
it's safe to run against a production server at any time, not just before a
first install. Run it plain first; add `--domain` once you know what domain
you're deploying to, which turns on the DNS and certificate checks.

## 2. Installing for the first time

`appctl deploy` has no SSH client and never dials out to a server on your
behalf — you SSH in yourself, with your own credentials, and everything below
runs **on the VPS**.

1. **SSH into the VPS.**

2. **Clone the repository you want to deploy** (your fork, if you have one —
   see section 6) and build `appctl` from source:

   ```bash
   git clone <your-repo-url>
   cd <your-checkout>
   npm install --workspace=cli
   npm run build --workspace=cli
   node apps/cli/dist/cli.js deploy doctor
   ```

   You need a real git checkout here, not the standalone `appctl` the
   `curl | bash` installer in the main [CLI README](../../apps/cli/README.md)
   produces — `deploy install` reads its default repository URL and ref from
   *this checkout's own git remote* (section 6), and a standalone install has
   no remote to read. If `~/.local/bin` is already on your `PATH` from an
   earlier `appctl` install, the plain `appctl` command works the same as
   `node apps/cli/dist/cli.js` from here on; this runbook uses `appctl` for
   brevity.

3. **Run `doctor`** (as above) and fix everything it reports before going
   further. A required failure here is cheaper to fix now than mid-install.

4. **Run `install`:**

   ```bash
   appctl deploy install --domain app.example.com
   ```

   This is interactive by default: it walks you through the essential
   environment variables (database credentials, JWT/cookie secrets — offering
   to generate the ones that can be generated, Google OAuth credentials,
   `INITIAL_ADMIN_EMAIL`) with sensible defaults, then runs preflight,
   checkout, environment collection, validates the database and the OAuth
   credentials, creates the database if you agree it should (below), builds
   the images, migrates, seeds, starts the stack, waits for health, stands up
   the shared proxy if this box has none, issues the certificate and
   publishes the vhost, schedules certificate renewal if nothing already owns
   it, and finally verifies the result over real HTTPS — printing each step's
   result as it completes. `--domain` is the one required flag; everything
   else — `--root` (default `/opt/infra/apps`), `--proxy-root` (default
   `/opt/infra/proxy`), `--port` (default `3535`) — has a workable default.

   **Two of those steps ask before acting, and neither guesses under
   `--non-interactive`:**

   - **Creating the database**, when it doesn't exist yet. A typo in
     `POSTGRES_DB` looks *exactly* like a database that hasn't been created —
     both fail the same way, and only you can tell the two apart. Answer yes
     (or pass `--create-database` up front) and `install` runs a single
     `CREATE DATABASE`, nothing else, against the maintenance database; answer
     no, or don't pass the flag under `--non-interactive`, and `install` stops
     naming `POSTGRES_DB` and the `.env` path so you can check it by hand.
   - **Bootstrapping the shared proxy**, covered in section 1 above
     (`--bootstrap-proxy`).

   The **OAuth credentials are checked against Google itself** before
   anything is built — a POST to Google's token endpoint with a deliberately
   invalid authorization code. `invalid_client` means the credentials are
   wrong and stops the install; `invalid_grant` means they're **right** — the
   client authenticated and only the made-up code was rejected, which is
   exactly what this check is trying to provoke. Nothing is issued, nothing
   is consumed, no browser or user is involved, and if the check can't reach
   Google at all (an egress-filtered server, a Google outage) that's a
   warning, never a reason to stop the install.

   **Renewal is scheduled only when nothing already owns it.** If this
   server already renews its certificates some other way — a systemd timer,
   an existing cron entry, a central renewal script your box already runs —
   `install` finds that (the exact same probe `doctor`'s `certificate-renewal`
   check uses) and deliberately schedules nothing of its own: two schedules
   against the same certificate tree isn't redundancy, it's two processes
   spending a rate-limit budget that Let's Encrypt counts per registered
   domain, shared with every other subdomain on the box. Only when nothing
   owns it does `install` write a twice-daily entry to `/etc/cron.d/certbot`
   that renews **and then reloads** the proxy — the reload is the half that
   matters, because a renewal that writes a new certificate and reloads
   nothing leaves the old one being served until the process restarts (see
   the troubleshooting table's "served vs. on disk" row). `--skip-renewal`
   opts out of this step entirely if you'd rather manage it yourself.

   For a scripted or first-time-nervous install, add `--staging` (section 8)
   and/or `--non-interactive` (which fails, listing what's unresolved,
   instead of prompting — useful once you already know every value you want
   to pass, or want a `.env` prepared ahead of time).

   **Object storage is deliberately not part of this wizard, or of `.env` at
   all.** Older checkouts of this template asked for `S3_BUCKET`/
   `S3_REGION`/`S3_ENDPOINT`/`STORAGE_PROVIDER` here; epic #372 retired all
   of them. A freshly installed deployment boots with no object storage
   configured and answers every upload, avatar, job-artifact and
   database-backup request with a `503` until an administrator signs in and
   configures a provider at `/admin/settings/storage` — which needs no
   restart and no redeploy. See
   [`docs/runbooks/storage-configuration.md`](../runbooks/storage-configuration.md)
   for that first-time setup, done once `install` has finished and you have
   logged in per section 3 below.

5. **If it fails partway through**, fix whatever it reported and run the
   *same command again* — `install` is idempotent, and each step is safe to
   re-run. Add `--resume` to skip straight to the step that failed rather
   than re-checking everything before it.

6. **Once it succeeds**, do not treat a clean `install` as "the site is
   live and correct" until you've done section 3 — the seed does not create
   anyone who can log in.

Full flag reference and exit codes: [`apps/cli/README.md`, "Deploying to a
server"](../../apps/cli/README.md#deploying-to-a-server).

## 3. After install: the first login (do this before anything else)

**A successful `install` does not create an admin user, or any user at
all.** The seed (`apps/api/prisma/seed.ts`) writes an **allowlist row** for
`INITIAL_ADMIN_EMAIL` — the same mechanism the "Access Control: Email
Allowlist" section of the root `CLAUDE.md` describes for local development —
and nothing more. Nobody is an admin, and nobody has an account, until that
exact email address completes Google OAuth login at `https://<domain>`.

If you skip this step and go looking for why the admin panel is empty or why
nobody can do anything privileged, you will not find a bug — you'll find a
correctly-installed application with no users. So:

1. Open `https://<domain>` in a browser.
2. Log in with Google, using the exact address configured as
   `INITIAL_ADMIN_EMAIL` during the environment wizard.
3. This creates the account and grants it the **admin** role, the same
   first-login bootstrap local development relies on.
4. From there, use the admin panel (`/admin/settings/users`, Allowlist tab)
   to add every other address that should be able to log in — the allowlist
   restricts access to pre-authorized emails only, and `INITIAL_ADMIN_EMAIL`
   is the only address the seed adds automatically.

## 4. Checking status and health

```bash
appctl deploy status
appctl deploy status --domain app.example.com
```

`status` reports container state, an immediate `/api/health/ready` poll, a
**separate frontend probe**, and — this is the part worth understanding, not
just running — migration state reported on its own, not inferred from the
health probe.

**`/api/health/ready` returning 200 only proves the app can run `SELECT 1`
against the configured database.** It passes against a completely empty,
unmigrated database exactly as readily as a fully migrated one, because
that's all the underlying check does. Nothing about a green readiness probe
tells you the schema is current. This is precisely why `status` reports
"Migrations: up to date" / "N pending" / "could not be determined" as its own
line, and why the install/update pipelines treat their own migrate step's
exit code — not the later health wait — as the only real evidence a
migration ran.

The frontend gets its own probe for the same kind of reason: the API can
answer every request correctly while the site itself 502s, if the web
container's own nginx and the shared proxy's upstream ever disagree about
which port to talk on (see the troubleshooting table's last row). A single
"healthy: true/false" that only checked the API would hide that class of
failure completely.

```bash
appctl deploy status --json || alert 'deployment unhealthy'
```

Exit codes: `0` serving and schema current, `1` installed but unhealthy, `2`
nothing installed at `--root`. The distinct exit `2` matters for monitoring —
"nothing is installed here" and "something is installed and broken" need
different alerts.

## 5. Updating

```bash
appctl deploy update
```

Fetches, and if the resolved ref's commit has moved, rebuilds, migrates,
re-seeds, restarts, and re-verifies. `update` refuses outright if nothing is
installed at `--root` — run `install` first.

**If the revision hasn't moved, `update` exits `0` and does nothing else** —
no rebuild, no restart, no seed. That's what makes it safe to run
unattended, for example from cron:

```cron
# Check for a new release every night at 03:00, do nothing if there isn't one
0 3 * * * cd /opt/infra/apps/repo && appctl deploy update --non-interactive >> /var/log/appctl-update.log 2>&1
```

Two behaviors are worth knowing before your first `update`, because both are
deliberate and both surprise people who've operated the shell-script
deployments this replaces:

**The seed re-runs by default, on every update.** `apps/api/prisma/seed.ts`
is entirely upserts, and re-running it is the *only* way a permission or role
row a newer release adds actually reaches a server that was installed
earlier. Skip it, and a release that ships a new permission does nothing on
your server — the feature ships, the permission doesn't exist in your
database, and the first symptom is a confusing 403 with nothing in the logs
pointing at "you needed to re-seed." The shell scripts this replaces never
re-seeded; this is a deliberate change, not an oversight. Pass `--skip-seed`
only if you've hand-edited seeded rows (a role's permission set, say) and
don't want them upserted back to their defaults.

**There is no automatic rollback.** A partly-applied database migration
can't be safely undone by checking out the old application code — that's a
decision that needs a human looking at what actually happened, not a
heuristic guessing at it. On failure, `update` prints the previous revision
and the exact command to redeploy it:

```bash
appctl deploy update --ref <previous-sha> --force
```

`--force` is what makes that command work even though the "ref" you're
moving to is technically older than what's currently checked out — without
it, `update` would see the ref hasn't "moved forward" in the way it expects
and do nothing.

Full flag reference: [`apps/cli/README.md`, "Deploying to a
server"](../../apps/cli/README.md#deploying-to-a-server).

## 6. Deploying a fork

You do not need to change anything in this CLI to deploy a fork, and that
property is worth understanding rather than just trusting.

`appctl deploy install`/`update` read the repository URL and ref from **the
checkout you ran them from** (`repo.ts` walks upward from the current
directory looking for `.git`, then reads `git remote get-url origin` and the
current branch) — not from a value hardcoded anywhere in `apps/cli`.
`--repo`/`--ref` override the detected values when you need to, but the
default is always "whatever this checkout points at." The environment
wizard's questions are parsed structurally from **your checkout's own**
`infra/compose/.env.example`, not from a fixed list of field names baked into
the CLI — rename the application, add a new secret, remove the Microsoft
OAuth block, switch your default branch to `develop`, and the wizard follows
all of it with no CLI change. The only two places a fork edits by hand are
outside `appctl deploy` entirely: the `bin` field in `apps/cli/package.json`
and `install.sh`'s default clone URL, both documented in the CLI README's
"Renaming this for a fork" section — neither is part of the deploy path.

In practice: clone your fork on the VPS (step 2 of section 2), build `appctl`
from *that* checkout, and run `deploy install` from inside it. It deploys
your fork, at your fork's default branch, asking about your fork's own
environment variables, automatically.

## 7. Logs

Every `doctor`, `install`, and `update` run writes two files under
`<deployRoot>/logs/`: a timestamped human-readable `.log` and a matching
machine-readable `.jsonl` (one JSON object per executed subprocess:
`argv`, `cwd`, `exitCode`, `durationMs`, captured `stdout`/`stderr`,
`startedAt`). Both are written mode `0600`, and only the newest ten runs are
kept — older ones are pruned at the start of each new run.

**Every value the CLI knows to be a secret is redacted from both files
before a single byte reaches disk** — whether you typed it during the wizard
or the wizard generated it. This is what makes it safe to attach a `.log` to
a support request or a GitHub issue without a second pass to scrub it by
hand. The honest boundary: redaction is a substring match against *known*
secret values (the ones `env-metadata.ts` marks `secret: true`), not a
pattern-based scan of the output — a value your fork's own `.env.example`
introduces with no corresponding metadata entry won't be recognized as a
secret and won't be redacted. If you add a new secret-shaped variable to a
fork, add a `secret: true` entry for it in `env-metadata.ts` so both masking
and log redaction pick it up.

## 8. Using Let's Encrypt staging while you work out the setup

```bash
appctl deploy install --domain app.example.com --staging
```

`--staging` requests a certificate from Let's Encrypt's **staging**
environment instead of production. The certificate it issues won't be
trusted by a real browser, but the whole rest of the pipeline — DNS,
webroot, vhost rendering, `nginx -t` validation, reload — runs identically,
so it's the right way to work out a first install's kinks.

The reason this matters more than it might look: a **failed** production
issuance spends real, shared rate-limit budget — five failures per hostname
per hour, and 50 certificates per registered domain per week, shared with
*every* subdomain on that server, not just this one app. Burn through that
debugging a typo'd DNS record on your first attempt, and you (and anyone else
deploying to the same box) are locked out of real certificates for the rest
of the week. Use `--staging` until `doctor --domain <yours>` and a full
`install --staging` both come back clean, then run `install` again without
the flag for the real certificate — `install` skips issuance entirely when a
usable certificate already exists, so re-running costs nothing if staging
already got you a (test) one.

## 9. Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| Certificate issuance fails during `install` | The domain's DNS doesn't actually point at this server. | `doctor --domain <domain>` runs `dns-resolves` and `dns-points-here` specifically for this — the failure names both addresses (what the domain resolves to, and what this server's own address is) so a CDN or a stale record is obvious at a glance. |
| Login redirects loop, or Google rejects the callback | `GOOGLE_CALLBACK_URL` disagrees with the domain you're actually serving. | `GOOGLE_CALLBACK_URL` is **derived automatically** from the domain you gave during install (`https://<domain>/api/auth/google/callback`) unless you deliberately overrode it in the wizard's `--all` review. If you're seeing this, something overrode the derived value — check the deployed `.env` and either fix it there or re-run the wizard for that key. |
| Migration step succeeds, but the app can't connect to the database afterward | `POSTGRES_PASSWORD` contains a URL-reserved character (`@`, `:`, `/`, `#`). | Fixed for new deployments (issue #172) — the database URL is now built in one place and the password is percent-encoded. An **older** deployment predating that fix, or a hand-edited `.env`, can still hit this. Either change the password to avoid those characters or confirm your checkout includes the fix. |
| `install`/`doctor` reports the loopback port is already in use, by something that isn't this deployment | Another app on the same VPS is already bound to that port. | Pick a different port for this app with `APP_BIND_PORT` in its `.env` (or `--port` during install), or stop whatever's holding the port. `doctor`'s `bind-port-free` check is written to *not* flag this app's own already-running nginx as a conflict — a false positive here means it's genuinely something else. |
| Repeated `install` attempts start failing with a rate-limit error from Let's Encrypt | You burned the hourly/weekly certificate budget on earlier failed attempts (section 8). | Wait — retrying immediately makes it worse. Use `--staging` for everything except the attempt you actually intend to keep. |
| `docker compose` commands fail as if the command doesn't exist, or behave unexpectedly | The standalone `docker-compose` **v1** binary is installed instead of the Compose **v2 plugin** (`docker compose`, no hyphen). | `doctor`'s `docker-compose-v2` check catches this directly. Install the v2 plugin per Docker's current documentation; v1 is not a supported substitute anywhere in this pipeline. |
| `status`/health checks show the API healthy, but the site itself returns 502 | The web container's own nginx and the shared proxy's upstream port have drifted out of agreement — the historical failure mode this exact pair of files used to have. | This is why `status` probes the frontend **separately** from `/api/health/ready` — an API-only health check would show green while the site is down. A stock deployment is guarded by a test asserting these two ports agree; if you've modified `apps/web/nginx.conf` or `infra/nginx/nginx.conf` in a fork, check that they still match. |
| The site serves an **expired** certificate, but `openssl x509 -enddate` on the file in `letsencrypt/live/` shows it was renewed weeks ago | Renewal wrote a new certificate and nothing reloaded the proxy — nginx holds its certificate **in memory**, so the old one keeps being served until the process restarts. Files on disk look completely correct, which is what makes this one quiet. | `doctor`'s `certificate-served` check catches exactly this: it compares what's served on `127.0.0.1:443` against the file on disk. The fix is one line: `docker exec <proxy-container> nginx -s reload` (containerised proxy) or `nginx -s reload` (host proxy). If you scheduled renewal yourself outside of `install`, make sure your renewal command reloads afterward — `install`'s own scheduled entry already does. |
| `install` fails cloning a **private** repository, asking for git credentials with no terminal to answer on | The repo is reached over `https` and this server has no credential for it. | `gh-installed`/`gh-authenticated` in `doctor` catch this in advance and are `recommended`, not `required`, everywhere else — they only promote to a real failure when the repository genuinely needs a credential this server lacks. `gh auth login` once, then re-run; `install` calls `gh auth setup-git` itself so the clone picks it up. An `ssh` remote or a public repository need none of this. |
| A `doctor`/`install` check reports `invalid_grant` for the OAuth credentials and you're not sure whether that's good or bad | It's **good** — this is the one result in this whole pipeline that looks like a failure and means the opposite. | Google authenticates the client *before* it evaluates the authorization grant, so `invalid_client` means your `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` were rejected (a real problem), while `invalid_grant` means they were **accepted** and only the check's own deliberately-invalid code was refused (exactly what it wanted to see). If you instead see `invalid_client`, re-copy both values from the Google Cloud console. |

## Summary checklist

- [ ] `appctl deploy doctor` run clean (or only recommended warnings) before starting
- [ ] `gh auth login` completed, if this repository is private and reached over `https`
- [ ] DNS A record for the domain points at this server, confirmed by `doctor --domain <domain>`
- [ ] Google OAuth redirect URI matches `https://<domain>/api/auth/google/callback` exactly
- [ ] External PostgreSQL reachable, with credentials `doctor`/`install`'s environment validation accepts
- [ ] First install run with `--staging` if this is a new domain or a first attempt on this server
- [ ] `appctl deploy install --domain <domain>` completed, including the OAuth credential probe (`invalid_grant` is a pass — see the troubleshooting table), any database-creation prompt, proxy bootstrap or reuse, and the external HTTPS verification step
- [ ] Logged in at `https://<domain>` as `INITIAL_ADMIN_EMAIL` — this, not the seed, is what creates the admin account
- [ ] Additional users added to the allowlist from the admin panel
- [ ] `appctl deploy status` reports healthy, with migrations "up to date," not just the readiness probe green
- [ ] Certificate renewal is owned by *something* — either `install`'s own scheduled entry (when nothing else owned it) or an existing mechanism `doctor`'s `certificate-renewal` check named; never both
- [ ] `appctl deploy update` scheduled (cron or otherwise) if this server should track new releases automatically
- [ ] `<deployRoot>/logs/` reviewed for anything unexpected if any step above didn't go as described

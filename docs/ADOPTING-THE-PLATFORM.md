# Adopting the platform in an existing app

How a team with an existing fork or app moves it onto the `@marinoscar/platform-*` packages, one slice at a time, without a big-bang rewrite. It gives the order, what each step deletes from the app, the checks that prove a step, how to roll back and the traps earlier adoptions found.

For a brand-new product, do not use this guide: start from the starter ([../starter/README.md](../starter/README.md), [RENAMING.md](RENAMING.md#starting-a-whole-new-project)). For the design behind the packages see [specs/platform-packages.md](specs/platform-packages.md).

## 1. What you are moving to

- Six published packages in lockstep: `platform-contract`, `platform-api`, `platform-web`, `platform-db`, `platform-cli` and `platform-infra`. Slices are subpath modules (for example `@marinoscar/platform-api/identity`).
- Your app keeps its **domain code** and its **appearance**. The packages own structure and behaviour. You extend them through their documented seams (options, registries, tokens, events, composition), never by editing a copy.
- The reference app in this repository (`apps/api`, `apps/web`, `apps/cli`) shows every binding; the [starter](../starter/README.md) is the smallest one.
- An upgrade is a version bump, CI and a deploy, never an automatic push to production.

## 2. Rules for the whole migration

- **One slice per pull request.** Adopt, delete the app's copy and run the checks in the same pull request. A revert then undoes exactly one slice.
- **Platform-first.** Once a slice is adopted, a fix goes into the package, never into an app copy.
- **Generated files are never hand-edited.** `infra/` and `infra/compose/.env.example` come from `platform-infra sync`; `apps/api/prisma/schema/` comes from `platform db compose`; an installed migration is never edited ([section 5](#5-pitfalls)).
- **A gap is a seam request**, not a patch ([section 7](#7-asking-for-a-missing-seam)).

## 3. The order

Adopt a slice only after every slice it depends on. The dependency graph is `packages/platform-slices.json`; the order below follows it.

| Step | What | Depends on |
|---|---|---|
| 0 | Measure, tag, pin | nothing |
| 1 | Database baseline | step 0 |
| 2 | Core, host and Doctor | step 1 |
| 3 | Identity and organizations, in single-org mode | core, doctor |
| 4 | Settings, then credentials | identity |
| 5 | Jobs and nodes | identity, settings |
| 6 | Storage | credentials, jobs, nodes |
| 7 | Email, then notifications | settings, credentials, jobs, storage |
| 8 | AI | credentials, jobs, nodes, storage |
| 9 | Database backup | email, jobs, storage |
| 10 | Telemetry | core, doctor |
| 11 | Harvested features | see step 11 |
| 12 | CLI, infra and web shell | any time after step 3 |

Telemetry and the Doctor depend only on `core`, so a team may adopt them first to prove the pipeline: that is how the first adopter started. Each step below says what it deletes.

### Step 0: measure, tag, pin

1. **Measure the drift.** From a checkout of this repository, run the drift report against your app (flags and output: [runbooks/platform-drift-report.md](runbooks/platform-drift-report.md)):

   ```bash
   node scripts/platform-drift.mjs --app ../your-app
   ```

   The report lists, file by file, what is identical, what changed only in comments, whitespace or identity names, and what is genuinely yours. Identical and normalised files are the ones a package replaces. The rest is your domain code or a seam request.
2. **Tag a rollback point** in your app before any change: `git tag MonoRepo` on the commit you start from, pushed to your remote. Use the same name in every repository.
3. **Pin one version of every platform package you use**, the same version for all. Once the packages are on npm, use the version (or the `next` dist-tag to try a pre-release) and let Renovate open the bumps. Until then, pin the release tarballs by URL; the pattern and the upgrade steps are in [runbooks/release-platform-packages.md](runbooks/release-platform-packages.md#install-from-a-github-release). Renovate cannot compare URL pins, so a bump is a hand edit of every pin.
4. **Single instances.** `@nestjs/*`, `fastify`, `@prisma/client`, `zod`, `react`, `@mui/*` and `@emotion/*` are peer dependencies: your app must have exactly one copy of each. Check with `npm ls <package>` after each install; the platform repository enforces the same rule with `scripts/check-single-instance.mjs`.
5. **Pin the contract once.** Because `platform-api` and `platform-web` both depend on `platform-contract`, point every copy at one pin with an `overrides` entry at the root until npm resolves it (`"@marinoscar/platform-contract": "$@marinoscar/platform-contract"`).

Deletes: nothing.

### Step 1: database baseline

An app with a production database adopts the platform migration history without re-running it. Do this before any slice that owns tables. The whole procedure, with a rehearsal, is [runbooks/database-baseline.md](runbooks/database-baseline.md); the order is:

1. Take a fresh backup and restore it into a scratch database on a non-production cluster with `pg_restore`.
2. Run the dry run against the copy: `npm run db:baseline` (add `--through <NNNN>` when the database is behind the newest platform migration, `--map <file>` when your SQL differs by more than comments).
3. Fix every difference the report refuses, then run `--apply` on the copy and the checks in the runbook's section 6.
4. Repeat on production inside a maintenance window, with a new backup, and compare the report with the rehearsal's.
5. Commit the new migration directories and `prisma/platform.lock` together.

Then compose the schema from fragments: `platform db compose` writes `apps/api/prisma/schema/` from `packages/platform-db/schema/` and your own `apps/api/prisma/fragments/` (see [DEVELOPMENT.md](DEVELOPMENT.md#making-database-changes)). A back-relation on a platform model is an `extend model` block in your fragment.

Deletes: your copy of the platform tables' schema (the composed schema replaces it). Never your migrations.

### Step 2: core, host and Doctor

Mount `PlatformHostCoreModule.forRoot()` (event bus, app metrics, maintenance mode, the `{ data }` envelope, request ids, the API reference) and `DoctorModule.forRoot`, and wire the web `PlatformHostProvider`. Register your own checks through the Doctor's registry. READMEs: [host](../packages/platform-api/src/host/README.md), [core](../packages/platform-api/src/core/README.md), [doctor](../packages/platform-api/src/doctor/README.md).

Deletes: your event bus, maintenance, interceptors, request-id middleware, OpenAPI bootstrap and Doctor framework.

### Step 3: identity and organizations, in single-org mode

Mount `IdentityModule.forRoot` with your host ports, and register your roles and permissions in the manifest. Leave `TENANCY_MODE` unset: everyone belongs to the default organization and organization management stays hidden. Do not switch to multi-org mode until every slice you use has passed its tenancy tests and you have run [runbooks/multi-org.md](runbooks/multi-org.md).

The application database role must be an ordinary role that owns the tables, never a superuser and never `BYPASSRLS` (row-level security is inert otherwise). The Doctor check `db.rls_role` fails when it is not ([SECURITY-ARCHITECTURE.md section 18](SECURITY-ARCHITECTURE.md#18-tenant-isolation-rls)).

Add your user-owned tables to the user-owned data registry; the conformance tripwire fails on an unregistered model that has an owner column.

Deletes: sign-in, sessions, users, allowlist, personal access tokens, device flow, guards and decorators. Read: [identity README](../packages/platform-api/src/identity/README.md), [web](../packages/platform-web/src/identity/README.md), [contract](../packages/platform-contract/src/identity/README.md).

### Step 4: settings, then credentials

Register your settings namespaces (system and user) with the settings slice before `SettingsModule.forRoot()`, and move your encrypted secrets into the credential store through its purpose registries. Runtime-configured features (storage, email, AI, Web Push) never get environment variables.

Deletes: your system-settings and user-settings controllers and your credential cipher. Read: [settings](../packages/platform-api/src/settings/README.md), [credentials](../packages/platform-api/src/credentials/README.md).

### Step 5: jobs and nodes

Register each of your job handlers with the packaged queue. Keep the type strings: a job `type` is permanent once jobs of it exist, and `apps/api/test/jobs/job-type-snapshot.spec.ts` pins them. Rewrite any `@Cron` that works inline into an enqueue-only task and any `@OnEvent` body that does I/O into a job; the conformance suites `cron-enqueue-only` and `on-event-no-io` fail otherwise.

Deletes: your queue, claim, lease, worker pool and worker-node code. Read: [jobs](../packages/platform-api/src/jobs/README.md), [nodes](../packages/platform-api/src/nodes/README.md), [adding a job type](../packages/platform-api/src/jobs/handlers/README.md).

### Step 6: storage

Mount the storage slice, register your object-key prefixes and post-upload processors, and move the provider configuration to the runtime admin page. Existing objects keep their keys; the key-prefix registry must list every prefix you already use. Read: [storage](../packages/platform-api/src/storage/README.md), [runbooks/storage-configuration.md](runbooks/storage-configuration.md).

Deletes: your provider drivers, the storage controllers and the storage configuration page.

### Step 7: email, then notifications

Mount email (SES or SMTP, template registry), then the notification framework: register your events, channels and templates. Call `notify()` only after the triggering write commits, outside any `$transaction`. Read: [email](../packages/platform-api/src/email/README.md), [notifications](../packages/platform-api/src/notifications/README.md).

Deletes: your mailer, your notification dispatcher, inbox, Web Push and broadcast code.

### Step 8: AI

Mount `AiModule.forRoot` and call `AiService.forUser(userId, { orgId, feature })` from your features. Never import a provider SDK outside the slice. AI jobs stay server-only. An app that stores its own AI keys needs a data migration into the credential store: rehearse it like the baseline in step 1. Read: [AI README](../packages/platform-api/src/ai/README.md), [runbooks/ai-configuration.md](runbooks/ai-configuration.md).

Deletes: your provider adapters, key resolver, usage ledger and AI settings pages.

### Step 9: database backup

Mount the db-backup slice. Every dump and restore must carry both `--enable-row-security` and the `app.rls_bypass` option, and the connection must be direct; the slice does this for you, so delete your own `pg_dump` wrappers rather than adapting them. Read: [db-backup README](../packages/platform-api/src/db-backup/README.md), [runbooks/database-restore.md](runbooks/database-restore.md).

Deletes: your backup and restore jobs, schedule and page.

### Step 10: telemetry

Mount the telemetry slice in all five layers, add your metric groups through the registry (no platform edit needed) and sync the infra fragments. Read: [telemetry README](../packages/platform-api/src/telemetry/README.md), [runbooks/telemetry.md](runbooks/telemetry.md).

Deletes: your OpenTelemetry setup, explorer, dashboard and collector configuration copies.

### Step 11: harvested features

Merge your own versions of these into the packaged ones, one at a time, after their dependencies:

| Feature | Needs | Replaces |
|---|---|---|
| Sharing (groups, grants, link shares) | identity | your circles, shares and link tokens: see the migration recipes in the [sharing README](../packages/platform-api/src/sharing/README.md) |
| Data export | jobs, storage | your export jobs and writers |
| User data reset, factory reset, offboarding | jobs, storage, sharing, exports | your purge code |
| Onboarding | identity, settings, doctor | your welcome dialog and checklists |
| Android app | storage, notifications | your Android server module and Kotlin shell |

Each has a spec and a package README linked from [../CLAUDE.md](../CLAUDE.md).

### Step 12: CLI, infra and web shell

- **CLI.** Build your CLI with `createCli()` from `@marinoscar/platform-cli` and keep only your own commands and branding ([../packages/platform-cli/README.md](../packages/platform-cli/README.md)).
- **Infra.** Run `npm run platform:infra:sync`. The Compose, nginx and env fragments become generated; your own additions move to the app-owned files (`infra/compose/app.env.example`, `app.*.compose.yml`, `infra/nginx/app.d/`). A drift between generated files and the lock fails `platform-infra sync --check` ([../packages/platform-infra/README.md](../packages/platform-infra/README.md)).
- **Web shell.** Fill the shell slots (`ShellLayout`, app bar, rail, bottom nav) with your navigation, and keep the five breakpoint gates untouched ([../packages/platform-web/src/shell/README.md](../packages/platform-web/src/shell/README.md)).

## 4. Checks to run

After every step, in your app:

```bash
npm run typecheck --workspace=api && npm run typecheck --workspace=web
npm test --workspace=api && npm run test:run --workspace=web
cd apps/api && npm run db:compose:check && npm run db:check
cd apps/api && npm run db:drift                 # needs a database
cd apps/api && npm run db:check:database        # needs a database
npm run platform:infra:sync -- --check
```

- **Conformance.** Your API test tree runs `runPlatformConformance()` (the reference app's entry is `apps/api/test/conformance.spec.ts`) and the web runs `runPlatformWebConformance()` (`apps/web/src/__tests__/conformance.test.ts`). Pass your own data: exemptions, minimums, registries. Skip a suite only with a written reason. Each suite is listed in [TESTING.md](TESTING.md#platform-conformance).
- **Doctor.** Open `/admin/settings/doctor` after deploying: every check should be `pass` or an understood `skip`.
- **Real database.** Run `npm run test:db --workspace=api` for the slices that own tables.
- **Visual baselines.** Regenerate them in the pinned Playwright container when a page changes, and make sure CI runs on the final head of the branch.

## 5. Pitfalls

| Pitfall | What to do |
|---|---|
| Hand-editing a generated file | `infra/` and `.env.example` are written by `platform-infra sync`; `apps/api/prisma/schema/` by `platform db compose`. Edit the source (a fragment, `app.env.example`, an app-owned overlay) and regenerate. CI fails on a stale or edited file |
| Editing an installed migration | Never. `prisma/platform.lock` records the sha256 of every platform migration and `npm run db:check` fails on any byte change, including a comment or a line ending. Exclude `**/migration.sql` from every repository-wide clean-up |
| Renaming an installed migration directory | Never. Deployed databases know migrations by name |
| Importing `@prisma/client` in package code | A published package never depends on an app's generated client. Core reaches Prisma only through `@prisma/client/extension`; a slice declares its models structurally. `packages/platform-api/test/no-generated-client.spec.ts` enforces it. Your own app code may import its client |
| Running as a superuser | Row-level security is inert for a superuser or `BYPASSRLS` role. The application role must be an ordinary role that owns the tables; the init script in `infra/compose/postgres-init/` shows how |
| A session-level `SET` for the organization | Use the transaction-local helpers (`forOrg`, `runInOrg`, `asSystem`, `runAsSystem`); a session `SET` leaks across pooled connections |
| Switching to multi-org mode too early | Stay in single-org mode until every slice has passed its tenancy tests. A user with no organization is refused at sign-in in multi mode |
| Pinning a platform response shape in an app test | A `toEqual` on a platform response fails on any additive field. Assert your own fields, or run the slice's conformance suite |
| Re-pinning a tarball of the same version in place | `npm install` nests the platform packages under the workspaces and breaks module resolution. Delete the platform entries from the lockfile before `npm install`, or bump the version |
| A hand-merged `package-lock.json` | Regenerate it |
| Docs naming the product | The template identity guard rejects the old product name outside allowlisted files; write "the app" in shared docs |
| Adopting a slice before its dependencies | The slice graph (`packages/platform-slices.json`) forbids imports outside the listed dependencies, so mount the dependencies first |

## 6. Rollback

| Scope | How |
|---|---|
| A slice | Revert its pull request. Each slice is one pull request by rule |
| A version bump | Revert the pin change and `npm install`; a bad release is deprecated by the maintainers ([runbooks/release-platform-packages.md](runbooks/release-platform-packages.md)) |
| The database baseline | The baseline writes only ledger rows (`migrate resolve --applied`). Restore the backup taken before `--apply` and revert the commit that added the directories and `platform.lock` ([runbooks/database-baseline.md](runbooks/database-baseline.md#9-rollback)) |
| The whole adoption | Reset to the `MonoRepo` tag. For data, restore the pre-adoption backup ([runbooks/database-restore.md](runbooks/database-restore.md)) |

At most one open pull request may carry a migration at a time, per repository: migration ids are timestamps in one linear history.

## 7. Asking for a missing seam

When the packages lack an option, port, registry or event your app needs:

1. Look in the slice README's extension-point catalog and pick the earliest rung that works (options, registries, tokens, events, composition).
2. If none fits, file a seam request in the platform repository with the `seam_request.yml` issue template: your app, the package and slice, the need in domain terms, the rungs you tried, why they fail and the proposed seam.
3. Do not edit platform code in your app. Work around it behind your own interface until the release that adds the seam. If you cannot wait, eject one piece temporarily with a ticket that links the request.

The one seam round trip measured so far took 15 minutes in the platform repository and 1 minute in the app. The process and its governance are in [specs/platform-packages.md](specs/platform-packages.md#extending-a-package-consumer-guide) and [PACKAGES.md](PACKAGES.md).

## 8. After adoption

- Let Renovate open one pull request that moves every platform package. After merging it: `npm install`, then `cd apps/api && npm run db:sync && npm run db:compose && npm run prisma:generate`, then `npm run platform:infra:sync`, then the checks above. Read each package's `CHANGELOG.md` for upgrade notes. This is the starter's upgrade loop ([../starter/README.md](../starter/README.md#upgrading-the-platform)).
- Keep a short ledger of local exceptions with a link to the seam request that will remove each one.
- Re-run the drift report occasionally; it should shrink to your domain code.

## See also

- [runbooks/platform-drift-report.md](runbooks/platform-drift-report.md), [runbooks/database-baseline.md](runbooks/database-baseline.md)
- [platform-adoption/go-no-go-evopath.md](platform-adoption/go-no-go-evopath.md): the first adopter's measured cost, its friction log and what it learned.
- [ADMIN-GUIDE.md](ADMIN-GUIDE.md): what the adopted features look like to admins and users.
- [../starter/README.md](../starter/README.md): the starter app and its upgrade loop.

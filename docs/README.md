# Documentation index

Every document in this repository, grouped by what you need it for. Links are
relative to `docs/`.

- A **spec** (`specs/`) describes the design of one feature and serves as its reference: the model, the rules, and the rejected alternatives. It is written for developers extending the template.
- A **runbook** (`runbooks/`) is a step-by-step procedure for an operator running a deployment.

## Read first

In this order:

1. [../README.md](../README.md): what the template is, what you get, how to start a new app.
2. [ARCHITECTURE.md](ARCHITECTURE.md): the subsystem map, permission matrix, tables and job types.
3. [SECURITY-ARCHITECTURE.md](SECURITY-ARCHITECTURE.md): authentication, credential kinds, RBAC, transport and data protection.
4. [DEVELOPMENT.md](DEVELOPMENT.md): the dev loop and Fastify, Prisma and Passport gotchas.
5. [TESTING.md](TESTING.md): test layers, helpers and how to run each suite.
6. [RENAMING.md](RENAMING.md): starting a new product from the starter (`new-project.mjs create`), renaming an app, and the legacy flow for existing forks.

## Guides

| Guide | What it covers |
|---|---|
| [API.md](API.md) | API conventions: auth schemes, response envelope, pagination, errors, `If-Match`, SSE, rate limits, how the OpenAPI document is produced |
| [DEVICE-AUTH.md](DEVICE-AUTH.md) | Integrating a CLI or device with the RFC 8628 device flow |
| [personal-access-tokens.md](personal-access-tokens.md) | Creating and using `pat_` tokens for scripts and CI |
| [../SECURITY.md](../SECURITY.md) | Supported versions, private vulnerability reporting, response targets and scope |
| [../apps/cli/README.md](../apps/cli/README.md) | `appctl`: install, `login`, `api`, `config`, `deploy`, `node`, CI usage |
| [PACKAGES.md](PACKAGES.md) | Documenting a `@marinoscar/platform-*` package or slice: the README template, TSDoc tags, the extension-point catalog, TypeDoc and the `check:package-docs` checks |

## Feature specs

| Spec | Feature | Read it when… |
|---|---|---|
| [specs/settings-ui.md](specs/settings-ui.md) | Registry-driven settings hubs | you add a settings page, admin or per-user |
| [specs/storage-providers.md](specs/storage-providers.md) | Runtime-configured object storage (S3, R2, S3-compatible) | you touch storage configuration or a storage consumer |
| [specs/job-queue.md](specs/job-queue.md) | Postgres-backed background job queue | you add a job type or anything long-running |
| [specs/worker-nodes.md](specs/worker-nodes.md) | Remote worker nodes and their data plane | you make a job type node-eligible or change the node API |
| [specs/ai-platform.md](specs/ai-platform.md) | Admin-governed, bring-your-own-key AI | you use AI from a feature or add a provider |
| [specs/browser-notifications.md](specs/browser-notifications.md) | Notification channels, service worker, Web Push | you add a notification event or channel |
| [specs/notification-broadcasts.md](specs/notification-broadcasts.md) | Admin broadcasts to every user | you change how broadcasts are composed or fanned out |
| [specs/database-backup.md](specs/database-backup.md) | Scheduled and on-demand `pg_dump` backups | you change backups or their node offload |
| [specs/database-restore.md](specs/database-restore.md) | Restore and rollback from a backup | you change restore gates or outcomes |
| [specs/maintenance-mode.md](specs/maintenance-mode.md) | The 503 maintenance window | you change maintenance behaviour or its layers |
| [specs/doctor.md](specs/doctor.md) | The admin Doctor: read-only configuration and health checks, and the redacted support bundle | you add a check or a support-bundle section, or read the Doctor's report |
| [specs/data-export.md](specs/data-export.md) | Data export: export sources and writers, the `user-data` and `org-data` exports, signed downloads, expiry, redaction and the secret-egress proof | you add an export source or format, or change what a user or organization export contains |
| [specs/onboarding.md](specs/onboarding.md) | First-run onboarding: the welcome dialog, the derived Setup guide and Get started checklists, the step and fact registries, activation metrics and feature notices | you add an onboarding step, a fact, an activation milestone or a feature notice |
| [specs/user-data-reset.md](specs/user-data-reset.md) | User data reset, factory reset and organization offboarding: the registry-driven per-user deletion with scopes, the delete order from the schema, the three jobs, the Danger Zone and factory reset pages | you add a model with an owner column (its keep-or-delete hint), a category, a scope, a factory reset step or an offboarding precondition |
| [specs/telemetry.md](specs/telemetry.md) | GreptimeDB-backed telemetry, the Telemetry Explorer and the Telemetry Dashboard | you change telemetry ingest, storage, querying or the dashboard |
| [specs/user-credentials.md](specs/user-credentials.md) | Encrypted per-user credentials | you add a bring-your-own-key credential type |
| [specs/vps-deploy.md](specs/vps-deploy.md) | `appctl deploy` to a single VPS | you change the deploy commands or the deployed layout |
| [specs/platform-packages.md](specs/platform-packages.md) | Proposed: turning the template into published platform packages (extension contract, tenancy, migrations, scaling, adoption roadmap) | you plan to share platform code between apps or change how forks consume it |
| [platform-adoption/go-no-go-evopath.md](platform-adoption/go-no-go-evopath.md) | The platform-packages go/no-go gate: what one platform change cost by package and by copy in EvoPath, the verdict, the friction log and what a re-run needs | you decide whether a later packaging wave may start, or re-run the gate |
| [specs/native-companion-architecture.md](specs/native-companion-architecture.md) | The Android companion: the web app in a Trusted Web Activity plus an optional native module, the five coordination channels, the Kotlin `platform-core`, hosted APK releases, Digital Asset Links, the `android_app` push channel | you build or release the Android app, or add a native capability |

## Decision records

| Index | What it covers |
|---|---|
| [adr/README.md](adr/README.md) | Architecture decision records: what an ADR is here, numbering, statuses, the template and the index of every ADR |

## Runbooks

| Runbook | When you need it |
|---|---|
| [runbooks/deploy-to-vps.md](runbooks/deploy-to-vps.md) | Taking an Ubuntu VPS to a running HTTPS deployment with `appctl deploy`, and keeping it current |
| [runbooks/run-worker-nodes.md](runbooks/run-worker-nodes.md) | Enrolling, running and operating worker nodes with `appctl node` |
| [runbooks/storage-configuration.md](runbooks/storage-configuration.md) | Setting up object storage, creating the bucket, rotating its key |
| [runbooks/ai-configuration.md](runbooks/ai-configuration.md) | Turning AI on, choosing the key policy, curating models, switching it off |
| [runbooks/vapid-keys.md](runbooks/vapid-keys.md) | Generating, enabling, rotating or removing Web Push keys |
| [runbooks/maintenance-mode.md](runbooks/maintenance-mode.md) | Opening or closing a maintenance window, or recovering from a lockout |
| [runbooks/database-restore.md](runbooks/database-restore.md) | Restoring the database from a backup, with the app possibly down |
| [runbooks/postgres-client-version.md](runbooks/postgres-client-version.md) | Backups fail because `pg_dump` is older than the server |
| [runbooks/node-job-secrets.md](runbooks/node-job-secrets.md) | Letting worker nodes take backups with short-lived database roles |
| [runbooks/rotate-secrets-encryption-key.md](runbooks/rotate-secrets-encryption-key.md) | Rotating or recovering from the loss of `SECRETS_ENCRYPTION_KEY` |
| [runbooks/deployment-info.md](runbooks/deployment-info.md) | Reading the About page's deployment sections |
| [runbooks/telemetry.md](runbooks/telemetry.md) | Enabling the GreptimeDB telemetry overlay, setting retention, configuring the AI assistant, connecting a BI tool |
| [runbooks/doctor.md](runbooks/doctor.md) | Triaging a misconfigured or unhealthy deployment with the admin Doctor, and sending a support bundle |
| [runbooks/platform-drift-report.md](runbooks/platform-drift-report.md) | Measuring how far a fork has drifted from the base with `scripts/platform-drift.mjs` (maintainers) |
| [runbooks/data-retention.md](runbooks/data-retention.md) | Seeing and changing how long each kind of data is kept, and turning audit-log retention on |
| [runbooks/container-images.md](runbooks/container-images.md) | Finding, verifying (cosign, SBOM) and pinning the published api, web, worker and stack-agent images; making the GHCR packages public |
| [runbooks/rds-proxy-rls-check.md](runbooks/rds-proxy-rls-check.md) | Measuring whether RDS Proxy pins connections under transaction-local row-level security, and whether RDS allows `BYPASSRLS` (manual, AWS account) |
| [runbooks/release-platform-packages.md](runbooks/release-platform-packages.md) | Releasing the `@marinoscar/platform-*` packages: owner prerequisites, changesets, the version PR, `next` vs `latest`, provenance, deprecating a bad version (maintainers) |
| [runbooks/air-gapped.md](runbooks/air-gapped.md) | Running a deployment with no internet egress: `DEPLOYMENT_NETWORK=air-gapped`, the Doctor's `network.egress` row, and how to make each outbound dependency internal |
| [runbooks/database-baseline.md](runbooks/database-baseline.md) | Adopting the platform migration history in an app that already has a production database: rehearse on a restored backup, `platform db baseline`, verify, roll back (operators, once per app) |
| [runbooks/multi-org.md](runbooks/multi-org.md) | Running in multi-organization mode: setting `TENANCY_MODE=multi`, creating the first organization, inviting its administrator, managing members and invitations |
| [runbooks/android-app.md](runbooks/android-app.md) | Installing the Android app, trusting its signing key so it opens full screen, pairing a native capability, Android troubleshooting |
| [runbooks/android-release.md](runbooks/android-release.md) | Releasing an APK: keystore, versioning, `appctl android release`, the terminal menu, the deploy step, the web upload, CI, rollback |
| [runbooks/factory-reset.md](runbooks/factory-reset.md) | Factory resetting a deployment (backup first, run, verify, recover) and offboarding an organization |

## Developer recipes in the code

READMEs that live next to the code they describe.

| README | Use it for |
|---|---|
| [../packages/platform-api/src/jobs/handlers/README.md](../packages/platform-api/src/jobs/handlers/README.md) | Adding a job type |
| [../apps/api/src/jobs/contracts/README.md](../apps/api/src/jobs/contracts/README.md) | Result schemas a worker node posts back for a node-eligible type |
| [../packages/platform-cli/src/engine/node/executors/README.md](../packages/platform-cli/src/engine/node/executors/README.md) | The CLI side of a node-eligible job type |
| [../packages/platform-api/src/ai/README.md](../packages/platform-api/src/ai/README.md) | Using AI from a feature; the AI slice's map (`@marinoscar/platform-api/ai`) |
| [../packages/platform-api/src/notifications/README.md](../packages/platform-api/src/notifications/README.md) | Adding a notification or a channel; the notifications slice (API; its web and contract READMEs are linked from it) |
| [../apps/api/src/examples/storage/README.md](../apps/api/src/examples/storage/README.md) | Post-upload storage object processors (the `ObjectProcessorRegistry` recipe) |
| [../packages/platform-api/src/identity/device-auth/README.md](../packages/platform-api/src/identity/device-auth/README.md) | Device flow reference: schemas, fields, security rationale |
| [../apps/api/scripts/README.md](../apps/api/scripts/README.md) | The `prisma-env.js` wrapper that builds `DATABASE_URL` |
| [../packages/shared/README.md](../packages/shared/README.md) | Product identity: name and brand colours shared by every app |
| [../packages/platform-api/src/core/registry/README.md](../packages/platform-api/src/core/registry/README.md) | Defining a registry, declaring its entries and writing its manifest; the registry behaviour apps rely on |
| [../apps/api/src/app-registrations/README.md](../apps/api/src/app-registrations/README.md) | The app-owned seam: where a fork adds its own registry entries without editing platform files |
| [../packages/platform-api/src/telemetry/README.md](../packages/platform-api/src/telemetry/README.md) | Telemetry, API slice: `forRoot` options, the metric-group registry, `VERDICT_POLICY`, host ports, the conformance suite; start here to add a dashboard group or tune the verdict |
| [../packages/platform-contract/src/telemetry/README.md](../packages/platform-contract/src/telemetry/README.md) | Telemetry wire shapes: the zod schemas and constants the API and the web share |
| [../packages/platform-web/src/telemetry/README.md](../packages/platform-web/src/telemetry/README.md) | Telemetry UI slice: `/headless`, `/ui`, `telemetryAdminCards`, the adapters and the theme tokens |
| [../packages/platform-cli/src/telemetry/README.md](../packages/platform-cli/src/telemetry/README.md) | Telemetry CLI slice: the worker span relay and the deploy wizard's env metadata |
| [../packages/platform-infra/src/telemetry/README.md](../packages/platform-infra/src/telemetry/README.md) | Telemetry infra slice: the compose files, the collector configuration, its app overlay and `platform-infra sync` |
| [../packages/platform-web/src/sharing/README.md](../packages/platform-web/src/sharing/README.md) | Sharing UI slice: the hooks, the share dialog, the group pages, the public `/s` page and `registerLinkRenderer`; the fragment-token rules |
| [../packages/platform-api/src/sharing/README.md](../packages/platform-api/src/sharing/README.md) | Sharing, API slice: groups, grants, `AccessPolicy`, the list helpers, link shares and the public-route pattern; a tested example per extension point (`apps/api/test/examples/sharing/`), the conformance suite and the kvox and MemoriaHub migration recipes; start here to make a table shareable |
| [../packages/platform-contract/src/sharing/README.md](../packages/platform-contract/src/sharing/README.md) | Sharing wire shapes: the group, grant and link schemas, `LINK_TOKEN_HEADER` and `buildLinkUrl` |
| [../packages/](../packages/) (`platform-*/README.md`) | The `@marinoscar/platform-*` packages: one README per package; layout and commands in [DEVELOPMENT.md § Platform packages](DEVELOPMENT.md#platform-packages) |
| [../starter/README.md](../starter/README.md) | The starter: what `new-project.mjs create` copies (an app on the published packages), running it, adding a first feature, upgrading with Renovate, the `next` channel, seam requests; its CI proof is the `starter` job (`scripts/starter-smoke.mjs`) |

## Agent rules

For AI coding agents working in this repository.

- [../CLAUDE.md](../CLAUDE.md): binding rules and pointers.
- [../.claude/agents/](../.claude/agents/): the specialised subagents (backend, frontend, database, testing, docs, ops).
- [../.claude/skills/new-project/SKILL.md](../.claude/skills/new-project/SKILL.md): start a new product from the starter (`new-project.mjs create`), or bootstrap an existing fork.
- [../.claude/skills/rename-app/SKILL.md](../.claude/skills/rename-app/SKILL.md): rename and rebrand an app (the starter plan) or a fork (the template plan).

# Admin and user guide

A task-oriented tour of what an administrator or a user can do in the application today. It is for the people who run a deployment built from this platform and the people who use it. Each section names where the feature lives, who may use it, the steps of its main task and where the full design or procedure is.

Developers extending the platform start at [README.md](README.md) instead.

## How to read this guide

- **Where** is the route in the web app. The admin pages sit under `/admin/settings` (the Console); the per-user pages sit under `/settings`. Both are searchable card hubs declared in `apps/web/src/config/adminSections.tsx` and `apps/web/src/config/userSettingsSections.tsx`.
- **Who** is the exact permission string the API enforces. A card you cannot open is hidden, not disabled. Writes inside a page are disabled without the matching `:write` permission. The full matrix is [ARCHITECTURE.md section 7](ARCHITECTURE.md#7-authorization).
- **Roles in one paragraph.** `admin` is a system role for deployment operators and holds every system permission. `org_admin`, `contributor` and `viewer` are organization roles, held through a membership. Every new membership is a `viewer`. `ai:use` is withheld from `viewer` on purpose.
- **Paths are relative to the deployment's address**, for example `https://<your-deployment>/admin/settings/email`.
- **Two modes change what you see.** `TENANCY_MODE=single` (the default) hides organization management. `TENANCY_MODE=multi` shows the Organizations group. `DEPLOYMENT_MODE=saas` disables in-app restore and factory reset.

## Where everything is

### Admin hub (`/admin/settings`)

| Group | Card | Route | Permission to open it |
|---|---|---|---|
| General | Email | `/admin/settings/email` | `system_settings:read` |
| General | Notifications | `/admin/settings/notifications` | `system_settings:read` |
| General | Web Push | `/admin/settings/push` | `push:read` |
| General | Storage | `/admin/settings/storage` | `storage_config:read` |
| General | Maintenance | `/admin/settings/maintenance` | `system_settings:read` |
| General | Setup guide | `/admin/settings/setup` | `system_settings:read` |
| General | Android app | `/admin/settings/android` | `system_settings:read` |
| Access | Users & Allowlist | `/admin/settings/users` | `users:read` |
| Operations | Jobs, Job Insights | `/admin/settings/jobs`, `/admin/settings/jobs/insights` | `jobs:read` |
| Operations | Worker Nodes | `/admin/settings/workers` | `nodes:read` |
| Operations | Database Backup | `/admin/settings/db-backup` | `db_backup:read` |
| Operations | Broadcasts | `/admin/settings/broadcasts` | `broadcasts:read` or `org_broadcasts:read` |
| Operations | About | `/admin/settings/about` | `system_settings:read` |
| AI | AI | `/admin/settings/ai` | `ai_config:read` |
| AI | AI Models, AI Usage | `/admin/settings/ai/models`, `/admin/settings/ai/usage` | `ai_config:read`, hidden while AI is off |
| AI | Organization AI keys | `/admin/settings/ai/organization-keys` | `org_ai_config:read`, hidden while AI is off |
| Observability | Telemetry | `/admin/settings/telemetry` | `telemetry:read` |
| Observability | Telemetry Explorer, Telemetry Dashboard | `/admin/settings/telemetry/explorer`, `/admin/settings/telemetry/dashboard` | `telemetry:query`, hidden while telemetry is off |
| Observability | Doctor | `/admin/settings/doctor` | `system_settings:read` |
| Organizations | Organization | `/admin/settings/organization` | `org_members:read`, multi-org mode only |
| Organizations | Organizations | `/admin/settings/organizations` | `organizations:read`, multi-org mode only |
| Organizations | Organization settings | `/admin/settings/organization-settings` | `org_settings:read`, multi-org mode only |
| Danger Zone | Factory reset | `/admin/settings/factory-reset` | `system:factory_reset` |

### User hub (`/settings`)

No user card declares a permission, apart from the ones noted. Every signed-in user owns their own settings.

| Group | Card | Route | Notes |
|---|---|---|---|
| Account | Profile, Appearance | `/settings/profile`, `/settings/appearance` | |
| Account | Notifications | `/settings/notifications` | |
| Account | Getting started | `/settings/getting-started` | Also in the user menu |
| Security | Access Tokens | `/settings/tokens` | Personal access tokens: [personal-access-tokens.md](personal-access-tokens.md) |
| Security | AI Keys | `/settings/ai` | `ai:use`, hidden while AI is off |
| Sharing | Groups | `/settings/groups` | `groups:read` |
| Your data | Download your data | `/settings/data-export` | |
| Danger Zone | Delete my data | `/settings/danger-zone` | |

## Users and the allowlist

- **Where:** Users & Allowlist, `/admin/settings/users`, two tabs: Users and Allowlist.
- **Who:** `users:read` opens the page. The Allowlist tab needs `allowlist:read`. Changing users needs `users:write`, changing roles needs `rbac:manage`, editing the allowlist needs `allowlist:write`.

Only addresses on the allowlist can sign in. The address in `INITIAL_ADMIN_EMAIL` always bypasses it.

1. Open the Allowlist tab and add the person's email address.
2. Tell them to sign in with Google using exactly that address.
3. Open the Users tab to see them, change their role or deactivate them.

Design: [SECURITY-ARCHITECTURE.md](SECURITY-ARCHITECTURE.md).

## Organizations and multi-org mode

- **Where:** Organizations group of the admin hub: Organization (the current organization's people) and Organizations (every organization). The user menu's organization button switches between organizations you belong to.
- **Who:** Organization needs `org_members:read` (the `org_admin` role). Its Invites tab needs `org_invites:read`. Organizations needs `organizations:read`; creating one needs `organizations:write` (the system `admin` role).
- **Mode:** the cards exist only when `TENANCY_MODE=multi`. In single mode everyone belongs to one default organization.

Create the first customer organization:

1. Set `TENANCY_MODE=multi` in the deployment's environment and restart the API. Take a backup first.
2. Open Organizations and choose **Create organization**.
3. Enter the name, a slug (lower-case letters, digits and hyphens; it cannot change later) and the first administrator's email.
4. The invited administrator signs in with that address. Signing in accepts the invitation and opens their organization.
5. They manage people on Organization: change roles, suspend or remove members, and invite more addresses on the Invites tab.

Full procedure and troubleshooting: [runbooks/multi-org.md](runbooks/multi-org.md). Model: [specs/platform-packages.md](specs/platform-packages.md#tenancy-and-access-model).

## Organization settings

- **Where:** Organization settings, `/admin/settings/organization-settings`. Multi-org mode only.
- **Who:** `org_settings:read` to open it; `org_settings:write` to change it. Each setting group also keeps its own permission.

An organization can only tighten what the deployment allows. The settings it can override are the notification policy (browser notifications off, more events suppressed) and the AI policy (AI off, no fallback to the deployment key, lower daily caps, providers off).

1. Open the page. It lists the settings the deployment lets an organization change, with their effective values.
2. Change the ones you want for this organization.
3. Save.

Design: [packages/platform-api/src/settings/README.md](../packages/platform-api/src/settings/README.md).

## Groups and sharing

- **Where:** Groups, `/settings/groups`.
- **Who:** `groups:read` (every organization role) to see your groups and accept invitations. `groups:write` (not `viewer`) to create a group. Inside a group the member roles are `admin`, `editor` and `viewer`; a group `admin` renames the group and manages its members and invitations. `groups:admin` (`org_admin`) administers every group of the organization.

Create a group and invite people:

1. Open Groups and create a group.
2. Open it and invite people by email, choosing a role for each.
3. Invitees see the invitation on their Groups page and accept or decline it.
4. A group admin changes roles or removes members later; members can leave.

A group belongs to one organization and is never a tenant.

**Grants and link shares.** A grant shares one record with a user, a group or anyone holding a link, with a role and an optional expiry. Grants need `sharing:read` and `sharing:write`; `sharing:admin` (`org_admin`) can revoke any grant. The platform ships no shareable record type of its own: the share dialog and "shared with me" list appear on a page once the application registers a record type. To share a record with a link:

1. Open the record's **Share** dialog.
2. Add people or groups with a role, or create a link.
3. For a link, pick an expiry (1 day, 7 days, 30 days or never, within the deployment's maximum) and copy the URL. The link is shown once.
4. Revoke a grant or link from the same dialog.

Anyone with a link reaches the `/s` page with no sign-in until it expires or is revoked.

Design and recipes: [packages/platform-api/src/sharing/README.md](../packages/platform-api/src/sharing/README.md), [packages/platform-web/src/sharing/README.md](../packages/platform-web/src/sharing/README.md).

## Setup guide and Get started

- **Where:** the Setup guide at `/admin/settings/setup` for administrators; Getting started at `/settings/getting-started` and in the user menu for everyone. A welcome dialog opens once per user at first sign-in.
- **Who:** the Setup guide needs `system_settings:read`. Getting started needs no permission beyond `user_settings:read`, which every role holds.

The checklists are derived from the live state, so a step cannot be ticked by hand. A step you cannot act on is left out.

1. As a new administrator, choose **Start setup** in the welcome dialog.
2. Work through the required steps: storage, email and access (an allowlist entry besides the initial administrator).
3. Then the recommended ones: AI, Web Push, database backup and, in multi-org mode, inviting a member of the organization.
4. Choose **Re-check** after each fix. Each step links to the page that fixes it.
5. Users see their own short list (profile, notifications) under Getting started, and can dismiss it and reopen it later.

Design: [specs/onboarding.md](specs/onboarding.md).

## Download your data

- **Where:** Download your data, `/settings/data-export`.
- **Who:** every signed-in user (`user_settings:read`) for their own data. An organization administrator (`org_members:read`) also sees the organization's data; a system `admin` (`organizations:read`) can name another organization.

1. Open the page and start a new export.
2. Pick the source (your data, or the organization's) and a format: `json`, `csv` (a zip of one file per table) or `xlsx`.
3. The export runs as a background job. You can leave the page.
4. When the row reads ready, choose download. The link is signed and short-lived; secrets and hashes are never included.
5. Exports are deleted after 7 days.

You get a notification when an export is ready or fails. Design: [specs/data-export.md](specs/data-export.md).

## Delete my data, factory reset and organization offboarding

All three are queue jobs, irreversible and confirmed by typing an exact phrase.

### Delete my data (any user)

- **Where:** Delete my data, `/settings/danger-zone`. **Who:** every signed-in user (`user_settings:write`).

1. Open the page. It shows what you own with live counts, and what is always kept (your account, sign-in and organization memberships).
2. Choose a scope: a specific category (files, notifications, AI history, credentials, settings), `DELETE MY CONTENT`, or everything.
3. Tick the acknowledgement and type the exact phrase shown (`DELETE MY DATA` for everything).
4. Keep the dialog open until it reports the counts.

### Factory reset (administrators)

- **Where:** Factory reset, `/admin/settings/factory-reset`, the last card. **Who:** `system:factory_reset` (system `admin`). Disabled when `DEPLOYMENT_MODE=saas`.

1. Take a database backup first and wait for it to complete. Backups survive the reset.
2. Open the page and read the counts of what will be erased.
3. Choose **Factory reset**, tick the acknowledgement and type `FACTORY RESET`.
4. Wait for the job. You stay signed in; every other user, personal access token and device login is gone.

### Organization offboarding (administrators, multi-org mode)

- **Where:** the **Offboard** action on a row of Organizations. **Who:** `orgs:offboard` (system `admin`). The default organization cannot be offboarded.

1. Switch to the organization and export its data first (Download your data). Offboarding requires an organization export finished in the last 7 days.
2. Choose **Offboard** on the organization's row and read what goes.
3. Choose whether the members keep their accounts or are deleted with their data.
4. Tick the acknowledgement and type the organization's slug.

Procedures, verification and recovery: [runbooks/factory-reset.md](runbooks/factory-reset.md). Design: [specs/user-data-reset.md](specs/user-data-reset.md).

## Android app

- **Where:** Android app, `/admin/settings/android`.
- **Who:** `system_settings:read` to view; `system_settings:write` to trust a build or publish a release.

The Android app is a Trusted Web Activity shell around the web app, plus optional native features. It needs https and object storage.

1. Publish a release (see the release runbook) and find it on the page under Releases.
2. On the phone, sign in to the server in the browser, download the APK and install it.
3. Open the app and enter the server address.
4. If the app shows a URL bar, the server does not trust that build yet: on the Android app page choose **Trust** next to the reported package and fingerprint, then reopen the app.
5. For a native feature, choose **Pair** in the app and approve the code on the activation page.
6. Choose **Send me a test notification** to check push delivery.

Procedures: [runbooks/android-app.md](runbooks/android-app.md), [runbooks/android-release.md](runbooks/android-release.md). Design: [specs/native-companion-architecture.md](specs/native-companion-architecture.md).

## Notifications and Web Push

Three pages cover notifications.

| Page | Route | Who | What it does |
|---|---|---|---|
| Notifications (user) | `/settings/notifications` | every user | Choose which events notify you and whether they arrive by email or in your browser |
| Notifications (admin) | `/admin/settings/notifications` | `system_settings:read` to view, `system_settings:write` to change | Switch browser notifications off for everyone, and suppress single events |
| Web Push | `/admin/settings/push` | `push:read` to view, `push:write` to change | Generate and manage the VAPID key pair that browser push needs |
| Broadcasts | `/admin/settings/broadcasts` | `broadcasts:read` / `broadcasts:write`; `org_broadcasts:read` / `org_broadcasts:write` for your own organization | Announce something to every active user |

Turn on Web Push:

1. Open Web Push and choose **Generate & enable**, optionally with a `mailto:` or `https:` subject. This works once; use Rotate afterwards.
2. Users allow notifications in their browser from their Notifications page.
3. Use the switch on the Web Push page to disable it without losing the keys.

Send a broadcast:

1. Open Broadcasts and compose the message.
2. Send it now or set a schedule.
3. Watch the delivery counts; cancel it while it runs, or resume it if it failed.

A broadcast respects each recipient's preferences and the admin switch. An organization administrator's broadcast reaches only that organization.

Procedures: [runbooks/vapid-keys.md](runbooks/vapid-keys.md). Design: [specs/browser-notifications.md](specs/browser-notifications.md), [specs/notification-broadcasts.md](specs/notification-broadcasts.md).

## Database backup and restore

- **Where:** Database Backup, `/admin/settings/db-backup`.
- **Who:** `db_backup:read` to view; `db_backup:write` to change the policy and to start, cancel or delete backups; `db_backup:restore` to restore or roll back. All are system permissions held by `admin`.

Backups stream into object storage, so configure Storage first.

1. Open the page and set the schedule: enabled, frequency, time of day and time zone, and how many backups to keep.
2. Choose **Back up now** for an immediate backup.
3. Watch the run; download the archive, cancel or delete a run from its row.
4. To restore, choose **Restore from this backup** on a completed run, read the pre-flight checks, acknowledge and type the confirmation phrase.
5. The application serves normally during the restore until a seconds-long swap, then restarts itself. Verify before deleting anything.
6. A restore can be rolled back from the same page while the displaced database or the pre-restore dump still exists.

Restore needs a restart policy on the API container and a single API replica. With `DEPLOYMENT_MODE=saas` there is no in-app restore; use the database provider's point-in-time recovery.

Procedures: [runbooks/database-restore.md](runbooks/database-restore.md), [runbooks/postgres-client-version.md](runbooks/postgres-client-version.md). Design: [specs/database-backup.md](specs/database-backup.md), [specs/database-restore.md](specs/database-restore.md).

## Jobs and Worker Nodes

- **Where:** Jobs and Job Insights, `/admin/settings/jobs` and `/admin/settings/jobs/insights`; Worker Nodes, `/admin/settings/workers`.
- **Who:** `jobs:read` to look, `jobs:write` to retry, reset or delete jobs. `nodes:read` to look at the fleet, `nodes:write` to mint credentials and revoke them.

Every long-running activity (backups, exports, resets, broadcasts, AI runs) is a job in a Postgres-backed queue.

1. Open Jobs to see the queue. Filter by type or status.
2. Retry a failed job, reset a stalled one or delete one from its row.
3. Open Job Insights to see durations, throughput and a projected finish time for outstanding work.
4. To run jobs on other machines, open Worker Nodes and create a node credential.
5. On the machine, run `appctl node enroll`, `appctl node register`, `appctl node doctor` and `appctl node start --daemon`.
6. The page shows each node, its vitals and its credentials; revoke a credential to cut a node off.

AI jobs always run on the server and never on a node.

Procedures: [runbooks/run-worker-nodes.md](runbooks/run-worker-nodes.md), [runbooks/node-job-secrets.md](runbooks/node-job-secrets.md). Design: [specs/job-queue.md](specs/job-queue.md), [specs/worker-nodes.md](specs/worker-nodes.md).

## Doctor

- **Where:** Doctor, `/admin/settings/doctor`.
- **Who:** `system_settings:read`.

The Doctor runs read-only checks across the database, sign-in, storage, email, jobs, telemetry, AI and more. It sends nothing and changes nothing.

1. Open the Doctor and read the verdict at the top.
2. Expand a category with a warning or failure, or turn on **Problems only**.
3. Read each row's detail and remedy, then use **Open settings** to fix it.
4. Choose **Run again**; a report is cached for 15 seconds otherwise.
5. To send a support request, choose **Download support bundle**, next to **Run again**. It is one redacted file.

Procedure: [runbooks/doctor.md](runbooks/doctor.md). Design: [specs/doctor.md](specs/doctor.md).

## Storage

- **Where:** Storage, `/admin/settings/storage`.
- **Who:** `storage_config:read` to view; `storage_config:write` to change.

Object storage holds uploads, backups, exports and APKs. It is configured here at runtime, never by environment variable. Providers are S3, Cloudflare R2 and any S3-compatible store, plus any storage driver your developers added (it appears in the same list).

1. Open the page and choose the provider.
2. Enter the bucket, region (required for S3), endpoint where the provider needs one, and the access key pair.
3. Choose **Test connection**. It runs four separate checks against what is on screen.
4. If the bucket is missing and the credential may create it, choose **Create bucket**.
5. Choose **Save changes**. To rotate a key later, paste only the new secret and save.

Saving a different bucket or provider while objects still point at the old one asks you to type a confirmation first. Nothing is deleted, but this deployment can no longer read those objects. Procedure: [runbooks/storage-configuration.md](runbooks/storage-configuration.md). Design: [specs/storage-providers.md](specs/storage-providers.md).

## Email

- **Where:** Email, `/admin/settings/email`.
- **Who:** `system_settings:read` to view; `system_settings:write` to save and send a test.

1. Open the page and choose the transport: SES, SMTP, or one your application added.
2. Fill in the connection and the sender address. Secrets are write-only; leave one blank to keep the stored value.
3. Switch email on.
4. Save.
5. Choose **Send test email**. The message goes to your own address and the provider's answer is shown verbatim, success or failure.

Package reference: [packages/platform-web/src/email/README.md](../packages/platform-web/src/email/README.md), [packages/platform-api/src/email/README.md](../packages/platform-api/src/email/README.md).

## AI: keys, models and caps

- **Where:** AI (`/admin/settings/ai`), AI Models, AI Usage and Organization AI keys for administrators; AI Keys (`/settings/ai`) for users. The cards other than AI appear only while AI is on.
- **Who:** `ai_config:read` / `ai_config:write` for the deployment. `org_ai_config:read` / `org_ai_config:write` (`org_admin`) for an organization's own keys. `ai:use` for users, held by `org_admin` and `contributor` but not `viewer`.

Switch AI on for the deployment:

1. Open AI and switch **Enabled** on.
2. Enable a provider and add the admin key. The server verifies the key before storing it, then shows only a masked hint.
3. Choose the key policy: `byok` (each user brings a key) or `byok_with_org_fallback` (users without a key use the admin key).
4. Open AI Models, refresh the catalog, classify new models and enable the ones users may call.
5. Watch AI Usage for who calls what.

Organization keys and caps (multi-org mode):

1. An organization administrator opens Organization AI keys and sets the organization's own key per provider. It is verified first and shown afterwards by its last four characters.
2. On Organization settings they can tighten the AI policy: switch AI off for the organization, disable the fallback to the deployment key, switch providers off, or set lower daily caps.
3. An organization can only tighten; it cannot loosen what the deployment sets.

Users add their own key on AI Keys. The kill switch is the same Enabled toggle: while it is off, every AI route except the config read answers as disabled.

Procedure: [runbooks/ai-configuration.md](runbooks/ai-configuration.md). Design: [specs/ai-platform.md](specs/ai-platform.md).

## Other Console pages

| Page | What it is for | Reference |
|---|---|---|
| Maintenance (`/admin/settings/maintenance`, `system_settings:read`) | Take the application out of service for planned work, with a message | [runbooks/maintenance-mode.md](runbooks/maintenance-mode.md) |
| Telemetry, Explorer, Dashboard | Metrics, logs and traces in GreptimeDB | [runbooks/telemetry.md](runbooks/telemetry.md) |
| About (`system_settings:read`) | The running version, commit and install time | [runbooks/deployment-info.md](runbooks/deployment-info.md) |
| Access Tokens (`/settings/tokens`) | Personal access tokens for scripts and CI | [personal-access-tokens.md](personal-access-tokens.md) |

## See also

- [README.md](README.md): every document.
- [ADOPTING-THE-PLATFORM.md](ADOPTING-THE-PLATFORM.md): moving an existing app onto the packages.
- [specs/settings-ui.md](specs/settings-ui.md): how the settings hubs and their cards are declared.

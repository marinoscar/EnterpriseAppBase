# Runbook: Air-gapped deployments

> **Audience:** operators · **Spec:** [doctor.md](../specs/doctor.md#network) · **Doctor check:** `network.egress` · **Variable:** `DEPLOYMENT_NETWORK` · **Permission:** `system_settings:read`

Use this when a deployment runs, or is about to run, on a network with no route to the internet: an on-prem install, a customer cloud with egress blocked, an isolated lab. It tells you which capabilities need the internet, what stops working without it, and how to make each one internal or switch it off. The admin Doctor's `network.egress` check reads the same inventory from the running deployment.

The check is **configuration only**. It never opens a connection, resolves a name or probes a port: it reads each capability's settings and classifies the configured host by its shape (see [How hosts are classified](#how-hosts-are-classified)). A pass means "nothing that is switched on points at the internet", not "every internal host answers"; the other Doctor checks (`storage.bucket`, `telemetry.reachable`) and each settings page's Test button prove reachability.

## 1. Before you start

- You need an Admin account: the Doctor requires `system_settings:read`.
- Know which internal services will replace the public ones (an SMTP relay, MinIO or another S3-compatible store, an OpenAI-compatible model server). Set them up first; this runbook points the deployment at them.
- Some dependencies exist only at **install time** (images, packages, certificates) and are invisible to the running API. They are listed in [section 5](#5-install-time-dependencies-the-doctor-cannot-see).
- Google sign-in has **no offline alternative today**. Read [`auth.google`](#authgoogle-google-sign-in) before committing to an air-gapped install.

## 2. Declare the network

1. In `infra/compose/.env`, set `DEPLOYMENT_NETWORK` to `air-gapped`. The only other value is `online`, the default (an empty value means the same).
2. Restart the API. The variable is read at startup; any other value stops the API with a message naming `DEPLOYMENT_NETWORK`, and the deploy wizard (`appctl deploy`) refuses it before it is written.
3. The startup log reads `Deployment network: air-gapped (DEPLOYMENT_NETWORK)`.

`DEPLOYMENT_NETWORK` changes no behaviour of any capability. It tells the Doctor to grade the outbound dependencies instead of only listing them.

## 3. Read the Doctor row

Open `/admin/settings/doctor` (or `GET /api/admin/doctor?category=network&refresh=true`) and find **Outbound dependencies (air-gap readiness)**, id `network.egress`, category `network`.

| `DEPLOYMENT_NETWORK` | Finding | Status |
|---|---|---|
| `online` | anything | `pass`: an inventory, "N outbound dependencies enabled (P public, Q private): ..." |
| `air-gapped` | every enabled dependency is on a private network | `pass`: "Air-gap ready" |
| `air-gapped` | only optional dependencies are public | `warn`: names each one and its host |
| `air-gapped` | a **required** dependency is public (Google as the only sign-in provider) | `fail`: names the dependency, its host and the section below |

Only **enabled** dependencies count: a capability that is switched off needs nothing. A host the Doctor cannot classify (no host configured, or an unparsable one) counts as public for an air-gapped deployment, so it fails closed. The row's `data` carries the counts (`enabled`, `public`, `private`, `unknown`, `required_public`) and `public_ids`, the ids of every enabled dependency that is not private. Find each id below.

### How hosts are classified

Private: `localhost`; a single-label name (a Docker service such as `minio`, `greptimedb`, `ollama`); IPv4 in `10/8`, `172.16/12`, `192.168/16`, `127/8`, `169.254/16`; IPv6 `::1`, `fc00::/7`, `fe80::/10`; a name ending in `.internal`, `.local`, `.lan`, `.home.arpa`, `.svc` or `.cluster.local`. Everything else is public, including a company domain such as `models.example.com` that only resolves internally. Point such hosts at a private-looking name (a `.internal` alias, the service name, an IP) if you want the Doctor to recognise them.

## 4. Dependencies

Every id the check can report, what stops working offline, and how to make it internal. Settings pages are under `/admin/settings`.

### `auth.google`: Google sign-in

- **Hosts:** `accounts.google.com` (browser), `oauth2.googleapis.com`, `www.googleapis.com` (API). **Required** while Google is the only enabled sign-in provider, which it is in this template.
- **Offline:** nobody can sign in. This is the `fail`.
- **Make it internal:** there is no offline alternative today. Per-organisation OIDC and SAML, which would let an install use an internal identity provider, are deferred in the platform epic, issue #672 (see the [platform packages spec](../specs/platform-packages.md#deployment-modes)). Until then an air-gapped install needs a proxy that lets the API and browsers reach those three Google hosts, or a fork that adds an internal provider (then `auth.google` is no longer required and grades as a `warn`).

### `auth.google.avatars`: Google profile pictures

- **Host:** `lh3.googleusercontent.com` (browser). Optional.
- **Offline:** profile pictures from Google do not load; the app shows initials.
- **Make it internal:** nothing to do; users may upload their own picture, which is served from object storage.

### `ai.provider.<id>`: AI providers

- **Hosts:** the provider's endpoint: `api.openai.com`, `api.anthropic.com`, `generativelanguage.googleapis.com`, your Azure OpenAI resource (`<name>.openai.azure.com`), or the base URL of an OpenAI-compatible server. One entry per provider slot; enabled when AI is on and that provider is enabled. Optional.
- **Offline:** every AI feature served by that provider fails.
- **Make it internal:** at `/admin/settings/ai`, disable the public providers and enable **OpenAI-compatible** with the base URL of an internal model server (for example `http://ollama:11434/v1`, or vLLM or LM Studio), with **Requires an API key** off if it has none. Or switch AI off there, which also stops the catalog refresh below. See the [AI configuration runbook](ai-configuration.md).

### `ai.catalog-refresh.<id>`: the daily model catalog refresh

- **Hosts:** the same as the provider's. One entry per provider the daily 04:00 job would refresh (AI on, provider enabled).
- **Offline:** the `ai.catalog.refresh` job fails every day, unattended, and the job history fills with failures.
- **Make it internal:** the same as `ai.provider.<id>`: an internal OpenAI-compatible server is refreshed like any provider; a disabled provider, or AI off, is never refreshed.

### `ai.realtime.<id>`: AI realtime voice

- **Hosts:** the provider's endpoint, reached by the **browser** after `POST /api/ai/realtime/sessions` mints an ephemeral secret. Only providers whose adapter supports realtime (OpenAI today).
- **Offline:** voice sessions cannot connect.
- **Make it internal:** disable that provider at `/admin/settings/ai`. No internal realtime provider ships today.

### `push.web-push`: Web Push

- **Hosts:** the push services subscribers' browsers registered with (`fcm.googleapis.com`, `updates.push.services.mozilla.com`, `web.push.apple.com`), read from the subscriptions, with a subscriber count. Always public.
- **Offline:** browser push notifications are not delivered; the in-app inbox still is.
- **Make it internal:** switch Web Push off at `/admin/settings/push` ([VAPID keys runbook](vapid-keys.md)). Browser push services cannot be self-hosted.

### `email.<transport>`: email (`email.smtp`, `email.ses`, and one per transport an app registered)

- **Hosts:** the SMTP relay's host, `email.<region>.amazonaws.com` for Amazon SES, or the hosts a registered transport declares (none for a local transport such as an in-memory log).
- **Offline:** no email is sent (invitations, notification emails, digests).
- **Make it internal:** at `/admin/settings/email`, choose **SMTP** with an internal relay (for example `smtp.corp.internal`), then **Send test email**. SES has no internal equivalent.

### `storage.s3`: object storage

- **Hosts:** the store's endpoint, or `s3.<region>.amazonaws.com` for Amazon S3 with no endpoint. Direction **both**: presigned URLs send the browser to the same host for uploads and downloads, so browsers must reach it too.
- **Offline:** uploads, downloads, profile pictures and database backups fail.
- **Make it internal:** at `/admin/settings/storage`, choose **S3-compatible** with MinIO or another internal store (for example `http://minio:9000`, path-style), and make sure browsers can reach that endpoint. See the [storage configuration runbook](storage-configuration.md).

### `telemetry.greptimedb`: the telemetry store

- **Host:** the GreptimeDB host of the reader connection.
- **Offline:** the telemetry explorer, dashboards and retention cannot reach the store.
- **Make it internal:** run GreptimeDB in the cluster with `telemetry.compose.yml` (host `greptimedb`), or save an internal host at `/admin/settings/telemetry`. See the [telemetry runbook](telemetry.md).

### `docs.scalar-cdn`: the API reference page

- **Hosts:** `cdn.jsdelivr.net` (the Scalar bundle) and `fonts.scalar.com` (its fonts), loaded by the **browser** on `/api/docs`. Optional.
- **Offline:** `/api/docs` renders an empty page. The API and `/api/openapi.json` keep working.
- **Make it internal:** self-host the `@scalar/api-reference` standalone bundle (behind the deployment's own nginx, or an internal static host) and set `API_DOCS_CDN` for the `api` container to its URL. A same-origin path (`/scalar/api-reference.js`) removes the dependency entirely. The default bundle may still request fonts from `fonts.scalar.com`; a self-hosted bundle configured without default fonts does not.

### A contributor that failed

If a module's description throws, the row lists one entry under that module's id (for example `email`) with an unknown host, and the API log has `Egress contributor "<id>" threw: ...`. It counts as public. Fix the cause (usually an unreadable settings row; the module's own Doctor check says more) and run again.

### Dependencies a fork adds

A fork registers its own outbound dependencies (an app-specific download host, say) with `EgressRegistry`; they appear here under the fork's ids. See the [Doctor spec](../specs/doctor.md#4-extending-it-in-a-fork).

## 5. Install-time dependencies the Doctor cannot see

The running API cannot see these, so `network.egress` never reports them. Provide them before the install goes offline.

| Dependency | Used by | Internal alternative |
|---|---|---|
| `git clone` of the repository | `appctl deploy` on a fresh server | Copy the repository in, or mirror it on an internal Git server |
| Container image pulls (`ghcr.io`, Docker Hub) | `docker compose pull` / build | An internal registry mirror; or build the images where the internet is reachable and load them (`docker save` / `docker load`). See the [container images runbook](container-images.md). |
| npm packages | building images from source | An internal npm mirror, or prebuilt images |
| ACME certificates (Let's Encrypt) | the VPS deploy's HTTPS | Certificates from an internal CA, installed on the host proxy |
| The OpenTelemetry collector's `httpcheck` of the public origin | `telemetry.compose.yml` | Point it at the internal origin, or remove the receiver from `infra/otel/` |

## 6. Summary checklist

- [ ] `DEPLOYMENT_NETWORK=air-gapped` in `infra/compose/.env`, API restarted
- [ ] Doctor run with **Run again**; `network.egress` read
- [ ] Sign-in: decided how users sign in (`auth.google` has no offline alternative today)
- [ ] AI: an internal OpenAI-compatible server, or AI switched off
- [ ] Web Push switched off
- [ ] Email through an internal SMTP relay
- [ ] Storage on MinIO or another internal S3-compatible store, reachable from browsers
- [ ] GreptimeDB in the cluster (or telemetry off)
- [ ] Scalar self-hosted and `API_DOCS_CDN` set, or `/api/docs` accepted as unavailable
- [ ] Install-time dependencies mirrored or preloaded
- [ ] `network.egress` is `pass`, or every remaining `warn` is accepted

## See also

- [Doctor runbook](doctor.md) and [spec](../specs/doctor.md): every check, and how to add an outbound dependency.
- [Platform packages spec](../specs/platform-packages.md): deployment modes and their gaps.
- [Security architecture](../SECURITY-ARCHITECTURE.md): what the egress inventory may and may not report.

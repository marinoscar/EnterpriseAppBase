# Runbook: Configuring the AI Platform

This runbook is the operator-facing procedure for turning AI on for a
deployment of this application, curating what it can do, choosing who pays
for it, and turning it off again — calmly, in an emergency, or forever. It
does not explain *why* the platform is shaped this way; that is
[`docs/specs/ai-platform.md`](../specs/ai-platform.md), which this runbook
links back to rather than restates. The developer-facing recipe for adding
AI to a feature, or a new provider adapter, is
[`CLAUDE.md`](../../CLAUDE.md)'s "MANDATORY: AI Platform Rules" section and
[`apps/api/src/ai/README.md`](../../apps/api/src/ai/README.md).

Everything in this document happens through the admin UI at
`/admin/settings/ai` (and `/admin/settings/ai/models`) or through
`appctl api` calls against the same endpoints — there is no environment
variable for any of it, and there must never be one (CLAUDE.md's
"Environment Variables" section states this explicitly).

## 0. Prerequisites

- **`SECRETS_ENCRYPTION_KEY` must be set** on the API process before any key
  — admin/org or a user's own — can be stored. The admin/org key lives in
  `CredentialsService` (`purpose: 'ai'`), and BYOK keys live in the
  dedicated `user_ai_keys` table, encrypted with a separate cipher purpose
  (`'ai_user_key'`); both paths call the same `SECRETS_ENCRYPTION_KEY`-backed
  encryption underneath. If this key is unset, saving any AI key fails —
  see `docs/runbooks/rotate-secrets-encryption-key.md` if you need to
  generate or rotate it.
- **Admin access** (`ai_config:read`/`ai_config:write`, seeded to the Admin
  role only) to reach `/admin/settings/ai`.
- Decide **before** you configure anything: will every user bring their own
  provider key (`byok`, the default and the safer starting posture), or
  should users with no key of their own fall back to a deployment-wide
  admin/org key (`byok_with_org_fallback`)? This is a deployment-wide
  policy decision, not a per-user one — see §3 below and
  `docs/specs/ai-platform.md` §3.

## 1. Turning AI on

1. Sign in as an Admin and open `/admin/settings/ai`. This card is
   reachable even while AI is off — it is the page that turns it on, so it
   deliberately carries no `feature` gate of its own (unlike every other AI
   card in the app).
2. Toggle **Enabled**. Until you do, every consumer-facing route under
   `/api/ai/*` (except `GET /api/ai/config`, which is how the web app
   learns AI is off at all) answers `403` with `details.reason:
   "AI_DISABLED"`, and no AI-shaped card or navigation entry appears
   anywhere else in the app.
3. Enable the provider(s) you intend to use — `openai` and, since #446,
   `anthropic` (§13 covers what is different about Anthropic).
   Enabling AI overall does nothing by itself if every individual provider
   stays disabled — a provider existing in the adapter registry does not
   mean it is reachable.

Equivalently, from the CLI:

```bash
appctl api PATCH /system-settings --data '{"ai":{"enabled":true}}'
```

(`PATCH /api/system-settings` and `PUT/PATCH /api/admin/ai/config` both work
against the same `ai` namespace; the dedicated `ai_config:*`-gated route is
the one the admin UI itself uses and the one this runbook otherwise assumes.)

## 2. Adding the admin (org) key

The admin/org key exists for exactly two purposes — discovering and
classifying a provider's models (§4 below), and, only under
`byok_with_org_fallback`, serving a request for a user who has not brought
their own key. It is **never** a default key for everyone regardless of
policy, and no endpoint anywhere ever returns it once stored.

1. On `/admin/settings/ai`, open the provider's row and paste the key.
2. The server verifies it against the provider **before** storing anything
   (`adapter.verifyKey`) — a rejected key comes back as a clear error and
   nothing is saved.
3. Once stored, the UI shows only a masked hint (`keyStatus`), never the key
   itself — this is true of every AI key surface in this platform, admin or
   user.

## 3. Testing the admin key

Use the **Test** action on the provider's row
(`POST /api/admin/ai/providers/:provider/test`). This always answers `200`
— a failed test is a successful diagnosis, not an error response — so read
the `success` field and each check's own `status`/`code`. Three checks run,
in order:

1. `credentials` — does the provider accept the key at all.
2. `list_models` — how many catalog models the key can see.
3. `responses_smoke` — one tiny, real, **billed** response call, to prove
   the key can actually answer a request and not merely list models.

That third check is deliberate and admin-only: it is this platform's own
money being spent to prove the deployment's key works, which is why the
equivalent *user* key test (`POST /api/ai/keys/:provider/test`, §6 below)
stops at the first two checks and never bills a user's own account on their
behalf.

## 4. Refreshing the model catalog

Discovery lists a provider's model ids; classification guesses their
capabilities. Neither happens automatically on a schedule you don't
control beyond the platform's own daily backfill — trigger a refresh
on demand from `/admin/settings/ai/models` (**Refresh catalog**), or:

```bash
appctl api POST /admin/ai/models/refresh --data '{"provider":"openai"}'
appctl api POST /admin/ai/models/refresh --data '{"provider":"anthropic"}'
```

This enqueues the `ai.catalog.refresh` job (server-only, always — see
`docs/specs/ai-platform.md` §9) and answers `{ jobId }` at once; watch its
outcome at `/admin/settings/jobs`. It requires an admin key for that
provider (409 without one) because discovery and classification always run
under the admin/org key, unconditionally, regardless of the deployment's key
policy.

A refresh that actually ran a sync also fires `AI_CATALOG_SYNCED_EVENT`,
which the keys module listens for to re-check affected users' stored keys
against the newly discovered or reclassified models right away, rather than
waiting for the weekly `ai.keys.recheck` cron.

## 5. Classifying unclassified models and enabling them

A freshly discovered model starts `enabled: false` with
`capabilitySource: 'unclassified'` — discovery alone changes nothing a user
can reach. On `/admin/settings/ai/models`:

1. Filter by `capabilitySource: unclassified` (or the equivalent
   `?includeDeprecated=false&...` query on `GET /api/admin/ai/models`) to
   find models the provider's own classifier didn't recognize.
2. For each one, either accept a best guess or set its capabilities
   explicitly (`PATCH /api/admin/ai/models/:id`, body
   `{ capabilities: {...} }`) — this sets `capabilitySource:
   'admin_override'`, which nothing automated ever overwrites again.
3. Flip **Enabled** on the models you want callable. A model must be both
   admin-enabled and reachable with whichever key resolves for a given
   caller (§7 of the spec) before anyone can actually use it — enabling it
   here is necessary but not sufficient on its own.

Enabling a deprecated model, or enabling an unclassified model with no
capabilities supplied, is refused (409 / 400 respectively) — an operator
must make an explicit capability decision rather than the platform guessing
one into existence.

## 6. Choosing the key policy

- **`byok` (default)** — every user must bring their own key
  (`/settings/ai`, gated by `ai:use`, seeded to all three roles) before they
  can call any model. No admin key, however well-funded, is ever used to
  serve a user's request under this policy — this is the platform's core
  security invariant, and it is enforced in one place
  (`AiKeyResolver.resolve`), not scattered across call sites.
- **`byok_with_org_fallback`** — a user with no key of their own is served
  by the admin/org key instead, for whichever providers have one configured.
  Setting this policy while a provider has no admin key configured is
  refused (400 `AI_KEY_REQUIRED`).

Switch it on `/admin/settings/ai`, or:

```bash
appctl api PUT /admin/ai/config --data '{"keyPolicy":"byok_with_org_fallback", ...}'
```

(`PUT` replaces the whole non-secret configuration and takes an `If-Match`
version header, like the storage-configuration endpoint — read the current
config first to get the current `version`.)

## 7. How users add their own key

Point users at `/settings/ai` (the **AI Keys** card, visible only once AI is
enabled — it declares `feature: 'ai'`). From there a user can:

- Paste a key for any enabled provider (`PUT /api/ai/keys/:provider`). It is
  verified against the provider first, then the models it can actually
  reach are computed and stored as `reachableModelIds`, and only then is
  anything saved — a rejected key is never stored.
- **Test** their stored (or a not-yet-saved) key
  (`POST /api/ai/keys/:provider/test`) — two checks only (`credentials`,
  `list_models`), never a billed smoke call against their own account.
- See which models they can actually call right now (`GET /api/ai/models`)
  — the intersection of admin-enabled models and what their key (or the org
  key, under fallback) can reach.
- Remove a key (`DELETE /api/ai/keys/:provider`) — idempotent, 204 either
  way.

A key's reachable-model list is re-verified weekly by the `ai.keys.recheck`
job (and sooner, per §4, right after a catalog sync touches that provider) —
a key's tier or organization restrictions are real and can change without
the user doing anything, so this list does not stay a one-time snapshot.

## 8. Turning AI off in an emergency

The kill switch (`ai.enabled = false`) is total on the consumer side and
leaves the admin side reachable, specifically so you are never locked out of
turning it back on:

- **From the UI**: `/admin/settings/ai` → toggle **Enabled** off. Takes
  effect immediately; every `/api/ai/*` route except `GET /api/ai/config`
  starts answering `403 AI_DISABLED`.
- **From the CLI**, when the UI itself is unreachable or you are scripting
  an incident response:

  ```bash
  appctl api PATCH /system-settings --data '{"ai":{"enabled":false}}'
  ```

`/api/admin/ai/*` (and the admin UI itself) stays reachable throughout, so
you can inspect what is configured or fix a bad setting even with the
platform switched off. Any in-flight `ai.response.run` job that has not yet
reached the provider fails cleanly (its run row records `AI_DISABLED`, and
the *job* still succeeds — this is an expected outcome, not an incident, so
it does not fire `jobs.job_failed`); a background run that has already made
its provider call runs to completion.

## 9. Rotating the admin key

Provider key rotation (a leaked key, a routine rotation policy, moving to a
different provider account):

1. `/admin/settings/ai` → the provider's row → set a new key. It is
   verified before it replaces the old one, so a bad replacement key never
   leaves you without a working one silently.
2. Or remove it outright (`DELETE /api/admin/ai/providers/:provider/key`,
   body `{"confirmation":"REMOVE"}`) if you are decommissioning that
   provider. Under `byok_with_org_fallback`, removing the only admin key a
   provider has answers with `warnings: ["ORG_FALLBACK_WITHOUT_KEY"]` — users
   with no key of their own for that provider will start seeing
   `AI_KEY_REQUIRED` until you either restore an admin key or every affected
   user brings their own.
3. There is nothing else to rotate — user BYOK keys are each that user's own
   responsibility, revocable individually from `/settings/ai`.

## 10. Troubleshooting by error code

Every failure this platform raises is an `AiError` with a stable `code`,
surfaced as `details.reason` on the HTTP response (the envelope's
top-level `code` is always the ordinary status-derived
`FORBIDDEN`/`BAD_REQUEST`/etc. this API already uses everywhere — the AI
code is specifically in `details.reason`). This table is the quick
reference; the full one is `docs/specs/ai-platform.md` §13.

| `details.reason` | HTTP | What it means | What to check |
|---|---|---|---|
| `AI_DISABLED` | 403 | The kill switch is off. | §1 — enable AI at `/admin/settings/ai`. |
| `AI_PROVIDER_DISABLED` | 403 | AI is on, but this specific provider is not. | Enable the provider on `/admin/settings/ai`. |
| `AI_KEY_REQUIRED` | 403 | No key resolves for this user/provider under the active policy. | Under `byok`: the user has no key — §7. Under `byok_with_org_fallback`: neither the user nor the deployment has one — §2/§9. |
| `AI_KEY_INVALID` | 400 | A submitted key was rejected by the provider. | The key is wrong, revoked, or scoped incorrectly at the provider. Nothing was stored. |
| `AI_MODEL_NOT_ENABLED` | 403 | The model is unknown, not admin-enabled, or deprecated. | Enable it (or pick an enabled one) on `/admin/settings/ai/models` — §5. |
| `AI_MODEL_NOT_REACHABLE` | 403 | The model is enabled, but the resolved key can't reach it. | The key's own tier/org restrictions — try `POST /api/ai/keys/:provider/test`, or refresh reachability by re-testing/re-saving the key. |
| `AI_CAPABILITY_UNSUPPORTED` | 400 | The model or provider lacks a capability the request needs (e.g. structured output, a tool, vision input), or the request chains with `previousResponseId` on a provider that stores no responses (Anthropic — `details.capability: "previous_response_id"`). | Pick a model/provider that declares it, or drop that part of the request; for Anthropic, send the conversation as `input` instead of chaining (§13). |
| `AI_TOOL_DISABLED` | 403 | A hosted tool (web search, file search, code interpreter, image generation, MCP) that is switched off, or an MCP server host outside the allowlist. | §12 — switch the tool on, or add the host, under **Hosted tools** on `/admin/settings/ai`. |
| `AI_RATE_LIMITED` | 429 | The provider throttled the call. | Transient; for a background run this defers automatically rather than charging an attempt. |
| `AI_PROVIDER_UNAVAILABLE` | 503 | The provider is unreachable or erroring at the transport level. | A provider-side outage, or `AI_PROVIDER_UNAVAILABLE` after an aborted/cancelled call. Check the provider's own status page. |
| `AI_CONTENT_FILTERED` | 422 | The provider's own content filter rejected the request or response. | Not a platform bug — the provider refused this specific content. |
| `AI_INVALID_REQUEST` | 400 | The request itself is malformed (no model/provider resolvable, a background run given a function tool, an invalid `maxOutputTokens`). | Check the request shape; function tools cannot run in a background run — use `runTools()` in-process instead. |
| `AI_STRUCTURED_OUTPUT_INVALID` | 502 | The model's output didn't parse against the requested schema. | Usually a model/schema mismatch, or a model too weak to reliably follow the schema; consider `strict: true` or a different model. |

## 11. Privacy: prompt logging

`ai.logPromptContent` (default **off**) is a deliberate, named privacy
switch — when off, no prompt text (instructions or input) is ever written
to a debug log line. Turning it on is a real decision, not a debugging
convenience left on by accident: prompt content can include anything a user
typed, and every log line derived from a call already redacts key material
unconditionally regardless of this setting (that part is not optional). Even
with it on, logged text is truncated to `AI_PROMPT_LOG_MAX_CHARS`
(2048 characters, `runtime/ai.service.ts`) and the key is never in scope to
log by construction — but the prompt text itself is the user's, so treat
this switch the same way you would treat verbose request logging anywhere
else in the app: on only for as long as you are actively debugging, and off
by default.

## 12. Hosted tools

Under **Hosted tools** on `/admin/settings/ai` there is one switch per
provider-hosted tool — web search, file search, code interpreter, image
generation and remote MCP servers — all **off** on a fresh deployment. Each
reaches outside this deployment (the open web, a third-party MCP server) and
is billed per use by the provider on whichever key pays for the call (§6), so
switch on only what users need. A request naming a switched-off tool is
refused with `AI_TOOL_DISABLED`; users also need a model that declares
**Hosted tools** on `/admin/settings/ai/models`.

**Allowed MCP hosts** narrows which servers users may point the model at —
one hostname per line (`mcp.example.com`), or `*.example.com` for its
subdomains. Leave it empty to allow any `https://` server (the page warns
while MCP is on with no list). MCP credentials are never configured here:
users send them per request in the tool's `headers`, which are never stored,
logged or returned — and a background run cannot carry them at all.

## 13. Enabling Anthropic

Anthropic (issue #446) is configured exactly like OpenAI — nothing here is
an environment variable, and nothing needs a restart:

1. On `/admin/settings/ai`, switch the **Anthropic** provider on (or
   `PUT /api/admin/ai/config` with `providers.anthropic.enabled: true`).
   `baseUrl` is optional and only for a gateway that speaks Anthropic's own
   API; leave it empty for `https://api.anthropic.com`.
2. Add the admin (org) key from the Anthropic Console on the provider's row
   (§2) and **Test** it (§3). The key is verified with `GET /v1/models`
   before anything is stored; the third, billed `responses_smoke` check is
   one tiny Messages call.
3. Refresh the catalog for `anthropic` (§4). The classifier recognises the
   Claude families (Claude 3 through the current Opus, Sonnet, Haiku, Fable
   and Mythos releases) and marks every other id `unclassified` — enable
   the models users should see (§5). No Anthropic model declares **Hosted
   tools**, embeddings, images or audio: the adapter implements text,
   reasoning, function tools, structured output, streaming, and image and
   PDF input only.
4. Users add their own Anthropic key on `/settings/ai` exactly as for
   OpenAI (§7), under the key policy you chose (§6).

What is different, and worth telling users:

- **No `previousResponseId`.** Anthropic keeps no conversation on its side.
  A request that chains onto an earlier response is refused with
  `AI_CAPABILITY_UNSUPPORTED` (`details.capability:
  "previous_response_id"`); send the conversation so far as `input`
  instead (user and assistant messages). In-process `runTools()` does this
  automatically. The AI Playground's multi-turn chat currently chains, so
  its second turn against a Claude model is refused — start a new thread
  per question until the playground learns to resend history.
- **Reasoning.** A reasoning effort becomes Anthropic's extended thinking:
  adaptive thinking with an effort level on Claude 4.6 and later, a fixed
  thinking-token budget on older families. Users see a summary of the
  thinking, never the raw chain of thought. A family without extended
  thinking (Claude 3.5 and earlier) refuses an effort.
- **Temperature.** Newer Claude models reject sampling parameters
  outright, and every Claude model rejects a temperature combined with
  extended thinking; both are refused up front with
  `AI_CAPABILITY_UNSUPPORTED` rather than sent.
- **Errors.** Anthropic's `529 overloaded` answers as
  `AI_PROVIDER_UNAVAILABLE` and its `429` as `AI_RATE_LIMITED`, each with
  the provider's `retry-after`; a background run defers on the latter
  without charging an attempt.


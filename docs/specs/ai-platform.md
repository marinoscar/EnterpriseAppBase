# AI Platform

> Epic #418 (umbrella), phase #419, and its stories #422–#436. This spec is
> filed by #422 (A0 — write this document) so that every parallel story in
> waves 0–4 shares one contract instead of each re-deriving it. It is written
> **ahead of** the code stories it describes (#423 database, #424 core
> contracts, #426 OpenAI adapter, #427 catalog, #428 admin API, #431 user
> keys, #432 runtime facade, #433 HTTP surface, #434 web admin UI, #435 web
> user UI, #436 CLAUDE.md recipe + runbook) so that parallel implementers
> build against it rather than against each other's in-progress code. Where
> this document says a file will exist, that file does not yet exist at the
> time this spec is written — treat every path below as the contract for
> whichever story creates it, not as evidence it is already there.
>
> **Out of scope for this document:** code (any of #423–#436 implements it);
> the CLAUDE.md "Adding an AI feature" recipe (#436); the operator runbook
> (#436). This document is the spec those two summarize and link back to.

## 1. What this is

The AI platform adds one admin-governed, bring-your-own-key (BYOK),
multi-provider, multimodal AI capability to this template, on the same
"administrator-editable, live, no restart" footing as Web Push (#355),
Broadcasts (#319) and Object Storage (#372) before it. Nothing about it is
deploy-time configuration: there is no `OPENAI_API_KEY` environment
variable, and there must never be one — see §14's rejected alternative and
the parallel rule already stated for storage in CLAUDE.md.

Seven things are true about this platform, and each is a separate gate a
call must pass, in this order — the governance model every other section
in this document exists to make precise:

1. **The platform itself is off by default.** `ai.enabled` starts `false`.
   An operator must turn it on before anything AI-shaped is reachable.
   (§8, the kill switch.)
2. **An operator chooses the key policy** before anyone can call a model:
   strict BYOK (`byok`, the default) or BYOK with an organization fallback
   (`byok_with_org_fallback`). This is a deployment-wide decision, not a
   per-user one. (§3.)
3. **An operator enables specific providers.** A provider existing in the
   adapter registry does not mean it is reachable — `providers.<id>.enabled`
   must be true. (§2.)
4. **An operator may configure an admin/org key**, which exists for two
   purposes only: discovering and classifying that provider's models (§6),
   and — only under the fallback policy — serving requests for users who
   have not brought their own key (§3). It is never a default key for
   everyone regardless of policy.
5. **An operator curates the model catalog.** Discovery lists model IDs;
   classification guesses their capabilities; an operator's enablement and
   capability overrides are the only things that make a model callable, and
   nothing automated ever overwrites either. (§6.)
6. **A user brings their own key**, per provider, verified against the
   provider and checked for which of the enabled models it can actually
   reach — a key's tier or org restrictions are real and differ per key.
   (§3, §7.)
7. **A user calls AI within what they are both permitted and able to use** —
   holding `ai:use`, and restricted to models that are simultaneously
   admin-enabled and reachable with whichever key resolution (§3) supplies.
   (§7, §11.)

Multimodal and multi-provider are contract properties, not features shipped
on day one: the normalized request/response (§5) and the capability model
(§4) are shaped so that image generation, audio transcription/speech,
embeddings and realtime are addable later (Phase 2/3) without a breaking
change to callers, and so a second provider (anything beyond the Phase 1
OpenAI adapter) is an adapter implementation, not a rewrite of the platform.

## 2. The configuration model

Configuration lives in two places, deliberately split, mirroring the split
storage already established in §2 of `docs/specs/storage-providers.md`:

**The `ai` system-settings namespace** (`system_settings.global`, read/write
through `SystemSettingsService`) holds everything that is *not* secret:

```ts
// ai settings namespace (system_settings, global row)
{ enabled: boolean /*false*/,
  keyPolicy: 'byok' | 'byok_with_org_fallback' /*'byok'*/,
  providers: { openai: { enabled: boolean /*false*/, baseUrl?: string } },
  defaults: { maxOutputTokensCap?: number, allowBackgroundRuns: boolean /*true*/ },
  logPromptContent: boolean /*false*/,
  usageRetentionDays: number /*180, 1–3650 — §12, #443*/ }
```

`GET /api/system-settings` returns the *entire* settings document, wholesale,
to any caller holding `system_settings:read` — that is simply how
`SystemSettingsService` works, and it is not being special-cased for `ai`.
That single fact is why the admin/org provider key can never live inside
this namespace: anything in `system_settings` is, by construction, returned
in full on every read of it. The key instead lives in **`CredentialsService`**
(the same encrypted-secret store SMTP, Web Push's VAPID private key and the
object-storage secret already use), addressed by `purpose: 'ai'`,
`name: '<providerId>'` — one row per provider, holding ciphertext plus a
masked hint, never the plaintext, exactly like
`storage-credential.constants.ts`'s pattern for the storage secret.

A **third** place holds per-user BYOK material: the `user_ai_keys` table
(§3, #423), one row per `(userId, provider)`, encrypted with
`encryptSecret(plaintext, 'ai_user_key')` — a dedicated cipher *purpose*,
distinct from the `'ai'` purpose the admin/org key's `CredentialsService`
row uses, so the two secret spaces cannot be confused by construction (a
`CredentialsService` lookup and a `user_ai_keys` decrypt use different HMAC
subkeys; neither can decrypt the other's ciphertext even by accident). It is
**not** stored in `CredentialsService`, because that store is scoped to
deployment-wide secrets with no per-user ownership or cascade-delete
semantics — see §14's rejected alternative for why reusing it anyway was
considered and turned down.

Non-secret, per-user preference (which model to default to) lives in a
fourth place: the `ai` sub-object already inside `user_settings` —
`ai: { defaultModel: { provider, modelId } | null }` — because it is exactly
as sensitive as every other per-user UI preference already in that
document, and creating a fourth settings surface for one nullable field
would be its own complexity.

## 3. The two keys and the key-resolution rule

There are exactly two keys a provider call can use, and they answer two
different questions:

- **The admin (org) key** — one per provider, in `CredentialsService`,
  `purpose:'ai'`. It exists to let the *platform* talk to a provider before
  any user has brought a key: catalog discovery and classification (§6) run
  under it unconditionally, and the connection-test probe (§9 of the admin
  routes table) uses it. It is **also** usable to *serve* a user's request,
  but **only** when `keyPolicy = 'byok_with_org_fallback'`.
- **The user (BYOK) key** — one per `(user, provider)`, in `user_ai_keys`,
  verified against the provider and checked for reachable models at set
  time (§7).

`AiKeyResolver.resolve(userId, provider)` is the one place this rule is
implemented, and every caller — the runtime facade (§9's `AiService`), the
usable-models computation (§7) — goes through it rather than re-deriving it:

```ts
resolve(userId, provider): Promise<{ apiKey: string; keySource: 'user' | 'org' }>
// 1. user key exists                                    -> { user }
// 2. policy 'byok_with_org_fallback' AND org key exists  -> { org }
// 3. otherwise                                           -> throw AiError('AI_KEY_REQUIRED')
```

**Under `keyPolicy = 'byok'` the org/admin key must never be returned by this
method, full stop** — not as a convenience, not as a "just this once" for an
internal caller. This is the platform's core security invariant, restated
here so it is traceable to one line: an administrator who opted a
deployment into strict BYOK has made a promise to every user that their own
provider account, quota and billing are the only ones a call of theirs can
touch. The conformance test that pins this ("under `byok`, the fake provider
records **zero** calls with the org key") is listed once, here, and again
verbatim in #431's and #432's acceptance criteria, precisely because two
independent stories both depend on it holding.

`ai_usage_events.keySource` records which of the three values actually
resolved a given call: `'user'`, `'org'`, or `'admin_discovery'` (§12) — the
third is reserved for calls the *platform itself* makes with the admin key
(catalog sync) and is never a value `AiKeyResolver` returns to a runtime
caller.

## 4. The capability model

Providers do not all speak the same protocol, and forcing them to would mean
the platform's public contract could only ever express what the *weakest*
supported provider can do (§14's rejected alternative). Instead, capability
is modeled at two levels that must agree:

**`AiCapability`** — a fixed enum a model or a provider *has or does not
have*:

```ts
export const AI_CAPABILITIES = ['responses','reasoning','tools','hosted_tools','structured_output','streaming',
  'vision_input','file_input','image_generation','image_edit','audio_transcription','audio_speech',
  'embeddings','realtime'] as const;
export type AiCapability = typeof AI_CAPABILITIES[number];
```

**Capability ports on `AiProviderAdapter`** — optional interface members,
one per capability family, that a provider adapter implements only for what
it actually supports:

```ts
export interface AiProviderAdapter {
  readonly id: string;               // 'openai' — permanent once chosen
  readonly displayName: string;
  listModels(ctx: AiCallContext): Promise<AiDiscoveredModel[]>;
  verifyKey(ctx: AiCallContext): Promise<AiKeyVerification>;
  classifyModel(modelId: string): AiModelCapabilities | null;   // null => 'unclassified'
  // Capability ports — presence IS the declaration (same idiom as JobHandler.nodeResultSchema)
  readonly responses?: AiResponsesPort;
  readonly images?: AiImagesPort;
  readonly audio?: AiAudioPort;
  readonly embeddings?: AiEmbeddingsPort;
  readonly realtime?: AiRealtimePort;
}
```

**Presence is the declaration** — the identical idiom CLAUDE.md's job-queue
section already uses for `JobHandler.nodeResultSchema` +
`persistNodeResult`: there is no `supportedCapabilities: AiCapability[]`
field on the adapter that could drift out of sync with what the adapter's
methods actually do. `AiProviderRegistry.supports(id, cap)` (§9) *derives*
the answer from port presence, so an adapter that implements `images` but
forgets to declare an `image_generation` flag somewhere is not a state this
model can represent — implementing the port **is** declaring the
capability.

Why not a lowest-common-denominator chat API (one `chat(messages)` method
every provider must somehow satisfy): reasoning-effort controls, hosted
tools (web search, file search, code interpreter, MCP), structured outputs
and background/streaming semantics are all things a "just messages" surface
either cannot express or can only express by inventing a provider-neutral
subset that throws away exactly the features BYOK users pick a provider
for. The capability model instead lets a caller (or the gate pipeline in
§9) ask "can this model do X" and get a precise answer, and lets a second
provider ship supporting only a subset of capabilities without changing the
interface anyone else depends on.

## 5. The normalized request/response

Requests and responses are shaped after the OpenAI Responses API — not
because every provider must literally be that API, but because it is the
richest widely-used shape (typed input items, hosted tools, structured
outputs, reasoning) and normalizing *down* from it to a simpler provider is
tractable, while normalizing *up* from a bare chat-completions shape is not.

```ts
// responses.types.ts (Responses-API-shaped)
export type AiInputItem =
  | { type: 'message'; role: 'user'|'assistant'|'system'|'developer'; content: AiContentPart[] }
  | { type: 'function_call_output'; callId: string; output: string };
export type AiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; url?: string; storageObjectId?: string; detail?: 'low'|'high'|'auto' }
  | { type: 'file'; storageObjectId?: string; url?: string; filename?: string };
export interface AiFunctionTool<P extends z.ZodTypeAny = z.ZodTypeAny> {
  type: 'function'; name: string; description: string; parameters: P; strict?: boolean;
}
export type AiHostedTool = { type: 'web_search' | 'file_search' | 'code_interpreter' | 'mcp'; options?: Record<string, unknown> };
export interface AiResponseRequest<S extends z.ZodTypeAny = z.ZodTypeAny> {
  model: string;
  instructions?: string;
  input: string | AiInputItem[];
  tools?: Array<AiFunctionTool | AiHostedTool>;
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'function'; name: string };
  structuredOutput?: { name: string; schema: S; strict?: boolean };
  reasoning?: { effort?: 'minimal'|'low'|'medium'|'high'; summary?: 'auto'|'concise'|'detailed' };
  maxOutputTokens?: number;
  temperature?: number;
  previousResponseId?: string;
  metadata?: Record<string, string>;
  providerOptions?: Record<string, Record<string, unknown>>;   // keyed by provider id; escape hatch
}
export type AiOutputItem =
  | { type: 'message'; text: string }
  | { type: 'reasoning'; summary: string[] }
  | { type: 'function_call'; callId: string; name: string; arguments: string }
  | { type: 'hosted_tool_call'; tool: string; status: string; result?: unknown };
export interface AiUsage { inputTokens?: number; outputTokens?: number; reasoningTokens?: number; cachedInputTokens?: number; }
export interface AiResponse<T = unknown> {
  id: string; provider: string; model: string;
  output: AiOutputItem[]; outputText: string; parsed?: T;
  usage: AiUsage; finishReason: 'stop'|'length'|'tool_calls'|'content_filter'|'error';
  providerRequestId?: string;
}
export type AiStreamEvent =
  | { type: 'response.created'; id: string }
  | { type: 'output_text.delta'; delta: string }
  | { type: 'reasoning_summary.delta'; delta: string }
  | { type: 'function_call.arguments.delta'; callId: string; delta: string }
  | { type: 'output_item.done'; item: AiOutputItem }
  | { type: 'response.completed'; response: AiResponse }
  | { type: 'error'; code: AiErrorCode; message: string };
```

`providerOptions`, keyed by provider id, is the deliberate escape hatch: a
caller who needs one provider's specific knob (a beta header, a
provider-only sampling parameter) can reach it without the normalized
contract growing a field for every provider's idiosyncrasy. It is optional,
provider-scoped, and never required for the contract's own guarantees to
hold.

Media (images/audio/embeddings/realtime) request/response types live in
`media.types.ts`, declared now (as part of #424, wave 0) but implemented
only in Phase 2/3: `AiImagesPort { generate(req, ctx); edit?(req, ctx) }`,
`AiAudioPort { transcribe?(req, ctx); speech?(req, ctx) }`,
`AiEmbeddingsPort { embed(req, ctx) }`, `AiRealtimePort { createSession(req,
ctx) }`. Every binary result is **bytes plus a MIME type** — never a
provider URL and never a filesystem path — so that the caller (not the AI
platform) decides whether and how to persist the result, through the
existing Storage Objects surface (`docs/specs/storage-providers.md`), the
same separation of concerns already enforced everywhere else media touches
storage in this repository. (Embeddings are the exception by nature: their
result is numbers, `{ vectors, dimensions }`, returned inline.)

### 5.1 Embeddings (Phase 2, issue #440)

The first Phase 2 port, and the shape the others follow: an adapter port
(`embeddings.embed`), one facade method (`AiUserClient.embed`), one usage
`operation` (`'embeddings'`), and one route (`POST /api/ai/embeddings`).

- **Facade.** `ai.forUser(userId).embed({ model, input, dimensions? })` →
  `{ provider, model, vectors, dimensions, usage }`, one vector per input in
  input order. It runs the same gate pipeline as `respond` (§7, §8), with
  `embeddings` as the one capability needed (model **and** provider port),
  then records one `ai_usage_events` row (`operation: 'embeddings'`,
  `inputTokens`). Synchronous — no job.
- **`model` is required.** Vectors are only comparable within one model, so
  an embedding model is never inferred from the caller's chat
  `ai.defaultModel`; store `model` and `dimensions` beside every vector.
- **Batch limit.** At most `AI_EMBEDDINGS_MAX_INPUTS` (256) non-empty texts
  per call. A larger batch is refused with `AI_INVALID_REQUEST` and a
  message telling the caller to chunk — never silently split.
- **`dimensions`** shortens every vector where the model supports it
  (OpenAI `text-embedding-3-*`); `text-embedding-ada-002` with `dimensions`
  is refused by the adapter as `AI_INVALID_REQUEST` rather than sent to a
  provider 400. Other ids pass through — the provider is the authority.
- **OpenAI wire detail.** The adapter pins `encoding_format: 'float'`: the
  SDK's own default (base64, decoded into `Float32Array`) does not survive
  `JSON.stringify` as an array. A reply with the wrong vector count or
  ragged lengths is `AI_PROVIDER_UNAVAILABLE`.
- **Large backfills are the fork's own job.** Embedding thousands of rows
  is long-running work (MANDATORY queue rule 1): declare a job type of your
  own (server-only, like every `ai.*` type, §9), enqueue one job per chunk
  of ≤ 256 rows with a payload of **row ids** (not texts), and have its
  `process()` re-read the rows, call `ai.forUser(ownerId).embed(...)` once,
  and write the vectors back; on `AI_RATE_LIMITED`, `throw err.toRateLimitError() ?? err` so the
  job defers instead of spending an attempt. No worked `example.ai-embed`
  handler ships; `ai.response.run` is the pattern to copy.

**Future work — out of scope for #440.** Vector *storage* and *search*:
a `pgvector` column/extension, an index (HNSW/IVFFlat), and a similarity
query API (`nearest(k)`, cosine/inner-product) are a future epic. Until
then a fork stores vectors itself (a `Float[]`/JSONB column, or its own
`vector` column behind a migration it owns) and computes similarity in the
query or in process.

### 5.2 Images (Phase 2, issue #437)

The embeddings shape (§5.1) plus a queue hop: an adapter port
(`images.generate` / `images.edit`), two facade methods, one usage
`operation` (`'images'`), one job type (`ai.image.generate`, §9) and two
routes. Outputs are **storage objects the user owns** — never base64 in an
API response or a database row.

- **Facade.** `ai.forUser(userId).generateImage({ model, prompt, size?,
  quality?, background?, outputFormat?, n? })` and `.editImage({ …,
  imageStorageObjectIds, maskStorageObjectId? })` → `{ runId, jobId }`.
  Always asynchronous, and **not** subject to `allowBackgroundRuns` (there
  is no synchronous form to fall back to). `model` is required; `n` is 1–4
  (`AI_IMAGES_MAX_N`); an edit takes 1–16 source images.
- **Gates, twice.** `prepareImage` runs at queue time and again in the job:
  kill switch → shape → provider → model with `image_generation` (or
  `image_edit`), model **and** provider port → an edit's inputs. A model
  without the capability is `AI_CAPABILITY_UNSUPPORTED`.
- **Inputs by storage object id** (`ai/storage/AiStorageInputResolver`,
  shared with #438/#441). The caller must be the uploader or hold
  `storage:read_any`; an unknown id is **404** and another user's is
  **403** — the answers `ObjectsService` gives. Each input must be `ready`,
  PNG/JPEG/WebP (the mask PNG) and ≤ 25 MiB, else `AI_INVALID_REQUEST`;
  the cap is enforced again while reading, since a simple upload's row size
  is 0 until post-processing. `ai_runs.request` stores the ids, never the
  bytes.
- **The job** (`ai.image.generate`, `{ runId }`): gates → **storage
  pre-flight** (`AiOutputWriter.assertWritable()`, so images that could not
  be kept are never paid for) → one provider call (one usage row,
  `units: { images: n }` plus tokens where reported) → every image written
  as a `ready` storage object owned by the user under
  `ai-outputs/<userId>/<runId>/` (`AI_OUTPUTS_KEY_PREFIX`, on
  `STORAGE_KEY_PREFIXES`) → the run completes with `output = { type:
  'images', provider, model, storageObjectIds, images: [{ storageObjectId,
  mimeType, size, revisedPrompt? }], usage }`. The client downloads each
  through `GET /api/storage/objects/{id}/download`.
- **Runs.** The same `ai_runs` table and `AiRunsService`; the operation is
  `request.operation` (`images.generate` | `images.edit`; absent means a
  responses run, so no migration and no change to old rows). Cancel works
  identically; images written after a cancel won are discarded.
- **Storage failures** become run outcomes: unconfigured or unwritable
  storage → `AI_STORAGE_UNAVAILABLE` (the job throws — an operator must
  act); an input deleted or no longer the user's → `AI_INVALID_REQUEST`.
- **OpenAI wire detail.** GPT-image models take `output_format`,
  `background` and `quality`; DALL·E models get `response_format:
  'b64_json'` instead (their default is a URL) and `quality: 'high'` →
  `hd` on DALL·E 3. A URL-only answer is `AI_PROVIDER_UNAVAILABLE`, never
  fetched. `moderation_blocked` → `AI_CONTENT_FILTERED`.

Out of scope: the Responses API `image_generation` hosted tool (#442) and
the UI (#445).

## 6. Model discovery and classification

A provider's model-listing endpoint returns IDs and little else useful —
not a capability list. Discovery and classification are therefore two
separate steps, both driven by the admin/org key, both server-only:

1. **Discovery**: `adapter.listModels(ctx)` returns `AiDiscoveredModel[]`
   (`{ id, ownedBy?, createdAt? }`) — ids only.
2. **Classification**: `adapter.classifyModel(modelId)` applies a curated,
   per-provider pattern classifier (e.g. matching `gpt-4o*` against known
   capability sets) and returns `AiModelCapabilities | null`. `null` means
   the provider's own classifier does not recognize the id — the row is
   persisted with `capabilitySource: 'unclassified'`, never guessed at by a
   generic heuristic that could be silently wrong about what a model can
   actually do.

Every `ai_models` row carries `capabilitySource: 'catalog' | 'admin_override'
| 'unclassified'`, and this field is the entire reason catalog refresh is
safe to run unattended, on a daily cron, forever:

- A **new** model is inserted with whatever `classifyModel` returned
  (`'catalog'`) or an empty capability set (`'unclassified'`), always
  `enabled: false` — discovery never turns a model on.
- An **existing** row has its `capabilities` touched by a refresh **only
  when** `capabilitySource !== 'admin_override'`. An administrator's
  capability override, once made, is permanent until the administrator
  changes it again — a refresh can never silently revert it.
- `enabled` is **never** written by a refresh for a model still present in
  the provider's list, under any `capabilitySource`. Enablement is
  exclusively an administrator's act (`PATCH /api/admin/ai/models/:id`, §9).
- A model that stops appearing in the provider's list gets
  `deprecatedAt: now()` (if not already set) and is force-disabled
  (`enabled: false`) — a model the provider withdrew cannot go on being
  served regardless of what an administrator previously chose. If it
  reappears later, `deprecatedAt` is cleared, but `enabled` stays `false`:
  reappearance is not re-enablement, because whatever made the provider
  withdraw it once is exactly the kind of thing an administrator should
  look at again before serving it to users a second time.
- Rows are never deleted, deprecated or not — `ai_runs` and
  `ai_usage_events` reference model ids by value, and history should stay
  readable after a model is retired.

## 7. Usable models for a user

"Which models can I use?" is answered by intersecting two independent
things that are each already true elsewhere in this document — it is not a
new source of truth of its own:

```
usable(user) = { admin-enabled AND not deprecated } ∩ { reachable with user's key }
             ∪ { admin-enabled AND not deprecated }              (only when org fallback applies)
```

Concretely, per enabled provider: if the user has a configured key,
usable models are `ai_models` rows with `enabled=true, deprecatedAt=null`
whose id is also in that key's `reachableModelIds` (computed at key-set
time, §3 of #431 — a key's tier or organization restrictions are real, and
a key that lacks GPT-4-class access must not advertise those models as
usable just because an administrator enabled them). If the user has *no*
key and the deployment's `keyPolicy = 'byok_with_org_fallback'`, every
admin-enabled, non-deprecated model for that provider is usable, with
`keySource: 'org'`. Otherwise, that provider contributes nothing to the
user's usable set.

`UsableModelsService.assertUsable(userId, provider, modelId, capability?)` is
the single-model form of the same check, called by the runtime facade's
gate pipeline (§9) before any provider call, and it is the one place the
four related error codes actually originate: `AI_MODEL_NOT_ENABLED` (the
model is not admin-enabled, or is deprecated), `AI_MODEL_NOT_REACHABLE` (it
is enabled, but the resolved key cannot reach it), `AI_KEY_REQUIRED` (no key
resolves at all — delegated to `AiKeyResolver`, §3), and
`AI_CAPABILITY_UNSUPPORTED` (the model or provider lacks the capability the
request needs, §4).

## 8. The kill switch

`ai.enabled = false` is the platform's single off switch, and its scope is
exact and total on the *consumer* side while leaving the *admin* side
reachable, so a deployment can always turn itself back on:

- Every route under `/api/ai/*` **except** `GET /api/ai/config` responds
  `403` with `details.reason: 'AI_DISABLED'` — the envelope's top-level
  `code` is the published, status-derived `FORBIDDEN` (§13's own note on
  why an `AiError`'s code travels in `details.reason`, never at the top
  level) — enforced by `AiEnabledGuard`, applied at
  the controller level on every user-facing AI controller (§10, §11). `GET
  /api/ai/config` is the one exception, deliberately: it is how a signed-in
  user's browser learns AI is off at all, and a route that answers "AI is
  disabled" must itself stay reachable while AI is disabled.
- Every AI job handler (`ai.catalog.refresh`, `ai.response.run`, and any
  Phase 2/3 media job) checks `ai.enabled` at process time and, if it has
  gone false since the job was enqueued, **fails without retry** by marking
  its own outcome terminal — this is a normal, expected outcome (the
  platform was turned off mid-flight), not a bug, so it must not fire the
  noisy `jobs.job_failed` notification or burn retry attempts.
- The catalog refresh cron (§9) does not enqueue anything while disabled —
  it is the one cron in this platform that has real work to skip, unlike a
  pure "decide whether to enqueue" tick.
- The web application hides every AI-related card, route and navigation
  entry when `GET /api/ai/config` (or the admin equivalent) reports
  `enabled: false` — no AI-shaped UI is reachable by URL guessing either.
- `/api/admin/ai/*` **stays reachable** throughout, regardless of
  `ai.enabled` — an administrator must always be able to turn the platform
  back on, inspect what is configured, or fix a bad configuration, even
  while it is off. This asymmetry (`/api/ai/*` gated, `/api/admin/ai/*`
  never gated by this switch) is deliberate and is the same asymmetry
  Maintenance Mode already has between the affected application and its
  own admin control (`docs/specs/maintenance-mode.md`).

## 9. Jobs

Every job type this platform has or plans is **server-only, never
node-eligible** — no `nodeResultSchema` +
`persistNodeResult` pair, ever, for any AI job type:

- `ai.catalog.refresh` — discovers and classifies one provider's models
  using the **admin** key (§6). Payload `{ providerId }`. `profile: {
  maxRuntimeMs: 5*60_000, maxAttempts: 3 }`.
- `ai.response.run` — executes one background AI response using a **user's**
  key (§9 of the runtime facade, `AiService.startRun`). Payload `{ runId }`.
  `profile: { maxRuntimeMs: 30*60_000, maxAttempts: 1 }` — a model call is
  neither idempotent nor cheap to blindly retry, so this type opts out of
  the deployment default attempt count rather than accept an automatic
  second charge against a user's own provider account. `ai_runs.request`
  stores the **full normalized request** — `instructions`, the complete
  `input` (whatever text/image/file content the caller sent), tool
  definitions, structured-output schema — everything `toStoredRunRequest`
  (`runtime/ai-run-request.ts`) needs to re-issue an identical call when the
  job executes, minus only the key. It is not redacted or truncated: the
  worker that later claims this job must reconstruct the exact request the
  user made, and truncating a prompt to store it would make the replayed
  call diverge from the one the user actually asked for. It is still never
  key material — see the ⚠ in that file and in §3 above.
- `ai.usage.purge` (#443) — deletes `ai_usage_events` rows older than
  `ai.usageRetentionDays`, 5000 ids a batch, oldest first. No payload, no
  provider call, no key; **not** gated on the kill switch (retention is
  data hygiene, not AI use). `profile: { maxRuntimeMs: 30*60_000,
  maxAttempts: 3 }`. Enqueued daily at 05:00 by `AiUsagePurgeTask` through
  `enqueueHousekeepingJob` — the one AI cron that uses that helper, because
  it is global (no per-provider subject).
- `ai.image.generate` (#437) — executes one image generation or edit run
  (§5.2) with the user's key. Payload `{ runId }`. `profile: { maxRuntimeMs:
  10*60_000, maxAttempts: 1 }` for the same reason as `ai.response.run`:
  images are billed per image. Same terminal-code handling as below, plus
  `AI_STORAGE_UNAVAILABLE`, which fails the run and **throws**.
- The remaining Phase 2/3 media jobs (audio transcription/speech) will
  follow the identical posture once implemented. Embeddings ship no job
  type of their own: `embed` is synchronous, and a large backfill is a
  fork's own server-only job calling it per chunk (§5.1).

The reason is not incidental — it is **MANDATORY queue rule 3**
(CLAUDE.md): a node never persists a job-scoped credential, and every
secret a node needs is brokered per-job by the server through
`job_node_secrets`. There is no way to broker a *user's own provider API
key* to a remote worker node under that mechanism without the key leaving
the server's control, which this platform's entire BYOK security posture
(§3) forbids categorically. The admin/org key has the identical problem: it
is exactly the credential §6 uses to talk to a provider on the platform's
behalf, and handing it to a node would let that node impersonate the
deployment to the provider. **Neither key may ever be brokered to a node**,
so neither job type may ever declare node eligibility — this is a
permanent property of this platform, not a placeholder pending a future
broker.

Every cron in this platform **only enqueues**, per MANDATORY queue rule 1:
the daily `ai.catalog.refresh` backfill task and the weekly `ai.keys.recheck`
task (staleness re-verification of a user's reachable-model list, #431) both
read settings or rows to decide *whether* work is due, then call
`JobsService.enqueue(...)` and do nothing else — neither uses
`enqueueHousekeepingJob` (that helper dedups by type alone, and both tasks'
payloads differ per subject), and both must pass
`apps/api/test/jobs/cron-enqueue-only.spec.ts`.

`ai.keys.recheck` is also enqueued **outside** its weekly cron, on
`AI_CATALOG_SYNCED_EVENT` (`ai/catalog/ai-catalog.events.ts`): every
`ai.catalog.refresh` job that actually ran a sync (never one that was
skipped) emits this event, and a listener in the keys module (never the
reverse — the catalog module imports nothing from `keys/`, so the
dependency stays one-directional) enqueues a recheck for the affected
provider's users at once rather than waiting up to a week for a model a
sync just deprecated or newly classified. `EventEmitter2` dispatches this
event **synchronously inside the job's own `process()`**, so the listener
must return immediately and only enqueue — it may never itself await a
provider round trip or a sweep, per MANDATORY queue rule 1.

A background run's own terminal handling (`ai.response.run`) draws a line
between an **expected** refusal and an **operator incident**:
`AI_RUN_TERMINAL_CODES` (`runtime/ai-response-run.handler.ts`) is the fixed
set of `AiErrorCode`s — `AI_DISABLED`, `AI_PROVIDER_DISABLED`,
`AI_KEY_REQUIRED`, `AI_KEY_INVALID`, `AI_MODEL_NOT_ENABLED`,
`AI_MODEL_NOT_REACHABLE`, `AI_CAPABILITY_UNSUPPORTED`, `AI_INVALID_REQUEST`,
`AI_CONTENT_FILTERED`, `AI_STRUCTURED_OUTPUT_INVALID` — that end the run
`failed` with the code recorded, while the *job* still **returns normally**
(no retry, no `jobs.job_failed`): the platform being off, a key being
rejected, or a model no longer being enabled are outcomes the user caused
or an administrator chose, not a bug the queue dashboard should surface as
an incident. `AI_RATE_LIMITED` is handled earlier and separately (the run
goes back to `pending`, the job defers via `toRateLimitError()`); every
other code — a provider outage, a timeout, an unexpected exception — is
**not** in this set, so the job throws and is retried/flagged the ordinary
way.

## 10. Streaming

`POST /api/ai/responses/stream` streams Server-Sent Events over a plain
`POST` — the same shape `/api/notifications/stream` already established in
this codebase, not a new streaming mechanism. Each `AiStreamEvent` is
written as `event: <type>\ndata: <json>\n\n`; a `: ping\n\n` heartbeat
comment is sent every 15 seconds to keep the connection alive through
proxies that time out an idle stream. Response headers include
`Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection:
keep-alive`, and — critically — `X-Accel-Buffering: no`, the header nginx
respects to disable its own response buffering for this specific response.

**Gate errors (kill switch, key required, model not enabled, capability
unsupported — everything in §7's and §9's gate pipeline) are surfaced
*before* the first byte is written**, as an ordinary JSON error response
with the matching HTTP status (§13) — exactly like a non-streaming route —
so a client's request library can `.catch()` it the normal way. Only a
failure that occurs **after** streaming has already started (a provider
error mid-response) is sent as an in-band `event: error` frame, after which
the stream closes; a client cannot tell the difference between "this
request was invalid" and "this request failed while streaming" by response
code alone, because the first never gets past headers and the second
already has.

A client disconnect is observed on the **response's** `close` event (while
the response has not finished) and aborts the in-flight provider call
through an `AbortController` whose signal is threaded into
`AiCallContext.signal` — an abandoned stream must not keep a provider
request (and a user's rate limit or spend) running after nobody is
listening. Not `request.raw.on('close')`: since Node 16 an
`IncomingMessage` emits `close` as soon as its body has been consumed,
which for a `POST` is before the first event exists. The non-streaming
`POST /api/ai/responses` threads the same signal, so a client that gives up
on a long answer stops paying for it too; either way the usage row records
`cancelled`.

**Implementation note (#433).** The route is a hand-written `@Res()` handler,
not Nest's `@Sse()`: `@Sse()` commits to `200 text/event-stream` before the
handler runs, which would force every gate refusal in-band. The handler
awaits `AiService.openStream` (eager — it rejects with the `AiError` for
every pre-stream failure, including a provider that refuses before its
first event), and only then hijacks the reply (`apps/api/src/ai/http/ai-sse.ts`),
carrying over headers already set on it. One known gap: when an adapter
reports a pre-stream throttle as an in-band first `error` event rather than
by throwing, the JSON `429` carries `details.reason` but not
`details.retryAfterMs` — the stream event type has no field for it.

**Request body.** `apps/api/src/ai/http/dto/ai-response-request.dto.ts` is
`.strict()`: a body carrying `tools` (or any unknown key, such as a
`stream` flag) is a `400`, never silently dropped. Media parts are accepted
by `http(s)` URL only in Phase 1. `structuredOutput.jsonSchema` is converted
with zod's `z.fromJSONSchema` (no ajv dependency; the same conversion a
background run uses to rebuild its stored schema), bounded at 64 KB, local
`$ref`s only — an unreadable schema is `400 AI_INVALID_REQUEST`.

nginx buffers `/api` with a 60-second read timeout by default, which is
fatal to any response that takes longer than a minute to finish streaming.
A dedicated, longest-prefix-wins location block, placed **before** the
general `/api` block and modeled on the existing `/api/notifications/stream`
block, disables buffering specifically for this one route:

```nginx
location /api/ai/responses/stream {
    proxy_pass http://api_upstream;          # use the same upstream name as the /api block
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off; proxy_cache off; chunked_transfer_encoding off;
    proxy_read_timeout 600s; proxy_send_timeout 600s;
    client_max_body_size 2m;
}
```

`gzip_types` must also exclude `text/event-stream` if it is configured at
all, for the same reason: a gzip encoder that buffers to build its window
defeats the entire point of an unbuffered proxy in front of it.

The `appctl deploy` edge vhost (`apps/cli/src/deploy/proxy.ts`
`renderVhost`) carries the same block, as it already does for the
notifications stream: nginx consumes `X-Accel-Buffering` rather than
forwarding it, so without its own location the host proxy would re-buffer
what the application's nginx forwards unbuffered.
`apps/api/test/ai/ai-stream-nginx.spec.ts` asserts the application block.

## 11. Permissions

Three permissions, all newly introduced by this platform (#423), following
the same blast-radius argument CLAUDE.md's RBAC section already makes for
`push:*`, `broadcasts:*`, `nodes:*` and `storage_config:*` — a new
permission pair earns its existence when reusing an existing one would let
a grant intended for one purpose silently acquire a different, larger one:

- `ai_config:read` / `ai_config:write` — deployment-wide AI configuration:
  the kill switch, key policy, provider enablement, admin/org keys, model
  catalog enablement and overrides. Seeded **Admin only**. Reusing
  `system_settings:*` was considered and rejected for the identical reason
  `storage_config:*` was split out rather than folded in: a wrong AI
  configuration (the wrong key policy, a model enabled that should not
  serve requests) has a blast radius specific to this platform, not to
  routine settings edits, and should not ride along with a permission
  seeded far more broadly for unrelated settings.
- `ai:use` — may call AI with the caller's own key (or the org fallback
  when policy allows it): the consumer-facing routes under `/api/ai/*`
  (excluding the always-open `GET /api/ai/config`). Seeded to **all three
  roles** (Admin, Contributor, Viewer) — using AI with a key the caller
  themselves supplied is not an administrative act, the same way managing
  one's own settings or storage objects is not.

`ai_config` and `ai:use` are deliberately **not** folded into one
permission: an administrator must be able to grant "may use AI" to
everyone (the default posture) while keeping "may reconfigure the AI
platform for the whole deployment" restricted to Admin — exactly the
reachability-vs-authority distinction CLAUDE.md's Settings UI Pattern
already draws between a destination gate and a tab gate, applied here to
two permissions instead of two UI surfaces.

## 12. Usage & audit

Every provider round-trip — success or failure — writes exactly one
`ai_usage_events` row: `{ userId?, provider, modelId, operation, keySource,
inputTokens?, outputTokens?, reasoningTokens?, cachedInputTokens?, units?,
latencyMs, status, errorCode?, providerRequestId?, jobId? }`. `operation` is
one of `responses | images | audio.transcribe | audio.speech | embeddings |
catalog` — `catalog` is the one operation with no `userId` (it runs under
the admin key, §6, `keySource: 'admin_discovery'`) and no
`inputTokens`/`outputTokens` (discovery/classification are not token-metered
calls); `units` exists for non-token-metered operations (`{ images: 2 }`,
`{ audioSeconds: 31.4 }`). `AiUsageRecorder` writes it from the facade's
round-trip outcome (#437 — `images` records `{ images: n }`), keeping only
finite, non-negative numbers and storing nothing when none are left.

**Reading it back (#443).** Two routes aggregate these rows, both answering
one report shape so one UI component renders either:

```ts
{ range: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' },   // UTC days, both inclusive
  groupBy: 'day' | 'user' | 'model' | 'provider' | 'keySource',
  totals: Bucket,
  series: Array<Bucket & { key: string, label: string }> }
// Bucket = { requests, failed, inputTokens, outputTokens, reasoningTokens,
//            cachedInputTokens, units: Record<string, number>,
//            orgKeyRequests, orgKeyInputTokens, orgKeyOutputTokens }
```

`requests` counts every round trip (succeeded, failed, cancelled); `failed`
is status `failed`; an unreported token count sums as zero; `units` sums
each numeric JSONB key; the `orgKey*` fields are the `keySource: 'org'`
subtotal — what the organization key paid for. Keys: `day` →
`YYYY-MM-DD` (chronological, **zero-filled** across the range); `user` → the
user id (label: the **email**; no-user rows key `system`); `model` →
`<provider>:<modelId>` (label: the model id); `provider` → the id (label:
the adapter's display name); `keySource` → `user`/`org`/`admin_discovery`.
Non-day series are ordered by `requests` descending. Default range is the
last 30 days; more than 90 days, or `from` after `to`, is a **400**
`AI_USAGE_RANGE_INVALID` — refused, never clamped. Totals and groups come
from one `GROUP BY GROUPING SETS ((key), ())` scan (plus one `jsonb_each`
scan for `units`), so they always add up; the `(created_at)` and
`(user_id, created_at)` indexes serve the window.

- `GET /api/admin/ai/usage` (`ai_config:read`, **not** behind
  `AiEnabledGuard` — cost is readable while AI is off) — every user;
  `groupBy` any of the five; filters `userId`, `provider`, `model`.
- `GET /api/ai/usage/me` (`ai:use` + `AiEnabledGuard`) — `groupBy` `day` or
  `model` only; always scoped to the caller in SQL, and the query DTO has
  no `userId` (a supplied one is stripped), so no request can read another
  user's usage.

Rows are kept `ai.usageRetentionDays` (default 180 — twice the longest
report window) and then deleted by the daily `ai.usage.purge` job (§9).

**Reading it back (UI, #444).** Two surfaces render the #443 aggregates, both
through `services/ai.ts` (`getAiUsage`, `getMyAiUsage` — every usage type lives
there) and `hooks/useAiUsage.ts`. The admin **AI Usage** card
(`/admin/settings/ai/usage`, `ai_config:read`, `feature: 'ai'`, appended to the
AI group) shows totals, the organization-key share (`keySource: 'org'`),
requests per day and a breakdown by user, model, provider or key source over
7/30/90 days; it reads `groupBy=day` plus the chosen breakdown, so two requests
per range. The user's own last 30 days by model is a **Usage section of
`/settings/ai`** — not a tab (Settings UI Pattern rule 2). The day chart is a
dependency-free bar chart with a Chart/Table toggle, never the only view.

Audit rows (written directly through Prisma — there is no dedicated audit
service in this codebase, the same pattern `StorageConfigAdminService.audit`
already uses) record every administrative and key-management act, never the
key material itself: `ai_config:replace`, `ai_config:set_key`,
`ai_config:delete_key`, `ai_config:test`, `ai_model:update`,
`ai_catalog:refresh_requested`, `ai_catalog:refresh` (the completed sync,
recorded by the job itself with `{ added, updated, deprecated }` counts),
`ai_key:set`, `ai_key:delete` (the last two are the user's own BYOK key
lifecycle, `targetType: 'user_ai_key'`). Every one of these carries codes,
counts or field *names* in its `meta` — never a key, never raw prompt text.

**Prompt content is never logged unless an administrator has explicitly set
`ai.logPromptContent = true`.** Even then, it is logged at debug level only,
truncated to 2 KB, and it is a *log* line, never a database column or an
audit `meta` field — turning this setting on is an explicit, reversible,
deployment-wide opt-in for debugging, not a standing feature. OpenTelemetry
spans for `ai.request` carry `ai.provider`, `ai.model`, `ai.operation`,
`ai.key_source`, `ai.status` and token-count attributes, and — per the
identical rule — never prompt text and never a key, regardless of
`logPromptContent`.

## 13. Error taxonomy

Every error this platform raises is an `AiError` (never a raw provider SDK
error escaping to a caller), carrying a stable `code` that maps to exactly
one HTTP status:

| Code | HTTP | Meaning |
|---|---|---|
| `AI_DISABLED` | 403 | The kill switch (§8) is off. |
| `AI_PROVIDER_DISABLED` | 403 | The platform is on, but this provider is not enabled. |
| `AI_KEY_REQUIRED` | 403 | No key resolves for this user/provider under the active policy (§3). |
| `AI_KEY_INVALID` | 400 | A submitted key failed `verifyKey` against the provider. |
| `AI_MODEL_NOT_ENABLED` | 403 | The model is not admin-enabled, or is deprecated (§6, §7). |
| `AI_MODEL_NOT_REACHABLE` | 403 | The model is enabled, but the resolved key cannot reach it (§7). |
| `AI_CAPABILITY_UNSUPPORTED` | 400 | The model/provider lacks a capability the request needs (§4). |
| `AI_RATE_LIMITED` | 429 | The provider rate-limited the call; convertible to the queue's `RateLimitError` via `toRateLimitError()` so a job defers rather than burning an attempt. |
| `AI_PROVIDER_UNAVAILABLE` | 503 | The provider is unreachable or erroring at the transport level. |
| `AI_CONTENT_FILTERED` | 422 | The provider's own content filter rejected the request or response. |
| `AI_INVALID_REQUEST` | 400 | The request itself is malformed (e.g. no model selected and no default set). |
| `AI_STRUCTURED_OUTPUT_INVALID` | 502 | The model's output failed to parse against the requested schema. |
| `AI_STORAGE_UNAVAILABLE` | 503 | An operation whose inputs or outputs are storage objects (§5.2) met unconfigured or unwritable object storage; an administrator fixes it at `/admin/settings/storage`. Seen as a background run's `errorCode`. |

`AiError` follows the `StorageNotConfiguredError` style already established
in this codebase: it serializes through the global `HttpExceptionFilter` as
`{ statusCode, code, message, details: { reason: code, retryAfterMs? } }`.
**The envelope's top-level `code`** is always the status-derived, published,
closed enum (`FORBIDDEN`, `TOO_MANY_REQUESTS`, ...) that `common/dto/error.dto.ts`
and the filter's own header already define for every error in this API —
`AiError` does not get a second, competing meaning for that field. The AI-
specific code from the table above travels **only** in `details.reason`,
written last inside `AiError`'s constructor so a caller-supplied
`details.reason` can never disagree with it; a client switches on
`details.reason`, never on the top-level `code`, to learn which of these
thirteen conditions occurred. Its `apiKey`/key material must never appear in
`details` or in any log line derived from it, regardless of how the error
was constructed (a unit test asserts `JSON.stringify(new AiError(...))`
never includes a key passed via `cause`).

## 14. Adding a provider

A second (or third) provider is an adapter implementation against the
existing contract, not a platform change, by design:

1. **Implement `AiProviderAdapter`** — `id` (permanent once jobs/usage/keys
   reference it), `displayName`, `listModels`, `verifyKey`,
   `classifyModel`, and whichever capability ports (§4) the provider
   genuinely supports. Self-register in `onModuleInit()` via
   `AiProviderRegistry.register(this)` — the identical "one line, no
   decorator, no central dispatch table" idiom `JobHandlerRegistry` already
   uses for job handlers.
2. **Write a classifier** for `classifyModel` — a curated, per-provider
   pattern match against known model-id shapes, returning
   `AiModelCapabilities` or `null` for an id the classifier does not
   recognize (§6). This is deliberately hand-curated per provider, not a
   generic heuristic, because guessing a model's capabilities wrong is worse
   than admitting "unclassified, an administrator should look at this."
3. **Run the conformance kit** (`describeAiProviderConformance`, #424)
   against the new adapter. It asserts, uniformly across every provider:
   `listModels` returns ids; `verifyKey`'s ok/invalid mapping; `classifyModel`
   returns schema-valid capabilities or `null`; if `responses` is
   implemented — `create` returns `outputText`, `stream` yields
   `response.created … response.completed` in order with deltas
   concatenating to the final text, structured output returns a
   schema-valid `parsed`, a function-tool round-trip works, and an
   unsupported capability surfaces as `AI_CAPABILITY_UNSUPPORTED`; and,
   always, that every error the adapter can produce is an `AiError`, never
   a raw SDK exception.

Nothing about the registry, the gate pipeline (§9 of #432), the admin API
(§9 below) or the HTTP surface (§10 below) changes to add a provider — they
already operate on `AiProviderAdapter` and `AiProviderRegistry.ids()`.

### HTTP surface

**Admin** (`/api/admin/ai/*`, `@ApiTags('AI Administration')`):

| Method & path | Permission | Behaviour |
|---|---|---|
| `GET /api/admin/ai/config` | `ai_config:read` | `describeForAdmin()` — `{ enabled, keyPolicy, logPromptContent, defaults, usageRetentionDays, providers:[{ id, displayName, enabled, baseUrl, keyStatus, supportedCapabilities }], version, updatedAt, updatedBy }`. `keyStatus = { configured, hint, updatedAt, updatedByUserId }` from `credentials.describe` — **never** `getSecret`. `providers` = registry ids ∪ settings keys. |
| `PUT /api/admin/ai/config` | `ai_config:write` | Body `{ enabled, keyPolicy, logPromptContent, defaults, usageRetentionDays?, providers:{ [id]: { enabled, baseUrl? } } }` (`usageRetentionDays` omitted keeps the stored value — the one non-full-replace field, so older clients still save); `If-Match: <version>` (mismatch → 409, like storage). Enabling a provider id not in the registry → 400. Setting `keyPolicy='byok_with_org_fallback'` while that provider has no admin key → 400 `AI_KEY_REQUIRED`. Audit `ai_config:replace` (field names only). |
| `PUT /api/admin/ai/providers/:provider/key` | `ai_config:write` | Body `{ apiKey }` (min 8). Verified with `adapter.verifyKey` **first**; invalid → 400 `AI_KEY_INVALID`, nothing stored. Audit `ai_config:set_key`. |
| `DELETE /api/admin/ai/providers/:provider/key` | `ai_config:write` | Body `{ confirmation: 'REMOVE' }`. Audit `ai_config:delete_key`. Under `byok_with_org_fallback`, response includes `warnings:['ORG_FALLBACK_WITHOUT_KEY']`. |
| `POST /api/admin/ai/providers/:provider/test` | `ai_config:write` | `@HttpCode(200)` always. Body `{ apiKey?, baseUrl? }` (blank ⇒ stored key). Checks: `credentials`, `list_models`, `responses_smoke`. Audit `ai_config:test` (codes only). |
| `GET /api/admin/ai/models` | `ai_config:read` | Query `provider?, capability?, enabled?, includeDeprecated?(default false), q?`, paginated like `GET /api/admin/jobs`. |
| `PATCH /api/admin/ai/models/:id` | `ai_config:write` | Body `{ enabled?, displayName?, capabilities? }`. Sets `capabilitySource='admin_override'`. Enabling a deprecated model → 409. Enabling an unclassified model with no capabilities supplied → 400. Audit `ai_model:update`. |
| `POST /api/admin/ai/models/refresh` | `ai_config:write` | Body `{ provider }`. 409 if no admin key. Enqueues `ai.catalog.refresh`; returns `{ jobId }`. Audit `ai_catalog:refresh_requested`. |
| `GET /api/admin/ai/usage` | `ai_config:read` | Query `from?, to?, groupBy?(day), userId?, provider?, model?` → the usage report (§12). |

**Public config** (any authenticated user, no `ai_config` permission
needed — the `/api/notifications/config` pattern), and **user keys/usable
models** below, both carry `@ApiTags('AI')` — issue #431 moved
`GET /api/ai/config` onto this tag alongside the rest of `/api/ai/*`, so
every consumer-facing route (as opposed to `/api/admin/ai/*`'s
`AI Administration` tag) groups under one heading in the API reference:

| Method & path | Auth | Behaviour |
|---|---|---|
| `GET /api/ai/config` | `@Auth()` | `{ enabled, keyPolicy, allowBackgroundRuns, providers:[{ id, displayName, enabled, hasOrgKey }] }`. When `enabled=false`: `{ enabled:false, keyPolicy, allowBackgroundRuns:false, providers:[] }`. Never includes hints or keys. Reachable even while `ai.enabled=false` (§8). |

**User keys and usable models** (`/api/ai/*`, all
`@UseGuards(AiEnabledGuard)`, `@Auth({ permissions:[PERMISSIONS.AI_USE] })`):

| Method & path | Behaviour |
|---|---|
| `GET /api/ai/keys` | List the caller's `UserAiKeyView[]` — one per enabled provider, configured or not. |
| `PUT /api/ai/keys/:provider` | Body `{ apiKey }` (min 8, max 512). Verifies, then computes reachable models, then stores. |
| `DELETE /api/ai/keys/:provider` | 204. Idempotent. |
| `POST /api/ai/keys/:provider/test` | `@HttpCode(200)`. Body `{ apiKey? }` (blank ⇒ stored key). **Two checks only** — `credentials` (the provider accepts the key) and `list_models` (how many catalog models it can reach) — deliberately **not** the admin probe's third `responses_smoke` check above: a real model call bills whoever's key is being tested, and it is this platform's own money for the admin probe but a user's own provider account for this one, so this route never spends it on their behalf. |
| `GET /api/ai/models` | `UsableAiModel[]` = `{ provider, modelId, displayName, capabilities, keySource }` (§7). |

**Consumer responses and background runs** (`/api/ai/*`, same guard/auth):

| Method & path | Behaviour |
|---|---|
| `POST /api/ai/responses` | `forUser(id).respond(...)` → `AiResponse` (includes `parsed` when structured). |
| `POST /api/ai/responses/stream` | SSE (§10). Function tools are not accepted over this route in Phase 1 — they execute server-side code and are for in-process `runTools()` only; hosted tools arrive in Phase 2. Request body limit 1 MB. |
| `POST /api/ai/embeddings` | `forUser(id).embed(...)` → `{ provider, model, dimensions, vectors, usage }` (§5.1). `model` required; > 256 inputs → 400 `AI_INVALID_REQUEST`; a model without `embeddings` → 400 `AI_CAPABILITY_UNSUPPORTED`. Request body limit 1 MB. |
| `POST /api/ai/images` | `generateImage(...)` → `{ runId, jobId }`, status 202 (§5.2). A model without `image_generation` → 400 `AI_CAPABILITY_UNSUPPORTED`. |
| `POST /api/ai/images/edits` | `editImage(...)` → `{ runId, jobId }`, status 202. Inputs by storage object id: unknown → 404, another user's → 403, not ready / wrong type / too large → 400 `AI_INVALID_REQUEST`. |
| `POST /api/ai/runs` | `startRun(...)` → `{ runId, jobId }`, status 202. |
| `GET /api/ai/runs/:id` | Scoped to caller → `{ id, status, provider, modelId, output, errorCode, errorMessage, createdAt, completedAt }` (never the stored prompt, never the job id); `output` is the `AiResponse`, or an image run's `{ type: 'images', storageObjectIds, … }`; 404 for another user's run. |
| `POST /api/ai/runs/:id/cancel` | Scoped to caller; 200. |
| `GET /api/ai/usage/me` | Query `from?, to?, groupBy?(day\|model)` → the caller's own usage report (§12). |

## Rejected alternatives

- **Adopting the Vercel AI SDK (or a similar third-party SDK) as the
  public contract.** Rejected: this platform's contract must be something
  this template owns and can extend without waiting on an upstream
  release — a curated capability model per provider (§4), a governance
  model with two distinct keys and a resolution rule with a hard security
  invariant (§3), and per-user encrypted BYOK storage tied to this
  repository's own cipher and audit conventions are all specific to this
  application's shape and would sit awkwardly bolted onto a generic SDK
  designed for a different (typically client-side, single-key) use case.
  Nothing stops an adapter's *implementation* from using such an SDK
  internally to talk to a provider — that is an adapter's private
  business — but the platform's own types, gates and storage are this
  repository's, not a dependency's.
- **LangChain**, for the same reason and more acutely: its abstractions
  (chains, agents, memory) solve a different problem than "one governed,
  BYOK, capability-gated facade a fork can inject anywhere," and adopting
  it would mean designing this platform's actual requirements — the kill
  switch, the key-resolution rule, per-user reachability, the audit trail —
  as a layer bolted on top of an abstraction that has no concept of any of
  them, rather than as the platform itself.
- **Storing user BYOK keys in `CredentialsService`** instead of a dedicated
  `user_ai_keys` table. Rejected: that store is designed for deployment-wide
  secrets with no user ownership, no cascade-delete-on-user-removal
  semantics, and no natural `(userId, provider)` addressing — modeling a
  per-user key there would mean either inventing user-scoping inside a
  store that was never designed for it, or accepting that a deleted user's
  keys silently outlive them. `user_ai_keys.userId` with `onDelete: Cascade`
  makes "the key belongs to the user, and disappears exactly when they do"
  a database-level guarantee instead of an application-level convention
  that could be missed.
- **Storing user keys in `user_settings` JSONB.** Rejected on the same
  principle CLAUDE.md's storage-config section already states for the
  storage secret: `user_settings` (like `system_settings`) is returned
  wholesale on read, and a column that must never appear in a bulk read has
  no business living inside a document whose entire contract is "return
  everything." A dedicated encrypted column, read by name, one row per
  provider, is the only shape that keeps "never returned by a GET" true by
  construction rather than by remembering to redact it.
- **A node-eligible AI job** (`nodeResultSchema` + `persistNodeResult` on
  `ai.catalog.refresh` or `ai.response.run`). Rejected categorically, not
  provisionally — see §9: both job types use a key (admin or user) that
  must never leave the server, and MANDATORY queue rule 3 forbids a node
  persisting a job-scoped credential at all. There is no broker design that
  makes this safe; it is simply out of scope for any worker node, ever, for
  this platform.
- **Environment-variable configuration** (`OPENAI_API_KEY` or equivalent),
  even as a migration aid or fallback alongside the runtime configuration.
  Rejected for the identical reason `docs/specs/storage-providers.md` §11
  gives for not keeping a permanent `STORAGE_PROVIDER`/`S3_BUCKET`
  environment fallback: two sources of truth for which credential is live is
  the exact ambiguity this platform's admin-governed model exists to
  remove, and per-user BYOK in particular has no sensible environment-variable
  shape at all — a key belongs to one user, not to the process.
- **A single chat-completions-shaped interface** as the normalized contract,
  instead of the Responses-API-shaped request/response of §5. Rejected: see
  §4 — reasoning efforts, hosted tools, structured outputs and
  background/streaming semantics cannot be expressed by a bare
  `chat(messages)` shape without inventing exactly the richer shape this
  spec already defines, so starting from the lowest common denominator
  would mean redesigning the contract the first time any of those features
  was needed rather than having room for them from the start.
- **Browser-side provider calls** (the web app calling OpenAI directly with
  a key handed to the client). Rejected outright: it would require shipping
  a user's own provider key to their browser (defeating the point of
  server-side encrypted storage, §2), makes the kill switch and every gate
  in §7/§9 unenforceable (a client can simply not call the gate), and
  removes every usage/audit row this platform's accounting depends on
  (§12). Every provider call in this platform happens server-side, with no
  exception.

## Verification

| Claim | Where it is asserted |
|---|---|
| Under `keyPolicy='byok'`, `AiKeyResolver.resolve` never returns the org key, and the fake provider records zero calls with it | `apps/api/src/ai/keys/ai-key-resolver.service.spec.ts`, restated in `apps/api/src/ai/runtime/ai.service.spec.ts` |
| The full `{user key yes/no} × {policy byok/fallback} × {org key yes/no}` resolution matrix | `apps/api/src/ai/keys/ai-key-resolver.service.spec.ts` |
| `AiProviderRegistry.supports()` is derived purely from capability-port presence, never a separate flag | `apps/api/src/ai/core/provider-registry.spec.ts` |
| Every error raised anywhere in the AI platform is an `AiError`, never a raw provider SDK error, and never includes key material in `details` or when `JSON.stringify`'d | `apps/api/src/ai/core/ai-error.spec.ts`, `apps/api/src/ai/testing/fake-ai-provider.conformance.spec.ts` |
| Catalog sync never overwrites an `admin_override` capability, never flips `enabled` on a still-present model, and force-disables (without deleting) a model that disappears | `apps/api/src/ai/catalog/ai-catalog.service.spec.ts` |
| The catalog refresh and key-recheck crons only enqueue | `apps/api/test/jobs/cron-enqueue-only.spec.ts` |
| `AiEnabledGuard` returns `403 { code:'AI_DISABLED' }` on every `/api/ai/*` route except `GET /api/ai/config`, and `/api/admin/ai/*` stays reachable while disabled | `apps/api/src/ai/config/ai-enabled.guard.spec.ts`, `apps/api/test/ai/ai-public-config.integration.spec.ts` |
| No response body from any AI route ever contains a plaintext key (serialize-and-search test) | `apps/api/test/ai/ai-admin.integration.spec.ts`, `apps/api/test/ai/ai-user-keys.integration.spec.ts` |
| `user_ai_keys.secret` is ciphertext under the `'ai_user_key'` cipher purpose, distinct from the admin key's `CredentialsService` purpose `'ai'` | `apps/api/src/ai/keys/user-ai-keys.service.spec.ts` |
| Deleting a user cascades their `user_ai_keys`; user A can never read/test/delete user B's key | `apps/api/test/ai/ai-user-keys.integration.spec.ts` |
| Usable models = admin-enabled ∩ reachable (or admin-enabled when org fallback applies); deprecated models excluded | `apps/api/src/ai/keys/usable-models.service.spec.ts` |
| `ai.catalog.refresh` and `ai.response.run` declare no `nodeResultSchema`/`persistNodeResult` and therefore never appear in `JobHandlerRegistry.serverOnlyTypes()`'s complement | `apps/api/src/ai/catalog/ai-catalog-refresh.handler.spec.ts`, `apps/api/src/ai/runtime/ai-response-run.handler.spec.ts` |
| The gate pipeline produces the exact documented error code for each gate, in order | `apps/api/src/ai/runtime/ai.service.spec.ts` |
| Every provider round-trip (success and failure) writes exactly one `ai_usage_events` row with the correct `keySource` | `apps/api/src/ai/runtime/ai-usage.recorder.spec.ts` |
| Usage aggregates add up under every grouping (real SQL over a seeded fixture); `/me` is scoped to the caller; the purge deletes only rows past retention and its cron only enqueues | `apps/api/test/ai/ai-usage.db.spec.ts`, `apps/api/test/ai/ai-usage.integration.spec.ts`, `apps/api/src/ai/usage/*.spec.ts`, `apps/api/test/jobs/cron-enqueue-only.spec.ts` |
| Streaming and non-streaming responses return identical final text for the same fake script; a pre-stream gate failure is plain JSON, a mid-stream failure is an `error` SSE frame; client abort stops the provider call | `apps/api/test/ai/ai-responses.integration.spec.ts` |
| `infra/nginx/nginx.conf` contains the `/api/ai/responses/stream` location with `proxy_buffering off` | a config-assertion spec reading the nginx file directly, mirroring `apps/api/test/production-image.spec.ts` |
| Seed grants: Admin holds all three AI permissions; Contributor and Viewer hold `ai:use` only | `apps/api/test/prisma/seed-data.spec.ts` |
| The conformance kit (`describeAiProviderConformance`) passes against `FakeAiProvider` | `apps/api/src/ai/testing/fake-ai-provider.conformance.spec.ts` |
| Embeddings: one vector per input in order, `dimensions` honoured, a model without `embeddings` → `AI_CAPABILITY_UNSUPPORTED`, > 256 inputs → `AI_INVALID_REQUEST`, one `operation: 'embeddings'` usage row; the #435 key-policy and secret-egress suites drive `POST /api/ai/embeddings` | `apps/api/src/ai/providers/openai/openai-embeddings.spec.ts`, `apps/api/src/ai/runtime/ai-embed.spec.ts`, `apps/api/test/ai/ai-embeddings.integration.spec.ts`, the conformance kit's `embeddings.*` scenarios |

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
Phase 3 proved it: the Anthropic adapter (issue #446, §14.1) fits the same
contract with one declared, behavioural adapter flag
(`supportsPreviousResponseId`, §5.7) and no change to any `AiService`
caller, and the Gemini adapter (issue #447, §14.2) — a third API shape —
fits it with the same flags plus one optional, backward-compatible
classifier argument (listing metadata, §6).

## 2. The configuration model

Configuration lives in two places, deliberately split, mirroring the split
storage already established in §2 of `docs/specs/storage-providers.md`:

**The `ai` system-settings namespace** (`system_settings.global`, read/write
through `SystemSettingsService`) holds everything that is *not* secret:

```ts
// ai settings namespace (system_settings, global row)
{ enabled: boolean /*false*/,
  keyPolicy: 'byok' | 'byok_with_org_fallback' /*'byok'*/,
  providers: { openai:    { enabled: boolean /*false*/, baseUrl?: string },
               anthropic: { enabled: boolean /*false*/, baseUrl?: string } /*§14.1, #446*/,
               gemini:    { enabled: boolean /*false*/, baseUrl?: string } /*§14.2, #447*/,
               'azure-openai': { enabled: boolean /*false*/, baseUrl?: string /*https*/,
                                 apiVersion?: string, apiStyle?: 'responses' | 'chat_completions',
                                 deployments?: Record<modelId, deploymentName> } /*§14.3, #448*/,
               'openai-compatible': { enabled: boolean /*false*/, baseUrl?: string /*http(s)*/,
                                      apiStyle?: 'responses' | 'chat_completions',
                                      requiresKey?: boolean } /*§14.3, #448*/ },
  defaults: { maxOutputTokensCap?: number, allowBackgroundRuns: boolean /*true*/ },
  logPromptContent: boolean /*false*/,
  usageRetentionDays: number /*180, 1–3650 — §12, #443*/,
  hostedTools: { …switches, mcpAllowedHosts: string[] } /*all off — §5.4, #442*/,
  limits: {                                   /*{} — no limits; §15, #450*/
    perUser?:  { requestsPerMinute?: number, requestsPerDay?: number },
    orgKey?:   { requestsPerDayPerUser?: number, tokensPerDayPerUser?: number },
    perModel?: Record<'<provider>:<modelId>',
                      { maxOutputTokens?: number, requestsPerMinutePerUser?: number }> } }
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
resolve(userId, provider): Promise<{ apiKey: string; keySource: 'user' | 'org' | 'none' }>
// 0. provider slot says requiresKey: false (#448)        -> { none }  (AI_KEYLESS_API_KEY)
// 1. user key exists                                    -> { user }
// 2. policy 'byok_with_org_fallback' AND org key exists  -> { org }
// 3. otherwise                                           -> throw AiError('AI_KEY_REQUIRED')
```

**Rule 0 is an administrator's opt-in, never a fallback** (#448, §14.3).
Only the `openai-compatible` slot has a `requiresKey` field, and only an
administrator (`ai_config:write`) can set it to `false` — for a self-hosted
server (Ollama, vLLM, LM Studio) that authenticates nobody. No key is read
or decrypted; the call carries the `AI_KEYLESS_API_KEY` marker
(`ai/core/provider-adapter.interface.ts`), which the adapter turns into **no
credential on the wire**, and the usage row says `keySource: 'none'`. It
precedes rule 1 (the server would ignore a user's key anyway) and holds under
either key policy: `byok` promises that only a user's own provider account
is *billed*, and a keyless server bills no account.

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

`ai_usage_events.keySource` records which value actually resolved a given
call: `'user'`, `'org'`, `'none'` (a keyless provider, #448), or
`'admin_discovery'` (§12) — the last is reserved for calls the *platform itself* makes with the admin key
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

**Model metadata beyond the capability list.** `AiModelCapabilities` also
carries optional descriptive fields a picker needs — `reasoningEfforts`,
`contextWindow`, `maxOutputTokens`, and (#439) `voices`: the voices an
`audio_speech` model speaks. Optional, so every stored row stays valid; the
classifier fills it (OpenAI: nine voices for `tts-1`/`tts-1-hd`, thirteen
for the GPT-4o TTS family), an administrator may override it like any
other capability field, and `GET /api/ai/models` publishes it. When a model
lists none, the provider's static `AiAudioPort.voices` is the fallback.

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
  | { type: 'function_call'; callId: string; name: string; arguments: string }   // replayed (§5.7, #446)
  | { type: 'function_call_output'; callId: string; output: string }
  | AiReasoningItem;                                                              // replayed (§5.7, #446)
export interface AiReasoningItem {
  type: 'reasoning'; summary: string[];
  [AI_PROVIDER_STATE]?: { provider: string; data: unknown };   // opaque, symbol-keyed, never serialised (§5.7)
}
export type AiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; url?: string; storageObjectId?: string; detail?: 'low'|'high'|'auto' }
  | { type: 'file'; storageObjectId?: string; url?: string; filename?: string };
export interface AiFunctionTool<P extends z.ZodTypeAny = z.ZodTypeAny> {
  type: 'function'; name: string; description: string; parameters: P; strict?: boolean;
}
export type AiHostedTool =                                         // §5.4 (#442)
  | { type: 'web_search'; searchContextSize?: 'low'|'medium'|'high'; userLocation?: { country?: string; city?: string } }
  | { type: 'file_search'; vectorStoreIds: string[]; maxResults?: number }
  | { type: 'code_interpreter'; container?: { type: 'auto' } }
  | { type: 'image_generation'; size?: string; quality?: string }
  | { type: 'mcp'; serverLabel: string; serverUrl: string; allowedTools?: string[];
      requireApproval?: 'never'|'always'; headers?: Record<string, string> };
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
  | { type: 'message'; text: string; citations?: { url: string; title: string; startIndex: number; endIndex: number }[] }
  | AiReasoningItem
  | { type: 'function_call'; callId: string; name: string; arguments: string }
  | { type: 'hosted_tool_call'; id?: string; tool: AiHostedToolType; status: string; result?: /* typed per tool, §5.4 */ };
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

The Responses API `image_generation` hosted tool (#442) is §5.4; the UI is
#445.

### 5.3 File and image inputs from storage objects (Phase 2, issue #441)

An `image`/`file` content part may name one of the caller's storage objects
(`{ type: 'file', storageObjectId }`) instead of a public `url` — exactly
one of the two. No new port, method or route: every Responses entry point
(`respond`, `stream`, `openStream`, `respondStructured`, `runTools`,
`startRun`) and `POST /api/ai/responses`, `/stream`, `/runs` accept it.

- **Resolved in the facade, before the adapter** (`prepare`, after the
  reasoning gate). Ownership and readiness through
  `AiStorageInputResolver` (§5.2: unknown **404**, another user's **403** —
  the `ObjectsService` answers, not the 404 the issue text proposed).
  **Modality follows the MIME type, not the part type**: PNG/JPEG/GIF/WebP
  is an image and needs `vision_input`, anything else a file and needs
  `file_input` — each in the model's `capabilities` **and**
  `inputModalities`, else `AI_CAPABILITY_UNSUPPORTED`; an `image` part
  naming a non-image is `AI_INVALID_REQUEST`. Caps (`ai/core`
  `file-inputs.types.ts`): images **20 MiB**, files **50 MiB**, at most 16
  distinct objects per request — else `AI_INVALID_REQUEST`.
- **Delivery is the adapter's declaration.** `AiProviderAdapter
  .fileInputStrategy` — `{ image, file }`, each `'presigned_url' | 'upload'
  | 'inline'`; absent means the provider refuses stored inputs
  (`AI_CAPABILITY_UNSUPPORTED`). After the gates and **before the key**,
  the facade prepares what the strategy needs and hands it to the adapter
  as `ctx.storageInputs` (`AiResolvedStorageInput`, keyed by id): a
  presigned GET URL (TTL **10 min**, the storage provider's own
  `getSignedDownloadUrl`), or `open()`/`read()` over a stream capped at the
  modality's limit. The **request is never rewritten**: it keeps the id,
  so the opt-in prompt log, `ai_runs.request` and every error carry no URL
  and no bytes.
- **OpenAI**: images → `presigned_url`, sent as `input_image.image_url`
  (OpenAI fetches it; the bytes never pass through the API). Files →
  `upload`: streamed to the Files API (`purpose: 'user_data'`) with the
  call's own resolved key, referenced by `file_id`, and **deleted
  provider-side** once the response completes, fails, or its stream ends
  (or is abandoned) — best effort, logged by file id only. Nothing is
  cached across calls or users; a `runTools` step that resends the file
  uploads it again.
- **Background runs** store the id only; the job resolves again when it
  runs (fresh URL, same checks). An input gone or no longer the user's by
  then fails the run `AI_INVALID_REQUEST` (the job returns); storage that
  cannot presign or read is `AI_STORAGE_UNAVAILABLE` — chosen over
  `AI_PROVIDER_UNAVAILABLE` because the fault, and the fix
  (`/admin/settings/storage`), is the deployment's storage, exactly as in
  §5.2. No usage row is written when this happens before the provider call.
- ⚠ **A presigned URL is a bearer capability**: it exists only in
  `ctx.storageInputs` for one call, and is never logged, persisted, put on
  a span or returned (the secret-egress suite hunts a presigned-URL
  sentinel as it hunts keys).
- **Data egress.** Sending a stored file to a model sends its contents to
  that third-party provider (and, for an upload, stores a copy there until
  the deletion above). That egress is what an administrator opts into by
  switching AI on and enabling a provider (§8); only the caller's own
  objects (or, with `storage:read_any`, anyone's) can be sent, and only in
  a request the caller makes.

### 5.4 Hosted tools (Phase 2, issue #442)

Tools the **provider** executes inside one Responses call: live web search,
file search over provider-side vector stores, a sandboxed code interpreter,
image generation and remote MCP servers.

- **Two gates.** The tool type must be switched on by an administrator
  (`ai.hostedTools.<type>`, all **off** by default — each one reaches outside
  the deployment and bills per use), else `AI_TOOL_DISABLED` (403); and the
  model must declare `hosted_tools` (§4), else `AI_CAPABILITY_UNSUPPORTED`.
  The admin gate runs first, right after provider enablement
  (`core/hosted-tools.ts`); every tool's shape is validated there too.
- **MCP.** `serverUrl` must be `https://` with no credentials in it. An
  optional `ai.hostedTools.mcpAllowedHosts` (hostnames, or `*.example.com`
  for subdomains) narrows which hosts it may name — empty means any host —
  and a host outside it is `AI_TOOL_DISABLED`. `headers` (the MCP server's
  own credential) are secret material: passed to the adapter and nowhere
  else — never in the prompt log line, a span, an `ai_usage_events` row or
  an `AiError`; a background run carrying them is refused with
  `AI_INVALID_REQUEST` rather than stored (the `ai_runs.request` shape has no
  `headers` member); and any header value a server echoes back is replaced
  with `[REDACTED]` in the response and every stream frame.
- **Outputs.** Each call is a `hosted_tool_call` item with a typed `result`:
  `web_search` `{ queries, sources[{ url }] }`, `file_search` `{ queries,
  results[{ fileId?, filename?, score?, text? }] }`, `code_interpreter`
  `{ code, containerId, outputs[logs|image url] }`, `image_generation`
  `{ storageObjectId, mimeType?, revisedPrompt?, size?, quality? }`, `mcp`
  `{ kind: 'call'|'list_tools'|'approval_request', serverLabel, … }`. Web
  search citations are `citations[{ url, title, startIndex, endIndex }]` on
  the message item, re-based onto its concatenated text.
- **Generated images are the user's storage objects.** The adapter decodes
  the image into bytes; the facade's output settler hands them to
  `AiService.persistHostedImage` (once per image, even though a stream shows
  the item twice), which writes them through `AiOutputWriter` as a `ready`
  object owned by the caller under `ai-outputs/<userId>/<runId>/` (a
  background run) or `ai-outputs/<userId>/<responseId>/`, and publishes only
  `storageObjectId` (+ metadata). The usage row records `units: { images: n }`.
  **Storage unavailable does not fail the response** — the text, citations
  and other items are intact and already paid for — so the image is
  published as `storageObjectId: null, storageError: 'AI_STORAGE_UNAVAILABLE'`
  and a warning is logged. (A dedicated image run, §5.2, instead refuses up
  front: it knows it will draw; a hosted tool only may.) A background run
  cancelled after its images were stored discards them.
- **Streaming.** Provider progress events (`response.web_search_call.*`,
  `response.code_interpreter_call.*`, …) are consumed by the stream mapper;
  each hosted call surfaces once, as the `output_item.done` carrying its
  final typed item — identical to what `create` returns.
- **Clients.** `GET /api/ai/config` publishes the five switches as
  `hostedTools` booleans (all false while AI is off; never the allowlist).
  The OpenAI classifier declares `hosted_tools` for its reasoning and chat
  multimodal families; an administrator can override the chip per model.

### 5.5 Audio transcription (Phase 2, issue #438)

The §5.2 shape with the recording as the one input and the transcript as
the run's output: an adapter method (`audio.transcribe`), one facade
method, one usage `operation` (`'audio.transcribe'`), one job type
(`ai.audio.transcribe`, §9) and one route.

- **Facade.** `ai.forUser(userId).transcribe({ storageObjectId, model?,
  language?, prompt?, timestampGranularities? })` → `{ runId, jobId }`.
  Always asynchronous and not subject to `allowBackgroundRuns`. `model` is
  optional: omitted, it is the first model the caller can use that declares
  `audio_transcription` (in `GET /api/ai/models` order) — never the chat
  `ai.defaultModel`; none → `AI_INVALID_REQUEST`.
- **The recording** is a storage object resolved by the same
  `AiStorageInputResolver` (§5.2): the caller's own (or `storage:read_any`),
  unknown → **404**, another user's → **403** (the storage API's answers,
  kept deliberately rather than the 404 the issue sketched), `ready`, a type
  matching `audio/*`, `video/mp4` or `video/webm` (the resolver understands
  `type/*`), and no larger than the port's `transcriptionMaxBytes` (OpenAI:
  25 MiB) — else `AI_INVALID_REQUEST`, refused at queue time from the row
  alone, before anything is queued or called.
- **The job** (`ai.audio.transcribe`, `{ runId }`) re-runs the gates, then
  **streams** the recording to the adapter (`AiMediaInput` may be bytes or
  an `AsyncIterable`): a row that knows its size is read through
  `openCapped`, which fails past the cap whatever the row said; a simple
  upload whose size is still 0 is read with the cap enforced first, so an
  oversized file never reaches the provider. One usage row, `units: {
  audioSeconds }` whenever the provider reports a duration (tokens are
  recorded where it reports those instead). The run completes with
  `output = { type: 'transcription', provider, model, storageObjectId, text,
  language?, durationSeconds?, segments?, words?, usage }`; nothing is
  written to object storage.
- **Retries.** Transcription is idempotent, so the job declares
  `maxAttempts: 2`: an unexpected failure with an attempt left puts the run
  back to `pending` for the queue's retry (a run left `running` under the
  same job by a crashed process is resumed); expected refusals are never
  retried. The shared lifecycle lives in `AiMediaRunHandler`, which
  `ai.image.generate` uses too.
- **OpenAI wire detail.** `POST /v1/audio/transcriptions`, multipart; a
  streamed input goes through the SDK's `toStreamingFile`, so the body is
  sent as it is read. Whisper is asked for `verbose_json` (language,
  duration, segments, `timestamp_granularities`); the GPT-4o transcribe
  family for `json`, without `timestamp_granularities` (it does not take
  them). The upload is named with an extension OpenAI can decode (`memo` +
  `audio/mp4` → `memo.m4a`).

### 5.6 Speech synthesis (Phase 2, issue #439)

§5.2 the other way round: text in, **one storage object the user owns**
out. An adapter method (`audio.speech`) plus a static `audio.voices` list,
one facade method, one usage `operation` (`'audio.speech'`), one job type
(`ai.audio.speech`, §9) and one route.

- **Facade.** `ai.forUser(userId).speak({ input, voice?, model?, format?,
  instructions?, speed? })` → `{ runId, jobId }`. Always asynchronous and
  not subject to `allowBackgroundRuns`. `input` is 1–4096 characters
  (`AI_SPEECH_INPUT_MAX_CHARS`, OpenAI's limit) — longer is
  `AI_INVALID_REQUEST` before any gate reads a table, and before any call;
  split long text into several runs. `model` defaults as for transcription
  (first usable `audio_speech` model); `voice` defaults to the first the
  model lists, and must be one of the model's `voices` (§4), else the
  port's — anything else is `AI_INVALID_REQUEST`. `format` defaults to
  `mp3` (`mp3|wav|opus|aac|flac|pcm`); `speed` is 0.25–4.
- **The job** (`ai.audio.speech`, `{ runId }`): gates → storage pre-flight
  (`assertWritable`, so audio that could not be kept is never paid for) →
  one provider call (one usage row, `units: { characters }`) → the audio
  written as one `ready` object at `ai-outputs/<userId>/<runId>/speech.<ext>`
  (`AiOutputWriter`'s `keyName`) → the run completes with `output = {
  type: 'speech', provider, model, storageObjectId, mimeType, size, format,
  voice, characters, aiGenerated: true, usage }`. Download it through
  `GET /api/storage/objects/{id}/download`. `maxAttempts: 2` — re-synthesis
  writes equivalent audio to the same key.
- **Disclosure.** Provider usage policies — OpenAI's among them — require
  making clear to end users that a voice they hear is AI-generated, not a
  human. Every speech output therefore carries `aiGenerated: true`, and the
  stored object's metadata carries `aiGenerated: 'true'` so the fact travels
  with the file; a client that plays the audio must surface it. This is a
  deployment's obligation the platform makes easy, not one it can discharge.
- **OpenAI wire detail.** `POST /v1/audio/speech` with `response_format`;
  the answer is the audio file itself (never a URL). `instructions` is sent
  only to models that take it — the `tts-1` family rejects it, so it is
  dropped there rather than sent to a 400.

### 5.7 Stateless providers and conversation replay (Phase 3, issue #446)

The contract above was shaped after a provider that STORES responses:
`previousResponseId` chains a request onto an earlier one, and the tool loop
(`runTools`) sent each round's `function_call_output`s chained onto the
response that asked for them. Anthropic's Messages API stores nothing — every
request carries the whole conversation — so a second provider needed one
declared fact, and the contract one small widening.

**The flag.** `AiProviderAdapter.supportsPreviousResponseId?: boolean`,
**absent meaning `true`** (so OpenAI, the fake provider and any fork's
adapter written before it are unchanged). It is a behavioural flag, not a
capability: the conversation still works, it travels differently.
`AiProviderRegistry.supportsPreviousResponseId(id)` is its derivation.
Anthropic and Gemini (§14.2) declare `false`.

**A caller's `previousResponseId` is refused, not ignored.** The gate
pipeline (step 2a, after the provider is known and before any key is
resolved) answers `AI_CAPABILITY_UNSUPPORTED` with `details.capability:
"previous_response_id"` for a provider that declares `false`. Silently
dropping it would answer as though the conversation had just begun — a
wrong answer that looks right. The adapter's own mapper refuses it too, as
defence in depth for a direct port caller. The caller sends the conversation
as `input` instead (user and assistant `message` items).

**The tool loop resends full history** for such a provider, decided per round
by the provider that answered: the original input, then every round's model
output replayed as input — `message` as an assistant message,
`function_call` and `reasoning` as themselves — then that round's tool
outputs. `core/conversation.ts` (`asInputItems`, `replayOutput`) is the one
definition of "the conversation so far", shared by the loop and the
conformance kit. Hosted-tool items are not replayed (the provider executed
them inside its own response; a stateless provider has none of ours).

**The widening.** `AiInputItem` gains `function_call` (the model's own call,
replayed — without it the neutral contract had no way to say "you asked for
this") and `reasoning`. OpenAI accepts a replayed `function_call` as input;
it drops a replayed `reasoning` item, because OpenAI's reasoning replay needs
its own item id and encrypted content, and chaining is how OpenAI keeps
reasoning across turns.

**Opaque provider state, invisible by construction.** Anthropic signs every
`thinking` block and requires the signed block (or the encrypted
`redacted_thinking` block) back at the start of the next request of a
tool-use turn when thinking is on. That material must survive the tool loop
and must never reach a caller: it is not the reasoning summary a caller may
see, and "never expose raw or redacted thinking" is a rule. So it rides on
the `reasoning` item under the `AI_PROVIDER_STATE` **symbol** key, as `{
provider, data }`. `JSON.stringify` skips symbol keys — every HTTP body, SSE
frame, log line and `ai_runs.output` row is therefore free of it with no code
to remember — while an in-process object spread (the tool loop's hop) keeps
it. An adapter reads only state whose `provider` is its own id. A stored
background run drops replayed `reasoning` items entirely (their state is
in-process only by design).

Gemini (#447) uses the same mechanism for a different shape of state: its
opaque `thoughtSignature` sits on individual response PARTS — a thought
summary, a text part, or a function call (Gemini 3 requires the function
call's signature back on the resent turn). Each signature becomes a
`reasoning` item whose state names the part it belongs to (`target:
'thought' | 'text' | 'function_call'`, plus the `callId` for a call); the
signature-only items carry an empty `summary`. Replaying puts each signature
back on exactly that part. No contract change was needed: `replayOutput`
already keeps a reasoning item's state and nothing else's, which is why the
signature travels on a reasoning item rather than on the `function_call`
item itself.

Rejected: **ignoring `previousResponseId`** on a stateless provider (a
silently wrong answer); **an in-process response cache** in the adapter to
emulate chaining (it breaks across replicas, background runs and restarts,
and holds users' conversations in memory with no retention policy); **always
resending history, for every provider** (OpenAI loses its server-side
reasoning continuity across tool rounds and every round re-bills the whole
prompt); **putting the thinking signature in a normal field** (every
serialiser — DTO, SSE, run row, log — would have to remember to strip it).

## 6. Model discovery and classification

A provider's model-listing endpoint returns IDs and little else useful —
not a capability list. Discovery and classification are therefore two
separate steps, both driven by the admin/org key, both server-only:

1. **Discovery**: `adapter.listModels(ctx)` returns `AiDiscoveredModel[]`
   (`{ id, ownedBy?, createdAt?, metadata? }`) — ids, plus whatever the
   provider's listing says about each model in `metadata`
   (`AiDiscoveredModelMetadata`: `displayName`, `inputTokenLimit`,
   `outputTokenLimit`, `supportedActions`, `thinking`; all optional, #447).
   OpenAI and Anthropic list ids only; Gemini's listing carries all five.
2. **Classification**: `adapter.classifyModel(modelId, metadata?)` applies a
   curated, per-provider pattern classifier (e.g. matching `gpt-4o*` against
   known capability sets) and returns `AiModelCapabilities | null`. `null`
   means the provider's own classifier does not recognize the id — the row
   is persisted with `capabilitySource: 'unclassified'`, never guessed at by
   a generic heuristic that could be silently wrong about what a model can
   actually do. The catalog sync hands each id's `metadata` back to the
   adapter that listed it (the second argument is omitted when there is
   none, so a one-argument classifier is called exactly as before); a
   classifier may use it to ENRICH its rule table — the provider's own token
   limits, or a listing that says a model cannot generate at all — but must
   answer from the id alone when it is absent, because every request-time
   lookup and every other caller passes the id only. `metadata` is never
   stored as-is: what the catalog keeps is the classifier's
   `AiModelCapabilities`.

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
`keySource: 'org'`. If the provider is keyless (`requiresKey: false`, §3
rule 0, #448), every admin-enabled, non-deprecated model for it is usable by
everyone, with `keySource: 'none'`. Otherwise, that provider contributes
nothing to the user's usable set.

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
- `ai.audio.transcribe` (#438) — executes one transcription run (§5.5).
  Payload `{ runId }`. `profile: { maxRuntimeMs: 15*60_000, maxAttempts: 2
  }` — the one AI job allowed an automatic retry, because transcribing the
  same recording twice changes nothing but the bill.
- `ai.audio.speech` (#439) — executes one speech run (§5.6). Payload
  `{ runId }`. `profile: { maxRuntimeMs: 5*60_000, maxAttempts: 2 }` — at
  most 4096 characters, and a retry rewrites the same `speech.<ext>` key.
  Like `ai.image.generate`, `AI_STORAGE_UNAVAILABLE` fails the run and
  **throws**.
- Every media job extends `AiMediaRunHandler` (claim, cancel, deadline,
  outcomes, retries for a multi-attempt profile, the settle safety net). Embeddings ship no job
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
round-trip outcome (#437 — `images` records `{ images: n }`; #438 —
`audio.transcribe` records `{ audioSeconds }`; #439 — `audio.speech` records
`{ characters }`), keeping only
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
the adapter's display name); `keySource` → `user`/`org`/`none`/`admin_discovery`.
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
| `AI_CAPABILITY_UNSUPPORTED` | 400 | The model/provider lacks a capability the request needs (§4) — including `previousResponseId` on a provider that stores no responses (`details.capability: "previous_response_id"`, §5.7). |
| `AI_TOOL_DISABLED` | 403 | A hosted tool type an administrator has not switched on, or an MCP server host outside `ai.hostedTools.mcpAllowedHosts` (§5.4). |
| `AI_RATE_LIMITED` | 429 | The provider rate-limited the call, **or** a deployment limit in `ai.limits` was reached (§15 — then `details.limit` names it, with `details.max` and `details.window`); convertible to the queue's `RateLimitError` via `toRateLimitError()` so a job defers rather than burning an attempt. `details.retryAfterMs` (and, over HTTP, a `Retry-After` header in whole seconds, rounded up) says when to retry, whenever it is known. |
| `AI_PROVIDER_UNAVAILABLE` | 503 | The provider is unreachable or erroring at the transport level — including, for the #448 adapters, an endpoint that answered with a **redirect** (`details.providerCode: "redirect_refused"`, `details.status` the 3xx; never followed, its `Location` never echoed) and a slot with no endpoint at all (`details.missing: "baseUrl"`), §14.3. |
| `AI_CONTENT_FILTERED` | 422 | The provider's own content filter rejected the request or response. |
| `AI_INVALID_REQUEST` | 400 | The request itself is malformed (e.g. no model selected and no default set). |
| `AI_STRUCTURED_OUTPUT_INVALID` | 502 | The model's output failed to parse against the requested schema. |
| `AI_STORAGE_UNAVAILABLE` | 503 | An operation whose inputs or outputs are storage objects (§5.2, §5.3) met unconfigured or unwritable object storage (or storage that cannot presign an input); an administrator fixes it at `/admin/settings/storage`. Seen as a background run's `errorCode`, or directly on a synchronous response with a stored input. |

**Admin configuration refusals (#448).** `PUT /api/admin/ai/config`
validates each provider's settings against that provider's own slot schema
before anything is written. These are ordinary `400`s (not `AiError`s),
with the reason in `details.reason` and the provider in `details.provider`:

| `details.reason` | When |
|---|---|
| `AI_UNKNOWN_PROVIDER` | The body names a provider id with no settings slot. |
| `AI_PROVIDER_NOT_REGISTERED` | Enabling a provider no adapter is registered for. |
| `AI_KEY_REQUIRED` | `byok_with_org_fallback` while an enabled, key-requiring provider has no admin key (a keyless provider is exempt). |
| `AI_PROVIDER_FIELD_UNSUPPORTED` | A value for a field the provider's slot does not have (`details.field`) — e.g. `requiresKey` on `openai`. An empty/null value is simply absent. |
| `AI_PROVIDER_SETTINGS_INVALID` | The built slot fails its schema (`details.fields`): a non-`https` Azure endpoint, credentials or a fragment in a URL, a malformed `apiVersion` or deployment name. |
| `AI_BASE_URL_REQUIRED` | Enabling `azure-openai` or `openai-compatible` without a `baseUrl` — neither has a default host. |

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
fourteen conditions occurred. Its `apiKey`/key material must never appear in
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
   If the provider's model list carries facts about each model, return them
   as `AiDiscoveredModel.metadata` and let the classifier enrich its table
   from its optional second argument (§6, §14.2).
3. **Declare whether it can chain.** A provider that stores no responses
   declares `supportsPreviousResponseId: false` (§5.7); the runtime then
   refuses a caller's `previousResponseId` and runs the tool loop by
   resending history. Omit it for a provider that chains.
4. **Run the conformance kit** (`describeAiProviderConformance`, #424)
   against the new adapter. It asserts, uniformly across every provider:
   `listModels` returns ids; `verifyKey`'s ok/invalid mapping; `classifyModel`
   returns schema-valid capabilities or `null`; if `responses` is
   implemented — `create` returns `outputText`, `stream` yields
   `response.created … response.completed` in order with deltas
   concatenating to the final text, structured output returns a
   schema-valid `parsed`, a function-tool round-trip works (chained with
   `previousResponseId`, or — reading the declared flag — with the
   conversation replayed), and an unsupported capability surfaces as
   `AI_CAPABILITY_UNSUPPORTED`; and, always, that every error the adapter
   can produce is an `AiError`, never a raw SDK exception. Run it over a
   MOCKED TRANSPORT (the real SDK with an injected `fetch`) that validates
   what the real API validates — a mock that accepts what the provider
   would reject proves nothing.
5. **Register the id** in `AI_PROVIDER_IDS` and give it a
   `providers.<id>` slot in every place the settings namespace is declared
   (`settings-parity.spec.ts` pins one slot per id); add the module to
   `AiModule`'s imports.

Nothing about the registry, the gate pipeline (§9 of #432), the admin API
(§9 below) or the HTTP surface (§10 below) changes to add a provider — they
already operate on `AiProviderAdapter` and `AiProviderRegistry.ids()`.

There are three worked examples, deliberately different in shape:
`providers/openai/` (the Responses API — every port, chaining),
`providers/anthropic/` (the Messages API — `responses` only, stateless) and
`providers/gemini/` (`generateContent` — `responses` and `embeddings`,
stateless, part-level replay state, metadata-enriched classifier). A
provider that speaks OpenAI's wire protocol is not a fourth shape but a
composition of the first: `providers/azure-openai/` and
`providers/openai-compatible/` (§14.3) reuse the OpenAI adapter's mappers
and engines with their own client factory and settings.

### 14.1 The Anthropic adapter (Phase 3, issue #446)

`apps/api/src/ai/providers/anthropic/` mirrors the OpenAI layout — client
factory, messages mapper, stream mapper, errors, model catalog, module, and a
`testing/` mock transport — and is the only place `@anthropic-ai/sdk` is
imported. It carries the `responses` port only (Anthropic has no
embeddings, image-generation or audio endpoints) and declares
`supportsPreviousResponseId: false`.

**Request mapping.** `instructions` (plus any `system`/`developer`
messages) → `system`; `message` items → `user`/`assistant` turns of content
blocks — `text`, `image` (URL, or base64 from a `data:` URL), `document`
(a PDF by URL or base64, plain text inline); `function_call` → assistant
`tool_use` and `function_call_output` → user `tool_result`; consecutive
items of one role merge into one turn, the shape the API requires. Function
tools → `tools` with `input_schema`; `toolChoice` → `auto`/`none`/`any`
(`required`)/`tool`. Hosted tools are refused (`AI_CAPABILITY_UNSUPPORTED`):
Anthropic's server tools are a different set, not mapped yet. `metadata` is
not mapped (Anthropic's only metadata field is an end-user id);
`providerOptions.anthropic` is the escape hatch, as `providerOptions.openai`
is for OpenAI.

**`max_tokens` is required** by the Messages API: the caller's (already
clamped) `maxOutputTokens`, else `ANTHROPIC_DEFAULT_MAX_TOKENS` (16,000 —
well inside a ten-minute non-streaming request) capped at the model's own
output limit.

**Reasoning.** The classifier records how each family thinks:
- *adaptive* (Claude 4.6 and later, where `budget_tokens` is deprecated or
  rejected): `thinking: { type: 'adaptive', display: 'summarized' }` plus
  `output_config.effort` — `minimal`/`low` → `low`, `medium`, `high`;
- *budget* (Claude 3.7 – 4.5): `thinking: { type: 'enabled', budget_tokens }`
  from `ANTHROPIC_THINKING_BUDGETS` (1,024 / 2,048 / 6,144 / 16,384 for
  minimal … high), added on top of the default answer allowance — or, with an
  explicit `maxOutputTokens`, shrunk to fit it, and refused
  (`AI_INVALID_REQUEST`) when even the 1,024-token minimum does not;
- *none* (Claude 3.5 and earlier): an effort is `AI_CAPABILITY_UNSUPPORTED`.

A `thinking` block's text becomes the reasoning item's `summary` — Claude 4
returns a summary there, never the raw chain of thought; its signature and
every `redacted_thinking` block travel only as `AI_PROVIDER_STATE` (§5.7).
`temperature` is refused where the family rejects sampling parameters, and
together with extended thinking everywhere, rather than sent to fail.

**Structured output.** Families with Anthropic's native structured outputs
use `output_config.format` (`json_schema`); older ones use a forced single
tool whose `input_schema` is the schema, its `tool_use` input mapped back as
the message text. Either way `parseStructured` validates it, exactly as for
OpenAI. The forced-tool path refuses extended thinking (Anthropic forbids a
forced `tool_choice` with thinking) and other tools alongside it (forcing
the schema tool would make them unreachable).

**Streaming.** `message_start` → `response.created`; `content_block_delta`
`text_delta` → `output_text.delta`, `thinking_delta` →
`reasoning_summary.delta`, `input_json_delta` →
`function_call.arguments.delta` (or `output_text.delta` for the forced
schema tool, so deltas still equal the final text); `signature_delta` is
kept for replay and never emitted; `content_block_stop` →
`output_item.done`; `message_stop` → `response.completed`, built by the same
function `create` uses. An `event: error` frame ends the stream with one
`error` event carrying our generic message.

**Discovery and classification.** `listModels` and `verifyKey` use `GET
/v1/models`. The classifier is a curated, ordered rule table over the Claude
families (Claude 3, 3.5, 3.7, 4.x Opus/Sonnet/Haiku, 5.x Opus/Sonnet, Fable,
Mythos): every family declares `responses`, `tools`, `structured_output` and
`streaming`; `reasoning` where extended thinking exists; `vision_input`;
`file_input` from Claude 3.5 Sonnet on (PDFs). None declares `hosted_tools`,
and the adapter declares `supportsHostedTools: false`: hosted tools ride on
the `responses` port with no port of their own, so without that declaration
the registry would derive `hosted_tools` from the port and the admin view's
`supportedCapabilities` would claim it. The flag, like
`supportsPreviousResponseId`, is optional and absent means `true` (OpenAI,
the fake provider and existing forks are unchanged).
Anything else is `null` — unclassified.

**Errors.** 401 → `AI_KEY_INVALID`; 403 and 404 → `AI_MODEL_NOT_REACHABLE`;
429 (and 402 `billing_error`, OpenAI's `insufficient_quota` precedent) →
`AI_RATE_LIMITED` with `retry-after`; 529 `overloaded_error`, 5xx and 408 →
`AI_PROVIDER_UNAVAILABLE` (with `retry-after` when named); other 4xx →
`AI_INVALID_REQUEST`; an abort → `AI_PROVIDER_UNAVAILABLE` with
`details.aborted`, as OpenAI's. Only the status, Anthropic's error `type` and
its request id reach `details` — never the provider's text.

**Storage-object inputs** (§5.3): images by `presigned_url`, documents
`inline` — nothing is uploaded to Anthropic, so nothing needs deleting.

**The client** is built per call with the key explicitly (which
short-circuits the SDK's own credential chain — `ANTHROPIC_API_KEY`,
`ANTHROPIC_AUTH_TOKEN`, a CLI profile, workload identity federation),
`authToken: null`, an explicit base URL, `maxRetries: 0` and logging off.

**Clients learn the flag from `GET /api/ai/config`.** Each `providers[]`
entry carries `supportsPreviousResponseId` (read from the adapter through
the registry), so a client never has to discover statelessness by being
refused. The web AI Playground uses it: for a provider that cannot chain it
resends the conversation so far (the completed user and assistant turns) as
`input` instead of sending `previousResponseId`; for OpenAI it keeps
chaining.

### 14.2 The Gemini adapter (Phase 3, issue #447)

`apps/api/src/ai/providers/gemini/` mirrors the Anthropic layout — client
factory, content mapper, stream mapper, embeddings mapper, errors, model
catalog, module, and a `testing/` mock transport — and is the only place
`@google/genai` is imported (`gemini-sdk-boundary.spec.ts` pins it). The
adapter is `'gemini'` / "Google Gemini", carries the `responses` and
`embeddings` ports, and declares `supportsPreviousResponseId: false`,
`supportsHostedTools: false` and `fileInputStrategy: { image: 'inline',
file: 'inline' }`. Images, audio and realtime are absent: Gemini's
image-output, speech and Live models are a different surface this adapter
does not map (and its classifier leaves them unclassified).

**The client** is built per call on the Gemini Developer API with the key,
an explicit base URL, API version `v1beta` and no `retryOptions` (the SDK
then never retries). Everything the SDK would read from the environment is
overridden: `vertexai: false` (so `GOOGLE_GENAI_USE_VERTEXAI` can never route
a call to a Vertex project's credentials), the explicit key
(`GOOGLE_API_KEY`/`GEMINI_API_KEY` ignored) and base URL
(`GOOGLE_GEMINI_BASE_URL` ignored). There are still no AI environment
variables (§2).

**Request mapping.** `instructions` (plus `system`/`developer` messages) →
`systemInstruction`; `message` items → `user`/`model` turns of parts:
`text`; `inlineData` (base64) for a `data:` URL or a storage object's
bytes; `fileData { fileUri, mimeType? }` for any other URL (the MIME type
from the path's extension when it names one — Gemini is the authority
otherwise). `function_call` → model `functionCall { name, args, id? }`;
`function_call_output` → user `functionResponse { name, response, id? }`.
Gemini matches a response to its call by NAME, so the mapper reads the name
off the matching `function_call` earlier in the (full-history) input, and
refuses an output whose call is not there. A JSON-object output is sent as
the `response`; anything else is wrapped as `{ output }`, the key Gemini
documents. Consecutive items of one role merge into one turn. Function
tools → one tool of `functionDeclarations` with `parametersJsonSchema`;
`toolChoice` → `functionCallingConfig.mode` `AUTO`/`NONE`/`ANY`
(`required`), a named function → `ANY` + `allowedFunctionNames`.
`maxOutputTokens` and `temperature` map to the same-named config fields;
`metadata` is dropped (the API has no free-form request metadata);
`providerOptions.gemini` is merged into the config last.

**Function-call ids.** Gemini 3 names each call; earlier models do not. An
id-less call gets a synthetic `callId` (`gemini_call_<uuid>`) so the neutral
contract's non-empty id holds; a synthetic id is never sent back.

**Reasoning.** With a reasoning effort or a summary requested, the config
carries `thinkingConfig { includeThoughts: true }` — Gemini then returns
thought SUMMARIES (parts marked `thought: true`), which become reasoning
items' `summary`; the raw chain of thought is never returned. An effort is
expressed per family (`GeminiModelProfile.thinking`):
- *level* (Gemini 3.x): `thinkingLevel` — Flash all four levels, Pro only
  `LOW` (minimal/low) and `HIGH` (medium/high);
- *budget* (Gemini 2.5, and any unclassified model): `thinkingBudget` from
  `GEMINI_THINKING_BUDGETS` (512 / 2,048 / 8,192 / 24,576 — inside the
  ranges of 2.5 Pro, Flash and Flash-Lite alike);
- *none* (Gemini 2.0, 1.5): an effort is `AI_CAPABILITY_UNSUPPORTED`.

**Thought signatures** are replayed through `AI_PROVIDER_STATE` on reasoning
items that name the part they came from (§5.7) — required by Gemini 3 on a
function-call turn, which the mock transport enforces as the real API does.

**Structured output** → `responseMimeType: 'application/json'` +
`responseJsonSchema`, then `parseStructured`, exactly as for the other
providers. It is refused (`AI_CAPABILITY_UNSUPPORTED`) on Gemini 2.0/1.5
(not declared `structured_output`) and, on Gemini 2.5, together with
function tools (that pair is a 400 there; Gemini 3 accepts it). A filtered
answer to a structured request is `AI_CONTENT_FILTERED` — there is nothing
to parse.

**Streaming** uses `generateContentStream` (`:streamGenerateContent?alt=sse`).
Gemini streams partial responses with no terminal event: the first chunk →
`response.created`; text slices → `output_text.delta`; thought slices →
`reasoning_summary.delta`; a function call (sent whole) →
`function_call.arguments.delta` + `output_item.done`; a change of part kind
closes the open item (`output_item.done`); the end of the stream →
`response.completed`, but only if a finish reason (or a blocked prompt) was
seen — a stream that ends without one is truncated and ends with an `error`
event. Both paths assemble parts with the same `GeminiOutputAssembler` and
finish with the same function, so a streamed and a non-streamed response
have identical output items. A consumer that stops early aborts the request
through the adapter's own abort controller (the SDK's iterator only releases
its reader).

**Finish reasons.** `MAX_TOKENS` → `length`; `SAFETY`, `RECITATION`,
`BLOCKLIST`, `PROHIBITED_CONTENT`, `SPII`, `LANGUAGE`, `IMAGE_*` safety →
`content_filter` (and a prompt blocked with no candidate); malformed or
unexpected tool calls and `OTHER` → `error`; otherwise `tool_calls` when the
output holds a call, else `stop`. **Usage**: `inputTokens` =
`promptTokenCount` + `toolUsePromptTokenCount`; `outputTokens` =
`candidatesTokenCount` + `thoughtsTokenCount` (thinking is billed as output,
as OpenAI's and Anthropic's counts include it); `reasoningTokens` =
`thoughtsTokenCount`; `cachedInputTokens` = `cachedContentTokenCount`.

**Embeddings** (§5.1) via `embedContent` (`:batchEmbedContents` on the wire):
every input is its own `Content` — a bare string array would be folded by
the SDK into ONE multimodal content (one vector) for `gemini-embedding-2`;
`dimensions` → `outputDimensionality`; the answer must be one finite vector
per input, all one length, or it is `AI_PROVIDER_UNAVAILABLE`. The Gemini API
reports no token count for embeddings, so `usage` is `{}`.

**Hosted tools are not mapped** (`supportsHostedTools: false`; every hosted
tool is refused with `AI_CAPABILITY_UNSUPPORTED`). Google Search grounding
and code execution exist, but neither maps cleanly onto §5.4's result types:
grounding cites sources through `vertexaisearch.cloud.google.com` redirect
links rather than the source URLs `AiWebSearchCallResult.sources` and
`AiUrlCitation.url` promise, and locates citations by UTF-8 byte offsets per
part where `AiUrlCitation` means character offsets into the message text;
code execution has no container (`containerId` is required) and returns
plots as inline bytes where the type carries a URL; and Gemini 2.5 cannot
combine either tool with function calling. A lossy mapping would be worse
than an honest refusal — this is a follow-up.

**Storage-object inputs** (§5.3) are `inline` for both modalities: the
runtime reads the bytes under its 20 MiB / 50 MiB caps and the adapter sends
them as base64 `inlineData`. A presigned URL is not usable as `fileData`
(Gemini expects a Files API or Cloud Storage URI there), and the Files API
would add an upload, a wait for the file to become `ACTIVE` and a delete for
bytes that fit inline. Nothing is uploaded, so nothing is left to delete;
Gemini's own inline request-size limit is the authority on a very large
file, and its 400 is `AI_INVALID_REQUEST`.

**Discovery and classification.** `listModels` pages `GET /v1beta/models`
(1,000 per page), strips the `models/` prefix, and returns each model's
listing facts as `metadata` (§6); `verifyKey` lists one model. The
classifier (`gemini-model-catalog.ts`) is a curated, ordered rule table —
Gemini 3.x Pro/Flash/Flash-Lite, 2.5 Pro/Flash/Flash-Lite, 2.0 Flash /
Flash-Lite, 1.5 Pro/Flash, and the embedding models
(`gemini-embedding-*`, `text-embedding-004`) — that deliberately leaves
image-output, TTS, Live/native-audio, computer-use and robotics variants and
the non-Gemini families (Imagen, Veo, Gemma, AQA, LearnLM) unclassified. The
listing metadata then enriches it: the provider's `inputTokenLimit` /
`outputTokenLimit` replace the table's limits; a `supportedActions` list
that lacks the method a profile needs (`generateContent`, or
`embedContent`/`batchEmbedContents`) makes the id unclassified, whatever its
name suggests; and an id no rule knows is still classified when the listing
is clear — a `gemini-*` model supporting `generateContent` gets the generic
current-generation profile (reasoning only if `thinking` says so), a model
supporting `embedContent` the embedding profile. Aliases such as
`gemini-flash-latest` classify this way. Every generative Gemini model
declares `vision_input` and `file_input`; none declares `hosted_tools`.

**Errors** (`gemini-errors.ts`). The SDK throws one typed error, `ApiError
{ status, message }`, whose message is Google's JSON error body (or, for an
error object mid-stream, `got status: <STATUS>. <json>`). Only three facts
are read from it — the canonical `status`, `ErrorInfo.reason` and
`RetryInfo.retryDelay` — and only those, the HTTP status and nothing of the
provider's text reach `details`.

| Gemini answer | `AiErrorCode` |
|---|---|
| 400 `INVALID_ARGUMENT` with reason `API_KEY_INVALID` (Gemini's answer to a bad key) | `AI_KEY_INVALID` |
| 401 `UNAUTHENTICATED`, 403 `PERMISSION_DENIED` | `AI_KEY_INVALID` |
| 404 `NOT_FOUND` | `AI_MODEL_NOT_REACHABLE` |
| 429 `RESOURCE_EXHAUSTED` | `AI_RATE_LIMITED`, `retryAfterMs` from `RetryInfo` |
| 408, 499, 5xx (`INTERNAL`, `UNAVAILABLE`, `DEADLINE_EXCEEDED`) | `AI_PROVIDER_UNAVAILABLE` (with the retry delay when named) |
| any other 4xx (`INVALID_ARGUMENT`, `FAILED_PRECONDITION`, ...) | `AI_INVALID_REQUEST` |
| the caller's signal aborted the request | `AI_PROVIDER_UNAVAILABLE`, `details.aborted` |
| the client's own timeout aborted it | `AI_PROVIDER_UNAVAILABLE`, `details.transport: "timeout"` |
| `fetch` failed | `AI_PROVIDER_UNAVAILABLE`, `details.transport: "connection"` |
| anything else (a malformed SSE chunk, ...) | `AI_PROVIDER_UNAVAILABLE` |

**Conformance.** `gemini.adapter.conformance.spec.ts` runs the unchanged kit
twice over a mock transport injected into the real SDK: Gemini 2.5 (id-less
calls, embeddings with `dimensions`) and Gemini 3 (named calls whose
`thoughtSignature` the mock requires back). The mock validates what the real
API validates: the bad-key 400, unknown fields, alternating turns starting
with a user turn, a function-response turn immediately after its call turn
with one response per call, `thinkingConfig` only on thinking models, no
JSON response together with function calling on Gemini 2.5.

### 14.3 The OpenAI-compatible adapters: Azure OpenAI and generic servers (Phase 3, issue #448)

Enterprise deployments frequently must use **Azure OpenAI** (data
residency, an existing enterprise agreement) or a **self-hosted** model
server — Ollama, vLLM, LM Studio, llama.cpp's server, a LiteLLM gateway —
that exposes OpenAI's API at its own base URL. Two adapters cover them:
`azure-openai` ("Azure OpenAI") and `openai-compatible`
("OpenAI-compatible"). Neither is a new mapping. Both are **compositions of
the OpenAI adapter's own pieces**, extracted into shared helpers under
`providers/openai/` rather than copied (the OpenAI adapter's behaviour and
tests are unchanged by the extraction):

| Shared piece (`providers/openai/`) | What it is |
|---|---|
| `openai-errors.ts` — `OpenAiFamily` | `{ providerId, label }`: the one thing that differs in an error or a response between family members — the provider id stamped on `details`/`AiResponse.provider` and the name in the generic, secret-free messages. Every mapper takes it, defaulting to OpenAI. |
| `openai-responses.engine.ts` | `create`/`stream` against `POST /responses`, with the #441 storage delivery and an optional **wire model** (an Azure deployment name). |
| `openai-chat-completions.mapper.ts` / `-stream.mapper.ts` / `.engine.ts` | The **Chat Completions** path (below) — new in #448, shared by both adapters. |
| `openai-call-telemetry.ts` | The `ai.provider.call` span and debug line (§12). |
| `openai-client.factory.ts` — `pinnedOpenAiClientOptions` | Every SDK option pinned: no `OPENAI_*` environment read, `maxRetries: 0`, no SDK logging. |
| `openai-redirect-guard.ts` — `noRedirectFetch` | The SSRF control below. |
| `openai-embeddings.mapper.ts` | `/embeddings`, reused by both adapters' embeddings port. |

`openai-sdk-boundary.spec.ts` pins the `openai` package to exactly these
three directories (`openai/`, `azure-openai/`, `openai-compatible/`).

**Settings** (§2). Each adapter's slot extends the common `{ enabled,
baseUrl? }`, and the runtime hands every non-secret field besides `enabled`
and `baseUrl` to the adapter as `AiCallContext.providerSettings`, which the
adapter reads with its own schema and defaults (`providerCallSettings(slot)`
in `ai-config.service.ts` builds both for every call site: the facade, the
catalog sync, the admin key verification and connection test, and the user
key probe):

| Slot | Field | Meaning | Default |
|---|---|---|---|
| `azure-openai` | `baseUrl` | The resource endpoint, `https://<resource>.openai.azure.com` (the adapter appends `/openai`, once). **https only.** Named `baseUrl` like every slot, so every generic consumer handles it with no Azure special case. | none — required to enable |
| | `apiVersion` | The `api-version` query value. | `2025-04-01-preview` (`AZURE_OPENAI_DEFAULT_API_VERSION`) |
| | `apiStyle` | `responses` or `chat_completions`. | `responses` — current api-versions serve the Responses API |
| | `deployments` | `Record<modelId, deploymentName>`; replaced whole on write. | none — each model id is sent as its own deployment name |
| `openai-compatible` | `baseUrl` | The server's API root **including** its version segment (`http://ollama.internal:11434/v1`). **http or https.** | none — required to enable |
| | `apiStyle` | `chat_completions` or `responses`. | `chat_completions` — what every compatible server serves |
| | `requiresKey` | `false` is the administrator's opt-in to a **keyless** server (below). | `true` |

The admin view (`GET /api/admin/ai/config`) reports each provider's
`settingsFields` (read off its slot schema) and the stored `apiVersion`,
`apiStyle`, `deployments`, `requiresKey` (`null` when unset, i.e. the
default); `PUT` accepts them per provider and refuses a field the provider
does not have, a slot that fails its schema, or enabling either adapter with
no endpoint — the §13 admin refusal table.

**Azure OpenAI** (`providers/azure-openai/`).

- *Client*: one `AzureOpenAI` per call with `baseURL: <endpoint>/openai`,
  the slot's `apiVersion` and the key in Azure's **`api-key` header**.
  `baseURL`, `apiVersion` and `apiKey` are always explicit: `AzureOpenAI`
  falls back to `OPENAI_BASE_URL` / `OPENAI_API_VERSION` /
  `AZURE_OPENAI_API_KEY`, and an ambient variable on a host must not move or
  break a call (a spec pins this with the variables set).
- *Deployments*: Azure routes by **deployment name**. A model id is looked
  up in `deployments` and falls back to itself (Azure's common convention of
  naming a deployment after its model); the deployment goes on the wire
  (the body's `model` for the Responses API, `/deployments/<name>/…` for
  Chat Completions and embeddings), while the model id stays what
  classification, telemetry, usage rows and the neutral response use.
- *Model list*: `GET /openai/models` is always called (it is also how a key
  is verified). With a `deployments` map configured, **its keys are the
  model list** — Azure's data plane cannot enumerate a resource's
  deployments, and the listing it does return names every model the region
  offers, deployed or not. Without a map the listing is returned as-is and
  the administrator enables what is deployed.
- *Classifier*: Azure models are OpenAI models, so ids classify with
  OpenAI's own table (`classifyOpenAiModel`) **minus `hosted_tools`**; an id
  the table does not know (`gpt-35-turbo`, a custom map key) is
  unclassified.
- *Ports*: `responses` and `embeddings`. Images and audio are absent for now
  (their Azure routing differs per api-version).
- *Storage inputs* (§5.3): images by `presigned_url`, files `inline`.

**OpenAI-compatible** (`providers/openai-compatible/`).

- *Client*: the OpenAI SDK per call at `baseUrl`, key as a bearer token
  (what vLLM's `--api-key`, LM Studio and most gateways check).
- *Model list*: `GET {baseUrl}/models`. **`classifyModel` answers `null` for
  every id**: a compatible server's ids (`llama3.1:8b`,
  `Qwen/Qwen2.5-7B-Instruct`) say nothing reliable about capabilities, so
  every discovered model is stored `unclassified` and an administrator
  declares it in the Models UI (an `admin_override`, §6) before enabling it.
  The conformance kit's `classifyModel` scenario is skipped for this reason
  (it needs at least one classified id); the adapter's own spec pins `null`.
- *Ports*: `responses` and `embeddings` (`POST {baseUrl}/embeddings`, which
  Ollama, vLLM and LM Studio serve, through the shared mapper).
- *Storage inputs*: `inline` for both modalities — a self-hosted server
  usually cannot reach this deployment's object storage, and `data:` images
  are what Ollama and vLLM accept.
- *Token limit parameter*: `max_tokens` (Azure's Chat Completions path uses
  `max_completion_tokens`, its current name and the only one its reasoning
  deployments accept).

**The Chat Completions mapper** — graceful degradation. Compatible servers
nearly always serve `POST /chat/completions` and rarely the Responses API.
`instructions` become a leading `system` message; `developer` turns are sent
as `system` (compatible servers rarely know the role); image parts become
`image_url` (a URL, presigned URL or `data:` URL) and file parts `file` with
inline `file_data` or a `file_id` (a remote file URL is refused);
function tools become `tools[].function` with the Zod schema's JSON Schema;
a replayed tool round-trip becomes `tool_calls` on the preceding assistant
turn and one `tool` message per output; replayed `reasoning` items are
dropped; structured output becomes `response_format: { type: 'json_schema',
json_schema: { name, schema, strict } }`, then `parseStructured` (§5).
Streaming asks for `stream_options: { include_usage: true }` so the last
chunk carries token usage; the stream mapper accumulates text and
tool-call-argument deltas (keyed by the call id each call announced in its
first fragment) and completes through the same `fromChatCompletion` the
non-streamed path uses, so both paths agree on what a response means and a
stream that ends without a finish reason is failed as truncated. Refused
with `AI_CAPABILITY_UNSUPPORTED`: a reasoning **effort** (Chat Completions
has no reasoning summaries and compatible servers no effort knob — a summary
request alone is a no-op), `previousResponseId`, and any hosted tool.
`metadata` is not forwarded.

**Flags — static and conservative.** Both adapters declare
`supportsPreviousResponseId: false` and `supportsHostedTools: false`, in
**both** API styles. A flag is per adapter while `apiStyle` is per slot; the
alternative — resolving the flag per call from settings — was rejected as
more machinery than it buys: Azure's Responses API does store responses,
but declaring `false` only means the tool loop resends the full history
(§5.7), which works in both styles, and the public config's published flag
(§5.7) stays a fact about the provider rather than about a setting that can
change between two requests of one conversation. A hosted tool that reaches
either port directly is refused before any request.

**`keySource: 'none'`** (§3 rule 0). With `openai-compatible` enabled and
`requiresKey: false`:

- `AiKeyResolver` answers `{ apiKey: AI_KEYLESS_API_KEY, keySource: 'none' }`
  first, under either key policy, reading no key; `sourceFor` answers
  `'none'`, so every admin-enabled model is usable with no BYOK key (§7).
- The client factory sees the marker and removes the SDK's `Authorization`
  header entirely — the marker never reaches the wire (the adapter spec
  asserts no request carries it), nor any response, log line, usage or run
  row (`ai-secret-egress.integration.spec.ts`).
- Usage rows record `keySource: 'none'`; the rate limits count it like a
  user's own call and never against `orgKey.*` (§15).
- `GET /api/ai/config` publishes `requiresKey: false` for it, so a client
  stops prompting users for a key nobody needs.
- The catalog sync and the admin connection test run keyless with no admin
  key stored, `POST /api/admin/ai/models/refresh` does not 409 for such a
  provider, and `byok_with_org_fallback` does not require it to have an org
  key.
- `ai_usage_events.key_source` is a plain string, so `'none'` costs no
  migration.

**SSRF posture.** Both adapters send this server's requests to a host an
administrator typed in.

- *Validated*: `aiEndpointUrlSchema` (`settings.schema.ts`) — scheme `https`
  only for Azure, `http`/`https` for a compatible server; no credentials in
  the URL (`https://user:pass@…` — a key belongs in the credential store,
  never in a document `GET /api/system-settings` returns wholesale); no
  fragment. A stored slot that fails it resets to its default on read, and
  the admin `PUT` refuses it (`AI_PROVIDER_SETTINGS_INVALID`).
- *Not refused*: an internal host. `http://ollama.internal:11434/v1` is the
  canonical self-hosted setup; **pointing the platform at an internal host
  is an explicit administrator decision**, writable only with
  `ai_config:write` / `system_settings:write`, both seeded Admin-only.
- *Never redirected*: `noRedirectFetch` sends every request with `redirect:
  'manual'` and turns **any** 3xx — same-origin included — into a synthetic
  `redirect_refused` error the SDK raises as an ordinary `APIError`,
  mapped to `AI_PROVIDER_UNAVAILABLE` with `details.status` and
  `details.providerCode: "redirect_refused"`; the `Location` is never
  followed or echoed. Refusing all redirects rather than only cross-origin
  ones is deliberate: an OpenAI-shaped API root has no business redirecting
  a POST, a same-origin redirect is nearly always a misconfigured `baseUrl`
  (a missing `/v1`) better reported than absorbed, and "same origin" is
  exactly the check a hostile DNS answer or proxy would aim to confuse.
- `providers.openai.baseUrl` is left exactly as it was (#428).

**Conformance.** The unchanged kit runs four times over the mocked
transport (the real SDK with an injected `fetch`; the mock checks Azure's
`api-key` header, not a bearer token): Azure in the Responses and the Chat
Completions style, and the compatible adapter in both. The kit skips the
ports neither adapter carries.

### HTTP surface

**Admin** (`/api/admin/ai/*`, `@ApiTags('AI Administration')`):

| Method & path | Permission | Behaviour |
|---|---|---|
| `GET /api/admin/ai/config` | `ai_config:read` | `describeForAdmin()` — `{ enabled, keyPolicy, logPromptContent, defaults, usageRetentionDays, hostedTools, limits, providers:[{ id, displayName, enabled, baseUrl, settingsFields, apiVersion, apiStyle, deployments, requiresKey, keyStatus, supportedCapabilities }], version, updatedAt, updatedBy }` (the four provider-specific fields are `null` where unset or not applicable — §14.3). `keyStatus = { configured, hint, updatedAt, updatedByUserId }` from `credentials.describe` — **never** `getSecret`. `providers` = registry ids ∪ settings keys. |
| `PUT /api/admin/ai/config` | `ai_config:write` | Body `{ enabled, keyPolicy, logPromptContent, defaults, usageRetentionDays?, hostedTools?, limits?, providers:{ [id]: { enabled, baseUrl?, apiVersion?, apiStyle?, deployments?, requiresKey? } } }` (the last four only for a provider whose `settingsFields` lists them; empty or null means the default — §14.3) (`usageRetentionDays`, `hostedTools` and `limits` omitted keep the stored value — the non-full-replace fields, so older clients still save; a `limits` that IS sent replaces the stored limits wholesale, so `{}` lifts them all (§15); the audit names each changed switch, `hostedTools.mcpAllowedHosts`, each changed `limits.*` number and `limits.perModel` as one field — never a host, never a value); `If-Match: <version>` (mismatch → 409, like storage). Enabling a provider id not in the registry → 400. Setting `keyPolicy='byok_with_org_fallback'` while that provider has no admin key → 400 `AI_KEY_REQUIRED` (a keyless provider is exempt). A provider's settings are validated against its own slot — 400 `AI_PROVIDER_FIELD_UNSUPPORTED` / `AI_PROVIDER_SETTINGS_INVALID` / `AI_BASE_URL_REQUIRED` (§13). Audit `ai_config:replace` (field names only). |
| `PUT /api/admin/ai/providers/:provider/key` | `ai_config:write` | Body `{ apiKey }` (min 8). Verified with `adapter.verifyKey` **first**; invalid → 400 `AI_KEY_INVALID`, nothing stored. Audit `ai_config:set_key`. |
| `DELETE /api/admin/ai/providers/:provider/key` | `ai_config:write` | Body `{ confirmation: 'REMOVE' }`. Audit `ai_config:delete_key`. Under `byok_with_org_fallback`, response includes `warnings:['ORG_FALLBACK_WITHOUT_KEY']`. |
| `POST /api/admin/ai/providers/:provider/test` | `ai_config:write` | `@HttpCode(200)` always. Body `{ apiKey?, baseUrl? }` (blank ⇒ stored key). Checks: `credentials`, `list_models`, `responses_smoke`. The provider slot's other settings (§14.3) apply; a keyless provider with no key submitted or stored is tested with no key. Audit `ai_config:test` (codes only). |
| `GET /api/admin/ai/models` | `ai_config:read` | Query `provider?, capability?, enabled?, includeDeprecated?(default false), q?`, paginated like `GET /api/admin/jobs`. |
| `PATCH /api/admin/ai/models/:id` | `ai_config:write` | Body `{ enabled?, displayName?, capabilities? }`. Sets `capabilitySource='admin_override'`. Enabling a deprecated model → 409. Enabling an unclassified model with no capabilities supplied → 400. Audit `ai_model:update`. |
| `POST /api/admin/ai/models/refresh` | `ai_config:write` | Body `{ provider }`. 409 if no admin key — unless the provider is keyless (`requiresKey: false`, §14.3). Enqueues `ai.catalog.refresh`; returns `{ jobId }`. Audit `ai_catalog:refresh_requested`. |
| `GET /api/admin/ai/usage` | `ai_config:read` | Query `from?, to?, groupBy?(day), userId?, provider?, model?` → the usage report (§12). |

**Public config** (any authenticated user, no `ai_config` permission
needed — the `/api/notifications/config` pattern), and **user keys/usable
models** below, both carry `@ApiTags('AI')` — issue #431 moved
`GET /api/ai/config` onto this tag alongside the rest of `/api/ai/*`, so
every consumer-facing route (as opposed to `/api/admin/ai/*`'s
`AI Administration` tag) groups under one heading in the API reference:

| Method & path | Auth | Behaviour |
|---|---|---|
| `GET /api/ai/config` | `@Auth()` | `{ enabled, keyPolicy, allowBackgroundRuns, hostedTools:{ web_search, file_search, code_interpreter, image_generation, mcp }, providers:[{ id, displayName, enabled, hasOrgKey, supportsPreviousResponseId, requiresKey }] }` — `supportsPreviousResponseId: false` (Anthropic, Gemini, Azure OpenAI, OpenAI-compatible) means send the conversation as `input`; `previousResponseId` is refused (§5.7). `requiresKey: false` (#448) marks a keyless OpenAI-compatible server: nobody needs a key for it (§14.3). When `enabled=false`: `{ enabled:false, keyPolicy, allowBackgroundRuns:false, hostedTools:{ …all false }, providers:[] }`. Never includes hints or keys. Reachable even while `ai.enabled=false` (§8). |

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
| `POST /api/ai/responses/stream` | SSE (§10). `tools` takes hosted tools only (§5.4); function tools are not accepted over HTTP — they execute server-side code and are for in-process `runTools()` only. Request body limit 1 MB. |
| `POST /api/ai/embeddings` | `forUser(id).embed(...)` → `{ provider, model, dimensions, vectors, usage }` (§5.1). `model` required; > 256 inputs → 400 `AI_INVALID_REQUEST`; a model without `embeddings` → 400 `AI_CAPABILITY_UNSUPPORTED`. Request body limit 1 MB. |
| `POST /api/ai/images` | `generateImage(...)` → `{ runId, jobId }`, status 202 (§5.2). A model without `image_generation` → 400 `AI_CAPABILITY_UNSUPPORTED`. |
| `POST /api/ai/images/edits` | `editImage(...)` → `{ runId, jobId }`, status 202. Inputs by storage object id: unknown → 404, another user's → 403, not ready / wrong type / too large → 400 `AI_INVALID_REQUEST`. |
| `POST /api/ai/audio/transcriptions` | `transcribe(...)` → `{ runId, jobId }`, status 202 (§5.5). The recording by storage object id: unknown → 404, another user's → 403, not ready / not audio / over the provider limit → 400 `AI_INVALID_REQUEST`; a model without `audio_transcription` → 400 `AI_CAPABILITY_UNSUPPORTED`. |
| `POST /api/ai/audio/speech` | `speak(...)` → `{ runId, jobId }`, status 202 (§5.6). `input` over 4096 characters → 400; a voice the model does not speak → 400 `AI_INVALID_REQUEST`; a model without `audio_speech` → 400 `AI_CAPABILITY_UNSUPPORTED`. The output carries `aiGenerated: true`. |
| `POST /api/ai/runs` | `startRun(...)` → `{ runId, jobId }`, status 202. |
| (all three responses routes) | `image`/`file` parts take `url` **or** `storageObjectId` (§5.3): unknown object → 404, another user's → 403, wrong modality → 400 `AI_CAPABILITY_UNSUPPORTED`, over 20/50 MiB → 400 `AI_INVALID_REQUEST`, storage unusable → 503 `AI_STORAGE_UNAVAILABLE`. |
| `GET /api/ai/runs/:id` | Scoped to caller → `{ id, status, provider, modelId, output, errorCode, errorMessage, createdAt, completedAt }` (never the stored prompt, never the job id); `output` is the `AiResponse`, an image run's `{ type: 'images', storageObjectIds, … }`, a transcript `{ type: 'transcription', text, … }`, or speech `{ type: 'speech', storageObjectId, aiGenerated: true, … }`; 404 for another user's run. |
| `POST /api/ai/runs/:id/cancel` | Scoped to caller; 200. |
| `GET /api/ai/usage/me` | Query `from?, to?, groupBy?(day\|model)` → the caller's own usage report (§12). |

## 15. Rate limits and output caps (Phase 3, issue #450)

Even with BYOK an administrator needs guardrails: against abusive request
volume, against one user draining the organization key when fallback is on,
and against runaway generation. `ai.limits` (§2) holds them. **Every field is
optional and absent means unlimited** — the default `{}` is Phase 1's
behaviour exactly, so an upgrade never starts refusing calls by itself.

| Field | Window | Counts |
|---|---|---|
| `perUser.requestsPerMinute` | sliding 60 s | every inference call the user makes, whoever's key pays |
| `perUser.requestsPerDay` | UTC day | the same |
| `orgKey.requestsPerDayPerUser` | UTC day | only calls the **org key** paid for (`keySource: 'org'`) |
| `orgKey.tokensPerDayPerUser` | UTC day | `input_tokens + output_tokens` of those org-key calls |
| `perModel['<provider>:<modelId>'].requestsPerMinutePerUser` | sliding 60 s | the user's calls to that one model |
| `perModel['<provider>:<modelId>'].maxOutputTokens` | — | an output cap, not a rate (below) |

Every number is a positive integer (at most 10⁹). A `perModel` key is the
lower-case provider id, a colon, and the model id exactly as the catalog
lists it (`^[a-z0-9-]+:.+$`, e.g. `openai:gpt-4.1-mini`), at most 500 entries.
Both `PUT /api/admin/ai/config` and `PATCH /api/system-settings` treat
`limits` as ONE value: sent, it replaces the stored limits wholesale (a
field-by-field merge could never lift a limit, and "absent" is how one is
lifted); omitted, the stored limits stay. `GET /api/ai/config` does not
publish them.

**Where it sits.** `AiLimitsService` (`ai/runtime/ai-limits.service.ts`) is
step 6b of the gate pipeline (§9 of #432): right **after** key resolution,
because the org-key limits must know whose key pays — a user on their own
key is never counted against `orgKey.*`, and a user with no usable key still
hears `AI_KEY_REQUIRED` rather than a rate limit. It runs inside the shared
`context()` step, so every provider round-trip passes it: `respond`,
`respondStructured`, `stream`/`openStream`, **each step** of a `runTools`
loop, `embed`, and the queued media runs (`executeImageRun`,
`executeTranscriptionRun`, `executeSpeechRun`, and the `ai.response.run`
handler's `respond`) **when the job executes**. The enqueue-only calls —
`startRun`, `generateImage`/`editImage`, `transcribe`, `speak` — never reach
it, so a queued request is counted once, when it actually calls the
provider, never twice. A queued run refused by a limit is **deferred**, not
failed: the handlers already turn `AI_RATE_LIMITED` into the queue's
`RateLimitError` (`toRateLimitError()`), with the limit's `retryAfterMs`, on
the separate rate-limit budget (`JOBS_RATELIMIT_*`), and the run returns to
`pending`.

**What counts.** One `ai_usage_events` row (§12) is one request. Only
`keySource` `user`/`org`/`none` rows count — a catalog sync
(`admin_discovery`) is the deployment's own call. A keyless call (`none`,
#448) counts like a user's own-key call: against `perUser.*` and
`perModel.*`, never against `orgKey.*`, since no organization key pays for
it. Failed and cancelled round-trips count (they
reached the provider). A call a limit refused records **no** row, so
hammering a limit does not extend the lock-out.

**Two sources for a minute window.** There is no Redis (or any shared cache)
in this template, and adding one for this alone was rejected (below). A
per-minute limit is therefore answered from two sources, and the larger
count wins:

1. an **in-process log** of admitted calls per `userId` (and per
   `userId:provider:model`), checked and reserved **synchronously**, before
   any `await` — so a burst of concurrent calls in one replica cannot all
   pass the check before any of them has finished and written its row; a
   call refused later in the same gate releases its reservation;
2. a **`COUNT(*)` over `ai_usage_events`** for that user (and model) with
   `created_at` in the last 60 seconds — served by the `(user_id,
   created_at)` index — so several API replicas agree on one budget.

The trade-off, stated plainly: the database count **lags by in-flight
requests** — a usage row is written when a round-trip *finishes*, so calls
still running on *other* replicas are invisible to it. Within one replica the
local log is exact; across replicas the limit can be overshot by at most the
number of calls in flight elsewhere. That is the right precision for abuse
protection and the wrong tool for billing, which is what the usage report
(§12) is for.

Daily windows read the database only: counts (and, for tokens, sums) since
**UTC midnight**, the same day boundary the usage report uses.

**When no limit applies there is no query at all.** A deployment with `{}`,
or with limits that do not apply to this call (org-key limits for a user on
their own key, a `perModel` entry for another model), pays nothing for this
feature.

**The refusal.** `AiError('AI_RATE_LIMITED')`, 429, with:

```ts
details: { reason: 'AI_RATE_LIMITED',
           limit: 'perUser.requestsPerMinute' | 'perUser.requestsPerDay'
                | 'orgKey.requestsPerDayPerUser' | 'orgKey.tokensPerDayPerUser'
                | 'perModel.requestsPerMinutePerUser',
           max: number, window: 'minute' | 'day',
           keySource?: 'org', provider: string, model: string,
           retryAfterMs: number }
```

`retryAfterMs` is, for a minute window, the time until enough counted calls
have left the window for one more to fit (the `(count − max + 1)`-th oldest
call's timestamp + 60 s − now); for a daily window, the time until the next
UTC midnight; never under one second. The global `HttpExceptionFilter` adds
`Retry-After` (seconds, rounded up) to any 429 whose `details` carry
`retryAfterMs` — provider throttles included. A call exactly 60 s old has
already left the window, in the log, the query and the arithmetic alike.

**Per-model output cap.** `perModel[…].maxOutputTokens` joins the gate pipeline's step-5
clamp: the call's cap is the **smaller** of `defaults.maxOutputTokensCap` and
the model's `maxOutputTokens`, applied whether or not the request named a
limit of its own, then bounded by the model's own catalog limit as before. A
background run stores the clamped value and is clamped again, against the
limits then in force, when it executes.

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
- **A Redis (or other shared-cache) rate limiter** for §15's per-minute
  windows. Rejected: this template has no such dependency, and adding a
  stateful service to every deployment — to be provisioned, secured, backed
  up and monitored — for abuse protection that tolerates a small overshoot
  is the wrong trade. The in-process log is exact within a replica, the
  indexed `ai_usage_events` count makes replicas agree, and the only error
  is bounded by calls in flight on other replicas (§15). A fork that needs
  exact cross-replica limits can put a shared store behind
  `AiLimitsService` without touching a caller.
- **Counting at enqueue time as well as at execution** for queued AI work.
  Rejected: a queued request would be counted twice — once as an intent,
  once as the call — and a burst of enqueues could lock a user out of
  synchronous calls for work that has not run yet. A limit is checked when
  the provider is actually called; a queued run over it is deferred (§15).
- **Browser-side provider calls** (the web app calling OpenAI directly with
  a key handed to the client). Rejected outright: it would require shipping
  a user's own provider key to their browser (defeating the point of
  server-side encrypted storage, §2), makes the kill switch and every gate
  in §7/§9 unenforceable (a client can simply not call the gate), and
  removes every usage/audit row this platform's accounting depends on
  (§12). Every provider call in this platform happens server-side, with no
  exception.

## The Playground (`/ai`, web reference UI — #434, #445)

The Playground is the template's copyable example of consuming every AI
capability from the browser, and a user's way to prove their key works. It
calls only the HTTP surface above — never a provider, never a key.

- **Modes.** A segmented control (not a settings tab strip) switches between
  Chat, Image, Transcribe, Speech and Embeddings. Each mode is defined by one
  capability (`responses`, `image_generation`, `audio_transcription`,
  `audio_speech`, `embeddings`) and lists only the usable models (§7) that
  declare it; a mode no usable model serves stays focusable but
  `aria-disabled`, with the reason as its tooltip. Nothing is keyed on a model
  name (`apps/web/src/components/ai/playground/aiPlaygroundModes.ts`). A
  mode's panel stays mounted once visited, so its inputs and any run it is
  polling survive a switch.
- **Chat** streams (`/responses/stream`) or queues a background run, with
  controls shown only for what the model declares (§4). Attachments (§5.3)
  are offered per `vision_input`/`file_input` **and** the matching input
  modality, pre-checked against the 20/50 MiB caps, uploaded through the
  storage API and sent by `storageObjectId`. Hosted tools (§5.4) appear only
  when the model has `hosted_tools` and the tool is switched on in
  `GET /api/ai/config` `hostedTools`; web search, file search (vector store
  ids typed in), code interpreter and image generation are offered — MCP is
  deliberately not, since it needs a secret header a playground should not
  invite users to paste. Citations, tool results and hosted images render
  under the answer; only `http(s)` URLs from a model or provider are linked.
- **Image, Transcribe, Speech** are run-backed: one `POST` answering 202, then
  the shared `useAiRun` poll (`startWith`) and `AiRunCard`. Inputs (an image
  and mask to edit, a recording) are uploaded and read back until `ready`
  first. Outputs are the user's storage objects, shown from short-lived
  signed download URLs: an image gallery (alt text from the prompt), a
  transcript with timestamped segments and a copy button, and a labelled
  `<audio controls>` player that always shows **"AI-generated audio"** (the
  speech disclosure, §5.6). Speech voices come from the model's `capabilities.voices`.
- **Embeddings** is synchronous: one input per line (≤ 256), then count,
  dimensions, the first 8 values per vector and — for ≤ 10 inputs — a cosine
  similarity matrix computed in the browser from the returned vectors.
- **Errors** of every road (a refused request, an SSE `error` frame, a failed
  run's `errorCode`) render through the one `AiErrorAlert` mapping; the
  storage API's own "not configured" reasons read as `AI_STORAGE_UNAVAILABLE`.

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
| Storage-object inputs: ownership/modality/size/strategy gates, delivery by presigned URL and by Files API upload with provider-side deletion (success, failure, stream end), queued runs storing only the id, and no presigned URL in any response, row or log line | `apps/api/src/ai/runtime/ai-file-inputs.spec.ts`, `apps/api/src/ai/providers/openai/openai-file-inputs.spec.ts`, `apps/api/test/ai/ai-file-inputs.integration.spec.ts`, `apps/api/test/ai/ai-secret-egress.integration.spec.ts` |
| Rate limits (§15): each limit's window and exact `retryAfterMs`, unlimited and query-free when unset, org-key limits never applied to a user's own key, the gate after key resolution, what counts, the per-model output clamp, a limited background run deferred not failed, and 429 + `Retry-After` + `details.limit` over HTTP | `apps/api/src/ai/runtime/ai-limits.service.spec.ts`, `apps/api/src/ai/runtime/ai-limits.facade.spec.ts`, `apps/api/src/ai/runtime/ai-response-run.handler.spec.ts`, `apps/api/src/ai/runtime/ai-image-generate.handler.spec.ts`, `apps/api/test/ai/ai-limits.integration.spec.ts`, `apps/api/src/ai/core/ai-error.spec.ts` |
| Stateless providers (#446): a caller's `previousResponseId` refused before any key is resolved, `runTools` resending full history with reasoning state replayed and never serialised, the Anthropic adapter passing the conformance kit (forced-tool and native structured outputs) over a mock as stateless as the real API, its mapping/stream/error/classifier tables, and both providers registered under every #435 guard suite | `apps/api/src/ai/runtime/ai-tool-loop.spec.ts`, `apps/api/src/ai/providers/anthropic/*.spec.ts`, `apps/api/src/common/schemas/settings-parity.spec.ts`, `apps/api/test/ai/*.spec.ts` |
| The Gemini adapter (#447): the conformance kit (unchanged) passing over a mock as strict as the real API, including Gemini 3 thought-signature replay and the embeddings port; the mapping, stream, embeddings, error and classifier tables, the classifier's enrichment from listing metadata, the catalog handing that metadata to `classifyModel`, `@google/genai` confined to its folder, and three providers registered under every #435 guard suite | `apps/api/src/ai/providers/gemini/*.spec.ts`, `apps/api/src/ai/catalog/ai-catalog.service.spec.ts`, `apps/api/src/common/schemas/settings-parity.spec.ts`, `apps/api/test/ai/*.spec.ts` |
| Embeddings: one vector per input in order, `dimensions` honoured, a model without `embeddings` → `AI_CAPABILITY_UNSUPPORTED`, > 256 inputs → `AI_INVALID_REQUEST`, one `operation: 'embeddings'` usage row; the #435 key-policy and secret-egress suites drive `POST /api/ai/embeddings` | `apps/api/src/ai/providers/openai/openai-embeddings.spec.ts`, `apps/api/src/ai/runtime/ai-embed.spec.ts`, `apps/api/test/ai/ai-embeddings.integration.spec.ts`, the conformance kit's `embeddings.*` scenarios |

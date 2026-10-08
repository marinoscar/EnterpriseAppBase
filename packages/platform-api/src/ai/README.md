# @marinoscar/platform-api/ai

The AI platform: admin-governed, bring-your-own-key, multi-provider AI for the API layer. One runtime facade (`AiService.forUser`) runs every call through the same gate pipeline (kill switch, provider and model enablement, capability match, limits, key resolution), records usage and traces it; five provider adapters (OpenAI, Anthropic, Gemini, Azure OpenAI, OpenAI-compatible) are the only place a provider SDK is imported. Moved out of the reference app's `src/ai/` by issue #739 (PP-8.6), which also added the organization tier: an organization's own provider keys, its tighten-only `ai` settings layer and its own kill switch, per-organization daily caps and usage, the feature registry and the target resolver. It depends on `core`, `doctor`, `otel-core`, `identity`, `settings`, `credentials`, `jobs`, `nodes`, `storage` and `testing` of this package (`packages/platform-slices.json`) and on `@marinoscar/platform-contract/ai` for the settings schemas and the org-key and feature shapes. The test kit is the nested subpath `@marinoscar/platform-api/ai/testing`, catalogued here. The design and its rationale are [docs/specs/ai-platform.md](../../../../docs/specs/ai-platform.md); the operator runbook is [docs/runbooks/ai-configuration.md](../../../../docs/runbooks/ai-configuration.md).

## Purpose and scope

One governed path from a feature to a model, so no feature holds a provider SDK, a key or a policy check of its own.

| Part | Source | What it is |
|---|---|---|
| Module | `ai.module.ts`, `ai.options.ts`, `ports.ts` | `AiModule.forRoot(options)` and the host ports the app binds |
| Core | `core/` | The provider-neutral contract: requests, responses, stream events, capabilities, `AiError`, the provider registry, tools and structured output |
| Providers | `providers/<provider>/` | The five adapters; the only files that import `openai`, `@anthropic-ai/sdk` or `@google/genai` |
| Catalogue | `catalog/` | Model discovery and classification (`ai_models`), the `ai.catalog.refresh` job |
| Policy | `config/`, `ai.system-settings.ts`, `ai.user-settings.ts` | The `ai` settings namespaces (with the org layer), the kill switch (`AiEnabledGuard`, `AiOrgEnabledInterceptor`), the deployment's provider keys, `/api/admin/ai/*` |
| Keys | `keys/` | A user's own keys (`/api/ai/keys`), an organization's own keys (`/api/admin/ai/org-keys`), `AiKeyResolver`, `UsableModelsService` |
| Features | `features/`, `runtime/target-resolver.ts` | `registerAiFeature`, `GET /api/ai/features`, `AI_TARGET_RESOLVER` |
| Runtime | `runtime/` | `AiService`, background runs (`ai_runs`, the `ai.*` job types), the tool loop, limits, usage recording |
| HTTP | `http/` | `/api/ai/responses` (and its SSE stream), runs, embeddings, images, audio, realtime |
| Storage | `storage/` | Storage objects in (`AiStorageInputResolver`) and out (`AiOutputWriter`, under `ai-outputs/`), over `AI_OBJECT_STORE` |
| Usage | `usage/` | The usage report (`/api/admin/ai/usage`, `/api/admin/ai/org-usage`, `/api/ai/usage/me`) and its retention purge |
| Test kit | `testing/` (`/ai/testing`) | `FakeAiProvider`, the runtime harness, the adapter conformance kit, the conformance suites (`conformance/`: kill switch, RBAC matrix, secret egress, key policy, jobs server-only, no SDK leak, orchestration boundary) |

Not here: the AI admin and user settings pages other than the Organization AI keys page (they stay in the reference app's `apps/web` for now; the org-key page is `@marinoscar/platform-web/ai`), orchestration graphs (an app's own, above the gateway), and object storage itself (`@marinoscar/platform-api/storage`, reached through the `AI_OBJECT_STORE` port).

### Module map

```
ai/
  ai.module.ts            # AiModule.forRoot(): the root module, one import line per sub-module
  ai.options.ts / ports.ts  # forRoot's resolved options; the host ports (AI_SYSTEM_PRISMA, AI_OBJECT_STORE, AI_METRICS)
  ai.permissions.ts        # AI_PERMISSIONS: ai_config:read/write, ai:use, org_ai_config:read/write
  ai.system-settings.ts / ai.user-settings.ts   # the `ai` namespaces (schemas from @marinoscar/platform-contract/ai)
  data/                    # AiDb, AiPrisma, AiSystemPrisma: the tables, structurally (no generated client)
  features/                # registerAiFeature, the feature registry, GET /api/ai/features
  core/                    # Provider-agnostic contracts. Feature code imports FROM HERE.
    ai-error.ts              AiError, AiErrorCode, AI_ERROR_STATUS
    capabilities.ts          AiCapability, AI_CAPABILITIES, aiModelCapabilitiesSchema
    provider-adapter.interface.ts   AiProviderAdapter — what a provider implements
    provider-registry.ts     AiProviderRegistry — self-registration, adapterCapabilities()
    structured-output.ts     Zod <-> JSON Schema conversion for structured output
    tools.ts                 defineTool() — function-tool definition + argument validation
    hosted-tools.ts          Hosted-tool shape, admin gate (AI_TOOL_DISABLED), MCP header secrets
    conversation.ts          asInputItems/replayOutput — a turn as input, for stateless providers
    types/                   AiResponse, AiResponseRequest, AiStreamEvent, media types,
                             file-inputs.types.ts (storage-object inputs: caps, strategies)
  providers/
    openai/                  The Phase 1 adapter (Responses API; every port), and the OpenAI
                             wire family's SHARED pieces: OpenAiFamily errors, the
                             Responses and Chat Completions engines/mappers, call telemetry,
                             pinned client options, noRedirectFetch. With the two dirs below,
                             the ONLY place the `openai` SDK is imported —
                             `openai-sdk-boundary.spec.ts` pins it.
    anthropic/               The Phase 3 adapter (Messages API, `responses` port only,
                             stateless). ONLY place `@anthropic-ai/sdk` is imported —
                             `anthropic-sdk-boundary.spec.ts` pins it; `core/no-provider-sdk.spec.ts`
                             and the `ai-no-sdk-leak` conformance suite keep every SDK out of the rest.
    gemini/                  The Phase 3 Gemini adapter (generateContent, `responses` +
                             `embeddings` ports, stateless, no hosted tools). ONLY place
                             `@google/genai` is imported — `gemini-sdk-boundary.spec.ts` pins it.
                             Its classifier is enriched by the model listing's own metadata
                             (`AiDiscoveredModel.metadata`, `classifyModel`'s optional 2nd arg).
    azure-openai/            The Azure OpenAI adapter: AzureOpenAI client per call
                             (endpoint, api-version, `api-key` header), `apiStyle` responses |
                             chat_completions, model id -> deployment map, OpenAI classifier
                             minus hosted_tools; `responses` + `embeddings`, stateless flags.
    openai-compatible/       The generic OpenAI-compatible adapter (Ollama, vLLM, LM
                             Studio): `baseUrl` + `apiStyle` (chat_completions default),
                             every model unclassified, keyless when `requiresKey: false`
                             (keySource 'none'); `responses` + `embeddings`.
  catalog/                 Model discovery + classification (ai_models table)
    ai-catalog.service.ts    Read/query the catalog
    ai-catalog-refresh.handler.ts   `ai.catalog.refresh` job (server-only)
    ai-catalog-refresh.task.ts      Daily backfill cron — enqueues only
    ai-catalog.events.ts     AI_CATALOG_SYNCED_EVENT
  config/                  Deployment-wide settings + the kill switch + admin API
    ai-config.service.ts     Read the `ai` settings namespace; assertEnabled/assertProviderEnabled
    ai-enabled.guard.ts       AiEnabledGuard — the kill switch, as a Nest guard
    ai-admin.controller.ts   /api/admin/ai/* (ai_config:read/write)
    ai-public.controller.ts /api/ai/config (any authenticated user)
    ai-config-admin.service.ts, ai-models-admin.service.ts, ai-provider-test.service.ts
  keys/                    Per-user BYOK keys + which models a user can reach
    ai-key-resolver.service.ts   AiKeyResolver — the ONE place the user/org/deployment key rule is decided
    org-key.service.ts / org-keys.controller.ts   An organization's own keys, /api/admin/ai/org-keys (#739)
    usable-models.service.ts    UsableModelsService — "which models can I call?"
    user-ai-keys.service.ts / .controller.ts   /api/ai/keys/*, /api/ai/models
    ai-keys-recheck.handler.ts / .task.ts       `ai.keys.recheck` job (server-only)
    ai-keys-catalog.listener.ts  Subscribes to AI_CATALOG_SYNCED_EVENT
  runtime/                 The facade every feature actually calls
    ai.service.ts            AiService — forUser(userId), the gate pipeline (see below)
    ai-runs.service.ts        AiRunsService — background run rows; AI_RESPONSE_RUN_TYPE
    ai-response-run.handler.ts  `ai.response.run` job (server-only)
    ai-media-run.handler.ts   AiMediaRunHandler — the claim/cancel/deadline/outcome lifecycle of media runs
    ai-image-generate.handler.ts  `ai.image.generate` job (server-only) — image runs
    ai-audio-transcribe.handler.ts  `ai.audio.transcribe` job (server-only) — transcription runs
    ai-audio-speech.handler.ts   `ai.audio.speech` job (server-only) — speech runs -> a storage object
    ai-run-request.ts         toStoredRunRequest/fromStoredRunRequest (ai_runs.request JSON)
    ai-hosted-outputs.ts      AiHostedOutputSettler — image bytes -> storage seam, MCP header scrub
    ai-image-run-request.ts   an image run's stored request
    ai-audio-run-request.ts   an audio run's stored request
    ai-run-operation.ts       aiRunOperation — `request.operation` tells runs apart
    ai-tool-loop.ts            runToolLoop — the function-calling agent loop
    ai-usage.recorder.ts       One ai_usage_events row per provider round-trip
    ai-limits.service.ts       AiLimitsService — ai.limits rate limits (per user, org key, per org, per model), step 6b
    target-resolver.ts         AI_TARGET_RESOLVER, DefaultAiTargetResolver — which model a call uses
  http/                    The consumer HTTP surface
    ai-responses.controller.ts   POST /api/ai/responses, POST /api/ai/responses/stream
    ai-runs.controller.ts        POST /api/ai/runs, GET/POST /api/ai/runs/:runId(/cancel)
    ai-embeddings.controller.ts  POST /api/ai/embeddings
    ai-images.controller.ts      POST /api/ai/images, POST /api/ai/images/edits — 202, a run
    ai-audio.controller.ts       POST /api/ai/audio/transcriptions, POST /api/ai/audio/speech — 202, a run
    ai-realtime.controller.ts    POST /api/ai/realtime/sessions — 201, an ephemeral realtime secret
    ai-sse.ts                     pipeAiSse/formatSseEvent/abortOnDisconnect — see below
    ai-http-request.ts           toAiRequest — HTTP DTO -> AiRequest
    json-schema-structured-output.ts   HTTP callers send JSON Schema, not Zod
  storage/                 Storage objects in and out of AI — shared by every media story
    ai-storage-input.resolver.ts  AiStorageInputResolver — object id -> ownership-checked input (+ bytes)
    ai-output-writer.ts          AiOutputWriter — bytes -> the user's storage objects under ai-outputs/
    ai-storage-errors.ts         aiErrorFromStorage — storage failures as run outcomes
    ai-storage-key-prefixes.ts   AI_STORAGE_KEY_PREFIXES — `ai-outputs/`, registered with the storage slice
  usage/                   Reading ai_usage_events back
    ai-usage.service.ts          AiUsageService — the aggregate report (GROUPING SETS SQL)
    ai-usage-admin.controller.ts GET /api/admin/ai/usage (ai_config:read), GET /api/admin/ai/org-usage (org_ai_config:read)
    ai-usage.controller.ts       GET /api/ai/usage/me (ai:use, caller only)
    ai-usage-purge.handler.ts / .task.ts   `ai.usage.purge` job + daily enqueue-only cron
  testing/                 `/ai/testing`: FakeAiProvider, describeAiProviderConformance, the runtime harness,
                           runOrchestrationBoundarySuite
```

Every sub-module is wired into `ai.module.ts` by one import line. A fork
adding AI to its own feature imports the one configured `AiModule` and
injects `AiService`; it never reaches into `core/`, `providers/`, `config/`
or `keys/` directly for that purpose (those are the slice's own internals,
not a feature's dependency). The HTTP surface (controllers, wire schemas) is
exported for the reference app's route discovery and contract suites only,
tagged `@internal`.

## Install and peer dependencies

Ships inside `@marinoscar/platform-api`; import it by its subpath:

```ts
import { AiModule, AiService, registerAiFeature } from '@marinoscar/platform-api/ai';
```

The three provider SDKs (`openai`, `@anthropic-ai/sdk`, `@google/genai`) are dependencies of `@marinoscar/platform-api` itself, imported only under `providers/<provider>/` (each pinned by its SDK-boundary spec). The slice depends on no generated Prisma client: it declares the `ai` fragment's tables structurally (`AiDb`, `AiPrisma`, the `*Row` types) and receives the app's client through core's `PLATFORM_PRISMA` port and the bypass client through `AI_SYSTEM_PRISMA`. Never install an orchestration package outside an app's orchestration directory (see Security notes).

## Quick start

The reference app's binding ([`ai.config.ts`](../../../../apps/api/src/platform/ai/ai.config.ts)) configures the module once, with a `@Global()` host module ([`ai-host.module.ts`](../../../../apps/api/src/platform/ai/ai-host.module.ts)) binding the ports:

```ts
// apps/api/src/platform/ai/ai-host.module.ts
@Global()
@Module({
  imports: [StorageProvidersModule],
  providers: [
    { provide: AI_SYSTEM_PRISMA, useExisting: PrismaSystemService },
    { provide: AI_OBJECT_STORE, useClass: AiObjectStoreAdapter },
    { provide: AI_METRICS, useExisting: AppMetricsService },
  ],
  exports: [AI_SYSTEM_PRISMA, AI_OBJECT_STORE, AI_METRICS],
})
export class AiHostModule {}

// apps/api/src/platform/ai/ai.config.ts
export const AiModule = PlatformAiModule.forRoot({ imports: [AiHostModule] });
```

A feature registers what it needs from a model and calls the facade ([`example-summary.feature.ts`](../../../../apps/api/src/examples/ai/example-summary.feature.ts), [`example-summary.service.ts`](../../../../apps/api/src/examples/ai/example-summary.service.ts)):

```ts
registerAiFeature({ id: 'example_summary', label: 'Summaries', needs: ['responses'] });

const answer = await this.ai.forUser(userId, { orgId, feature: 'example_summary' }).respond({ input });
```

### Using AI from a feature

Import the app's configured `AiModule`, inject `AiService`, and call
`forUser(userId, scope?)`. `scope.orgId` is the call's organization (the
principal's active one; a background job carries its own) and selects the
organization's policy, caps and own key; `scope.feature` names a registered
AI feature (`registerAiFeature`), which the target resolver and the
`app.ai.*` metrics read:

```ts
import { AiModule } from '../platform/ai/ai.config'; // the app's one configured AiModule

@Module({ imports: [AiModule], providers: [MyFeatureService] })
export class MyFeatureModule {}
```

```ts
constructor(private readonly ai: AiService) {}

async summarize(userId: string, text: string) {
  const res = await this.ai.forUser(userId).respond({ input: `Summarise: ${text}` });
  return res.outputText;
}
```

No SDK, no key, no policy check of your own — `forUser` runs the full gate
pipeline (kill switch, provider/model enablement, capability match, key
resolution, the `ai.limits` rate limits and output-token clamp — see below),
records one `ai_usage_events` row per round-trip, and traces the call. A call
over a limit throws `AiError('AI_RATE_LIMITED')` with `retryAfterMs` and
`details.limit` (429 plus `Retry-After` over HTTP); in a job,
`err.toRateLimitError()` defers it. Twelve entry points, all on the client
`forUser` returns:

- **`respond(req, opts?)`** — one response. `req.input` is a string or
  `AiInputItem[]` (text/image/file parts); `opts.signal` aborts it.
  `req.previousResponseId` chains onto an earlier response only on a
  provider that stores them (OpenAI); Anthropic, Gemini, Azure OpenAI and
  OpenAI-compatible refuse it with
  `AI_CAPABILITY_UNSUPPORTED` — send the conversation as `input` instead
  (`runTools` already does, spec §2.10).
- **`stream(req, opts?)`** — an `AsyncIterable<AiStreamEvent>`. Lazy: a gate
  or pre-stream provider failure surfaces on the first iteration. Use this
  for an in-process consumer that is already committed to iterating.
- **`openStream(req, opts?)`** — the SSE-route form: the returned promise
  itself rejects with the `AiError` for anything that fails *before* the
  first event, so an HTTP handler can answer it as an ordinary JSON error
  rather than an in-band frame; after that, iterate exactly like `stream`.
- **`respondStructured({ schema, schemaName?, strict?, ...req }, opts?)`** —
  `schema` is a Zod schema; `parsed` on the result is typed and always
  present, or the call throws `AiError('AI_STRUCTURED_OUTPUT_INVALID')`.

  ```ts
  const weather = z.object({ city: z.string(), tempC: z.number() });
  const { parsed } = await this.ai.forUser(userId).respondStructured({
    schema: weather,
    input: 'What is the weather in Paris right now, roughly?',
  });
  ```
- **`runTools({ input, tools, maxSteps? }, opts?)`** — the function-calling
  agent loop (up to 8 gated round-trips by default, max 20). Define a tool
  with `defineTool` (`ai/core/tools.ts`) — one Zod schema doubles as the
  provider-facing JSON Schema and the validation of the model's arguments:

  ```ts
  const getWeather = defineTool({
    name: 'get_weather',
    description: 'Look up the current weather for a city.',
    parameters: z.object({ city: z.string() }),
    execute: async ({ city }, ctx) => lookupWeather(city, ctx.userId),
  });

  const result = await this.ai.forUser(userId).runTools({
    input: 'What is the weather in Paris?',
    tools: [getWeather.tool],
  });
  ```
- **`startRun(req)`** — queues the request as a background `ai.response.run`
  job and returns `{ runId, jobId }` at once; poll with
  `AiRunsService.get(userId, runId)` / cancel with `.cancel(...)`. Throws
  `AiError('AI_INVALID_REQUEST')` for a function tool (it cannot survive the
  queue hop — use `runTools` in-process instead) or when
  `ai.defaults.allowBackgroundRuns` is off.
- **`embed({ model, input, dimensions? }, opts?)`** — one vector per input
  (a string or up to 256 strings), synchronous; `model` is required. For a
  large backfill, enqueue your own server-only job that embeds one chunk
  per run (`docs/specs/ai-platform.md` §2.11).
- **`generateImage({ model, prompt, n?, size?, … })` /
  `editImage({ …, imageStorageObjectIds, maskStorageObjectId? })`** —
  always queue an `ai.image.generate` run and return `{ runId, jobId }`;
  the succeeded run's `output.storageObjectIds` are storage objects the
  user owns (under `ai-outputs/<userId>/<runId>/`). Edit inputs are the
  user's own storage objects, never bytes. A later media feature reads and
  writes storage the same way, through `ai/storage`'s
  `AiStorageInputResolver` / `AiOutputWriter` (§2.12).
- **`transcribe({ storageObjectId, model?, language?, prompt?,
  timestampGranularities? })`** — always queues an `ai.audio.transcribe`
  run; the succeeded run's `output.text` is the transcript. The recording
  is the user's own storage object, streamed to the provider by the job
  (§2.13).
- **`speak({ input, voice?, model?, format?, instructions?, speed? })`** —
  always queues an `ai.audio.speech` run (input ≤ 4096 characters); the
  succeeded run's `output.storageObjectId` is the audio, a storage object
  the user owns, with `aiGenerated: true` — surface that to listeners
  (§2.14).
- **`createRealtimeSession({ model?, voice?, instructions?, turnDetection?,
  tools? })`** — synchronously mints an ephemeral realtime secret the
  BROWSER connects to the provider with over WebRTC (`{ clientSecret,
  expiresAt, connectUrl, … }`); off unless `ai.defaults.allowRealtime`
  (`AI_REALTIME_DISABLED`); one usage row, `units: { sessions: 1 }` (§2.15).

**Picking a model**: pass `req.model` (and `req.provider` when more than one
is registered) to pin it, or leave both unset to fall back to the caller's
own `user_settings.ai.defaultModel` — `AiService` resolves this the same way
either path is called, so a feature never re-implements the fallback.

**Handling `AiError`**: every failure this platform can produce is an
`AiError` with a stable `.code` (never a raw provider SDK error) — catch it
and switch on `.code`, not on `err.message`, which is deliberately generic
for anything wrapping a caught SDK error. `docs/specs/ai-platform.md` §2.23
has the full table (`AI_DISABLED`, `AI_KEY_REQUIRED`, `AI_MODEL_NOT_ENABLED`,
`AI_CAPABILITY_UNSUPPORTED`, `AI_RATE_LIMITED`, …); a job handler does
`throw err.toRateLimitError() ?? err;` so a provider throttle defers the job
rather than charging an attempt, the same idiom `RateLimitError` already
uses elsewhere in this codebase.

## Configuration

`AiModule.forRoot(options)`. No option is an environment variable: keys, models, policy and limits are runtime configuration (the `ai` settings namespace, the credential stores, `ai_models`).

| Option | Type | Default | Meaning |
|---|---|---|---|
| `imports` | `Array<Type \| DynamicModule>` | `[]` | The `@Global()` modules binding the host ports (`AI_SYSTEM_PRISMA` and `AI_OBJECT_STORE` required; `AI_METRICS` and `AI_TARGET_RESOLVER` optional) |
| `providers` | `AiProviderModuleId[]` | all five | Which provider adapters to load; an unloaded provider is absent from the registry (its settings slot stays, inert) |
| `perUserDefaultModel` | `boolean` | `true` | Whether users pick their own default model (`ai.defaultModel`); `false` for an app whose features pick their model (an `AI_TARGET_RESOLVER`). `GET /api/ai/config` reports it, so the web hides the picker |

### Runtime policy (the `ai` namespace)

The deployment's `ai` system settings namespace (schemas: `@marinoscar/platform-contract/ai`) holds `enabled`, `keyPolicy` (`byok` or `byok_with_org_fallback`), one slot per provider, `defaults` (output-token cap, background runs, realtime), `logPromptContent`, `usageRetentionDays`, `hostedTools`, `limits` and `deploymentKeyServesOrgs` (#739, default `true`: whether the deployment's keys pay for an organization that stores none of its own). Edited at `/admin/settings/ai`.

**The org layer (#739).** The namespace is org-overridable through the settings slice: an organization may only TIGHTEN it (`tightenAiPolicy`): switch AI off for its members, narrow `byok_with_org_fallback` to `byok`, switch providers off, and set lower `limits.perOrg` daily caps. `AiConfigService.resolveForOrg(orgId)` is the effective policy every gate reads; `AiOrgEnabledInterceptor` refuses a consumer route with `403 AI_DISABLED` (`details.scope: 'org'`) while the caller's organization has AI off.

**Key resolution.** `AiKeyResolver.resolve(userId, provider, { orgId })` answers, in order: a keyless provider (`requiresKey: false`, `keySource: 'none'`); the user's own key; the organization's own key (under the fallback policy, or for a holder of `org_ai_config:write` in that organization); the deployment's key (when `deploymentKeyServesOrgs`, under the fallback policy or for a holder of `ai_config:write`); else `AI_KEY_REQUIRED`. The tier that paid is the span attribute `ai.key.tier`.

### The request lifecycle: the gate pipeline

Every call through `AiService.forUser(userId)` — `respond`, `stream`,
`openStream`, `respondStructured`, `runTools`, `startRun` — runs the
identical sequence, documented in full in `runtime/ai.service.ts`'s own
header comment:

```
 1. kill switch (deployment, then the org's layer)  -> AI_DISABLED
 2. provider enabled + registered    -> AI_PROVIDER_DISABLED
 2b. hosted tools: shape, admin switch, MCP host  -> AI_INVALID_REQUEST / AI_TOOL_DISABLED
 3. model enabled / capability match /  AI_MODEL_NOT_ENABLED
    key exists / key reaches model      AI_CAPABILITY_UNSUPPORTED
    (UsableModelsService.assertUsable)  AI_KEY_REQUIRED
                                        AI_MODEL_NOT_REACHABLE
 4. reasoning effort offered by the model  -> AI_CAPABILITY_UNSUPPORTED
 5. clamp maxOutputTokens to the deployment cap, the ai.limits.perModel cap
    and the model's own limit (the smallest wins)
 6. resolve the key (AiKeyResolver — the byok invariant lives HERE, only):
    keyless? -> the user's own -> the org's own -> the deployment's
 6b. rate limits (AiLimitsService)         -> AI_RATE_LIMITED (429)
 7. call the adapter: { apiKey, baseUrl, signal, requestId }
 8. record ONE ai_usage_events row (success, failure, or cancellation)
 9. trace it as an `ai.request` span (never the key, never prompt text)
```

Steps 1–5 are `AiService.prepare()` — decrypts nothing, and is the one place
every AI-shaped error code in this platform except `AI_KEY_REQUIRED` (owned
by `AiKeyResolver`) and `AI_KEY_INVALID`/`AI_RATE_LIMITED`/
`AI_PROVIDER_UNAVAILABLE`/`AI_CONTENT_FILTERED`/`AI_STRUCTURED_OUTPUT_INVALID`
(all provider-call-time outcomes) originates. Step 6 is the only place
`AiCallContext.apiKey` exists in this file at all — between resolving it and
handing it to the adapter — and it is never logged, put on a span,
persisted, or included in any `AiError`.

`respondStructured` is `respond` with a `structuredOutput` request shape
layered on; `runTools` is `respond` driven in a loop by `ai-tool-loop.ts`,
one usage row per round-trip; `startRun` runs `prepare()` eagerly (so an
unusable request fails fast, synchronously, before anything is queued) and
then hands a JSON-safe copy of the request (`toStoredRunRequest`) to
`AiRunsService.create`, which enqueues `ai.response.run`.

`embed` is the first non-responses operation and the template
for the rest of Phase 2: `prepareEmbedding()` runs steps 1–3 with
`embeddings` as the one capability needed (plus a shape check: `model`
required, 1–256 non-empty inputs, positive `dimensions`), then it shares
steps 6–9 with `respond` — `context()` and `track()` take a provider-neutral
`AiCallTarget`, and `TRACKED_OPERATIONS` maps the span operation
(`embeddings.create`) to the usage `operation` (`embeddings`). A new port is
one more `prepare…`, one more map entry and one more `AiUserClient` method.
Synchronous, no job; a large backfill is a fork's own server-only job type
calling `embed` per chunk of ≤ 256 rows (`docs/specs/ai-platform.md` §2.11).

`generateImage`/`editImage` are that template plus a queue hop:
`prepareImage()` runs steps 1–3 with `image_generation`/`image_edit` and, for
an edit, resolves each input storage object through
`storage/AiStorageInputResolver` (ownership, readiness, type, size — the row
only); the client then queues an `ai_runs` row (`request.operation:
'images.generate' | 'images.edit'`) and an `ai.image.generate` job. The job
calls `executeImageRun()` — `prepareImage()` again, the storage pre-flight,
the inputs' bytes, then steps 6–9 (`units: { images: n }`) — and stores
every image through `storage/AiOutputWriter` as the user's own storage
objects; the run's `output.storageObjectIds` names them
(`docs/specs/ai-platform.md` §2.12). The two `storage/` pieces are the ones
the audio and file-input stories reuse.

`transcribe` is the same template with the recording as the
one input: `prepareTranscription()` runs steps 1–3 with
`audio_transcription` (an omitted model is the first usable one declaring
it) and resolves the recording (`audio/*`, `video/mp4|webm`, at most the
port's `transcriptionMaxBytes`); `executeTranscriptionRun()` gates again,
streams the recording through `AiStorageInputResolver.openCapped()` into
the adapter, and records `units: { audioSeconds }`. The transcript is the
run's output; nothing is stored (§2.13). Both media jobs extend
`runtime/ai-media-run.handler.ts`, which owns the run lifecycle — a new
media job is its `execute()` plus a type and a profile.

`speak` mirrors images: `prepareSpeech()` runs steps 1–3 with
`audio_speech`, refuses input over 4096 characters first, and resolves the
voice against the model's catalog `voices` (else the port's `audio.voices`);
the `ai.audio.speech` job calls `executeSpeechRun()` (`units: { characters
}`) behind the storage pre-flight and writes the audio through
`AiOutputWriter` as `ai-outputs/<userId>/<runId>/speech.<ext>`. Its output
carries `aiGenerated: true` — the disclosure provider policies require
(§2.14).

`createRealtimeSession` is synchronous and has no job:
`prepareRealtime()` checks the kill switch, then `ai.defaults.allowRealtime`
(default off → `AI_REALTIME_DISABLED`), then steps 2–3 with `realtime`
(an omitted model is the first usable one) and the voice, then `context()`
(key + rate limits — a mint counts as one request), then ONE adapter call:
OpenAI's `POST /v1/realtime/client_secrets` mints an ephemeral `ek_…` secret
with the user's key. The result — `{ provider, model, voice, clientSecret,
expiresAt, connectUrl }` — is the one credential the platform returns: the
browser connects to the provider directly over WebRTC with it, and the
user's key never leaves. Usage is `operation: 'realtime'`, `units: {
sessions: 1 }`, no tokens (the server never sees the audio). See
`docs/specs/ai-platform.md` §2.15.

**Storage-object inputs** need no method of their own: an
`image`/`file` part may carry `storageObjectId` instead of `url`, and
`prepare()` resolves it (`planStorageInputs`: ownership, readiness,
modality from the MIME type vs. `vision_input`/`file_input`, 20/50 MiB caps,
the adapter's `fileInputStrategy`). Just before the key,
`materializeStorageInputs` prepares a 10-minute presigned URL or a capped
stream per input and passes them to the adapter as `ctx.storageInputs`
(never in the request, so nothing logged, queued or recorded carries a URL).
OpenAI sends images as `image_url` and uploads files to its Files API,
deleting them after the response; Anthropic sends images by the same
presigned URL and documents inline (a base64 PDF or plain text), so nothing
is uploaded to it; Gemini sends both images and files inline (base64
`inlineData`) — a presigned URL is not a `fileData` URI Gemini accepts. Azure
OpenAI takes images by presigned URL and files inline; an OpenAI-compatible
server gets both inline (it usually cannot reach this deployment's storage).
See `docs/specs/ai-platform.md` §2.9.

**Stateless providers**: an adapter declaring
`supportsPreviousResponseId: false` (Anthropic, Gemini, and — conservatively,
in both API styles — Azure OpenAI and OpenAI-compatible) cannot chain onto a stored
response. `prepare()` refuses a caller's `previousResponseId` with
`AI_CAPABILITY_UNSUPPORTED` (step 2a, before any key is resolved), and
`runTools` resends the whole conversation each round instead of chaining —
the original input plus every round's output replayed with
`core/conversation.ts`'s `replayOutput`, then the tool outputs. A
`reasoning` item carries the provider's opaque replay state (Anthropic's
thinking signature; Gemini's per-part `thoughtSignature`, tagged with the
part it belongs on) under the `AI_PROVIDER_STATE` symbol, which
`JSON.stringify` never sees — it survives the in-process hop and nothing
else. `GET /api/ai/config` publishes the flag per provider
(`providers[].supportsPreviousResponseId`) so a client resends history
rather than being refused. See `docs/specs/ai-platform.md` §2.10.

### OpenAI-compatible endpoints and keyless servers

`azure-openai` and `openai-compatible` are compositions of the OpenAI
adapter's shared pieces, not new mappings: each has its own client factory
(Azure: `AzureOpenAI`, `api-key` header, explicit `apiVersion`; compatible:
the OpenAI SDK at `baseUrl`) and settings reader, and picks the
**Responses** engine or the **Chat Completions** engine per call from the
slot's `apiStyle`. The Chat Completions mapper
(`providers/openai/openai-chat-completions.mapper.ts`) is the graceful
degradation most compatible servers need: messages, image/file parts,
function tools and `tool_calls` replay, `response_format: json_schema` +
`parseStructured`, streaming with `stream_options.include_usage`; a
reasoning effort, `previousResponseId` and hosted tools are refused.

A slot's settings besides `enabled`/`baseUrl` reach the adapter as
`AiCallContext.providerSettings` — `config/ai-config.service.ts`'s
`providerCallSettings(slot)` builds `{ baseUrl, providerSettings }` for every
call site. With `requiresKey: false` on `openai-compatible`, `AiKeyResolver`
answers `{ apiKey: AI_KEYLESS_API_KEY, keySource: 'none' }` before any key
lookup, every enabled model is usable without BYOK, the adapter sends no
credential, and the limits count it like a user's own call. SSRF: the
endpoints are validated by `aiEndpointUrlSchema` (https for Azure, http/https
for compatible; no credentials, no fragment), an internal host is an explicit
admin decision, and `noRedirectFetch` refuses every redirect. See
`docs/specs/ai-platform.md` §2.24.

### Rate limits and output caps

`ai.limits` — `perUser.{requestsPerMinute,requestsPerDay}`,
`orgKey.{requestsPerDayPerUser,tokensPerDayPerUser}` and
`perModel['<provider>:<modelId>'].{maxOutputTokens,requestsPerMinutePerUser}`
— every field optional, absent meaning unlimited, `{}` by default.
`runtime/ai-limits.service.ts` enforces the rates as step 6b, inside the
shared `context()` step, so every provider round-trip passes it (each
`runTools` step, `embed`, and the media runs when the job executes) and no
enqueue-only call (`startRun`, `generateImage`, `transcribe`, `speak`) ever
does. It sits after key resolution because `orgKey.*` only counts calls the
org key pays for. With nothing applicable configured it returns without a
query.

A refusal is `AiError('AI_RATE_LIMITED')` with `retryAfterMs` and
`details.limit`; `HttpExceptionFilter` adds `Retry-After`, and the job
handlers' existing `toRateLimitError()` defers a queued run instead of
failing it. Per-minute windows take the larger of an in-process log
(reserved synchronously, exact for bursts within one replica) and an indexed
`COUNT(*)` over `ai_usage_events` in the last 60 s (so replicas agree; it
lags by calls in flight elsewhere — there is no Redis here, by design); daily
windows count since UTC midnight. `perModel[…].maxOutputTokens` is not a rate:
`effectiveOutputTokensCap` folds it into step 5's clamp. Tests pass a clock
through the runtime harness (`createAiRuntimeHarness({ clock })`). See
`docs/specs/ai-platform.md` §2.22.

`limits.perOrg.{requestsPerDay,outputTokensPerDay}` (#739) cap one organization's whole daily volume, whoever's key pays; a refusal carries `details.scope: 'org'`. An organization's own layer may set lower values, never higher.

### Hosted tools

`AiResponseRequest.tools` may carry provider-hosted tools — `web_search`,
`file_search`, `code_interpreter`, `image_generation`, `mcp` — a typed union
in `core/types/responses.types.ts`. Two gates: the tool type must be switched
on in `ai.hostedTools` (all off by default; `AI_TOOL_DISABLED`, 403, from
`core/hosted-tools.ts`, which also enforces `mcpAllowedHosts`), and the model
must declare `hosted_tools` (step 3). Results come back as `hosted_tool_call`
items with a typed `result` per tool, and web-search citations as
`citations` on the message item.

Two things never leave the facade, both handled by
`runtime/ai-hosted-outputs.ts` on every response and stream event:

- **Image bytes.** An `image_generation` item arrives from the adapter with
  its bytes in `result.image`; `AiService.persistHostedImage` stores them once
  per image through `storage/AiOutputWriter` (a `ready` object the user owns,
  under `ai-outputs/<userId>/<runId|responseId>/`) and publishes only its
  `storageObjectId`. Storage unavailable publishes `storageObjectId: null`
  with `storageError: 'AI_STORAGE_UNAVAILABLE'` rather than failing the
  response.
- **MCP `headers`.** Secret like a key: sent to the adapter and nowhere
  else — not the prompt log line, the span (`ai.hosted_tools` names types
  only), a usage row, or `ai_runs.request` (`startRun` refuses an MCP tool
  with headers, and the stored shape has no `headers` member). Any header
  value a server echoes back is replaced by `[REDACTED]`.

### Streaming, end to end

1. A client `POST`s `/api/ai/responses/stream` with `Accept:
   text/event-stream`. `@Sse()` was deliberately **not** used —
   `AiResponsesController.stream()` takes `@Res()` directly, because
   `@Sse()` commits to `200 text/event-stream` before the handler runs, and
   this route's contract needs the opposite: a gate refusal must still be an
   ordinary JSON error, not an in-band frame (`ai-sse.ts`'s own header
   explains the choice in full).
2. The controller calls `AiService.forUser(id).openStream(req)` rather than
   the lazy `stream()` — `openStream`'s returned *promise* rejects with the
   `AiError` for any gate or pre-stream provider failure, so a failure that
   happens before the first byte is written answers as an ordinary JSON
   error with the matching HTTP status, exactly like a non-streaming route,
   via the global exception filter (nothing has been written to `reply`
   yet). Only a failure **after** streaming has started is sent in-band, via
   `pipeAiSse`, as an `event: error` frame (`{ type: 'error', code,
   message }`), after which the stream closes.
3. Once `openStream` resolves, `pipeAiSse` (`http/ai-sse.ts`) **hijacks**
   the Fastify reply (`reply.hijack()`) and writes frames straight to the
   socket by hand: each `AiStreamEvent` as
   `` event: <type>\ndata: <json>\n\n ``, and a `: ping\n\n` heartbeat
   comment every 15 seconds (`AI_SSE_HEARTBEAT_MS`) so no proxy reaps a
   quiet connection while a reasoning model is still thinking.
   `pipeAiSse<E extends SseFrame>` is generic: a feature route can stream its
   own `{ type, ... }` frames through the same pipe and wire rules (the type
   defaults to `AiStreamEvent`).
4. Response headers include `X-Accel-Buffering: no` (`AI_SSE_HEADERS`, the
   header nginx respects to disable buffering for this one response),
   following the precedent
   `packages/platform-api/src/notifications/notifications.controller.ts` already set for
   `/api/notifications/stream`.
5. `infra/nginx/nginx.conf` carries a dedicated, longest-prefix-wins
   `location /api/ai/responses/stream` block, placed before the general
   `/api` block, with `proxy_buffering off` and a long `proxy_read_timeout`
   — nginx buffers `/api` with a 60-second read timeout by default, which
   would truncate any response that streams for longer than a minute.
   `packages/platform-cli/src/engine/deploy/proxy.ts` (the vhost the CLI's `appctl deploy`
   generates on a target server) carries the identical block, so a
   deployed fork streams correctly too, not only local dev.
6. A client disconnect is observed via `abortOnDisconnect` listening on the
   **response's** own `close` event (not the request's — since Node 16 an
   `IncomingMessage` emits `close` as soon as its body is consumed, which
   for a `POST` is before the first event is even generated) and aborts an
   `AbortController` threaded into `AiCallContext.signal` — an abandoned
   stream must not keep spending a user's rate limit or provider spend
   after nobody is listening. The same helper backs the non-streaming
   `POST /api/ai/responses` too.
7. On the web side, `apps/web/src/services/sse.ts`'s `postSse()` is the
   client half of this contract: one `POST`ed request, one streamed answer,
   no reconnect (a reconnect would re-submit the prompt) — see
   `apps/web/src/services/ai.ts` for how the AI chat surface uses it.

### Adding a provider

A new provider is an adapter implementation against the existing
`AiProviderAdapter` contract, never a platform change. The full recipe —
self-registration, the model classifier, error mapping onto `AiErrorCode`,
and the conformance kit every adapter must pass — is
[`docs/specs/ai-platform.md`](../../../../docs/specs/ai-platform.md) §4.

## Extension-point catalog

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `AiModule.forRoot` | option | `forRoot({ imports?, providers?, perUserDefaultModel? }): DynamicModule` | Configure the slice once, with the host-port modules; import the result everywhere | experimental | [example](../../../../apps/api/src/platform/ai/ai.config.ts) |
| `AI_SYSTEM_PRISMA` | token | `InjectionToken<AiSystemPrisma>` | Bind the app's bypass client (retention purges, the deployment-wide usage report) | experimental | [example](../../../../apps/api/src/platform/ai/ai-host.module.ts) |
| `AI_OBJECT_STORE` | token | `InjectionToken<AiObjectStore>` | Bind object storage for image, audio and file-input runs | experimental | [example](../../../../apps/api/src/platform/ai/ai-host.module.ts) |
| `AI_METRICS` | token | `InjectionToken<AiMetrics>` | Bind the app's `app.ai.*` instruments; omit for none | experimental | [example](../../../../apps/api/src/platform/ai/ai-host.module.ts) |
| `AI_TARGET_RESOLVER` | token | `InjectionToken<AiTargetResolver>` | Pick the provider and model per call (per feature, per organization) instead of the user's default model | experimental | [example](../../../../apps/api/src/examples/ai/example-target-resolver.ts) |
| `registerAiFeature` | registry | `registerAiFeature({ id, label, needs, inputModalities?, providers?, requiresHostedTools?, defaultEffort? }): void` | Declare an AI feature before bootstrap; `forUser(userId, { feature })` then checks the model fits it, and `GET /api/ai/features` lists it | experimental | [example](../../../../apps/api/src/examples/ai/example-summary.feature.ts) |
| `AiConformanceFixture` | option | `{ createAiApp; createContext; closeContext; createUser; openApiDocument; defaultOrgId; rolePermissions }` | Tell the AI conformance suites how the app boots, mints a user for a role and seeds its grants | experimental | [example](../../../../apps/api/test/conformance/ai-fixture.ts) |
| `AiKillSwitchOptions` | option | `{ fixture; minAiRoutes?; minAdminAiRoutes?; minAiJobTypes? }` | Run the `ai-kill-switch` suite (`aiKillSwitch`) | experimental | [example](../../../../apps/api/test/conformance.spec.ts) |
| `aiKillSwitchSuite` | registry | `ConformanceAppSuite<AiKillSwitchOptions>` | Read the suite's id and description | experimental | [example](../../../../apps/api/test/conformance.spec.ts) |
| `AiRbacMatrixOptions` | option | `{ fixture; minRoutes?; minPermissionedRoutes? }` | Run the `ai-rbac-matrix` suite (`aiRbacMatrix`) | experimental | [example](../../../../apps/api/test/conformance.spec.ts) |
| `aiRbacMatrixSuite` | registry | `ConformanceAppSuite<AiRbacMatrixOptions>` | Read the suite's id and description | experimental | [example](../../../../apps/api/test/conformance.spec.ts) |
| `AiSecretEgressOptions` | option | `{ fixture }` | Run the `ai-secret-egress` suite (`aiSecretEgress`) | experimental | [example](../../../../apps/api/test/conformance.spec.ts) |
| `aiSecretEgressSuite` | registry | `ConformanceAppSuite<AiSecretEgressOptions>` | Read the suite's id and description | experimental | [example](../../../../apps/api/test/conformance.spec.ts) |
| `AiKeyPolicyOptions` | option | `{ fixture }` | Run the `ai-key-policy` suite (`aiKeyPolicy`) | experimental | [example](../../../../apps/api/test/conformance.spec.ts) |
| `aiKeyPolicySuite` | registry | `ConformanceAppSuite<AiKeyPolicyOptions>` | Read the suite's id and description | experimental | [example](../../../../apps/api/test/conformance.spec.ts) |
| `AiJobsServerOnlyOptions` | option | `{ fixture; minAiJobTypes? }` | Run the `ai-jobs-server-only` suite (`aiJobsServerOnly`) | experimental | [example](../../../../apps/api/test/conformance.spec.ts) |
| `aiJobsServerOnlySuite` | registry | `ConformanceAppSuite<AiJobsServerOnlyOptions>` | Read the suite's id and description | experimental | [example](../../../../apps/api/test/conformance.spec.ts) |
| `AiNoSdkLeakOptions` | option | `{ apiTrees; webTrees; sdkOwner?; noSdkManifests; extraSdkPackages? }` | Run the `ai-no-sdk-leak` suite (`aiNoSdkLeak`) over the source trees and manifests the app ships | experimental | [example](../../../../apps/api/test/conformance.spec.ts) |
| `aiNoSdkLeakSuite` | registry | `ConformanceSuite<AiNoSdkLeakOptions>` | Call the suite's `check()` directly in a test | experimental | [example](../../../../apps/api/test/conformance.spec.ts) |
| `aiOrchestrationBoundarySuite` | registry | `ConformanceAppSuite<OrchestrationBoundaryOptions>` | Read the suite's id (`ai-orchestration-boundary`, option key `aiOrchestrationBoundary`) | experimental | [example](../../../../apps/api/test/conformance.spec.ts) |

Not extension points, but the surface a feature uses: `AiService.forUser(userId, { orgId?, feature? })` and its client (`respond`, `stream`, `openStream`, `respondStructured`, `runTools`, `startRun`, `embed`, `generateImage`, `editImage`, `transcribe`, `speak`, `createRealtimeSession`), `defineTool`, `AiError`, `AiEnabledGuard` and `AiOrgEnabledInterceptor` (for an app's own `/api/ai/*` controller), `UserAiKeysService.importKey` (migrating keys an app already holds) and `AiOrgKeyService` (an organization's keys, programmatically).

## Data

The `ai` fragment of `@marinoscar/platform-db` (`schema/ai.prisma`):

| Model (table) | What | Ownership | Notes |
|---|---|---|---|
| `AiModel` (`ai_models`) | One model of one provider: capabilities, enablement | `system` | Written by the catalogue sync and the AI Models page |
| `UserAiKey` (`user_ai_keys`) | A user's own key, ciphertext under the `ai_user_key` purpose | `user` | Cascade with the user; the hint and verification only are ever returned |
| `AiRun` (`ai_runs`) | One background run | `org` (row-level security) | `org_id` from the run's job; purged by `ai.runs.purge` |
| `AiUsageEvent` (`ai_usage_events`) | One provider round-trip's accounting | `org` (row-level security) | `org_id` null only for the catalogue sync's discovery row; purged by `ai.usage.purge` |

No migration in #739: `org_id` already existed on `ai_runs` and `ai_usage_events` (#725). An organization's own keys live in `org_credentials` under the registered purpose `ai` (credentials slice); the deployment's in `credentials` under the same purpose. Objects an AI run writes live under `ai-outputs/<userId>/<runId>/` (`AI_STORAGE_KEY_PREFIXES`, registered with the storage slice by `forRoot`). Apps never add columns to these tables.

## Permissions and settings

| Permission | Scope | Gates |
|---|---|---|
| `ai_config:read` / `ai_config:write` | system | `/api/admin/ai/*` (config, models, providers, usage); NOT behind `AiEnabledGuard`, so AI can always be switched back on |
| `ai:use` | org | Every consumer route under `/api/ai/*` (with `AiEnabledGuard`), except `GET /api/ai/config` |
| `org_ai_config:read` / `org_ai_config:write` | org (`org_admin`) | `/api/admin/ai/org-keys`, `GET /api/admin/ai/org-usage`, and the org layer of the `ai` namespace (`/api/org-settings`) |

Declared as `AI_PERMISSIONS` and seeded by the app. Settings: the `ai` system namespace (`AI_SYSTEM_SETTINGS`, org-overridable) and the per-user `ai` namespace (`AI_USER_SETTINGS`: `defaultModel`). Credential purposes: `ai` (tiers `system` and `org`, `AI_CREDENTIAL_PURPOSE_DEF`) and the user keys' own `ai_user_key` cipher domain.

## UI

The settings pages (AI, AI Models, AI Usage, AI Keys, the Playground) are the reference app's (`apps/web/src/pages`), registered in its section registries with `feature: 'ai'` (except the admin AI card, where AI is switched on). The Organization AI keys page and its hooks are `@marinoscar/platform-web/ai` ([README](../../../platform-web/src/ai/README.md)), routed at `/admin/settings/ai/organization-keys` (`org_ai_config:read`).

## Infra

None of its own beyond the streaming route: `infra/nginx/nginx.conf` (and the CLI's deploy vhost) carry a `location /api/ai/responses/stream` block with buffering off (see Streaming). No environment variable: AI configuration is runtime configuration.

## Observability

Every provider round-trip is an `ai.request` span (provider, model, operation, `ai.key.source`, `ai.key.tier`, `ai.feature`; never a key, never prompt text) and one `ai_usage_events` row. Through `AI_METRICS` the app records `app.ai.*` metrics with bounded labels (provider, model, operation, status, key source, feature). With `logPromptContent` on, a bounded prompt preview is logged. The Doctor carries the AI checks (`ai-enabled`, `ai-providers`) and the AI hosts in its egress inventory.

## Security notes

- **Keys never leave the server.** A key is resolved per call and held only between resolution and the adapter call; no route, log line, span, `AiError`, usage row or `ai_runs.request` row carries one. The one secret returned is a realtime session's ephemeral provider secret (`POST /api/ai/realtime/sessions`), never a key. `ai-secret-egress.integration.spec.ts` sweeps every response for the user, organization and deployment sentinels.
- **SDKs stay in their folder.** Only `providers/<provider>/` imports a provider SDK (the `ai-no-sdk-leak` conformance suite, each SDK-boundary spec).
- **AI jobs are server-only.** No `ai.*` job type implements `nodeResultSchema`/`persistNodeResult`: a key is never brokered to a worker node.
- **Orchestration stays above the gateway.** `@langchain/langgraph` and `@langchain/core` are allowed only under an app's orchestration directory, and `langchain`, `langsmith`, `@ai-sdk/*` and `@langchain/<provider>` never (`runOrchestrationBoundarySuite`).
- **Tenant isolation.** `ai_runs` and `ai_usage_events` are under row-level security; `orgId` comes from the principal or the job, never request input. An organization's key is read only in that organization's scope.
- **MCP headers** are secret like a key (see Hosted tools); **storage inputs** may carry presigned URLs, held only in `AiCallContext.storageInputs`.

## Conformance suite

`@marinoscar/platform-api/ai/testing` carries two kinds of guard.

**Conformance suites** run in every app through `runPlatformConformance()` (importing `@marinoscar/platform-api/ai/testing` registers them). Each DISCOVERS its subject from the booted app, a registry or the source trees it is given: a future route, job type or adapter is covered with no edit. None names a path.

| Suite id (option key) | What it pins | Options |
|---|---|---|
| `ai-kill-switch` (`aiKillSwitch`) | With `ai.enabled=false` (and with only the caller's organization off, `details.scope: 'org'`) every discovered `/api/ai/*` route except `GET /api/ai/config` answers `403 AI_DISABLED` before auth, `/api/admin/ai/*` stays reachable, and every `ai.*` job makes zero provider calls | `fixture` |
| `ai-rbac-matrix` (`aiRbacMatrix`) | Every route crossed with Admin, Contributor, Viewer and anonymous is granted or denied exactly as the seeded permissions say (read from `x-rbac`); a PAT inherits its owner's grants | `fixture` |
| `ai-secret-egress` (`aiSecretEgress`) | No response schema has a key-shaped property (only the realtime `clientSecret`); no sentinel key appears in any body, header, log line, audit row, usage row, run row, stored object or error | `fixture` |
| `ai-key-policy` (`aiKeyPolicy`) | The administrator's key is never spent on a user's own inference, BYOK always wins, a keyless provider gets no key, over every synchronous and queued route | `fixture` |
| `ai-jobs-server-only` (`aiJobsServerOnly`) | No `ai.*` job type is node-eligible (derived from `serverOnlyTypes()`) | `fixture` |
| `ai-no-sdk-leak` (`aiNoSdkLeak`) | No provider SDK import outside its adapter directory, none in the app, the web or the contract, no manifest but the package's declares one | `apiTrees`, `webTrees`, `sdkOwner?`, `noSdkManifests` |
| `ai-orchestration-boundary` (`aiOrchestrationBoundary`) | No file outside the allowed orchestration roots imports `@langchain/*`, and no banned orchestration package is installed or imported | `apiSourceRoots`, `webSourceRoots`, `packageJsonPaths`, `allowedRoots` |

The five that boot the app take ONE `AiConformanceFixture` (how the app creates itself over a mocked database, mints a user for a role, returns its OpenAPI document and which grants it seeds); the reference app's is [`apps/api/test/conformance/ai-fixture.ts`](../../../../apps/api/test/conformance/ai-fixture.ts), built from the helpers its other integration specs use. `aiPackageProviderDirs(root)` lists the package's own adapter directories for `ai-no-sdk-leak` from the slice's layout. The web side (every AI card carries a permission the API enforces and `feature: 'ai'`) is the `settings-ai-cards` suite of [`@marinoscar/platform-web/settings/testing`](../../../platform-web/src/settings/README.md#conformance-suite).

```ts
import '@marinoscar/platform-api/ai/testing'; // registers the suites
runPlatformConformance({
  sourceRoots: [API_SOURCE_ROOT],
  suites: {
    aiKillSwitch: { fixture },
    aiNoSdkLeak: { apiTrees: [{ name: 'app', root: API_SOURCE_ROOT, minFiles: 100 }], webTrees: [], noSdkManifests: [] },
    aiOrchestrationBoundary: { apiSourceRoots: [API_SOURCE_ROOT], webSourceRoots: [], packageJsonPaths: [], allowedRoots: {} },
    aiKeyPolicy: { skip: 'This app has no AI providers of its own.' },
  },
});
```

An app with AI disabled at build time still runs the suites and they must find the platform's routes (the vacuity floors: 10 consumer routes, 5 admin routes, 15 RBAC routes, 3 `ai.*` job types). Each suite is proved against a planted violation in `test/ai/testing/*.spec.ts`.

**Kits** (not suites an app runs through the runner):

| Kit | What it pins |
|---|---|
| `describeAiProviderConformance(name, factory, options?)` | Every adapter behaves the same for each port it carries (listing, key verification, classification, responses, streaming, structured output, the tool round-trip, embeddings, images, audio) |
| `runOrchestrationBoundarySuite(options)` | The orchestration scan behind `ai-orchestration-boundary`, callable directly |
| `createAiRuntimeHarness(options?)` | The real runtime over a scripted fake, in-memory tables and storage: for gate, key-policy and limit tests |

### Testing without a real provider

- **`FakeAiProvider`** (`testing/fake-ai-provider.ts`) implements
  `AiProviderAdapter` entirely in memory: scriptable responses, a call log
  (so a test can assert exactly which key/model/request reached it — the
  BYOK invariant tests all read this log), and streaming support. With
  `embeddingsPort: true` it also carries a deterministic embeddings port,
  recorded as `embeddings.embed` calls with their `apiKey`; with
  `imagesPort: true`, an images port (generate + edit, tiny PNGs, recorded
  as `images.generate`/`images.edit` with the request they received), and
  delivers storage-object inputs OpenAI's way by default (images by URL,
  files by a fake upload, recorded in `calls[].storageInputs` and
  `deletedFileIds`; `fileInputStrategy: false` declares none); with
  `audioPort: true`, an audio port whose `transcribe` reads the whole input
  (bytes or stream), records it as `audioBytes`, and answers one second per
  1000 bytes, and whose `speech` answers `FAKE-<format>:<voice>:<input>`
  bytes (voices `FAKE_SPEECH_VOICES`). Register
  it in `AiProviderRegistry` in place of a real adapter for any integration
  test that exercises `AiService`.
- **`createAiRuntimeHarness()`** (`testing/ai-runtime-harness.ts`) wires up
  an in-memory Prisma-shaped store, a seeded user key (`HARNESS_USER_KEY`)
  and org key (`HARNESS_ORG_KEY`), and a `FakeAiProvider` behind
  `HARNESS_PROVIDER`/`HARNESS_MODEL` (plus `HARNESS_EMBEDDING_MODEL` and
  `HARNESS_IMAGE_MODEL`, `HARNESS_TRANSCRIPTION_MODEL` and
  `HARNESS_SPEECH_MODEL`, with the fake's
  embeddings, images and audio ports on, and
  in-memory object storage — `testing/in-memory-ai-storage.ts` — behind the
  real input resolver and output writer), so a test can call
  `AiService.forUser(HARNESS_USER)` immediately without standing up the
  whole Nest module tree.
- **`describeAiProviderConformance()`** (`testing/conformance.ts`) is the
  ONE Jest suite every provider adapter — including a fork's own second
  provider — runs, so "implements `AiProviderAdapter`" means the same thing
  for every provider: `listModels` returns ids, `verifyKey`'s ok/invalid
  mapping is correct, `classifyModel` returns schema-valid capabilities or
  `null`, and (when `responses` is implemented) `create`/`stream`/structured
  output/a tool round-trip all behave, (when `embeddings` is implemented)
  single/batch/`dimensions` embeddings are well formed, (when `images` is
  implemented) generate/edit return bytes with an image MIME type, (when
  `audio.transcribe` is implemented) bytes and streams transcribe and an
  oversized declared size is refused unread, (when `audio.speech` is
  implemented) speech returns audio bytes, lists its voices and refuses
  input over 4096 characters, and every error surfaces as an
  `AiError`, never a raw SDK exception. `providers/openai/openai.adapter.conformance.spec.ts`
  `providers/anthropic/anthropic.adapter.conformance.spec.ts` and
  `providers/gemini/gemini.adapter.conformance.spec.ts` are the three
  worked examples (the Azure OpenAI and OpenAI-compatible adapters run it too, each in both API styles —
  `providers/azure-openai/` and `providers/openai-compatible/`, over the
  same OpenAI mock transport, which also speaks `/chat/completions`,
  Azure's `api-key` header and keyless requests) of wiring a real adapter through it over a mocked
  transport (the real SDK with an injected `fetch`); the Anthropic and
  Gemini mocks are as stateless as the real APIs, so their tool round-trips
  pass only because the kit reads `supportsPreviousResponseId: false` and
  resends the conversation (and the Gemini 3 mock refuses the resent turn
  unless its thought signature came back). `openai.adapter.live.spec.ts` is the separate, opt-in suite
  that hits the real OpenAI API. `FakeAiProvider` takes
  `supportsPreviousResponseId: false` to drive the full-history tool loop.
- **`InMemoryAiKeysPrisma`** (`testing/in-memory-ai-keys-prisma.ts`) backs
  the harness's key storage for tests that need `user_ai_keys`/credential
  behaviour without a real database.

No test in this module — or in a fork's own feature tests — should need a
real provider account or network access; every scenario above is reachable
through `FakeAiProvider` and the harness.

**Cross-cutting guard suites** are a different kind of test: each discovers
its own subject (every `/api/ai/*` route, every `ai.*` job type, every file in
the source trees it is given) from the real router, registry or filesystem
rather than a hand-written list, so a future route, job type or provider adapter
is covered automatically, with no edit to the suite. They are the `ai-*`
conformance suites listed under [Conformance suite](#conformance-suite),
run in the reference app from `apps/api/test/conformance.spec.ts` (plus the
web-side `settings-ai-cards`). See `CLAUDE.md`'s "MANDATORY: AI Platform Rules"
rule 4 for what each one pins.

## Upgrade notes

New subpath in this version. From the reference app's `src/ai/` (#739):

- Import from `@marinoscar/platform-api/ai` (and `/ai/testing`) instead of `src/ai/...`; the settings schemas from `@marinoscar/platform-contract/ai`.
- `AiModule` is now `AiModule.forRoot({ imports })`: bind `AI_SYSTEM_PRISMA` and `AI_OBJECT_STORE` (and optionally `AI_METRICS`, `AI_TARGET_RESOLVER`) in a `@Global()` host module, configure once, import the result.
- The `ai` namespace gains `deploymentKeyServesOrgs` (default `true`: unchanged behaviour) and `limits.perOrg`; stored documents without them read as before.
- New routes: `GET /api/ai/features`, `/api/admin/ai/org-keys`, `GET /api/admin/ai/org-usage`; `GET /api/admin/ai/usage` takes `orgId` and `groupBy=org`. New permissions `org_ai_config:read`/`write` (seeded for `org_admin`).
- `ai-outputs/` is registered by the slice (`AI_STORAGE_KEY_PREFIXES`); an app manifest may reuse the definition to keep its purge order.
- Nothing is migrated: stored keys, runs and usage rows are read unchanged.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Nest can't resolve dependencies ... Symbol(@marinoscar/platform/ai/SYSTEM_PRISMA)` (or `OBJECT_STORE`) | The host port is not bound, or its module is not `@Global()` | Bind it in a `@Global()` module passed to `AiModule.forRoot({ imports })` |
| `403 AI_DISABLED` with `details.scope: 'org'` | The caller's organization switched AI off in its `ai` layer | Its `org_admin` clears the override at Organization settings |
| `403 AI_KEY_REQUIRED` although the deployment has a key | `deploymentKeyServesOrgs` is off, or the policy is `byok` | Store an organization key, switch the deployment keys back on, or switch to the fallback policy |
| `400 AI_INVALID_REQUEST` "unknown feature" | `forUser(userId, { feature })` names a feature never registered | `registerAiFeature` it at import time, before bootstrap |
| `Registry "ai-features" is frozen` | A feature registered after bootstrap | Register from the app's manifest, at import time |
| `429 AI_RATE_LIMITED` with `details.limit: 'perOrg.*'` | The organization's daily cap | Raise `limits.perOrg` (deployment) or the org's own lower value |
| `503 AI_STORAGE_UNAVAILABLE` on an image or speech run | Object storage is not configured | Configure it at `/admin/settings/storage` |

## Links

- [Package README](../../README.md)
- [Spec: AI platform](../../../../docs/specs/ai-platform.md)
- [Runbook: AI configuration](../../../../docs/runbooks/ai-configuration.md)
- [Platform packages spec](../../../../docs/specs/platform-packages.md)
- [Contract](../../../platform-contract/src/ai/README.md)
- [Web counterpart](../../../platform-web/src/ai/README.md)
- [Storage slice](../storage/README.md)
- [Package documentation standard](../../../../docs/PACKAGES.md)

# AI Platform (`apps/api/src/ai`)

Admin-governed, bring-your-own-key, multi-provider AI (epic #419). This is
the module's developer map — what lives where, how a request flows through
the gate pipeline, how streaming works end to end, and how to test against
it without a real provider. The design decisions and rationale live in
[`docs/specs/ai-platform.md`](../../../../docs/specs/ai-platform.md); the
operator runbook is
[`docs/runbooks/ai-configuration.md`](../../../../docs/runbooks/ai-configuration.md);
the day-to-day "how do I add AI to a feature / a provider" recipes are in
[`CLAUDE.md`](../../../../CLAUDE.md)'s "MANDATORY: AI Platform Rules" and
"Using AI in a Feature" / "Adding an AI Provider" sections. This file does
not restate any of those — read them for the *why*.

## Module map

```
ai/
  ai.module.ts            # The platform's root module — one import line per sub-module
  core/                    # Provider-agnostic contracts. Feature code imports FROM HERE.
    ai-error.ts              AiError, AiErrorCode, AI_ERROR_STATUS
    capabilities.ts          AiCapability, AI_CAPABILITIES, aiModelCapabilitiesSchema
    provider-adapter.interface.ts   AiProviderAdapter — what a provider implements
    provider-registry.ts     AiProviderRegistry — self-registration, adapterCapabilities()
    structured-output.ts     Zod <-> JSON Schema conversion for structured output
    tools.ts                 defineTool() — function-tool definition + argument validation
    types/                   AiResponse, AiResponseRequest, AiStreamEvent, media types
  providers/
    openai/                  The Phase 1 adapter. ONLY place the `openai` SDK is imported —
                             `core/no-provider-sdk.spec.ts` enforces this statically.
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
    ai-key-resolver.service.ts   AiKeyResolver — the ONE place the byok/org rule is decided
    usable-models.service.ts    UsableModelsService — "which models can I call?"
    user-ai-keys.service.ts / .controller.ts   /api/ai/keys/*, /api/ai/models
    ai-keys-recheck.handler.ts / .task.ts       `ai.keys.recheck` job (server-only)
    ai-keys-catalog.listener.ts  Subscribes to AI_CATALOG_SYNCED_EVENT
  runtime/                 The facade every feature actually calls
    ai.service.ts            AiService — forUser(userId), the gate pipeline (see below)
    ai-runs.service.ts        AiRunsService — background run rows; AI_RESPONSE_RUN_TYPE
    ai-response-run.handler.ts  `ai.response.run` job (server-only)
    ai-run-request.ts         toStoredRunRequest/fromStoredRunRequest (ai_runs.request JSON)
    ai-tool-loop.ts            runToolLoop — the function-calling agent loop
    ai-usage.recorder.ts       One ai_usage_events row per provider round-trip
  http/                    The consumer HTTP surface (issue #433)
    ai-responses.controller.ts   POST /api/ai/responses, POST /api/ai/responses/stream
    ai-runs.controller.ts        POST /api/ai/runs, GET/POST /api/ai/runs/:runId(/cancel)
    ai-sse.ts                     pipeAiSse/formatSseEvent/abortOnDisconnect — see below
    ai-http-request.ts           toAiRequest — HTTP DTO -> AiRequest
    json-schema-structured-output.ts   HTTP callers send JSON Schema, not Zod
  usage/                   Reading ai_usage_events back (issue #443)
    ai-usage.service.ts          AiUsageService — the aggregate report (GROUPING SETS SQL)
    ai-usage-admin.controller.ts GET /api/admin/ai/usage (ai_config:read)
    ai-usage.controller.ts       GET /api/ai/usage/me (ai:use, caller only)
    ai-usage-purge.handler.ts / .task.ts   `ai.usage.purge` job + daily enqueue-only cron
  testing/                 FakeAiProvider, describeAiProviderConformance, test harness
```

Every sub-module is wired into `ai.module.ts` by one import line — the same
"being in the graph is the registration" idiom `app.module.ts` uses for
`JobsModule`. A fork adding AI to its own feature imports `AiModule` and
injects `AiService`; it never reaches into `core/`, `providers/`, `config/`
or `keys/` directly for that purpose (those are the platform's own internals,
not a feature's dependency).

## The request lifecycle: the gate pipeline

Every call through `AiService.forUser(userId)` — `respond`, `stream`,
`openStream`, `respondStructured`, `runTools`, `startRun` — runs the
identical sequence, documented in full in `runtime/ai.service.ts`'s own
header comment:

```
 1. kill switch                      -> AI_DISABLED
 2. provider enabled + registered    -> AI_PROVIDER_DISABLED
 3. model enabled / capability match /  AI_MODEL_NOT_ENABLED
    key exists / key reaches model      AI_CAPABILITY_UNSUPPORTED
    (UsableModelsService.assertUsable)  AI_KEY_REQUIRED
                                        AI_MODEL_NOT_REACHABLE
 4. reasoning effort offered by the model  -> AI_CAPABILITY_UNSUPPORTED
 5. clamp maxOutputTokens to the deployment cap and the model's own limit
 6. resolve the key (AiKeyResolver — the byok invariant lives HERE, only)
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

`embed` (issue #440) is the first non-responses operation and the template
for the rest of Phase 2: `prepareEmbedding()` runs steps 1–3 with
`embeddings` as the one capability needed (plus a shape check: `model`
required, 1–256 non-empty inputs, positive `dimensions`), then it shares
steps 6–9 with `respond` — `context()` and `track()` take a provider-neutral
`AiCallTarget`, and `TRACKED_OPERATIONS` maps the span operation
(`embeddings.create`) to the usage `operation` (`embeddings`). A new port is
one more `prepare…`, one more map entry and one more `AiUserClient` method.
Synchronous, no job; a large backfill is a fork's own server-only job type
calling `embed` per chunk of ≤ 256 rows (`docs/specs/ai-platform.md` §5.1).

## Streaming, end to end

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
4. Response headers include `X-Accel-Buffering: no` (`AI_SSE_HEADERS`, the
   header nginx respects to disable buffering for this one response),
   following the precedent
   `apps/api/src/notifications/notifications.controller.ts` already set for
   `/api/notifications/stream`.
5. `infra/nginx/nginx.conf` carries a dedicated, longest-prefix-wins
   `location /api/ai/responses/stream` block, placed before the general
   `/api` block, with `proxy_buffering off` and a long `proxy_read_timeout`
   — nginx buffers `/api` with a 60-second read timeout by default, which
   would truncate any response that streams for longer than a minute.
   `apps/cli/src/deploy/proxy.ts` (the vhost the CLI's `appctl deploy`
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

## Testing without a real provider

- **`FakeAiProvider`** (`testing/fake-ai-provider.ts`) implements
  `AiProviderAdapter` entirely in memory: scriptable responses, a call log
  (so a test can assert exactly which key/model/request reached it — the
  BYOK invariant tests all read this log), and streaming support. With
  `embeddingsPort: true` it also carries a deterministic embeddings port,
  recorded as `embeddings.embed` calls with their `apiKey`. Register
  it in `AiProviderRegistry` in place of a real adapter for any integration
  test that exercises `AiService`.
- **`createAiRuntimeHarness()`** (`testing/ai-runtime-harness.ts`) wires up
  an in-memory Prisma-shaped store, a seeded user key (`HARNESS_USER_KEY`)
  and org key (`HARNESS_ORG_KEY`), and a `FakeAiProvider` behind
  `HARNESS_PROVIDER`/`HARNESS_MODEL` (plus `HARNESS_EMBEDDING_MODEL`, with
  the fake's embeddings port on), so a test can call
  `AiService.forUser(HARNESS_USER)` immediately without standing up the
  whole Nest module tree.
- **`describeAiProviderConformance()`** (`testing/conformance.ts`) is the
  ONE Jest suite every provider adapter — including a fork's own second
  provider — runs, so "implements `AiProviderAdapter`" means the same thing
  for every provider: `listModels` returns ids, `verifyKey`'s ok/invalid
  mapping is correct, `classifyModel` returns schema-valid capabilities or
  `null`, and (when `responses` is implemented) `create`/`stream`/structured
  output/a tool round-trip all behave, (when `embeddings` is implemented)
  single/batch/`dimensions` embeddings are well formed, and every error surfaces as an
  `AiError`, never a raw SDK exception. `providers/openai/openai.adapter.conformance.spec.ts`
  is the worked example of wiring a real adapter through it; `openai.adapter.live.spec.ts`
  is the separate, opt-in suite that hits the real OpenAI API.
- **`InMemoryAiKeysPrisma`** (`testing/in-memory-ai-keys-prisma.ts`) backs
  the harness's key storage for tests that need `user_ai_keys`/credential
  behaviour without a real database.

No test in this module — or in a fork's own feature tests — should need a
real provider account or network access; every scenario above is reachable
through `FakeAiProvider` and the harness.

**Cross-cutting guard suites** (`apps/api/test/ai/`, issue #435) are a
different kind of test: each discovers its own subject (every `/api/ai/*`
route, every `ai.*` job type, every file in `apps/api/src`/`apps/web/src`)
from the real router/registry/filesystem rather than a hand-written list, so
a future route, job type or provider adapter is covered automatically, with
no edit to the suite — `ai-kill-switch.integration.spec.ts`,
`ai-rbac-matrix.integration.spec.ts`, `ai-secret-egress.integration.spec.ts`,
`ai-key-policy.integration.spec.ts`, `ai-jobs-server-only.spec.ts`, and
`ai-no-sdk-leak.spec.ts` (plus the web-side
`apps/web/src/__tests__/config/aiSettingsRegistry.test.ts`). See
`CLAUDE.md`'s "MANDATORY: AI Platform Rules" rule 4 for what each one pins.

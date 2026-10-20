# @marinoscar/platform-ai-providers

## 0.1.0-next.8

## 0.1.0-next.7

## 0.1.0-next.6

### Minor Changes

- e1ca08c: New package `@marinoscar/platform-ai-providers` (#991): the five AI provider adapters (OpenAI, OpenAI-compatible, Azure OpenAI, Anthropic, Gemini) and the provider-agnostic core they implement, runnable in a plain Node process (no Nest, no database, no OpenTelemetry SDK). Subpaths: `.` (core types, `AiProviderAdapter` and its ports, `AiError` and its codes, capabilities, structured output, tools, hosted tools, conversation helpers, media and file-input types, `parseRetryAfterMs`, and the structural `AiLogger` and `AiTracer` ports), `./openai`, `./anthropic`, `./gemini`, and `./<provider>/testing` (mock transports and fixtures). `zod` is a required peer; each SDK is an optional peer loaded only by its subpath. Each adapter is built with `create*Adapter({ clients?, logger?, tracer? })`; without a tracer no span is started. API: `@marinoscar/platform-api/ai` keeps every exported name and type: it re-exports the core, its provider classes are now Nest subclasses of the lean adapters and client factories (same constructors, injection tokens, logger names and `ai.provider.call` spans), and `AiError` is still an `HttpException` with `toRateLimitError()` (the platform splices `HttpException` into its prototype chain when `ai/core/ai-error` loads). `parseRetryAfterMs` moved to the new package and `@marinoscar/platform-api/jobs` re-exports it. The `ai-no-sdk-leak` suite gains `aiProvidersPackageSdkDirs` and accepts a list of `sdkOwner` manifests; the platform package's own provider folders now import no SDK. Back-compat: no route, shape, id or behaviour changes; the platform package still depends on the three SDKs so an app gets them installed.

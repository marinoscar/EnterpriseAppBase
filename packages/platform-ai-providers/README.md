# @marinoscar/platform-ai-providers

## Purpose and scope

The AI provider adapters of the platform (OpenAI, OpenAI-compatible, Azure OpenAI, Anthropic, Google Gemini) and the provider-agnostic core types they implement (`AiProviderAdapter` and its ports, `AiError`, capabilities, structured output, tools, hosted tools, conversation helpers, media and file-input types). It runs in a plain Node process: no Nest, no database, no OpenTelemetry SDK. `@marinoscar/platform-api/ai` builds its Nest provider modules on these classes and re-exports the core unchanged: an app that wants the adapters without Nest, a database or OpenTelemetry (a CLI, a worker, another service) installs this package alone.

## Install and peer dependencies

```bash
npm install @marinoscar/platform-ai-providers zod
npm install openai              # for ./openai (OpenAI, OpenAI-compatible, Azure OpenAI)
npm install @anthropic-ai/sdk   # for ./anthropic
npm install @google/genai       # for ./gemini
```

`zod` is a required peer. Each provider SDK is an optional peer, loaded only by its own subpath: install only the ones you import. The root entry loads no SDK. CommonJS, Node 24 or newer.

| Subpath | Optional peer needed |
|---|---|
| `.` | none |
| `./openai`, `./openai/testing` | `openai` |
| `./anthropic`, `./anthropic/testing` | `@anthropic-ai/sdk` |
| `./gemini`, `./gemini/testing` | `@google/genai` |

## Quick start

A plain Node script, no Nest and no database:

```ts
import { createOpenAiAdapter } from '@marinoscar/platform-ai-providers/openai';

const adapter = createOpenAiAdapter({ logger: console });
const ctx = { apiKey: process.env.MY_KEY!, requestId: 'r1' };

for await (const event of adapter.responses.stream({ model: 'gpt-4o', input: 'Hello' }, ctx)) {
  if (event.type === 'output_text.delta') process.stdout.write(event.delta);
}
```

`adapter.responses.create(req, ctx)` returns the whole `AiResponse` instead. A failure is always an `AiError` with a stable `code`.

### Subpaths

| Import | Holds |
|---|---|
| `@marinoscar/platform-ai-providers` | The core: `AiProviderAdapter` and its ports, `AiError` and its codes, capabilities, structured output, tools, hosted tools, conversation helpers, media and file-input types, `parseRetryAfterMs`, the `AiLogger` and `AiTracer` ports |
| `.../openai` | `createOpenAiAdapter`, `createOpenAiCompatibleAdapter`, `createAzureOpenAiAdapter`, the engines and mappers, the redirect and family guards |
| `.../anthropic` | `createAnthropicAdapter` (Messages API) |
| `.../gemini` | `createGeminiAdapter` (generateContent, embeddings) |
| `.../<provider>/testing` | The provider's mock transport and fixtures, for tests |

### Relation to `@marinoscar/platform-api/ai`

`@marinoscar/platform-api/ai` depends on this package and re-exports every name from it. Its provider classes are Nest subclasses of these adapters (same constructors, injection tokens, logger names and spans), and its `AiError` is this package's, with `HttpException` spliced into the prototype. Provider registration, key resolution, usage and policy stay there; this package has no registry.

## Configuration

Each `create*Adapter(options)` takes optional `clients` (the SDK client factory), `logger` (an `AiLogger`, which Nest's `Logger` and `console` satisfy) and `tracer` (an `AiTracer`, which an OpenTelemetry `Tracer` satisfies). The key, base URL and provider settings travel per call in `AiCallContext` (`apiKey`, `baseUrl`, `providerSettings`, `signal`, `requestId`); an adapter never holds a key between calls.

## Extension-point catalog

None. The package is a library of adapters; the platform's provider registry (`registerAiProvider`) is the extension point and lives in `@marinoscar/platform-api/ai`.

## Data

None. The package stores nothing; every call is stateless.

## Permissions and settings

None. Keys and provider settings are passed per call by the caller.

## UI

None. Server-side only: a provider key must never reach a browser.

## Infra

None. No environment variable is read; every SDK option that could be read from the environment is pinned.

## Observability

`AiTracer` is a structural port that an OpenTelemetry `Tracer` satisfies, but the package imports no OpenTelemetry SDK. Without a tracer no span is started; with one, each provider call runs inside one `ai.provider.call` span carrying `ai.provider`, `ai.model`, `ai.operation` and `ai.status`. Without a logger nothing is logged.

## Security notes

The key is passed per call and never stored, logged, put on a span or carried by an `AiError`; an `AiError`'s `cause` is non-enumerable and never serialised. The SDK clients are built with redirects refused (`noRedirectFetch` and the redirect guard in `./openai`), so a key is never replayed to a redirect target, and the family guards refuse a request the Azure and OpenAI-compatible adapters cannot serve (a hosted tool) before any call. No environment variable is read.

## Conformance suite

None in this package. `@marinoscar/platform-api/ai/testing` runs the adapter conformance kit and the `ai-no-sdk-leak` suite over it.

## Upgrade notes

New in 0.1.0-next.5: extracted from `@marinoscar/platform-api/ai`, whose public API is unchanged.

## Troubleshooting

None yet. A missing SDK surfaces as a module-not-found error when its subpath is imported: install that optional peer.

## Links

- [AI platform spec](../../docs/specs/ai-platform.md)
- [`@marinoscar/platform-api/ai`](../platform-api/src/ai/README.md)

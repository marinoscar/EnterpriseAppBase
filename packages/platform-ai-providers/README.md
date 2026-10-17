# @marinoscar/platform-ai-providers

## Purpose and scope

The AI provider adapters of the platform (OpenAI, OpenAI-compatible, Azure OpenAI, Anthropic, Google Gemini) and the provider-agnostic core types they implement (`AiProviderAdapter` and its ports, `AiError`, capabilities, structured output, tools, hosted tools, conversation helpers, media and file-input types). It runs in a plain Node process: no Nest, no database, no OpenTelemetry SDK. `@marinoscar/platform-api/ai` builds its Nest provider modules on these classes and re-exports the core unchanged (issue #991).

## Install and peer dependencies

`zod` is a required peer. The provider SDKs are optional peers: install only the one whose subpath you import (`openai` for `./openai`, `@anthropic-ai/sdk` for `./anthropic`, `@google/genai` for `./gemini`). The root entry loads no SDK.

## Quick start

```ts
import { createOpenAiAdapter } from '@marinoscar/platform-ai-providers/openai';

const adapter = createOpenAiAdapter({ logger: console });
const response = await adapter.responses.create({ model: 'gpt-4o', input: 'Hello' }, { apiKey, requestId: 'r1' });
```

## Configuration

Each `create*Adapter(options)` takes optional `clients` (the SDK client factory), `logger` (an `AiLogger`, which Nest's `Logger` and `console` satisfy) and `tracer` (an `AiTracer`, which an OpenTelemetry `Tracer` satisfies). The key, base URL and provider settings travel per call in `AiCallContext`.

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

Without a tracer no span is started; with one, each provider call runs inside one `ai.provider.call` span carrying `ai.provider`, `ai.model`, `ai.operation` and `ai.status`. Without a logger nothing is logged.

## Security notes

No log line, span or `AiError` carries key material; an `AiError`'s `cause` is non-enumerable and never serialised.

## Conformance suite

None in this package. `@marinoscar/platform-api/ai/testing` runs the adapter conformance kit and the `ai-no-sdk-leak` suite over it.

## Upgrade notes

New in 0.1.0-next.5 (#991): extracted from `@marinoscar/platform-api/ai`, whose public API is unchanged.

## Troubleshooting

None yet. A missing SDK surfaces as a module-not-found error when its subpath is imported: install that optional peer.

## Links

- [AI platform spec](../../docs/specs/ai-platform.md)
- [`@marinoscar/platform-api/ai`](../platform-api/src/ai/README.md)

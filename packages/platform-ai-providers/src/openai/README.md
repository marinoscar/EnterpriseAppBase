# @marinoscar/platform-ai-providers/openai

## Purpose and scope

The `./openai` subpath: the OpenAI wire family: `OpenAiProviderAdapter` (Responses API, embeddings, images, audio, realtime), `OpenAiCompatibleProviderAdapter` (a self-hosted or third-party server, `./compatible/`) and `AzureOpenAiProviderAdapter` (`./azure/`), their client factories, per-call settings readers, the Responses and Chat Completions engines and mappers, error mapping, the redirect and family guards, and the `ai.provider.call` telemetry helper. Framework-free; `@marinoscar/platform-api/ai` registers Nest subclasses of these classes.

## Install and peer dependencies

Needs the optional peer `openai` (and `zod`). Importing this subpath loads the SDK; the package root does not.

## Quick start

```ts
import { createOpenAiAdapter } from '@marinoscar/platform-ai-providers/openai';

const adapter = createOpenAiAdapter({ logger: console });
```

## Configuration

`createOpenAiAdapter({ clients?, logger?, tracer? })`: `clients` defaults to a new `OpenAiClientFactory` (pass one with a `fetch` to route calls elsewhere, as the mock transports do); the key, base URL and provider settings travel per call in `AiCallContext`.

## Extension-point catalog

None. A new provider is registered with `registerAiProvider` in `@marinoscar/platform-api/ai`, not here.

## Data

None. Every call is stateless.

## Permissions and settings

None. The caller passes the key and the provider settings per call.

## UI

None. Server-side only.

## Infra

None. No environment variable is read; the SDK's environment fallbacks are pinned off.

## Observability

With a tracer, each call runs inside one `ai.provider.call` span (`ai.provider`, `ai.model`, `ai.operation`, `ai.status`); with a logger, one debug line per call. Neither carries the key, the prompt or the output.

## Security notes

An SDK error never escapes: it is mapped to an `AiError` whose `cause` is never serialised.

## Conformance suite

None here. `./openai/testing`: `OpenAiMockServer` and the Responses and Chat Completions fixtures. The adapter conformance kit is `describeAiProviderConformance` in `@marinoscar/platform-api/ai/testing`.

## Upgrade notes

New in 0.1.0-next.5: moved from `@marinoscar/platform-api/ai`'s `providers/` folder without a behaviour change.

## Troubleshooting

None yet. A module-not-found error for `openai` means the optional peer is not installed.

## Links

- [Package README](../../README.md)
- [AI platform spec](../../../../docs/specs/ai-platform.md)

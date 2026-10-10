import { registerAiProvider } from '@marinoscar/platform-api/ai';

import { exampleTranscribeProvider } from '../platform-extensions/ai/example-transcribe/example-transcribe.provider';

// =============================================================================
// This app's AI providers (PP-14.6, issue #924)
// =============================================================================
//
// An AI provider is added HERE, with `registerAiProvider`, AT IMPORT TIME: the
// registry freezes once the application has bootstrapped, and
// `platform/ai/ai.config.ts` imports this file before it calls
// `AiModule.forRoot()`, which loads the module of every registered provider.
// Like `host.ts` and `core.ts`, this file makes the `register` call itself.
//
// Registering is all it takes. The provider then has a slot in the `ai`
// settings namespace, a generated form on `/admin/settings/ai`, a deployment
// key route (`PUT /api/admin/ai/providers/<id>/key`), a row on the user and
// organization key pages, and a place in the usage records, the limits and the
// Doctor, with no change to a platform file. Recipe: docs/EXTENDING.md and the
// package README of `@marinoscar/platform-api/ai`.
//
// The reference app registers the worked example, `example-transcribe`: an
// AssemblyAI stand-in that only transcribes, over a fake transport (no
// network). It is registered so the example is the real thing, but OFF until an
// administrator switches it on and saves a key: a fresh install gains a
// disabled card and nothing else. A fork that does not want it deletes the
// `registerAiProvider` call below (and the `platform-extensions/ai` folder).
// =============================================================================

registerAiProvider(exampleTranscribeProvider);

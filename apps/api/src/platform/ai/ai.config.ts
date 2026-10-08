// =============================================================================
// The reference app's AI slice, configured once (issue #739)
// =============================================================================
//
// `AiModule` here is the CONFIGURED dynamic module of
// `@marinoscar/platform-api/ai`, built once at import time: every app module
// that imports `AiModule` (the application root, the telemetry assistant)
// imports this one object. All five providers load (the default); keys,
// models and limits stay runtime configuration (the `ai` settings namespace
// and the credential stores), never an environment variable.
// =============================================================================

import { AiModule as PlatformAiModule } from '@marinoscar/platform-api/ai';

import { AiHostModule } from './ai-host.module';

/** The AI platform: `AiModule.forRoot()` with the app's host ports. */
export const AiModule = PlatformAiModule.forRoot({ imports: [AiHostModule] });

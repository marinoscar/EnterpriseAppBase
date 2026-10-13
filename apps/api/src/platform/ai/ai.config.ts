// =============================================================================
// The reference app's AI slice, configured once (issue #739)
// =============================================================================
//
// `AiModule` here is the CONFIGURED dynamic module of
// `@marinoscar/platform-api/ai`, built once at import time: every app module
// that imports `AiModule` (the application root, the telemetry assistant)
// imports this one object. Every registered provider loads (the default: the
// five built-ins and the app's own, `app-registrations/ai.ts`); keys,
// models and limits stay runtime configuration (the `ai` settings namespace
// and the credential stores), never an environment variable.
// =============================================================================

import { AiModule as PlatformAiModule } from '@marinoscar/platform-api/ai';

// Registers the app's own AI providers (side effect): `forRoot` loads every registered provider's module.
import '../../app-registrations/ai';
import { ExamplePricing } from '../../platform-extensions/ai/example-pricing/example-pricing';
import { AiHostModule } from './ai-host.module';

/**
 * The AI platform: `AiModule.forRoot()` with the app's host ports and, as the
 * worked example of the pricing seam (PP-14.17, #935), a price list for the
 * example provider only: the usage pages show a Cost column, and every other
 * provider is unpriced.
 */
export const AiModule = PlatformAiModule.forRoot({
  imports: [AiHostModule],
  pricing: { useClass: ExamplePricing },
});

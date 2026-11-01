// =============================================================================
// The example price list: `AI_PRICING` (PP-14.17, issue #935)
// =============================================================================
//
// The platform ships no rates: they change, and they are a deployment's
// contract with a provider. An app that has them binds ONE port,
// `AiPricing.costFor(usage)`, through `AiModule.forRoot({ pricing })`
// (`platform/ai/ai.config.ts`), and the usage pages then show a Cost column.
// The port prices a slice of recorded usage (a provider, a model, an operation,
// summed tokens and units); it never records, and a `null` answer means "no
// price" (an unlisted model, a free tier), which the page shows as a dash.
//
// This example prices the example provider only, per minute of audio, in a
// made-up unit. Every other provider answers `null`, so a fresh install shows
// no cost at all until the example provider is switched on and used. A fork
// replaces the rate table with its own, or removes the binding.
// =============================================================================

import { Injectable } from '@nestjs/common';
import type { AiCost, AiPricing, AiPricingUsage } from '@marinoscar/platform-api/ai';

/** The currency label the example uses. Not a real currency: the rates are made up. */
export const EXAMPLE_PRICING_CURRENCY = 'USD';

/** Made-up rates for the example provider: 0.6 per hour of audio, in major units. */
export const EXAMPLE_AUDIO_RATE_PER_SECOND = 0.6 / 3600;

@Injectable()
export class ExamplePricing implements AiPricing {
  costFor(usage: AiPricingUsage): AiCost | null {
    if (usage.provider !== 'example-transcribe') return null;

    const seconds = usage.units.audioSeconds;

    if (seconds === undefined) return null;

    return { amount: seconds * EXAMPLE_AUDIO_RATE_PER_SECOND, currency: EXAMPLE_PRICING_CURRENCY };
  }
}

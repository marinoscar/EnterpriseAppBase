// The five built-in providers' bespoke cards, registered through the same
// registry an app uses (PP-14.6, issue #924). The admin AI page calls this at
// module scope; the component is the one that has always drawn them, so their
// markup is unchanged. A call, not a bare side-effect import: the package is
// `sideEffects: false`.

import { AiProviderCard } from './AiProviderCard.js';
import { registerBuiltinAiProviderCard } from './aiProviderCardRegistry.js';

/** The ids of the providers whose bespoke card ships with the slice. */
export const BUILTIN_AI_PROVIDER_CARD_IDS = ['openai', 'anthropic', 'gemini', 'azure-openai', 'openai-compatible'] as const;

/** Registers the bespoke card of each built-in provider. Idempotent. */
export function registerBuiltinAiProviderCards(): void {
  for (const id of BUILTIN_AI_PROVIDER_CARD_IDS) registerBuiltinAiProviderCard(id, AiProviderCard);
}

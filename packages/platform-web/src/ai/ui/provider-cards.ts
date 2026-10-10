// `@marinoscar/platform-web/ai/ui/provider-cards`: the AI provider card
// registry (PP-14.6, issue #924), alone, so an app registers a card from its
// main chunk without pulling every AI page in. Also exported by `/ai/ui`.
// Documented in ../README.md.

export { registerAiProviderCard, getAiProviderCard } from './admin/aiProviderCardRegistry.js';
export type { AiProviderCardComponent } from './admin/aiProviderCardRegistry.js';
export { AiGenericProviderCard } from './admin/AiGenericProviderCard.js';
export type { AiProviderCardProps } from './admin/AiProviderCard.js';
export type { AiProviderFormErrors, AiProviderFormValue } from './admin/aiProviderForm.js';

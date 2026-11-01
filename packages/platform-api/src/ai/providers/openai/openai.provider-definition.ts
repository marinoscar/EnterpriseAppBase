import { systemAiProviderSchema } from '@marinoscar/platform-contract/ai';

import type { AiProviderDefinition } from '../ai-provider-definition';
import { OpenAiProviderModule } from './openai.module';

/**
 * The `openai` provider's definition (PP-14.6, #924): what the AI slice knows
 * about it before its adapter runs. Registered by `../builtin-ai-providers.ts`
 * through `registerAiProvider`, like an app's provider. Its settings are the
 * fields its slot always had, so the stored `ai.providers['openai']` and the
 * admin page are unchanged.
 *
 * @stability experimental
 */
export const openAiProviderDefinition: AiProviderDefinition = {
  id: 'openai',
  label: 'OpenAI',
  description: "OpenAI's Responses API, embeddings, images, audio and realtime.",
  module: OpenAiProviderModule,
  settingsSchema: systemAiProviderSchema.omit({ enabled: true }),
  defaults: {},
  requiresKey: true,
};

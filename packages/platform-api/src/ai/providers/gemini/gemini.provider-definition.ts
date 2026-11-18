import { systemAiProviderSchema } from '@marinoscar/platform-contract/ai';

import type { AiProviderDefinition } from '../ai-provider-definition';
import { GeminiProviderModule } from './gemini.module';

/**
 * The `gemini` provider's definition (PP-14.6, #924): what the AI slice knows
 * about it before its adapter runs. Registered by `../builtin-ai-providers.ts`
 * through `registerAiProvider`, like an app's provider. Its settings are the
 * fields its slot always had, so the stored `ai.providers['gemini']` and the
 * admin page are unchanged.
 *
 * @stability experimental
 */
export const geminiProviderDefinition: AiProviderDefinition = {
  id: 'gemini',
  label: 'Google Gemini',
  description: "Google's Gemini API.",
  module: GeminiProviderModule,
  settingsSchema: systemAiProviderSchema.omit({ enabled: true }),
  defaults: {},
  requiresKey: true,
};

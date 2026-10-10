import { systemAiProviderSchema } from '@marinoscar/platform-contract/ai';

import type { AiProviderDefinition } from '../ai-provider-definition';
import { AnthropicProviderModule } from './anthropic.module';

/**
 * The `anthropic` provider's definition (PP-14.6, #924): what the AI slice knows
 * about it before its adapter runs. Registered by `../builtin-ai-providers.ts`
 * through `registerAiProvider`, like an app's provider. Its settings are the
 * fields its slot always had, so the stored `ai.providers['anthropic']` and the
 * admin page are unchanged.
 *
 * @stability experimental
 */
export const anthropicProviderDefinition: AiProviderDefinition = {
  id: 'anthropic',
  label: 'Anthropic',
  description: "Anthropic's Messages API (Claude).",
  module: AnthropicProviderModule,
  settingsSchema: systemAiProviderSchema.omit({ enabled: true }),
  defaults: {},
  requiresKey: true,
};

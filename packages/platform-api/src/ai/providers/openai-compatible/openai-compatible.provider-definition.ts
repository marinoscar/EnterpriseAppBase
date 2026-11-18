import { systemAiCompatibleProviderSchema } from '@marinoscar/platform-contract/ai';

import type { AiProviderDefinition } from '../ai-provider-definition';
import { OpenAiCompatibleProviderModule } from './openai-compatible.module';

/**
 * The `openai-compatible` provider's definition (PP-14.6, #924): what the AI slice knows
 * about it before its adapter runs. Registered by `../builtin-ai-providers.ts`
 * through `registerAiProvider`, like an app's provider. Its settings are the
 * fields its slot always had, so the stored `ai.providers['openai-compatible']` and the
 * admin page are unchanged.
 *
 * @stability experimental
 */
export const openAiCompatibleProviderDefinition: AiProviderDefinition = {
  id: 'openai-compatible',
  label: 'OpenAI-compatible',
  description: 'Ollama, vLLM, LM Studio or any server speaking the OpenAI wire protocol.',
  module: OpenAiCompatibleProviderModule,
  settingsSchema: systemAiCompatibleProviderSchema.omit({ enabled: true }),
  defaults: {},
  requiresKey: true,
  requiresBaseUrl: true,
  help: {
    baseUrl:
      "The server's API root, including /v1 — e.g. http://ollama:11434/v1 or https://vllm.internal.example.com/v1. Required to enable the provider.",
  },
};

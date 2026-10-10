import { systemAiAzureProviderSchema } from '@marinoscar/platform-contract/ai';

import type { AiProviderDefinition } from '../ai-provider-definition';
import { AzureOpenAiProviderModule } from './azure-openai.module';

/**
 * The `azure-openai` provider's definition (PP-14.6, #924): what the AI slice knows
 * about it before its adapter runs. Registered by `../builtin-ai-providers.ts`
 * through `registerAiProvider`, like an app's provider. Its settings are the
 * fields its slot always had, so the stored `ai.providers['azure-openai']` and the
 * admin page are unchanged.
 *
 * @stability experimental
 */
export const azureOpenAiProviderDefinition: AiProviderDefinition = {
  id: 'azure-openai',
  label: 'Azure OpenAI',
  description: 'OpenAI models served from an Azure OpenAI resource.',
  module: AzureOpenAiProviderModule,
  settingsSchema: systemAiAzureProviderSchema.omit({ enabled: true }),
  defaults: {},
  requiresKey: true,
  requiresBaseUrl: true,
  help: {
    baseUrl:
      'Your Azure OpenAI resource endpoint, e.g. https://my-resource.openai.azure.com. Must use https. Required to enable the provider.',
  },
};

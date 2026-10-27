// =============================================================================
// The five built-in AI providers, registered (PP-14.6, #924)
// =============================================================================
//
// They register through `registerAiProvider`, the same function an app uses,
// at import time and in the order the admin page lists them. Anything that
// reads the registry (`AiModule.forRoot`, the `ai` settings namespace, the
// config services) imports this file first, so the built-ins are always
// there regardless of which entry point loaded the slice.
//
// IDEMPOTENT ACROSS DUPLICATE MODULE INSTANCES: a provider already registered
// is skipped, so two copies of this file (a bundler, a test double) cannot
// make the second registration throw `DUPLICATE_ID`. The registry is frozen
// once the application bootstraps, and nothing registers after that.
// =============================================================================

import { anthropicProviderDefinition } from './anthropic/anthropic.provider-definition';
import { aiProviderKind, registerAiProvider, type AiProviderDefinition } from './ai-provider-definition';
import { azureOpenAiProviderDefinition } from './azure-openai/azure-openai.provider-definition';
import { geminiProviderDefinition } from './gemini/gemini.provider-definition';
import { openAiProviderDefinition } from './openai/openai.provider-definition';
import { openAiCompatibleProviderDefinition } from './openai-compatible/openai-compatible.provider-definition';

/**
 * The built-in providers, in registration (and admin page) order.
 *
 * @stability experimental
 */
export const BUILTIN_AI_PROVIDER_DEFINITIONS: readonly AiProviderDefinition[] = Object.freeze([
  openAiProviderDefinition,
  anthropicProviderDefinition,
  geminiProviderDefinition,
  azureOpenAiProviderDefinition,
  openAiCompatibleProviderDefinition,
]);

for (const definition of BUILTIN_AI_PROVIDER_DEFINITIONS) {
  if (!aiProviderKind.has(definition.id)) registerAiProvider(definition);
}

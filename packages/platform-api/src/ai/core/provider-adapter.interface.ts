// Moved to `@marinoscar/platform-ai-providers` (#991) so the AI provider
// adapters and their core types run without Nest. This path re-exports the
// names it always exported, unchanged, so platform imports keep working.
// The side-effect import runs the `AiError` integration (ai-error.ts) first.

import './ai-error';

export {
  AI_KEYLESS_API_KEY,
} from '@marinoscar/platform-ai-providers';

export type {
  AiCallContext,
  AiDiscoveredModel,
  AiDiscoveredModelMetadata,
  AiKeyVerification,
  AiOperationContext,
  AiOperationHandler,
  AiProviderAdapter,
  AiResponsesPort,
} from '@marinoscar/platform-ai-providers';

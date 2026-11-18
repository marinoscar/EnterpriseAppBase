// Moved to `@marinoscar/platform-ai-providers` (#991) so the AI provider
// adapters and their core types run without Nest. This path re-exports the
// names it always exported, unchanged, so platform imports keep working.
// The side-effect import runs the `AiError` integration (ai-error.ts) first.

import './ai-error';

export {
  AI_CAPABILITIES,
  AI_INPUT_MODALITIES,
  AI_OUTPUT_MODALITIES,
  AI_REASONING_EFFORTS,
  aiModelCapabilitiesSchema,
  BUILTIN_AI_CAPABILITIES,
} from '@marinoscar/platform-ai-providers';

export type {
  AiCapability,
  AiCapabilityEnum,
  AiInputModality,
  AiInputModalityEnum,
  AiModelCapabilities,
  AiOutputModality,
  AiOutputModalityEnum,
  AiReasoningEffort,
  AiReasoningEffortEnum,
  BuiltinAiCapability,
} from '@marinoscar/platform-ai-providers';

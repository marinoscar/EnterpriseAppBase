// Moved to `@marinoscar/platform-ai-providers` (#991) so the AI provider
// adapters and their core types run without Nest. This path re-exports the
// names it always exported, unchanged, so platform imports keep working.
// The side-effect import runs the `AiError` integration (ai-error.ts) first.

import '../ai-error';

export {
  AI_HOSTED_TOOL_TYPES,
  AI_PROVIDER_STATE,
} from '@marinoscar/platform-ai-providers';

export type {
  AiCodeInterpreterCallResult,
  AiCodeInterpreterTool,
  AiContentPart,
  AiFileSearchCallResult,
  AiFileSearchTool,
  AiFinishReason,
  AiFunctionTool,
  AiHostedTool,
  AiHostedToolCallItem,
  AiHostedToolResults,
  AiHostedToolType,
  AiImageGenerationCallResult,
  AiImageGenerationTool,
  AiInputItem,
  AiMcpCallResult,
  AiMcpTool,
  AiMessageOutputItem,
  AiMessageRole,
  AiOutputItem,
  AiProviderState,
  AiReasoningItem,
  AiResponse,
  AiResponseRequest,
  AiStreamEvent,
  AiStructuredOutputSpec,
  AiTool,
  AiToolChoice,
  AiUrlCitation,
  AiUsage,
  AiWebSearchCallResult,
  AiWebSearchTool,
} from '@marinoscar/platform-ai-providers';

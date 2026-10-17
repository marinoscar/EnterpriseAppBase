// Moved to `@marinoscar/platform-ai-providers` (#991) so the AI provider
// adapters and their core types run without Nest. This path re-exports the
// names it always exported, unchanged, so platform imports keep working.
// The side-effect import runs the `AiError` integration (ai-error.ts) first.

import '../ai-error';

export {
  AI_STORAGE_INPUT_FILE_MAX_BYTES,
  AI_STORAGE_INPUT_IMAGE_MAX_BYTES,
  AI_STORAGE_INPUT_IMAGE_MIME_TYPES,
  AI_STORAGE_INPUT_URL_TTL_SECONDS,
  AI_STORAGE_INPUTS_MAX,
  storageInputMaxBytes,
  storageInputModality,
} from '@marinoscar/platform-ai-providers';

export type {
  AiFileInputStrategies,
  AiFileInputStrategy,
  AiResolvedStorageInput,
  AiResolvedStorageInputs,
  AiStorageInputModality,
} from '@marinoscar/platform-ai-providers';

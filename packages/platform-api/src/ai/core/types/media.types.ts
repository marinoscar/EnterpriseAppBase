// Moved to `@marinoscar/platform-ai-providers` (#991) so the AI provider
// adapters and their core types run without Nest. This path re-exports the
// names it always exported, unchanged, so platform imports keep working.
// The side-effect import runs the `AiError` integration (ai-error.ts) first.

import '../ai-error';

export {
  AI_EMBEDDINGS_MAX_INPUTS,
  AI_IMAGE_BACKGROUNDS,
  AI_IMAGE_EDIT_MAX_INPUTS,
  AI_IMAGE_INPUT_MAX_BYTES,
  AI_IMAGE_INPUT_MIME_TYPES,
  AI_IMAGE_MASK_MIME_TYPES,
  AI_IMAGE_OUTPUT_FORMATS,
  AI_IMAGE_PROMPT_MAX_CHARS,
  AI_IMAGE_QUALITIES,
  AI_IMAGES_MAX_N,
  AI_PROVIDER_OPTIONS_MAX_BYTES,
  AI_REALTIME_CLIENT_SECRET_TTL_SECONDS,
  AI_REALTIME_INSTRUCTIONS_MAX_CHARS,
  AI_SPEECH_FORMAT_MIME,
  AI_SPEECH_FORMATS,
  AI_SPEECH_INPUT_MAX_CHARS,
  AI_SPEECH_INSTRUCTIONS_MAX_CHARS,
  AI_SPEECH_SPEED_MAX,
  AI_SPEECH_SPEED_MIN,
  AI_TRANSCRIPTION_DEFAULT_MAX_BYTES,
  AI_TRANSCRIPTION_EXTRAS_MAX_BYTES,
  AI_TRANSCRIPTION_INPUT_MIME_TYPES,
  AI_TRANSCRIPTION_PROMPT_MAX_CHARS,
  AI_TRANSCRIPTION_RESPONSE_FORMATS,
  AI_TRANSCRIPTION_TIMESTAMP_GRANULARITIES,
  isStreamedPayload,
} from '@marinoscar/platform-ai-providers';

export type {
  AiAudioPort,
  AiBinaryPayload,
  AiEmbeddingRequest,
  AiEmbeddingResult,
  AiEmbeddingsPort,
  AiGeneratedImage,
  AiImageEditRequest,
  AiImageGenerationRequest,
  AiImageResult,
  AiImagesPort,
  AiMediaInput,
  AiRealtimePort,
  AiRealtimeSession,
  AiRealtimeSessionRequest,
  AiRealtimeTurnDetection,
  AiSpeechFormat,
  AiSpeechRequest,
  AiSpeechResult,
  AiStreamedPayload,
  AiTranscriptionExtras,
  AiTranscriptionExtrasSegment,
  AiTranscriptionRequest,
  AiTranscriptionResult,
  AiTranscriptionSegment,
  AiTranscriptionTimestampGranularity,
  AiTranscriptionWord,
} from '@marinoscar/platform-ai-providers';

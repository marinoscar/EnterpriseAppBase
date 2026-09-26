// =============================================================================
// Media capability port types (issue #424, epic #419)
// =============================================================================
//
// Declared now, implemented in Phase 2/3 (#420 and later), so those stories
// only implement. Every result carries BYTES + a MIME type, never a provider
// URL: provider-hosted URLs expire and are not ours to authorize, so the
// caller persists the bytes to object storage and serves them itself.
// =============================================================================

import type { AiCallContext } from '../provider-adapter.interface';
import type { AiFunctionTool, AiUsage } from './responses.types';

/** Raw media going in or out of a provider. */
export interface AiBinaryPayload {
  data: Uint8Array;
  mimeType: string;
  filename?: string;
}

interface AiMediaRequestBase {
  model: string;
  /** Keyed by provider id — same escape hatch as `AiResponseRequest`. */
  providerOptions?: Record<string, Record<string, unknown>>;
}

interface AiMediaResultBase {
  provider: string;
  model: string;
  usage: AiUsage;
  providerRequestId?: string;
}

// ---- Images -----------------------------------------------------------------

/** The most images one generate/edit call may ask for (`n`). */
export const AI_IMAGES_MAX_N = 4;

/** The most source images one edit may send. */
export const AI_IMAGE_EDIT_MAX_INPUTS = 16;

/** The largest source image (or mask) an edit reads, in bytes (25 MiB). */
export const AI_IMAGE_INPUT_MAX_BYTES = 25 * 1024 * 1024;

/** The MIME types a source image may have. */
export const AI_IMAGE_INPUT_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/** The MIME types a mask may have (it needs an alpha channel). */
export const AI_IMAGE_MASK_MIME_TYPES = ['image/png'] as const;

/** The longest prompt accepted, in characters. */
export const AI_IMAGE_PROMPT_MAX_CHARS = 32_000;

export const AI_IMAGE_QUALITIES = ['low', 'medium', 'high', 'auto'] as const;
export const AI_IMAGE_BACKGROUNDS = ['transparent', 'opaque', 'auto'] as const;
export const AI_IMAGE_OUTPUT_FORMATS = ['png', 'jpeg', 'webp'] as const;

export interface AiImageGenerationRequest extends AiMediaRequestBase {
  prompt: string;
  /** Provider-validated, e.g. `1024x1024` or `auto`. */
  size?: string;
  quality?: (typeof AI_IMAGE_QUALITIES)[number];
  background?: (typeof AI_IMAGE_BACKGROUNDS)[number];
  outputFormat?: (typeof AI_IMAGE_OUTPUT_FORMATS)[number];
  /** Number of images, 1 to `AI_IMAGES_MAX_N`; defaults to 1. */
  n?: number;
}

export interface AiImageEditRequest extends AiImageGenerationRequest {
  /** The source image(s) to edit. */
  images: AiBinaryPayload[];
  /** Optional mask; transparent areas mark what may change. */
  mask?: AiBinaryPayload;
}

export interface AiGeneratedImage extends AiBinaryPayload {
  revisedPrompt?: string;
}

export interface AiImageResult extends AiMediaResultBase {
  images: AiGeneratedImage[];
}

export interface AiImagesPort {
  generate(req: AiImageGenerationRequest, ctx: AiCallContext): Promise<AiImageResult>;
  /** Present only when the provider supports editing (`image_edit`). */
  edit?(req: AiImageEditRequest, ctx: AiCallContext): Promise<AiImageResult>;
}

// ---- Audio ------------------------------------------------------------------

export interface AiTranscriptionRequest extends AiMediaRequestBase {
  audio: AiBinaryPayload;
  /** ISO-639-1 hint. */
  language?: string;
  /** Vocabulary/context hint. */
  prompt?: string;
  /** Request per-segment timestamps where supported. */
  timestamps?: boolean;
}

export interface AiTranscriptionSegment {
  startSeconds: number;
  endSeconds: number;
  text: string;
}

export interface AiTranscriptionResult extends AiMediaResultBase {
  text: string;
  language?: string;
  durationSeconds?: number;
  segments?: AiTranscriptionSegment[];
}

export interface AiSpeechRequest extends AiMediaRequestBase {
  input: string;
  voice: string;
  format?: 'mp3' | 'wav' | 'opus' | 'aac' | 'flac' | 'pcm';
  /** Style/tone instructions where supported. */
  instructions?: string;
  speed?: number;
}

export interface AiSpeechResult extends AiMediaResultBase {
  audio: AiBinaryPayload;
}

export interface AiAudioPort {
  /** Present only when the provider supports `audio_transcription`. */
  transcribe?(req: AiTranscriptionRequest, ctx: AiCallContext): Promise<AiTranscriptionResult>;
  /** Present only when the provider supports `audio_speech`. */
  speech?(req: AiSpeechRequest, ctx: AiCallContext): Promise<AiSpeechResult>;
}

// ---- Embeddings -------------------------------------------------------------

/**
 * The most inputs one `embed` call accepts. A larger batch is refused with
 * `AI_INVALID_REQUEST` rather than silently split: chunk it yourself, and for
 * a backfill of thousands of rows enqueue your own job type that calls
 * `embed` per chunk (docs/specs/ai-platform.md, "Embeddings").
 */
export const AI_EMBEDDINGS_MAX_INPUTS = 256;

export interface AiEmbeddingRequest extends AiMediaRequestBase {
  /** One text, or up to `AI_EMBEDDINGS_MAX_INPUTS` texts. None may be empty. */
  input: string | string[];
  /**
   * Shorten every vector to this many dimensions where the model supports it
   * (OpenAI: `text-embedding-3-*`). A model that cannot is refused with
   * `AI_INVALID_REQUEST` rather than answered at its native length.
   */
  dimensions?: number;
}

export interface AiEmbeddingResult extends AiMediaResultBase {
  /** One vector per input, in input order (a single string input yields one). */
  vectors: number[][];
  /** The length of every vector in `vectors`. */
  dimensions: number;
}

export interface AiEmbeddingsPort {
  embed(req: AiEmbeddingRequest, ctx: AiCallContext): Promise<AiEmbeddingResult>;
}

// ---- Realtime ---------------------------------------------------------------

export interface AiRealtimeSessionRequest extends AiMediaRequestBase {
  instructions?: string;
  voice?: string;
  modalities?: Array<'text' | 'audio'>;
  tools?: AiFunctionTool[];
}

/**
 * A short-lived session the BROWSER connects to directly. `clientSecret` is
 * an ephemeral, provider-minted token scoped to this one session — never the
 * provider API key the server called with.
 */
export interface AiRealtimeSession {
  id: string;
  provider: string;
  model: string;
  clientSecret: string;
  expiresAt: Date;
}

export interface AiRealtimePort {
  createSession(req: AiRealtimeSessionRequest, ctx: AiCallContext): Promise<AiRealtimeSession>;
}

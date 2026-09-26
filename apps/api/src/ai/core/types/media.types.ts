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

export interface AiImageGenerationRequest extends AiMediaRequestBase {
  prompt: string;
  /** Provider-validated, e.g. `1024x1024` or `auto`. */
  size?: string;
  quality?: 'low' | 'medium' | 'high' | 'auto';
  background?: 'transparent' | 'opaque' | 'auto';
  outputFormat?: 'png' | 'jpeg' | 'webp';
  /** Number of images; defaults to 1. */
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

export interface AiEmbeddingRequest extends AiMediaRequestBase {
  input: string | string[];
  /** Truncate to this many dimensions where supported. */
  dimensions?: number;
}

export interface AiEmbeddingResult extends AiMediaResultBase {
  /** One vector per input, in input order. */
  embeddings: number[][];
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

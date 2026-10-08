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

/**
 * Raw media going in or out of a provider.
 *
 * @stability experimental
 */
export interface AiBinaryPayload {
  /** The bytes. */
  data: Uint8Array;
  /** Their MIME type. */
  mimeType: string;
  /** A file name, when one is known. */
  filename?: string;
}

interface AiMediaRequestBase {
  /** The provider's model id. */
  model: string;
  /** Keyed by provider id — same escape hatch as `AiResponseRequest`. */
  providerOptions?: Record<string, Record<string, unknown>>;
}

interface AiMediaResultBase {
  /** Provider id. */
  provider: string;
  /** Model id. */
  model: string;
  /** Token accounting, as the provider reported it. */
  usage: AiUsage;
  /** The provider's request id, for support tickets. */
  providerRequestId?: string;
}

// ---- Images -----------------------------------------------------------------

/**
 * The most images one generate/edit call may ask for (`n`).
 *
 * @stability experimental
 */
export const AI_IMAGES_MAX_N = 4;

/**
 * The most source images one edit may send.
 *
 * @stability experimental
 */
export const AI_IMAGE_EDIT_MAX_INPUTS = 16;

/**
 * The largest source image (or mask) an edit reads, in bytes (25 MiB).
 *
 * @stability experimental
 */
export const AI_IMAGE_INPUT_MAX_BYTES = 25 * 1024 * 1024;

/**
 * The MIME types a source image may have.
 *
 * @stability experimental
 */
export const AI_IMAGE_INPUT_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/**
 * The MIME types a mask may have (it needs an alpha channel).
 *
 * @stability experimental
 */
export const AI_IMAGE_MASK_MIME_TYPES = ['image/png'] as const;

/**
 * The longest prompt accepted, in characters.
 *
 * @stability experimental
 */
export const AI_IMAGE_PROMPT_MAX_CHARS = 32_000;

/**
 * The image qualities a request may ask for.
 *
 * @stability experimental
 */
export const AI_IMAGE_QUALITIES = ['low', 'medium', 'high', 'auto'] as const;

/**
 * The image backgrounds a request may ask for.
 *
 * @stability experimental
 */
export const AI_IMAGE_BACKGROUNDS = ['transparent', 'opaque', 'auto'] as const;

/**
 * The image formats a request may ask for.
 *
 * @stability experimental
 */
export const AI_IMAGE_OUTPUT_FORMATS = ['png', 'jpeg', 'webp'] as const;

/**
 * One image-generation request.
 *
 * @stability experimental
 */
export interface AiImageGenerationRequest extends AiMediaRequestBase {
  /** What to draw. */
  prompt: string;
  /** Provider-validated, e.g. `1024x1024` or `auto`. */
  size?: string;
  /** One of {@link AI_IMAGE_QUALITIES}. */
  quality?: (typeof AI_IMAGE_QUALITIES)[number];
  /** One of {@link AI_IMAGE_BACKGROUNDS}. */
  background?: (typeof AI_IMAGE_BACKGROUNDS)[number];
  /** One of {@link AI_IMAGE_OUTPUT_FORMATS}. */
  outputFormat?: (typeof AI_IMAGE_OUTPUT_FORMATS)[number];
  /** Number of images, 1 to `AI_IMAGES_MAX_N`; defaults to 1. */
  n?: number;
}

/**
 * One image-edit request.
 *
 * @stability experimental
 */
export interface AiImageEditRequest extends AiImageGenerationRequest {
  /** The source image(s) to edit. */
  images: AiBinaryPayload[];
  /** Optional mask; transparent areas mark what may change. */
  mask?: AiBinaryPayload;
}

/**
 * One generated image.
 *
 * @stability experimental
 */
export interface AiGeneratedImage extends AiBinaryPayload {
  /** The prompt as the provider rewrote it. */
  revisedPrompt?: string;
}

/**
 * The result of a generate or edit call.
 *
 * @stability experimental
 */
export interface AiImageResult extends AiMediaResultBase {
  /** The images, in order. */
  images: AiGeneratedImage[];
}

/**
 * The images port a provider adapter implements (`image_generation`, `image_edit`).
 *
 * @stability experimental
 */
export interface AiImagesPort {
  /**
   * Generates images.
   *
   * @param req - the request.
   * @param ctx - the call's key and signal.
   */
  generate(req: AiImageGenerationRequest, ctx: AiCallContext): Promise<AiImageResult>;
  /**
   * Edits images. Present only when the provider supports editing (`image_edit`).
   *
   * @param req - the request.
   * @param ctx - the call's key and signal.
   */
  edit?(req: AiImageEditRequest, ctx: AiCallContext): Promise<AiImageResult>;
}

// ---- Audio ------------------------------------------------------------------

/**
 * Media handed to a provider as a STREAM rather than a buffer (#438): the
 * bytes are read once, as the provider request is sent, so a 25 MB recording
 * is never held in memory whole. `size`, when known, lets an adapter refuse
 * an oversized input before it opens a connection.
 *
 * @stability experimental
 */
export interface AiStreamedPayload {
  /** The bytes, read once. */
  stream: AsyncIterable<Uint8Array>;
  /** Their MIME type. */
  mimeType: string;
  /** A file name, when one is known. */
  filename?: string;
  /** Bytes, when known in advance. */
  size?: number;
}

/**
 * Media going INTO a provider: whole bytes, or a stream (`'stream' in input`).
 *
 * @stability experimental
 */
export type AiMediaInput = AiBinaryPayload | AiStreamedPayload;

/**
 * Whether `input` is streamed rather than buffered.
 *
 * @param input - the media.
 * @returns `true` for an {@link AiStreamedPayload}.
 *
 * @stability experimental
 */
export function isStreamedPayload(input: AiMediaInput): input is AiStreamedPayload {
  return 'stream' in input && input.stream !== undefined;
}

/**
 * The MIME types a transcription input may have: any audio, plus the two
 * video containers people record voice memos and meetings in. `type/*` is a
 * wildcard (`AiStorageInputResolver` understands it).
 *
 * @stability experimental
 */
export const AI_TRANSCRIPTION_INPUT_MIME_TYPES = ['audio/*', 'video/mp4', 'video/webm'] as const;

/**
 * The largest transcription input when the provider's audio port declares
 * no limit of its own (`AiAudioPort.transcriptionMaxBytes`): 25 MiB, OpenAI's.
 *
 * @stability experimental
 */
export const AI_TRANSCRIPTION_DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

/**
 * The longest vocabulary/context prompt accepted, in characters.
 *
 * @stability experimental
 */
export const AI_TRANSCRIPTION_PROMPT_MAX_CHARS = 4_000;

/**
 * The provider answer shapes a transcription may ask for.
 *
 * @stability experimental
 */
export const AI_TRANSCRIPTION_RESPONSE_FORMATS = ['text', 'json', 'verbose_json'] as const;

/**
 * The timestamp granularities a transcription may ask for.
 *
 * @stability experimental
 */
export const AI_TRANSCRIPTION_TIMESTAMP_GRANULARITIES = ['segment', 'word'] as const;

/**
 * One of {@link AI_TRANSCRIPTION_TIMESTAMP_GRANULARITIES}.
 *
 * @stability experimental
 */
export type AiTranscriptionTimestampGranularity = (typeof AI_TRANSCRIPTION_TIMESTAMP_GRANULARITIES)[number];

/**
 * One transcription request.
 *
 * @stability experimental
 */
export interface AiTranscriptionRequest extends AiMediaRequestBase {
  /** The recording. */
  audio: AiMediaInput;
  /** ISO-639-1 hint. */
  language?: string;
  /** Vocabulary/context hint. */
  prompt?: string;
  /**
   * The provider's answer shape. Omit and the adapter asks for the richest
   * one the model supports (OpenAI: `verbose_json` for Whisper, `json` for
   * the GPT-4o transcribe family).
   */
  responseFormat?: (typeof AI_TRANSCRIPTION_RESPONSE_FORMATS)[number];
  /** Per-segment and/or per-word timestamps, where the model supports them. */
  timestampGranularities?: AiTranscriptionTimestampGranularity[];
}

/**
 * One timed segment of a transcript.
 *
 * @stability experimental
 */
export interface AiTranscriptionSegment {
  /** Start, in seconds from the beginning. */
  startSeconds: number;
  /** End, in seconds from the beginning. */
  endSeconds: number;
  /** The segment's text. */
  text: string;
}

/**
 * One timed word of a transcript.
 *
 * @stability experimental
 */
export interface AiTranscriptionWord {
  /** Start, in seconds from the beginning. */
  startSeconds: number;
  /** End, in seconds from the beginning. */
  endSeconds: number;
  /** The word. */
  word: string;
}

/**
 * The result of a transcription.
 *
 * @stability experimental
 */
export interface AiTranscriptionResult extends AiMediaResultBase {
  /** The whole transcript. */
  text: string;
  /** The language detected (or hinted). */
  language?: string;
  /** The audio's length, when the provider reports it — what `audioSeconds` usage is metered on. */
  durationSeconds?: number;
  /** Timed segments, when asked for and supported. */
  segments?: AiTranscriptionSegment[];
  /** Timed words, when asked for and supported. */
  words?: AiTranscriptionWord[];
}

/**
 * The longest text one speech call may speak, in characters (OpenAI's limit).
 *
 * @stability experimental
 */
export const AI_SPEECH_INPUT_MAX_CHARS = 4_096;

/**
 * The longest style/tone instruction accepted, in characters.
 *
 * @stability experimental
 */
export const AI_SPEECH_INSTRUCTIONS_MAX_CHARS = 4_096;

/**
 * The audio formats speech may be produced in.
 *
 * @stability experimental
 */
export const AI_SPEECH_FORMATS = ['mp3', 'wav', 'opus', 'aac', 'flac', 'pcm'] as const;

/**
 * One of {@link AI_SPEECH_FORMATS}.
 *
 * @stability experimental
 */
export type AiSpeechFormat = (typeof AI_SPEECH_FORMATS)[number];

/**
 * The MIME type each speech format is stored and served as (`pcm`: raw 24 kHz 16-bit LE).
 *
 * @stability experimental
 */
export const AI_SPEECH_FORMAT_MIME: Record<AiSpeechFormat, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  opus: 'audio/opus',
  aac: 'audio/aac',
  flac: 'audio/flac',
  pcm: 'audio/pcm',
};

/**
 * The slowest speaking rate (1 is normal).
 *
 * @stability experimental
 */
export const AI_SPEECH_SPEED_MIN = 0.25;

/**
 * The fastest speaking rate (1 is normal).
 *
 * @stability experimental
 */
export const AI_SPEECH_SPEED_MAX = 4;

/**
 * One text-to-speech request.
 *
 * @stability experimental
 */
export interface AiSpeechRequest extends AiMediaRequestBase {
  /** 1 to `AI_SPEECH_INPUT_MAX_CHARS` characters. */
  input: string;
  /** The voice (one the model speaks). */
  voice: string;
  /** Defaults to `mp3`. */
  format?: AiSpeechFormat;
  /** Style/tone instructions where supported (OpenAI: not the `tts-1` family). */
  instructions?: string;
  /** `AI_SPEECH_SPEED_MIN` to `AI_SPEECH_SPEED_MAX`; 1 is normal. */
  speed?: number;
}

/**
 * The result of a speech call.
 *
 * @stability experimental
 */
export interface AiSpeechResult extends AiMediaResultBase {
  /** The spoken audio. */
  audio: AiBinaryPayload;
}

/**
 * The audio port a provider adapter implements (`audio_transcription`, `audio_speech`).
 *
 * @stability experimental
 */
export interface AiAudioPort {
  /**
   * Transcribes a recording. Present only when the provider supports `audio_transcription`.
   *
   * @param req - the request.
   * @param ctx - the call's key and signal.
   */
  transcribe?(req: AiTranscriptionRequest, ctx: AiCallContext): Promise<AiTranscriptionResult>;
  /**
   * The largest audio input `transcribe` accepts, in bytes. The runtime
   * refuses a larger input with `AI_INVALID_REQUEST` BEFORE calling. Omitted:
   * `AI_TRANSCRIPTION_DEFAULT_MAX_BYTES`.
   */
  readonly transcriptionMaxBytes?: number;
  /**
   * Speaks text. Present only when the provider supports `audio_speech`.
   *
   * @param req - the request.
   * @param ctx - the call's key and signal.
   */
  speech?(req: AiSpeechRequest, ctx: AiCallContext): Promise<AiSpeechResult>;
  /**
   * Every voice `speech` accepts, as static data (#439). A model may offer a
   * subset — its catalog capabilities' `voices`; this is the provider-wide
   * list the runtime falls back to when a model does not say.
   */
  readonly voices?: readonly string[];
}

// ---- Embeddings -------------------------------------------------------------

/**
 * The most inputs one `embed` call accepts. A larger batch is refused with
 * `AI_INVALID_REQUEST` rather than silently split: chunk it yourself, and for
 * a backfill of thousands of rows enqueue your own job type that calls
 * `embed` per chunk (docs/specs/ai-platform.md, "Embeddings").
 *
 * @stability experimental
 */
export const AI_EMBEDDINGS_MAX_INPUTS = 256;

/**
 * One embeddings request.
 *
 * @stability experimental
 */
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

/**
 * The result of an embeddings call.
 *
 * @stability experimental
 */
export interface AiEmbeddingResult extends AiMediaResultBase {
  /** One vector per input, in input order (a single string input yields one). */
  vectors: number[][];
  /** The length of every vector in `vectors`. */
  dimensions: number;
}

/**
 * The embeddings port a provider adapter implements (`embeddings`).
 *
 * @stability experimental
 */
export interface AiEmbeddingsPort {
  /**
   * Embeds texts.
   *
   * @param req - the request.
   * @param ctx - the call's key and signal.
   */
  embed(req: AiEmbeddingRequest, ctx: AiCallContext): Promise<AiEmbeddingResult>;
}

// ---- Realtime ---------------------------------------------------------------
//
// #449 (docs/specs/ai-platform.md §2.15). The server mints an EPHEMERAL,
// short-lived client secret with the resolved key; the browser connects to
// the provider directly (WebRTC) with that secret. The server never sees the
// media, so a session has no result beyond the secret itself.

/**
 * How long a minted client secret may be used to OPEN a session (seconds).
 *
 * @stability experimental
 */
export const AI_REALTIME_CLIENT_SECRET_TTL_SECONDS = 60;

/**
 * The longest initial `instructions` accepted, in characters.
 *
 * @stability experimental
 */
export const AI_REALTIME_INSTRUCTIONS_MAX_CHARS = 16_000;

/**
 * How the provider decides a user's turn has ended. `server_vad` detects
 * silence; `semantic_vad` judges whether the user has finished their
 * thought. `null` on a request switches detection off (push-to-talk: the
 * client commits the audio buffer itself).
 *
 * @stability experimental
 */
export type AiRealtimeTurnDetection =
  | {
      /** Silence detection. */
      type: 'server_vad';
      /** Activation threshold, 0-1. */
      threshold?: number;
      /** Audio kept from before speech started, in milliseconds. */
      prefixPaddingMs?: number;
      /** Silence that ends a turn, in milliseconds. */
      silenceDurationMs?: number;
    }
  | {
      /** Semantic end-of-turn detection. */
      type: 'semantic_vad';
      /** How quickly the model answers. */
      eagerness?: 'low' | 'medium' | 'high' | 'auto';
    };

/**
 * One realtime (voice) session request.
 *
 * @stability experimental
 */
export interface AiRealtimeSessionRequest extends AiMediaRequestBase {
  /** Initial system instructions — the client may change them over its data channel. */
  instructions?: string;
  /** The voice the model answers in; the runtime has already checked the model speaks it. */
  voice?: string;
  /** Output modalities; the provider's default (audio, with its transcript) when omitted. */
  modalities?: Array<'text' | 'audio'>;
  /** Client-executed function tools the session starts with. */
  tools?: AiFunctionTool[];
  /** Omitted: the provider's default. `null`: no automatic turn detection. */
  turnDetection?: AiRealtimeTurnDetection | null;
  /** Initial per-response output-token cap (a default the client can change, not an enforcement). */
  maxOutputTokens?: number;
  /** Seconds the client secret may open a session; defaults to `AI_REALTIME_CLIENT_SECRET_TTL_SECONDS`. */
  expiresInSeconds?: number;
}

/**
 * A short-lived session the BROWSER connects to directly. `clientSecret` is
 * an ephemeral, provider-minted token scoped to this one session
 * configuration — never the provider API key the server called with.
 *
 * ⚠ Treat `clientSecret` as a bearer credential: it is returned to the
 * caller (that is its purpose) and nowhere else — never logged, never put on
 * a span, never stored.
 *
 * @stability experimental
 */
export interface AiRealtimeSession {
  /** The provider's session id, when it reports one. */
  id?: string;
  /** Provider id. */
  provider: string;
  /** Model id. */
  model: string;
  /** The ephemeral secret the browser authenticates the connection with. */
  clientSecret: string;
  /** When `clientSecret` stops being able to open a session. */
  expiresAt: Date;
  /** Where the browser POSTs its WebRTC SDP offer, with `Authorization: Bearer <clientSecret>`. */
  connectUrl: string;
  /** The voice the session speaks in, as the provider confirmed it. */
  voice?: string;
  /** The effective initial configuration, as neutral non-secret fields. */
  sessionConfig?: {
    /** Output modalities. */
    modalities?: Array<'text' | 'audio'>;
    /** Initial instructions. */
    instructions?: string;
    /** Turn detection; `null` when off. */
    turnDetection?: AiRealtimeTurnDetection | null;
    /** Initial per-response output-token cap. */
    maxOutputTokens?: number;
  };
  /** The provider's request id, for support tickets. */
  providerRequestId?: string;
}

/**
 * The realtime port a provider adapter implements (`realtime`).
 *
 * @stability experimental
 */
export interface AiRealtimePort {
  /**
   * Mints a session the browser connects to.
   *
   * @param req - the request.
   * @param ctx - the call's key and signal.
   */
  createSession(req: AiRealtimeSessionRequest, ctx: AiCallContext): Promise<AiRealtimeSession>;
  /**
   * Every voice `createSession` accepts, as static data. A model may offer a
   * subset — its catalog capabilities' `voices`; this is the fallback.
   */
  readonly voices?: readonly string[];
}

// =============================================================================
// The runtime facade's public types (issue #432, epic #419)
// =============================================================================
//
// What a fork codes against. Everything here is provider-neutral and carries
// no key: the facade resolves the key per call and hands it straight to the
// adapter (docs/specs/ai-platform.md §2.2), so no type in this file has a field
// able to hold one.
// =============================================================================

import type { z } from 'zod';

import type { AiDefinedTool } from '../core/tools';
import type {
  AiRealtimeTurnDetection,
  AiSpeechFormat,
  AiEmbeddingRequest,
  AiImageGenerationRequest,
  AiTranscriptionSegment,
  AiTranscriptionTimestampGranularity,
  AiTranscriptionWord,
} from '../core/types/media.types';
import type {
  AiFunctionTool,
  AiResponse,
  AiResponseRequest,
  AiStreamEvent,
  AiUsage,
} from '../core/types/responses.types';

/**
 * A request as a fork writes it. `model` (and `provider`) are optional:
 *
 *   - both omitted  -> the caller's `ai.defaultModel` user setting, else
 *                      `AI_INVALID_REQUEST` ('No model selected');
 *   - `model` alone -> `provider` is the default model's provider, else the
 *                      only registered provider, else `AI_INVALID_REQUEST`.
 */
export type AiRequest = Omit<AiResponseRequest, 'model'> & {
  /** Provider id; resolved as above when omitted. */
  provider?: string;
  /** Model id; resolved as above when omitted. */
  model?: string;
};

/**
 * `embed`'s request. `model` is REQUIRED — vectors from different models are
 * not comparable, so an embedding model is never inferred from the caller's
 * chat `ai.defaultModel`. `provider` resolves as for `AiRequest`.
 */
export type AiEmbedRequest = Omit<AiEmbeddingRequest, 'model'> & {
  /** Provider id; resolved as for `AiRequest` when omitted. */
  provider?: string;
  /** The embedding model's id. */
  model: string;
};

/**
 * `generateImage`'s request. `model` is REQUIRED — an image model is never
 * inferred from the caller's chat `ai.defaultModel`. `provider` resolves as
 * for `AiRequest`.
 */
export type AiGenerateImageRequest = Omit<AiImageGenerationRequest, 'model'> & {
  /** Provider id; resolved as for `AiRequest` when omitted. */
  provider?: string;
  /** The image model's id. */
  model: string;
};

/**
 * `editImage`'s request: a generation request plus the images to edit, BY
 * STORAGE OBJECT ID. Each must be the caller's own (ownership only, like
 * `ObjectsService`), `ready`, PNG/JPEG/WebP and at most
 * `AI_IMAGE_INPUT_MAX_BYTES`; the mask, when given, must be a PNG.
 */
export type AiEditImageRequest = AiGenerateImageRequest & {
  /** 1 to `AI_IMAGE_EDIT_MAX_INPUTS` storage object ids. */
  imageStorageObjectIds: string[];
  /** A PNG whose transparent areas mark what may change. */
  maskStorageObjectId?: string;
};

/**
 * `transcribe`'s request (#438): a recording the caller uploaded, BY STORAGE
 * OBJECT ID — their own (ownership only), `ready`, `audio/*`
 * or `video/mp4`/`video/webm`, and no larger than the provider accepts
 * (25 MiB for OpenAI).
 *
 * `model` is optional: omitted, the first model the caller can use that
 * declares `audio_transcription` (by provider, then model id — the order
 * `GET /api/ai/models` lists them in) — never the chat `ai.defaultModel`.
 */
export interface AiTranscribeRequest {
  /** The recording: a `ready` storage object the caller owns. */
  storageObjectId: string;
  /** Provider id; resolved from the model when omitted. */
  provider?: string;
  /** Model id; the first usable `audio_transcription` model when omitted. */
  model?: string;
  /** ISO-639-1 language hint (`en`); improves accuracy and latency. */
  language?: string;
  /** Vocabulary/context hint (names, jargon), at most 4000 characters. */
  prompt?: string;
  /** Segment and/or word timestamps, where the model supports them (OpenAI: Whisper). */
  timestampGranularities?: AiTranscriptionTimestampGranularity[];
  /** Keyed by provider id — same escape hatch as `AiResponseRequest`. */
  providerOptions?: Record<string, Record<string, unknown>>;
}

/**
 * `speak`'s request (#439): text to speech, stored as the caller's own
 * storage object.
 *
 * `model` is optional exactly as for `AiTranscribeRequest` (the first usable
 * model declaring `audio_speech`); `voice` is optional too — omitted, the
 * first voice the model lists (its catalog `voices`, else the provider's).
 */
export interface AiSpeakRequest {
  /** 1 to 4096 characters. */
  input: string;
  /** The voice; the model's first listed voice when omitted. */
  voice?: string;
  /** Provider id; resolved from the model when omitted. */
  provider?: string;
  /** Model id; the first usable `audio_speech` model when omitted. */
  model?: string;
  /** Defaults to `mp3`. */
  format?: AiSpeechFormat;
  /** Style/tone instructions, where the model supports them. */
  instructions?: string;
  /** 0.25 to 4; 1 is normal. */
  speed?: number;
  /** Keyed by provider id — same escape hatch as `AiResponseRequest`. */
  providerOptions?: Record<string, Record<string, unknown>>;
}

/**
 * `createRealtimeSession`'s request (#449, docs/specs/ai-platform.md §2.15).
 *
 * `model` is optional: omitted, the first model the caller can use that
 * declares `realtime` (in `GET /api/ai/models` order) — never the chat
 * `ai.defaultModel`. `voice` defaults to the model's first listed voice.
 * Everything here is the session's INITIAL configuration: the browser that
 * holds the ephemeral secret may change it over its data channel.
 */
export interface AiRealtimeRequest {
  /** Provider id; resolved from the model when omitted. */
  provider?: string;
  /** Model id; the first usable `realtime` model when omitted. */
  model?: string;
  /** The voice; the model's first listed voice when omitted. */
  voice?: string;
  /** Initial system instructions, at most `AI_REALTIME_INSTRUCTIONS_MAX_CHARS`. */
  instructions?: string;
  /** Omitted: the provider's default. `null`: no automatic turn detection (push-to-talk). */
  turnDetection?: AiRealtimeTurnDetection | null;
  /** Client-executed function tools the session starts with (in-process callers only). */
  tools?: AiFunctionTool[];
  /** Keyed by provider id — same escape hatch as `AiResponseRequest`. */
  providerOptions?: Record<string, Record<string, unknown>>;
}

/**
 * A minted realtime session. `clientSecret` is the provider's EPHEMERAL
 * secret — hand it to the browser that will connect, and nowhere else (never
 * log or store it). It is never the caller's key.
 */
export interface AiRealtimeSessionResult {
  /** Provider id. */
  provider: string;
  /** Model id. */
  model: string;
  /** The voice the session speaks in. */
  voice: string;
  /** The ephemeral secret (see above). */
  clientSecret: string;
  /** When `clientSecret` can no longer OPEN a session (a connected call continues). */
  expiresAt: Date;
  /** Where the browser POSTs its SDP offer with `Authorization: Bearer <clientSecret>`. */
  connectUrl: string;
}

/** Per-call options every facade method accepts. */
export interface AiCallOptions {
  /** Aborts the provider call. An aborted call records a `cancelled` usage row. */
  signal?: AbortSignal;
}

/** `respondStructured`'s request: a Zod schema instead of a `structuredOutput` spec. */
export type AiStructuredRequest<S extends z.ZodTypeAny> = Omit<AiRequest, 'structuredOutput'> & {
  /** The output's schema. */
  schema: S;
  /** Identifier the provider is told (`[a-zA-Z0-9_-]`). Defaults to `'response'`. */
  schemaName?: string;
  /** Ask the provider to enforce the schema exactly. Defaults to true. */
  strict?: boolean;
};

/** A structured response: `parsed` is always present and already validated. */
export type AiStructuredResponse<T> = AiResponse<T> & {
  /** The validated output. */
  parsed: T;
};

/** What happened to one function call the model made during `runTools`. */
export type AiToolCallStatus = 'ok' | 'invalid_arguments' | 'unknown_tool' | 'error' | 'timeout';

/**
 * One function call the model made during `runTools`, and what came of it.
 *
 * @stability experimental
 */
export interface AiToolCallRecord {
  /** The provider's call id. */
  callId: string;
  /** The tool's name. */
  name: string;
  /** The raw arguments string the model produced. */
  arguments: string;
  /** What happened. */
  status: AiToolCallStatus;
  /** What was fed back to the model as the `function_call_output`. */
  output: string;
  /** The tool's error message when `status` is `error` or `timeout`. */
  error?: string;
  /** How long the tool ran. */
  durationMs: number;
}

/** One provider round-trip of the tool loop, and the calls it produced. */
export interface AiToolStep {
  /** 1-based round-trip index. */
  step: number;
  /** The provider's response of this round-trip. */
  response: AiResponse;
  /** Empty on the final step (the model stopped calling tools). */
  calls: AiToolCallRecord[];
}

/**
 * The tool loop's round-trips when a request names none.
 *
 * @stability experimental
 */
export const AI_TOOL_LOOP_DEFAULT_MAX_STEPS = 8;

/**
 * The most round-trips a tool loop may ask for.
 *
 * @stability experimental
 */
export const AI_TOOL_LOOP_MAX_STEPS = 20;

/**
 * A tool's execution timeout when a request names none.
 *
 * @stability experimental
 */
export const AI_TOOL_DEFAULT_TIMEOUT_MS = 30_000;

/**
 * `runTools`'s request: tools with their implementations.
 *
 * @stability experimental
 */
export type AiToolLoopRequest = Omit<AiRequest, 'tools'> & {
  /** The tools, from `defineTool`. */
  tools: AiDefinedTool[];
  /** Provider round-trips allowed, 1-20. Defaults to 8. */
  maxSteps?: number;
  /** Per-tool execution timeout. Defaults to 30 s. */
  toolTimeoutMs?: number;
  /** Called after every round-trip, in order. A throw here aborts the loop. */
  onStep?: (step: AiToolStep) => void;
};

/**
 * `runTools`'s answer.
 *
 * @stability experimental
 */
export interface AiToolLoopResult {
  /** The last provider response. */
  final: AiResponse;
  /** Every round-trip, in order. */
  steps: AiToolStep[];
  /**
   * `completed` — the model stopped calling tools;
   * `steps_exhausted` — `maxSteps` round-trips were spent and the model still
   * wanted to call tools (those calls were NOT executed).
   */
  stopReason: 'completed' | 'steps_exhausted';
}

/** `startRun`'s answer. Poll `AiRunsService.get(userId, runId)`. */
export interface AiRunHandle {
  /** The run (`ai_runs.id`). */
  runId: string;
  /** The queue job running it. */
  jobId: string;
}

/**
 * The statuses a background run passes through.
 *
 * @stability experimental
 */
export const AI_RUN_STATUSES = ['pending', 'running', 'succeeded', 'failed', 'cancelled'] as const;

/**
 * One of {@link AI_RUN_STATUSES}.
 *
 * @stability experimental
 */
export type AiRunStatus = (typeof AI_RUN_STATUSES)[number];

/** One image an image run stored. */
export interface AiImageRunOutputImage {
  /** The storage object the image was saved as. */
  storageObjectId: string;
  /** Its MIME type. */
  mimeType: string;
  /** Bytes. */
  size: number;
  /** The prompt the provider actually used, where it rewrote it (DALL·E 3). */
  revisedPrompt?: string;
}

/**
 * A succeeded image run's `output`: the storage objects it created, owned by
 * the run's user. Download each with `GET /api/storage/objects/{id}/download`.
 * The images themselves are never in the row.
 */
export interface AiImageRunOutput {
  /** Discriminator. */
  type: 'images';
  /** Provider id. */
  provider: string;
  /** Model id. */
  model: string;
  /** Every image's storage object, in order. */
  storageObjectIds: string[];
  /** Every image, in order. */
  images: AiImageRunOutputImage[];
  /** Token accounting. */
  usage: AiUsage;
}

/**
 * A succeeded transcription run's `output` (#438): the transcript itself.
 * `storageObjectId` is the recording it was made from.
 */
export interface AiTranscriptionRunOutput {
  /** Discriminator. */
  type: 'transcription';
  /** Provider id. */
  provider: string;
  /** Model id. */
  model: string;
  /** The recording transcribed. */
  storageObjectId: string;
  /** The whole transcript. */
  text: string;
  /** As the provider reports it (OpenAI Whisper: a language name such as `english`). */
  language?: string;
  /** The recording's length, when reported. */
  durationSeconds?: number;
  /** Timed segments, when asked for. */
  segments?: AiTranscriptionSegment[];
  /** Timed words, when asked for. */
  words?: AiTranscriptionWord[];
  /** Token accounting. */
  usage: AiUsage;
}

/**
 * A succeeded speech run's `output` (#439): the storage object holding the
 * audio, owned by the run's user — download it with
 * `GET /api/storage/objects/{id}/download`. `aiGenerated` is always `true`:
 * provider usage policies (OpenAI's among them) require telling listeners
 * the voice is AI-generated, and a client should surface it.
 */
export interface AiSpeechRunOutput {
  /** Discriminator. */
  type: 'speech';
  /** Provider id. */
  provider: string;
  /** Model id. */
  model: string;
  /** The storage object holding the audio. */
  storageObjectId: string;
  /** Its MIME type. */
  mimeType: string;
  /** Bytes. */
  size: number;
  /** The audio format. */
  format: AiSpeechFormat;
  /** The voice spoken in. */
  voice: string;
  /** Characters spoken — what `units.characters` meters. */
  characters: number;
  /** Always `true`: tell listeners the voice is AI-generated. */
  aiGenerated: true;
  /** Token accounting. */
  usage: AiUsage;
}

/** What a succeeded run's `output` holds: a response, an image run's images, a transcript, or speech. */
export type AiRunOutput = AiResponse | AiImageRunOutput | AiTranscriptionRunOutput | AiSpeechRunOutput;

/** A background run as its owner sees it. Carries no request and no key. */
export interface AiRunView {
  /** The run. */
  id: string;
  /** Where it is. */
  status: AiRunStatus;
  /** Provider id. */
  provider: string;
  /** Model id. */
  modelId: string;
  /** Once `succeeded`: the `AiResponse`, or a media run's `AiImageRunOutput`/`AiTranscriptionRunOutput`/`AiSpeechRunOutput`. */
  output: AiRunOutput | null;
  /** The failure's `AiErrorCode`, once `failed`. */
  errorCode: string | null;
  /** The failure's message, once `failed`. */
  errorMessage: string | null;
  /** The queue job running it. */
  jobId: string | null;
  /** When it was started. */
  createdAt: Date;
  /** When it settled. */
  completedAt: Date | null;
}

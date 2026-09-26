// =============================================================================
// AI provider adapter contract (issue #424, epic #419)
// =============================================================================
//
// One class per provider implements this and self-registers with
// `AiProviderRegistry` from its own `onModuleInit()` — the same explicit
// registration `JobHandler` uses (see `jobs/job-handler.registry.ts` for why
// explicit registration beats decorator discovery).
//
// CAPABILITY PORTS: PRESENCE IS THE DECLARATION. An adapter that can generate
// images carries an `images` port; one that cannot leaves it `undefined`.
// There is no `supportsImages: boolean` to disagree with the code — the same
// idiom as `JobHandler.nodeResultSchema` + `persistNodeResult`.
// `AiProviderRegistry.supports()` is the derivation.
//
// NO SDK TYPE CROSSES THIS BOUNDARY. Every method takes and returns the
// neutral types in `./types`, and every failure is an `AiError` — an adapter
// that lets a raw SDK error escape fails the conformance kit.
// =============================================================================

import type { AiErrorCode } from './ai-error';
import type { AiModelCapabilities } from './capabilities';
import type { AiFileInputStrategies, AiResolvedStorageInputs } from './types/file-inputs.types';
import type {
  AiAudioPort,
  AiEmbeddingsPort,
  AiImagesPort,
  AiRealtimePort,
} from './types/media.types';
import type { AiResponse, AiResponseRequest, AiStreamEvent } from './types/responses.types';

/**
 * Per-call context. The key is resolved per call by the runtime (org key or
 * the user's own key, per policy) and handed to the adapter — adapters hold
 * no credentials of their own.
 *
 * ⚠ `apiKey` is secret material: it must never appear in a log line, an
 * `AiError`'s details, or a persisted row.
 */
export interface AiCallContext {
  apiKey: string;
  baseUrl?: string;
  signal?: AbortSignal;
  requestId: string;
  /**
   * The request's storage-object inputs (#441), resolved and authorised by the
   * runtime, keyed by `storageObjectId` — present only when the request
   * carries any. ⚠ May hold presigned URLs: the same never-log rule as
   * `apiKey` applies (see `types/file-inputs.types.ts`).
   */
  storageInputs?: AiResolvedStorageInputs;
}

export interface AiDiscoveredModel {
  id: string;
  ownedBy?: string;
  createdAt?: Date;
}

/**
 * The outcome of `verifyKey`. A rejected key is an ordinary answer
 * (`ok: false, code: 'AI_KEY_INVALID'`), not an exception — the admin UI asks
 * this question precisely when it expects "no" to be possible.
 */
export interface AiKeyVerification {
  ok: boolean;
  code?: AiErrorCode;
  detail?: string;
}

export interface AiResponsesPort {
  create(req: AiResponseRequest, ctx: AiCallContext): Promise<AiResponse>;
  stream(req: AiResponseRequest, ctx: AiCallContext): AsyncIterable<AiStreamEvent>;
}

export interface AiProviderAdapter {
  /** Stable identifier (`'openai'`). PERMANENT — stored in settings, catalog rows and usage rows. */
  readonly id: string;
  readonly displayName: string;

  listModels(ctx: AiCallContext): Promise<AiDiscoveredModel[]>;
  verifyKey(ctx: AiCallContext): Promise<AiKeyVerification>;
  /** `null` means "unclassified": the catalog stores it and an admin decides. */
  classifyModel(modelId: string): AiModelCapabilities | null;

  /**
   * How this adapter wants storage-object image/file inputs delivered (#441).
   * Presence is the declaration that it accepts them at all; absent, a
   * request carrying one is refused with `AI_CAPABILITY_UNSUPPORTED`.
   */
  readonly fileInputStrategy?: AiFileInputStrategies;

  // Capability ports — presence IS the declaration.
  readonly responses?: AiResponsesPort;
  readonly images?: AiImagesPort;
  readonly audio?: AiAudioPort;
  readonly embeddings?: AiEmbeddingsPort;
  readonly realtime?: AiRealtimePort;
}

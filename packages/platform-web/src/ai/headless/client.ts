/**
 * The AI platform's HTTP calls, over the host's transport (`PlatformApiClient`).
 *
 * Moved from the reference app's `services/ai.ts` (issue #890); the types they
 * produce live in `./types.ts`. Every call takes the transport as its first
 * argument, so the package never reaches for an app singleton: the hooks pass
 * `usePlatformApi()`'s.
 *
 * ⚠ THE TEST ENDPOINTS ANSWER 200 WHEN THE ANSWER IS BAD. The provider test
 * route always returns HTTP 200; the outcome is in the body's `success` and
 * per-check `status`.
 */
import type { PlatformApiClient } from '../../core/index.js';
import { AI_KEY_REMOVE_CONFIRMATION } from './types.js';
import type {
  AiAdminConfig,
  AiAdminConfigInput,
  AiAdminConfigWithWarnings,
  AiCatalogRefreshQueued,
  AiEmbeddingsRequest,
  AiEmbeddingsResponse,
  AiImageEditRequest,
  AiImageGenerateRequest,
  AiModel,
  AiModelListFilter,
  AiModelListResponse,
  AiModelUpdateInput,
  AiMyUsageGroupBy,
  AiMyUsageQuery,
  AiProbeResult,
  AiPublicConfig,
  AiRealtimeSession,
  AiRealtimeSessionRequest,
  AiResponse,
  AiResponseRequest,
  AiRun,
  AiRunStarted,
  AiSpeechRequest,
  AiStreamEvent,
  AiStreamHandlers,
  AiTranscriptionRequest,
  AiUsageQuery,
  AiUsageReport,
  UsableAiModel,
  UserAiKey,
} from './types.js';

const ADMIN = '/admin/ai';

function usageQueryString(query: object): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query) as [string, unknown][]) {
    if (typeof value === 'string' && value !== '') params.set(key, value);
  }
  return params.toString();
}

/**
 * Drop blank optional strings so "blank means use the stored value" is
 * expressed by ABSENCE, which is what the API's schema reads — an empty
 * string would be a (too short) key.
 */
function stripBlank<T extends Record<string, string | undefined>>(input: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(input) as [keyof T, string | undefined][]) {
    if (value !== undefined && value.trim() !== '') out[key] = value as T[keyof T];
  }
  return out;
}

// =============================================================================
// Calls — public configuration
// =============================================================================

/**
 * Get AI config.
 *
 * @stability experimental
 */
export async function getAiConfig(api: PlatformApiClient): Promise<AiPublicConfig> {
  return api.get<AiPublicConfig>('/ai/config');
}

/**
 * Get AI admin config.
 *
 * @stability experimental
 */
export async function getAiAdminConfig(api: PlatformApiClient): Promise<AiAdminConfig> {
  return api.get<AiAdminConfig>(`${ADMIN}/config`);
}

/**
 * Replace the configuration. `expectedVersion` travels as `If-Match`; a stale
 * version answers 409, exactly like the storage configuration.
 
 *
 * @stability experimental
 */
export async function updateAiAdminConfig(
  api: PlatformApiClient,
  input: AiAdminConfigInput,
  expectedVersion?: number
): Promise<AiAdminConfig> {
  return api.put<AiAdminConfig>(
    `${ADMIN}/config`,
    input,
    expectedVersion === undefined ? undefined : { ifMatch: String(expectedVersion) }
  );
}

/**
 * Store the organisation key for a provider. Verified first; 400 `AI_KEY_INVALID` stores nothing.
 *
 * @stability experimental
 */
export async function setAiProviderKey(
  api: PlatformApiClient,
  provider: string,
  apiKey: string
): Promise<AiAdminConfig> {
  return api.put<AiAdminConfig>(`${ADMIN}/providers/${encodeURIComponent(provider)}/key`, {
    apiKey,
  });
}

/**
 * Delete AI provider key.
 *
 * @stability experimental
 */
export async function deleteAiProviderKey(
  api: PlatformApiClient,
  provider: string
): Promise<AiAdminConfigWithWarnings> {
  return api.delete<AiAdminConfigWithWarnings>(
    `${ADMIN}/providers/${encodeURIComponent(provider)}/key`,
    {
      jsonBody: { confirmation: AI_KEY_REMOVE_CONFIRMATION },
    }
  );
}

/**
 * Probe a provider. Blank `apiKey` means "use the stored key". Always 200 — read `success`.
 *
 * @stability experimental
 */
export async function testAiProvider(
  api: PlatformApiClient,
  provider: string,
  input: {
    /** The api key. */
    apiKey?: string;
    /** The base url. */
    baseUrl?: string;
  } = {}
): Promise<AiProbeResult> {
  return api.post<AiProbeResult>(
    `${ADMIN}/providers/${encodeURIComponent(provider)}/test`,
    stripBlank(input)
  );
}

/**
 * List AI models.
 *
 * @stability experimental
 */
export async function listAiModels(
  api: PlatformApiClient,
  filter: AiModelListFilter = {}
): Promise<AiModelListResponse> {
  const query = new URLSearchParams();
  if (filter.provider) query.set('provider', filter.provider);
  if (filter.capability) query.set('capability', filter.capability);
  if (filter.enabled !== undefined) query.set('enabled', String(filter.enabled));
  if (filter.includeDeprecated) query.set('includeDeprecated', 'true');
  if (filter.q?.trim()) query.set('q', filter.q.trim());
  if (filter.page) query.set('page', String(filter.page));
  if (filter.pageSize) query.set('pageSize', String(filter.pageSize));
  const suffix = query.toString();
  return api.get<AiModelListResponse>(`${ADMIN}/models${suffix ? `?${suffix}` : ''}`);
}

/**
 * Update AI model.
 *
 * @stability experimental
 */
export async function updateAiModel(
  api: PlatformApiClient,
  id: string,
  input: AiModelUpdateInput
): Promise<AiModel> {
  return api.patch<AiModel>(`${ADMIN}/models/${encodeURIComponent(id)}`, input);
}

/**
 * Enqueue a catalogue refresh for one provider. 409 `AI_KEY_REQUIRED` when it has no org key.
 *
 * @stability experimental
 */
export async function refreshAiModels(
  api: PlatformApiClient,
  provider: string
): Promise<AiCatalogRefreshQueued> {
  return api.post<AiCatalogRefreshQueued>(`${ADMIN}/models/refresh`, { provider });
}

// =============================================================================
// Calls — the caller's own keys and models (`ai:use`)
// =============================================================================

/**
 * List user AI keys.
 *
 * @stability experimental
 */
export async function listUserAiKeys(api: PlatformApiClient): Promise<UserAiKey[]> {
  return api.get<UserAiKey[]>('/ai/keys');
}

/**
 * Set user AI key.
 *
 * @stability experimental
 */
export async function setUserAiKey(
  api: PlatformApiClient,
  provider: string,
  apiKey: string
): Promise<UserAiKey> {
  return api.put<UserAiKey>(`/ai/keys/${encodeURIComponent(provider)}`, { apiKey });
}

/**
 * Delete user AI key.
 *
 * @stability experimental
 */
export async function deleteUserAiKey(api: PlatformApiClient, provider: string): Promise<void> {
  await api.delete<void>(`/ai/keys/${encodeURIComponent(provider)}`);
}

/**
 * Probe the caller's stored key, or `apiKey` when given. Always 200 — read `success`.
 *
 * @stability experimental
 */
export async function testUserAiKey(
  api: PlatformApiClient,
  provider: string,
  apiKey?: string
): Promise<AiProbeResult> {
  return api.post<AiProbeResult>(
    `/ai/keys/${encodeURIComponent(provider)}/test`,
    stripBlank({ apiKey })
  );
}

/**
 * List usable AI models.
 *
 * @stability experimental
 */
export async function listUsableAiModels(api: PlatformApiClient): Promise<UsableAiModel[]> {
  return api.get<UsableAiModel[]>('/ai/models');
}

// =============================================================================
// Calls — responses and background runs (`ai:use`)
// =============================================================================

/**
 * Create AI response.
 *
 * @stability experimental
 */
export async function createAiResponse(
  api: PlatformApiClient,
  req: AiResponseRequest
): Promise<AiResponse> {
  return api.post<AiResponse>('/ai/responses', req);
}

/**
 * `POST /ai/responses/stream` — one prompt, one streamed answer, via
 * `postSse` (no reconnect: a reconnect would re-submit the prompt).
 *
 * Resolves with the completed {@link AiResponse}, or `null` when the stream
 * ended without one (an `error` event, delivered to `onError`, or `signal`
 * aborted — aborting is not an error). REJECTS with `ApiError` when a gate
 * refused the request before the first byte (`AI_DISABLED`,
 * `AI_KEY_REQUIRED`, `AI_MODEL_NOT_ENABLED`, …) — the same error, with the
 * same `code`, the non-streaming call would have thrown.
 
 *
 * @stability experimental
 */
export async function streamAiResponse(
  api: PlatformApiClient,
  req: AiResponseRequest,
  handlers: AiStreamHandlers = {},
  signal?: AbortSignal
): Promise<AiResponse | null> {
  if (!api.postSse) {
    throw new Error('streamAiResponse: the platform transport has no postSse.');
  }
  let completed: AiResponse | null = null;

  await api.postSse('/ai/responses/stream', req, {
    ...(signal === undefined ? {} : { signal }),
    onFrame: (eventName, data) => {
      // The frame's `event:` line is authoritative for the type; the JSON
      // body carries the rest (and usually repeats `type`).
      const payload = typeof data === 'object' && data !== null ? data : {};
      const event = { ...payload, type: eventName } as AiStreamEvent;

      handlers.onEvent?.(event);
      switch (event.type) {
        case 'output_text.delta':
          handlers.onTextDelta?.(event.delta);
          break;
        case 'reasoning_summary.delta':
          handlers.onReasoningDelta?.(event.delta);
          break;
        case 'response.completed':
          completed = event.response;
          handlers.onCompleted?.(event.response);
          break;
        case 'error':
          handlers.onError?.(event.code, event.message);
          break;
        default:
          break;
      }
    },
  });

  return completed;
}

/**
 * Create AI run.
 *
 * @stability experimental
 */
export async function createAiRun(
  api: PlatformApiClient,
  req: AiResponseRequest
): Promise<AiRunStarted> {
  return api.post<AiRunStarted>('/ai/runs', req);
}

/**
 * Get AI run.
 *
 * @stability experimental
 */
export async function getAiRun(api: PlatformApiClient, id: string): Promise<AiRun> {
  return api.get<AiRun>(`/ai/runs/${encodeURIComponent(id)}`);
}

/**
 * Cancel AI run.
 *
 * @stability experimental
 */
export async function cancelAiRun(api: PlatformApiClient, id: string): Promise<AiRun> {
  return api.post<AiRun>(`/ai/runs/${encodeURIComponent(id)}/cancel`);
}

/**
 * Create AI image run.
 *
 * @stability experimental
 */
export async function createAiImageRun(
  api: PlatformApiClient,
  req: AiImageGenerateRequest
): Promise<AiRunStarted> {
  return api.post<AiRunStarted>('/ai/images', req);
}

/**
 * Create AI image edit run.
 *
 * @stability experimental
 */
export async function createAiImageEditRun(
  api: PlatformApiClient,
  req: AiImageEditRequest
): Promise<AiRunStarted> {
  return api.post<AiRunStarted>('/ai/images/edits', req);
}

/**
 * Create AI transcription run.
 *
 * @stability experimental
 */
export async function createAiTranscriptionRun(
  api: PlatformApiClient,
  req: AiTranscriptionRequest
): Promise<AiRunStarted> {
  return api.post<AiRunStarted>('/ai/audio/transcriptions', req);
}

/**
 * Create AI speech run.
 *
 * @stability experimental
 */
export async function createAiSpeechRun(
  api: PlatformApiClient,
  req: AiSpeechRequest
): Promise<AiRunStarted> {
  return api.post<AiRunStarted>('/ai/audio/speech', req);
}

/**
 * Create realtime session.
 *
 * @stability experimental
 */
export async function createRealtimeSession(
  api: PlatformApiClient,
  req: AiRealtimeSessionRequest = {}
): Promise<AiRealtimeSession> {
  return api.post<AiRealtimeSession>('/ai/realtime/sessions', req);
}

/**
 * Create AI embeddings.
 *
 * @stability experimental
 */
export async function createAiEmbeddings(
  api: PlatformApiClient,
  req: AiEmbeddingsRequest
): Promise<AiEmbeddingsResponse> {
  return api.post<AiEmbeddingsResponse>('/ai/embeddings', req);
}

/**
 * `GET /admin/ai/usage` — `ai_config:read`. Not behind the AI kill switch.
 *
 * @stability experimental
 */
export async function getAiUsage(
  api: PlatformApiClient,
  query: AiUsageQuery
): Promise<AiUsageReport> {
  return api.get<AiUsageReport>(`${ADMIN}/usage?${usageQueryString(query)}`);
}

/**
 * `GET /ai/usage/me` — `ai:use`, the caller's own usage only.
 *
 * @stability experimental
 */
export async function getMyAiUsage(
  api: PlatformApiClient,
  query: AiMyUsageQuery
): Promise<AiUsageReport<AiMyUsageGroupBy>> {
  return api.get<AiUsageReport<AiMyUsageGroupBy>>(`/ai/usage/me?${usageQueryString(query)}`);
}

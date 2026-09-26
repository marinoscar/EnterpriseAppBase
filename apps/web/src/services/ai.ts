/**
 * The AI platform's HTTP surface (epic #419, umbrella #418), as the web app
 * sees it.
 *
 * Issue #425. Shaped after `services/storageConfig.ts`: `services/api.ts`
 * stays the transport (the `ApiService` instance, the refresh dance, the
 * maintenance recogniser) and this module holds every Phase 1 AI call next to
 * the types it produces. The tail of `services/api.ts` is legacy; nothing new
 * goes there.
 *
 * Three route families, three audiences:
 *
 * - `GET /ai/config` — any authenticated user. The PUBLIC projection of the
 *   `ai` system-settings namespace: whether AI is on at all, the key policy,
 *   and which providers exist. It is what hides the AI cards, the AI
 *   destination and the AI routes when an administrator has not switched AI
 *   on (see `hooks/useAiConfig.ts`). It never carries a key hint.
 * - `/admin/ai/*` — `ai_config:read` / `ai_config:write`. The organisation's
 *   configuration, provider keys and model catalogue.
 * - `/ai/keys`, `/ai/models`, `/ai/responses`, `/ai/runs` — `ai:use`, and
 *   refused with `403 AI_DISABLED` while AI is off.
 *
 * =============================================================================
 * A KEY ONLY EVER TRAVELS ONE WAY
 * =============================================================================
 *
 * No response type below carries an API key, because no endpoint returns one.
 * Keys appear only as WRITE-ONLY `apiKey` arguments; what comes back is a
 * masked {@link SecretStatus} (admin keys) or a {@link UserAiKey} view (a
 * user's own key). Nothing here should grow a field that could hold the real
 * key coming back.
 *
 * =============================================================================
 * ⚠ THE TEST ENDPOINTS ANSWER 200 WHEN THE ANSWER IS BAD
 * =============================================================================
 *
 * `POST /admin/ai/providers/:p/test` always returns HTTP 200; the outcome is
 * in the body's `success` and per-check `status`. A caller that reads only
 * the status code reports success for every rejected key.
 */
import { api, API_BASE_URL } from './api';
import { postSse } from './sse';

// =============================================================================
// Shared vocabulary
// =============================================================================

/**
 * Whose key pays for a call. `byok` — each user must bring their own;
 * `byok_with_org_fallback` — a user without a key falls back to the
 * organisation's key for that provider.
 */
export const AI_KEY_POLICIES = ['byok', 'byok_with_org_fallback'] as const;
export type AiKeyPolicy = (typeof AI_KEY_POLICIES)[number];

/**
 * The machine-readable codes the AI API answers with (`ApiError.code`).
 * Mirrors `AI_ERROR_STATUS` in `apps/api/src/ai/core/ai-error.ts` (#424).
 */
export const AI_ERROR_CODES = [
  'AI_DISABLED',
  'AI_PROVIDER_DISABLED',
  'AI_KEY_REQUIRED',
  'AI_KEY_INVALID',
  'AI_MODEL_NOT_ENABLED',
  'AI_MODEL_NOT_REACHABLE',
  'AI_CAPABILITY_UNSUPPORTED',
  'AI_RATE_LIMITED',
  'AI_PROVIDER_UNAVAILABLE',
  'AI_CONTENT_FILTERED',
  'AI_INVALID_REQUEST',
  'AI_STRUCTURED_OUTPUT_INVALID',
] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

/** Confirmation literal the admin key DELETE requires (same idiom as push). */
export const AI_KEY_REMOVE_CONFIRMATION = 'REMOVE';

// =============================================================================
// Configuration
// =============================================================================

/** `GET /ai/config` — what every authenticated user may know. */
export interface AiPublicConfig {
  enabled: boolean;
  keyPolicy: AiKeyPolicy;
  /** Empty while `enabled` is false. */
  providers: { id: string; displayName: string; enabled: boolean; hasOrgKey: boolean }[];
}

/** Masked status of a stored credential — never the credential itself. */
export interface SecretStatus {
  configured: boolean;
  hint: string | null;
  updatedAt: string | null;
  updatedByUserId: string | null;
}

export interface AiAdminProvider {
  id: string;
  displayName: string;
  enabled: boolean;
  baseUrl?: string;
  keyStatus: SecretStatus;
  supportedCapabilities: string[];
}

/** `GET /admin/ai/config`. */
export interface AiAdminConfig {
  enabled: boolean;
  keyPolicy: AiKeyPolicy;
  logPromptContent: boolean;
  defaults: { maxOutputTokensCap?: number; allowBackgroundRuns: boolean };
  providers: AiAdminProvider[];
  version: number;
  updatedAt: string | null;
  updatedBy?: { id: string; email: string } | null;
  /** Present on a key deletion that leaves an org-fallback policy keyless. */
  warnings?: string[];
}

/** `PUT /admin/ai/config` body. Providers are keyed by id. */
export interface AiAdminConfigInput {
  enabled: boolean;
  keyPolicy: AiKeyPolicy;
  logPromptContent: boolean;
  defaults: { maxOutputTokensCap?: number; allowBackgroundRuns: boolean };
  providers: Record<string, { enabled: boolean; baseUrl?: string }>;
}

export interface AiProbeCheck {
  id: string;
  label: string;
  status: 'passed' | 'failed' | 'skipped';
  code: string | null;
  detail: string | null;
  error: string | null;
}

/** `POST /admin/ai/providers/:p/test` and `POST /ai/keys/:p/test` — always 200. */
export interface AiProbeResult {
  success: boolean;
  provider: string;
  usedStoredKey: boolean;
  checks: AiProbeCheck[];
  attemptedAt: string;
}

// =============================================================================
// Models
// =============================================================================

export interface AiModelCapabilities {
  capabilities: string[];
  inputModalities: string[];
  outputModalities: string[];
  reasoningEfforts?: string[];
  contextWindow?: number;
  maxOutputTokens?: number;
}

/** A row of the organisation's model catalogue (`/admin/ai/models`). */
export interface AiModel {
  id: string;
  provider: string;
  modelId: string;
  displayName: string | null;
  capabilities: AiModelCapabilities;
  capabilitySource: 'catalog' | 'admin_override' | 'unclassified';
  enabled: boolean;
  deprecatedAt: string | null;
  lastSeenAt: string;
}

export interface AiModelListFilter {
  provider?: string;
  capability?: string;
  enabled?: boolean;
  includeDeprecated?: boolean;
  q?: string;
  page?: number;
  pageSize?: number;
}

/** Paginated like `GET /admin/jobs`. */
export interface AiModelListResponse {
  items: AiModel[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface AiModelUpdateInput {
  enabled?: boolean;
  displayName?: string | null;
  capabilities?: AiModelCapabilities;
}

// =============================================================================
// Per-user keys and usable models
// =============================================================================

/** The caller's own key for one provider, masked. */
export interface UserAiKey {
  provider: string;
  configured: boolean;
  hint: string | null;
  verifiedAt: string | null;
  lastErrorCode: string | null;
  reachableModelCount: number;
  reachableCheckedAt: string | null;
}

/** A model this caller can actually call right now, and whose key pays. */
export interface UsableAiModel {
  provider: string;
  modelId: string;
  displayName: string | null;
  capabilities: AiModelCapabilities;
  keySource: 'user' | 'org';
}

// =============================================================================
// Responses and runs
// =============================================================================

export type AiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; url?: string; storageObjectId?: string; detail?: 'low' | 'high' | 'auto' }
  | { type: 'file'; storageObjectId?: string; url?: string; filename?: string };

export type AiInputItem =
  | {
      type: 'message';
      role: 'user' | 'assistant' | 'system' | 'developer';
      content: AiContentPart[];
    }
  | { type: 'function_call_output'; callId: string; output: string };

/**
 * `POST /ai/responses` (and `/stream`, `/ai/runs`) body. HTTP callers send a
 * JSON Schema for structured output, never Zod; function tools are not
 * accepted over HTTP in Phase 1.
 */
export interface AiResponseRequest {
  provider?: string;
  model?: string;
  instructions?: string;
  input: string | AiInputItem[];
  structuredOutput?: { name: string; jsonSchema: object; strict?: boolean };
  reasoning?: {
    effort?: 'minimal' | 'low' | 'medium' | 'high';
    summary?: 'auto' | 'concise' | 'detailed';
  };
  maxOutputTokens?: number;
  temperature?: number;
  previousResponseId?: string;
  metadata?: Record<string, string>;
  providerOptions?: Record<string, Record<string, unknown>>;
}

export type AiOutputItem =
  | { type: 'message'; text: string }
  | { type: 'reasoning'; summary: string[] }
  | { type: 'function_call'; callId: string; name: string; arguments: string }
  | { type: 'hosted_tool_call'; tool: string; status: string; result?: unknown };

export interface AiUsage {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
}

export interface AiResponse<T = unknown> {
  id: string;
  provider: string;
  model: string;
  output: AiOutputItem[];
  outputText: string;
  parsed?: T;
  usage: AiUsage;
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error';
  providerRequestId?: string;
}

/** One SSE frame of `POST /ai/responses/stream`; `type` is the frame's `event:`. */
export type AiStreamEvent =
  | { type: 'response.created'; id: string }
  | { type: 'output_text.delta'; delta: string }
  | { type: 'reasoning_summary.delta'; delta: string }
  | { type: 'function_call.arguments.delta'; callId: string; delta: string }
  | { type: 'output_item.done'; item: AiOutputItem }
  | { type: 'response.completed'; response: AiResponse }
  | { type: 'error'; code: AiErrorCode; message: string };

export type AiRunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

/** `POST /ai/runs` — 202. */
export interface AiRunStarted {
  runId: string;
  jobId: string;
}

/** `GET /ai/runs/:id` — scoped to the caller. */
export interface AiRun {
  id: string;
  status: AiRunStatus;
  provider: string;
  modelId: string;
  output: AiResponse | null;
  errorCode: string | null;
  createdAt: string;
  completedAt: string | null;
}

// =============================================================================
// Calls — public configuration
// =============================================================================

export async function getAiConfig(): Promise<AiPublicConfig> {
  return api.get<AiPublicConfig>('/ai/config');
}

// =============================================================================
// Calls — administration (`ai_config:*`)
// =============================================================================

const ADMIN = '/admin/ai';

export async function getAiAdminConfig(): Promise<AiAdminConfig> {
  return api.get<AiAdminConfig>(`${ADMIN}/config`);
}

/**
 * Replace the configuration. `expectedVersion` travels as `If-Match`; a stale
 * version answers 409, exactly like the storage configuration.
 */
export async function updateAiAdminConfig(
  input: AiAdminConfigInput,
  expectedVersion?: number,
): Promise<AiAdminConfig> {
  return api.put<AiAdminConfig>(`${ADMIN}/config`, input, {
    headers:
      expectedVersion === undefined ? undefined : { 'If-Match': String(expectedVersion) },
  });
}

/** Store the organisation key for a provider. Verified first; 400 `AI_KEY_INVALID` stores nothing. */
export async function setAiProviderKey(
  provider: string,
  apiKey: string,
): Promise<AiAdminConfig> {
  return api.put<AiAdminConfig>(
    `${ADMIN}/providers/${encodeURIComponent(provider)}/key`,
    { apiKey },
  );
}

export async function deleteAiProviderKey(provider: string): Promise<AiAdminConfig> {
  return api.delete<AiAdminConfig>(`${ADMIN}/providers/${encodeURIComponent(provider)}/key`, {
    body: JSON.stringify({ confirmation: AI_KEY_REMOVE_CONFIRMATION }),
  });
}

/** Probe a provider. Blank `apiKey` means "use the stored key". Always 200 — read `success`. */
export async function testAiProvider(
  provider: string,
  input: { apiKey?: string; baseUrl?: string } = {},
): Promise<AiProbeResult> {
  return api.post<AiProbeResult>(
    `${ADMIN}/providers/${encodeURIComponent(provider)}/test`,
    stripBlank(input),
  );
}

export async function listAiModels(filter: AiModelListFilter = {}): Promise<AiModelListResponse> {
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

export async function updateAiModel(id: string, input: AiModelUpdateInput): Promise<AiModel> {
  return api.patch<AiModel>(`${ADMIN}/models/${encodeURIComponent(id)}`, input);
}

/** Enqueue a catalogue refresh for one provider. 409 when it has no org key. */
export async function refreshAiModels(provider: string): Promise<{ jobId: string }> {
  return api.post<{ jobId: string }>(`${ADMIN}/models/refresh`, { provider });
}

// =============================================================================
// Calls — the caller's own keys and models (`ai:use`)
// =============================================================================

export async function listUserAiKeys(): Promise<UserAiKey[]> {
  return api.get<UserAiKey[]>('/ai/keys');
}

export async function setUserAiKey(provider: string, apiKey: string): Promise<UserAiKey> {
  return api.put<UserAiKey>(`/ai/keys/${encodeURIComponent(provider)}`, { apiKey });
}

export async function deleteUserAiKey(provider: string): Promise<void> {
  await api.delete<void>(`/ai/keys/${encodeURIComponent(provider)}`);
}

/** Probe the caller's stored key, or `apiKey` when given. Always 200 — read `success`. */
export async function testUserAiKey(provider: string, apiKey?: string): Promise<AiProbeResult> {
  return api.post<AiProbeResult>(
    `/ai/keys/${encodeURIComponent(provider)}/test`,
    stripBlank({ apiKey }),
  );
}

export async function listUsableAiModels(): Promise<UsableAiModel[]> {
  return api.get<UsableAiModel[]>('/ai/models');
}

// =============================================================================
// Calls — responses and background runs (`ai:use`)
// =============================================================================

export async function createAiResponse(req: AiResponseRequest): Promise<AiResponse> {
  return api.post<AiResponse>('/ai/responses', req);
}

/** Callbacks for {@link streamAiResponse}. Every one is optional. */
export interface AiStreamHandlers {
  /** Every event, in order, before the typed callbacks below. */
  onEvent?: (event: AiStreamEvent) => void;
  /** Each `output_text.delta` — append to the visible answer. */
  onTextDelta?: (delta: string) => void;
  /** Each `reasoning_summary.delta`. */
  onReasoningDelta?: (delta: string) => void;
  /** The final `response.completed`. */
  onCompleted?: (response: AiResponse) => void;
  /** An `error` event — a failure AFTER streaming began. */
  onError?: (code: AiErrorCode, message: string) => void;
}

/** Where the stream is POSTed, resolved against the same base as every call. */
export const AI_STREAM_URL = `${API_BASE_URL}/ai/responses/stream`;

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
 */
export async function streamAiResponse(
  req: AiResponseRequest,
  handlers: AiStreamHandlers = {},
  signal?: AbortSignal,
): Promise<AiResponse | null> {
  let completed: AiResponse | null = null;

  await postSse<Record<string, unknown>>({
    url: AI_STREAM_URL,
    body: req,
    authorization: () => {
      const token = api.getAccessToken();
      return token ? `Bearer ${token}` : null;
    },
    reauthenticate: () => api.refreshToken(),
    signal,
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

export async function createAiRun(req: AiResponseRequest): Promise<AiRunStarted> {
  return api.post<AiRunStarted>('/ai/runs', req);
}

export async function getAiRun(id: string): Promise<AiRun> {
  return api.get<AiRun>(`/ai/runs/${encodeURIComponent(id)}`);
}

export async function cancelAiRun(id: string): Promise<AiRun> {
  return api.post<AiRun>(`/ai/runs/${encodeURIComponent(id)}/cancel`);
}

// =============================================================================
// Helpers
// =============================================================================

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

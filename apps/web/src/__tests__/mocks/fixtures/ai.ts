/**
 * Shared AI fixtures — issue #425, epic #419.
 *
 * The default MSW handlers (`../handlers.ts`) answer every Phase 1 AI route
 * from these, and the page stories built in parallel (#429 admin pages, #430
 * AI Keys, #434 Playground) import them rather than inventing their own, so
 * every AI test in the web app agrees on what a realistic answer looks like.
 * Shapes follow the API contracts in #428 (admin), #431 (keys/models) and
 * #433 (responses/runs); types are the web client's own (`services/ai.ts`).
 *
 * `GET /ai/config` answers DISABLED by default — a fresh deployment. A test
 * that needs AI on overrides it:
 *
 *   server.use(http.get('*\/api/ai/config', () => HttpResponse.json({ data: mockAiPublicConfigEnabled })));
 *
 * or, for components under the shell provider, renders with
 * `wrapperOptions: { aiEnabled: true }` (see `utils/test-utils.tsx`).
 *
 * NO FIXTURE CARRIES A KEY. Masked hints only, exactly as the API answers.
 */
import type {
  AiAdminConfig,
  AiModel,
  AiModelListResponse,
  AiProbeResult,
  AiPublicConfig,
  AiResponse,
  AiRun,
  AiStreamEvent,
  UsableAiModel,
  UserAiKey,
} from '../../../services/ai';

const T0 = '2026-09-01T12:00:00.000Z';

export const mockAiPublicConfigDisabled: AiPublicConfig = {
  enabled: false,
  keyPolicy: 'byok',
  providers: [],
};

export const mockAiPublicConfigEnabled: AiPublicConfig = {
  enabled: true,
  keyPolicy: 'byok_with_org_fallback',
  providers: [{ id: 'openai', displayName: 'OpenAI', enabled: true, hasOrgKey: true }],
};

export const mockAiAdminConfig: AiAdminConfig = {
  enabled: false,
  keyPolicy: 'byok',
  logPromptContent: false,
  defaults: { maxOutputTokensCap: 4096, allowBackgroundRuns: true },
  providers: [
    {
      id: 'openai',
      displayName: 'OpenAI',
      enabled: false,
      keyStatus: {
        configured: true,
        hint: '••••abcd',
        updatedAt: T0,
        updatedByUserId: 'admin-user-id',
      },
      supportedCapabilities: [
        'text',
        'vision',
        'structured_output',
        'function_tools',
        'reasoning',
        'streaming',
      ],
    },
  ],
  version: 3,
  updatedAt: T0,
  updatedBy: { id: 'admin-user-id', email: 'admin@example.com' },
};

export const mockAiProbeResultPassed: AiProbeResult = {
  success: true,
  provider: 'openai',
  usedStoredKey: true,
  checks: [
    { id: 'credentials', label: 'Credentials', status: 'passed', code: 'ok', detail: 'Key accepted', error: null },
    { id: 'list_models', label: 'List models', status: 'passed', code: 'ok', detail: '42 models', error: null },
    {
      id: 'responses_smoke',
      label: 'Responses smoke test',
      status: 'skipped',
      code: 'not_attempted',
      detail: 'No cheap enabled text model',
      error: null,
    },
  ],
  attemptedAt: T0,
};

export const mockAiProbeResultFailed: AiProbeResult = {
  success: false,
  provider: 'openai',
  usedStoredKey: false,
  checks: [
    {
      id: 'credentials',
      label: 'Credentials',
      status: 'failed',
      code: 'AI_KEY_INVALID',
      detail: 'The provider rejected this key',
      error: 'Incorrect API key provided',
    },
    { id: 'list_models', label: 'List models', status: 'skipped', code: 'not_attempted', detail: null, error: null },
    { id: 'responses_smoke', label: 'Responses smoke test', status: 'skipped', code: 'not_attempted', detail: null, error: null },
  ],
  attemptedAt: T0,
};

export const mockAiModels: AiModel[] = [
  {
    id: 'model-1',
    provider: 'openai',
    modelId: 'gpt-5-mini',
    displayName: 'GPT-5 mini',
    capabilities: {
      capabilities: ['text', 'vision', 'structured_output', 'function_tools', 'reasoning', 'streaming'],
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      reasoningEfforts: ['minimal', 'low', 'medium', 'high'],
      contextWindow: 400000,
      maxOutputTokens: 128000,
    },
    capabilitySource: 'catalog',
    enabled: true,
    deprecatedAt: null,
    lastSeenAt: T0,
  },
  {
    id: 'model-2',
    provider: 'openai',
    modelId: 'text-embedding-3-small',
    displayName: null,
    capabilities: {
      capabilities: ['embeddings'],
      inputModalities: ['text'],
      outputModalities: ['embedding'],
    },
    capabilitySource: 'catalog',
    enabled: false,
    deprecatedAt: null,
    lastSeenAt: T0,
  },
  {
    id: 'model-3',
    provider: 'openai',
    modelId: 'ft:custom-model',
    displayName: null,
    capabilities: { capabilities: [], inputModalities: [], outputModalities: [] },
    capabilitySource: 'unclassified',
    enabled: false,
    deprecatedAt: null,
    lastSeenAt: T0,
  },
];

export const mockAiModelList: AiModelListResponse = {
  items: mockAiModels,
  total: mockAiModels.length,
  page: 1,
  pageSize: 20,
  totalPages: 1,
};

export const mockUserAiKeys: UserAiKey[] = [
  {
    provider: 'openai',
    configured: true,
    hint: '••••wxyz',
    verifiedAt: T0,
    lastErrorCode: null,
    reachableModelCount: 12,
    reachableCheckedAt: T0,
  },
];

export const mockUsableAiModels: UsableAiModel[] = [
  {
    provider: 'openai',
    modelId: 'gpt-5-mini',
    displayName: 'GPT-5 mini',
    capabilities: mockAiModels[0].capabilities,
    keySource: 'user',
  },
];

export const mockAiResponse: AiResponse = {
  id: 'resp_123',
  provider: 'openai',
  model: 'gpt-5-mini',
  output: [{ type: 'message', text: 'Hello! How can I help?' }],
  outputText: 'Hello! How can I help?',
  usage: { inputTokens: 9, outputTokens: 7 },
  finishReason: 'stop',
  providerRequestId: 'req_abc',
};

/** The frames `POST /ai/responses/stream` sends for {@link mockAiResponse}, in order. */
export const mockAiStreamEvents: AiStreamEvent[] = [
  { type: 'response.created', id: 'resp_123' },
  { type: 'output_text.delta', delta: 'Hello! ' },
  { type: 'output_text.delta', delta: 'How can I help?' },
  { type: 'output_item.done', item: { type: 'message', text: 'Hello! How can I help?' } },
  { type: 'response.completed', response: mockAiResponse },
];

/** Serialise events the way the API does: `event: <type>\ndata: <json>\n\n`. */
export function toSseBody(events: AiStreamEvent[]): string {
  return events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
}

export const mockAiRun: AiRun = {
  id: 'run_1',
  status: 'succeeded',
  provider: 'openai',
  modelId: 'gpt-5-mini',
  output: mockAiResponse,
  errorCode: null,
  createdAt: T0,
  completedAt: T0,
};

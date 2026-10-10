import type { PluggableDescriptor } from '@marinoscar/platform-contract/settings';

// =============================================================================
// Shared vocabulary
// =============================================================================

/**
 * Whose key pays for a call. `byok` — each user must bring their own;
 * `byok_with_org_fallback` — a user without a key falls back to the
 * organisation's key for that provider.
 
 *
 * @stability experimental
 */
export const AI_KEY_POLICIES = ['byok', 'byok_with_org_fallback'] as const;
/**
 * The AI key policy type.
 *
 * @stability experimental
 */
export type AiKeyPolicy = (typeof AI_KEY_POLICIES)[number];

/**
 * The machine-readable codes the AI API answers with (`ApiError.code`).
 * Mirrors `AI_ERROR_STATUS` in `apps/api/src/ai/core/ai-error.ts` (#424).
 
 *
 * @stability experimental
 */
export const AI_ERROR_CODES = [
  'AI_DISABLED',
  'AI_REALTIME_DISABLED',
  'AI_PROVIDER_DISABLED',
  'AI_KEY_REQUIRED',
  'AI_KEY_INVALID',
  'AI_MODEL_NOT_ENABLED',
  'AI_MODEL_NOT_REACHABLE',
  'AI_CAPABILITY_UNSUPPORTED',
  'AI_TOOL_DISABLED',
  'AI_RATE_LIMITED',
  'AI_PROVIDER_UNAVAILABLE',
  'AI_CONTENT_FILTERED',
  'AI_INVALID_REQUEST',
  'AI_STRUCTURED_OUTPUT_INVALID',
  'AI_STORAGE_UNAVAILABLE',
] as const;
/**
 * The AI error code type.
 *
 * @stability experimental
 */
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

/**
 * Confirmation literal the admin key DELETE requires (same idiom as push).
 *
 * @stability experimental
 */
export const AI_KEY_REMOVE_CONFIRMATION = 'REMOVE';

// =============================================================================
// Configuration
// =============================================================================

/**
 * `GET /ai/config` — what every authenticated user may know.
 *
 * @stability experimental
 */
export interface AiPublicConfig {
  /** Whether enabled. */
  enabled: boolean;
  /** The key policy. */
  keyPolicy: AiKeyPolicy;
  /** Empty while `enabled` is false. */
  providers: {
    /** The id. */
    id: string;
    /** The display name. */
    displayName: string;
    /** Whether enabled. */
    enabled: boolean;
    /** Whether org key. */
    hasOrgKey: boolean;
    /**
     * Whether a request may continue a conversation by `previousResponseId`
     * (#446). `false` for a stateless provider (Anthropic): send the
     * conversation so far as `input` instead, or the API answers 400
     * `AI_CAPABILITY_UNSUPPORTED`. Optional so an older API that omits it
     * still works — absent means chain, the pre-#446 behaviour.
     */
    supportsPreviousResponseId?: boolean;
    /**
     * Whether calling this provider needs a key (#448). `false` only for an
     * OpenAI-compatible server the administrator marked keyless: nobody adds
     * a key for it and its calls are recorded with `keySource: 'none'`.
     * Optional so an older API that omits it still works — absent means a key
     * is needed, the pre-#448 behaviour. Test with `=== false`.
     */
    requiresKey?: boolean;
  }[];
  /**
   * `defaults.allowBackgroundRuns` (#433): whether `POST /ai/runs` accepts a
   * request; always `false` while `enabled` is false. Optional so an older API
   * that omits it still works — absent means "unknown": the playground offers
   * background runs, handles a refusal, and hides them only on `false`.
   */
  allowBackgroundRuns?: boolean;
  /**
   * `defaults.allowRealtime` (#449): whether `POST /ai/realtime/sessions`
   * mints a voice session; always `false` while `enabled` is false. Optional
   * so an older API that omits it still works — absent means "off": the
   * playground offers Voice only on an explicit `true`.
   */
  allowRealtime?: boolean;
  /**
   * Which provider-hosted tools an administrator has switched on (#442); all
   * false while `enabled` is false. Offer a tool only when its flag is true —
   * a request naming a disabled one is `403 AI_TOOL_DISABLED`. Optional so an
   * older API that omits it still works: absent means "none".
   */
  hostedTools?: Record<AiHostedToolType, boolean>;
  /**
   * Whether users may pick their own default model (#739). `false` in an app
   * whose AI features pick their model themselves: hide the picker. Optional
   * so an older API that omits it still works — absent means `true`.
   */
  perUserDefaultModel?: boolean;
}

/**
 * The provider-hosted tool types (#442).
 *
 * @stability experimental
 */
export const AI_HOSTED_TOOL_TYPES = [
  'web_search',
  'file_search',
  'code_interpreter',
  'image_generation',
  'mcp',
] as const;
/**
 * The AI hosted tool type type.
 *
 * @stability experimental
 */
export type AiHostedToolType = (typeof AI_HOSTED_TOOL_TYPES)[number];

/**
 * `ai.hostedTools` — each hosted tool's switch, plus the MCP host allowlist (admin only).
 *
 * @stability experimental
 */
export type AiHostedToolsSettings = Record<AiHostedToolType, boolean> & {
  /** `mcp.example.com` or `*.example.com`; empty means any `https://` host. */
  mcpAllowedHosts: string[];
};

/**
 * One model's `ai.limits.perModel` entry (#450). `maxOutputTokens` clamps
 * every call to the model (the smaller of it and `defaults.maxOutputTokensCap`
 * wins); `requestsPerMinutePerUser` limits each user's calls to it.
 
 *
 * @stability experimental
 */
export interface AiModelLimits {
  /** The max output tokens. */
  maxOutputTokens?: number;
  /** The requests per minute per user. */
  requestsPerMinutePerUser?: number;
}

/**
 * `ai.limits` (#450) — rate limits and output caps. Every field is optional
 * and ABSENT MEANS UNLIMITED; `{}` is "no limits at all". Each value is an
 * integer from 1 to {@link AI_LIMIT_MAX}.
 
 *
 * @stability experimental
 */
export interface AiLimits {
  /** Every inference call a user makes, whoever's key pays. */
  perUser?: {
    /** The requests per minute. */
    requestsPerMinute?: number;
    /** The requests per day. */
    requestsPerDay?: number;
  };
  /** Only calls the organization key pays for. */
  orgKey?: {
    /** The requests per day per user. */
    requestsPerDayPerUser?: number;
    /** The tokens per day per user. */
    tokensPerDayPerUser?: number;
  };
  /** Keyed `<provider>:<modelId>` — see {@link aiModelLimitKey}. At most 500 entries. */
  perModel?: Record<string, AiModelLimits>;
  /** Each organization's whole daily volume, whoever's key pays (#739). */
  perOrg?: {
    /** The requests per day. */
    requestsPerDay?: number;
    /** The output tokens per day. */
    outputTokensPerDay?: number;
  };
}

/**
 * The largest value any `ai.limits` field accepts.
 *
 * @stability experimental
 */
export const AI_LIMIT_MAX = 1_000_000_000;

/**
 * A `limits.perModel` key: `<provider>:<modelId>`.
 *
 * @stability experimental
 */
export function aiModelLimitKey(provider: string, modelId: string): string {
  return `${provider}:${modelId}`;
}

/**
 * Masked status of a stored credential — never the credential itself.
 *
 * @stability experimental
 */
export interface SecretStatus {
  /** Whether configured. */
  configured: boolean;
  /** The hint. */
  hint: string | null;
  /** When updated happened (ISO-8601). */
  updatedAt: string | null;
  /** The updated by user id. */
  updatedByUserId: string | null;
}

/**
 * The AI admin provider wire shape.
 *
 * @stability experimental
 */
export interface AiAdminProvider {
  /** The id. */
  id: string;
  /** The display name. */
  displayName: string;
  /**
   * Whether this build has an adapter for the provider. `false` for a
   * provider that exists only as a settings key (a removed adapter): it can
   * be switched off but not on (`400 AI_PROVIDER_NOT_REGISTERED`).
   */
  registered: boolean;
  /**
   * `false` for a registered adapter that has no settings slot yet (#921): the
   * page lists it read-only and never sends it back on save. Absent (an older
   * API, or any provider with a slot) means configurable.
   */
  configurable?: boolean;
  /** Whether enabled. */
  enabled: boolean;
  /**
   * The operator's endpoint override; `null` means the provider's default.
   * For `azure-openai` it is the resource endpoint
   * (`https://<resource>.openai.azure.com`); for `openai-compatible` the API
   * root, `/v1` included. Both need one before they can be enabled (#448).
   */
  baseUrl: string | null;
  /**
   * The settings fields this provider accepts besides `enabled` (#448). A
   * form renders exactly these, and the `PUT` sends exactly these — a field a
   * provider does not list is `400 AI_PROVIDER_FIELD_UNSUPPORTED`. Optional
   * so an older API that omits it still works — absent means `['baseUrl']`.
   */
  settingsFields?: AiProviderSettingsField[];
  /**
   * The provider's settings as stored, besides `enabled`: the values of
   * exactly the `settingsFields` (PP-14.6, #924). A provider an app or package
   * registered with `registerAiProvider` has only these (no typed field
   * below); read its values from here. Absent from an API older than #924.
   */
  settings?: Record<string, unknown>;
  /**
   * Whether the provider cannot be enabled before its `baseUrl` is set (it has
   * no default host). Absent from an API older than #924 — read as `false`.
   */
  requiresBaseUrl?: boolean;
  /** The provider's own help texts for its key and endpoint fields, when it declares any (#924). */
  help?: AiProviderHelp;
  /** Azure OpenAI `api-version`; `null` for the default ({@link AI_AZURE_DEFAULT_API_VERSION}). */
  apiVersion?: string | null;
  /** Wire API; `null` for the provider's default (see {@link aiDefaultApiStyle}). */
  apiStyle?: AiApiStyle | null;
  /** Azure OpenAI model id to deployment name; `null` when none is configured. */
  deployments?: Record<string, string> | null;
  /** OpenAI-compatible: whether calls need a key; `null` for the default (`true`). */
  requiresKey?: boolean | null;
  /** The key status. */
  keyStatus: SecretStatus;
  /** The supported capabilities. */
  supportedCapabilities: string[];
}

/**
 * The help texts a provider's definition declares (PP-14.6, #924).
 *
 * @stability experimental
 */
export interface AiProviderHelp {
  /** Under the key field. */
  key?: string;
  /** Under the endpoint (`baseUrl`) field. */
  baseUrl?: string;
}

/**
 * The settings fields the five built-in providers carry (#448); the form
 * models and the bespoke cards know these by name.
 *
 * @stability experimental
 */
export type BuiltinAiProviderSettingsField =
  'baseUrl' | 'apiVersion' | 'apiStyle' | 'deployments' | 'requiresKey';

/**
 * A provider settings field besides `enabled` — `AiAdminProvider.settingsFields`.
 * Any string since #924 (PP-14.6): a provider an app registered declares its
 * own; the built-ins' are {@link BuiltinAiProviderSettingsField}.
 *
 * @stability experimental
 */
export type AiProviderSettingsField = string;

const BUILTIN_SETTINGS_FIELDS: ReadonlySet<string> = new Set<BuiltinAiProviderSettingsField>([
  'baseUrl',
  'apiVersion',
  'apiStyle',
  'deployments',
  'requiresKey',
]);

/**
 * Whether `field` is one of the five built-in providers' named settings
 * ({@link BuiltinAiProviderSettingsField}); any other is a provider's own.
 *
 * @param field - a settings field name.
 * @stability experimental
 */
export function isBuiltinAiProviderSettingsField(field: string): field is BuiltinAiProviderSettingsField {
  return BUILTIN_SETTINGS_FIELDS.has(field);
}

/**
 * Which wire API an OpenAI-shaped adapter speaks (#448).
 *
 * @stability experimental
 */
export type AiApiStyle = 'responses' | 'chat_completions';

/**
 * Azure OpenAI's `api-version` when none is set — mirrors the API's default.
 *
 * @stability experimental
 */
export const AI_AZURE_DEFAULT_API_VERSION = '2025-04-01-preview';

/**
 * Most Azure deployments one provider accepts — mirrors the API's cap.
 *
 * @stability experimental
 */
export const AI_AZURE_DEPLOYMENTS_MAX = 200;

/**
 * An Azure `api-version` or deployment name: a letter or digit, then up to 63
 * of letters, digits, `.`, `_`, `-`. Mirrors the API's own pattern.
 
 *
 * @stability experimental
 */
export const AI_AZURE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * Longest model id a `deployments` entry may map — mirrors the API.
 *
 * @stability experimental
 */
export const AI_AZURE_MODEL_ID_MAX = 256;

/**
 * The `apiStyle` a provider uses while its own is unset (`null`).
 *
 * @stability experimental
 */
export function aiDefaultApiStyle(providerId: string): AiApiStyle {
  return providerId === 'openai-compatible' ? 'chat_completions' : 'responses';
}

/**
 * The fields a provider's form renders and its `PUT` entry carries; `['baseUrl']` from an older API.
 *
 * @stability experimental
 */
export function aiProviderSettingsFields(
  provider: Pick<AiAdminProvider, 'settingsFields'>
): AiProviderSettingsField[] {
  return provider.settingsFields ?? ['baseUrl'];
}

/**
 * One provider's entry in the `PUT` body. Only `enabled` plus that provider's `settingsFields`.
 *
 * @stability experimental
 */
export interface AiProviderSettingsInput {
  /** Whether enabled. */
  enabled: boolean;
  /** The base url. */
  baseUrl?: string | null;
  /** The api version. */
  apiVersion?: string | null;
  /** The api style. */
  apiStyle?: AiApiStyle | null;
  /** The deployments. */
  deployments?: Record<string, string> | null;
  /** Whether requires key. */
  requiresKey?: boolean | null;
  /** A setting only a provider an app registered declares (#924); sent as is. */
  [setting: string]: unknown;
}

/**
 * A provider's `PUT` entry: `enabled`, plus ONLY the fields its
 * `settingsFields` lists — any other is `400 AI_PROVIDER_FIELD_UNSUPPORTED`.
 * `baseUrl` is always sent (a `null` clears it, the pre-#448 shape the three
 * built-in providers keep exactly); the other fields are omitted when unset,
 * which the full-replace `PUT` reads as "back to the default".
 
 *
 * @stability experimental
 */
export function aiProviderSettingsToInput(
  provider: Pick<AiAdminProvider, 'settingsFields'>,
  values: {
    /** Whether enabled. */
    enabled: boolean;
    /** The base url. */
    baseUrl: string | null;
    /** The api version. */
    apiVersion?: string | null;
    /** The api style. */
    apiStyle?: AiApiStyle | null;
    /** The deployments. */
    deployments?: Record<string, string> | null;
    /** Whether requires key. */
    requiresKey?: boolean | null;
    /**
     * The values of the provider's OWN settings (#924), by field name: the
     * ones its `settingsFields` lists beyond the five built-in names. An
     * empty (`undefined`, `null`, `''`) value is left out, the provider default.
     */
    own?: Record<string, unknown> | undefined;
  }
): AiProviderSettingsInput {
  const fields = aiProviderSettingsFields(provider);
  const input: AiProviderSettingsInput = { enabled: values.enabled };
  if (fields.includes('baseUrl')) input.baseUrl = values.baseUrl?.trim() || null;
  if (fields.includes('apiVersion') && values.apiVersion?.trim())
    input.apiVersion = values.apiVersion.trim();
  if (fields.includes('apiStyle') && values.apiStyle) input.apiStyle = values.apiStyle;
  if (
    fields.includes('deployments') &&
    values.deployments &&
    Object.keys(values.deployments).length > 0
  ) {
    input.deployments = { ...values.deployments };
  }
  if (fields.includes('requiresKey') && typeof values.requiresKey === 'boolean') {
    input.requiresKey = values.requiresKey;
  }
  for (const field of fields) {
    if (isBuiltinAiProviderSettingsField(field)) continue;
    const own = values.own?.[field];
    if (own !== undefined && own !== null && own !== '') input[field] = own;
  }
  return input;
}

/**
 * `GET /admin/ai/config`.
 *
 * @stability experimental
 */
export interface AiAdminConfig {
  /** Whether enabled. */
  enabled: boolean;
  /** The key policy. */
  keyPolicy: AiKeyPolicy;
  /** Whether log prompt content. */
  logPromptContent: boolean;
  /**
   * `maxOutputTokensCap: null` means no cap. `allowRealtime` (#449) is absent
   * from an older API — read as off.
   */
  defaults: {
    /** The max output tokens cap. */
    maxOutputTokensCap: number | null;
    /** Whether allow background runs. */
    allowBackgroundRuns: boolean;
    /** Whether allow realtime. */
    allowRealtime?: boolean;
  };
  /** Absent from an API older than #442 — read as every tool off. */
  hostedTools?: AiHostedToolsSettings;
  /** Rate limits and output caps (#450); `{}` — or absent, from an older API — means unlimited. */
  limits?: AiLimits;
  /**
   * Whether the deployment's provider keys pay for calls in an organization
   * with no key of its own (#739). Absent from an older API — read as `true`.
   */
  deploymentKeyServesOrgs?: boolean;
  /** The providers. */
  providers: AiAdminProvider[];
  /**
   * One generated-form description per provider that has a definition, in the
   * order of `providers` (PP-14.6, #924): `enabled`, the provider's settings
   * fields, then a write-only `apiKey` secret when it needs a key. Absent from
   * an API older than #924.
   */
  descriptors?: PluggableDescriptor[];
  /** The version. */
  version: number;
  /** When updated happened (ISO-8601). */
  updatedAt: string | null;
  /** The updated by. */
  updatedBy: {
    /** The id. */
    id: string;
    /** The email. */
    email: string;
  } | null;
}

/**
 * `DELETE /admin/ai/providers/:p/key` — the config view plus warnings.
 *
 * @stability experimental
 */
export interface AiAdminConfigWithWarnings extends AiAdminConfig {
  /** `['ORG_FALLBACK_WITHOUT_KEY']` when an org-fallback policy is left keyless; else `[]`. */
  warnings: string[];
}

/**
 * `PUT /admin/ai/config` body — a FULL REPLACE. For every provider included,
 * an omitted, `''` or `null` `baseUrl` CLEARS the stored override, and an
 * omitted or `null` `maxOutputTokensCap` clears the cap; so a caller that
 * wants to keep either must send it. A provider left out of `providers`
 * entirely keeps its settings.
 
 *
 * @stability experimental
 */
export interface AiAdminConfigInput {
  /** Whether enabled. */
  enabled: boolean;
  /** The key policy. */
  keyPolicy: AiKeyPolicy;
  /** Whether log prompt content. */
  logPromptContent: boolean;
  /** `allowRealtime` (#449): omit to keep the stored value. */
  defaults: {
    /** The max output tokens cap. */
    maxOutputTokensCap?: number | null;
    /** Whether allow background runs. */
    allowBackgroundRuns: boolean;
    /** Whether allow realtime. */
    allowRealtime?: boolean;
  };
  /** Omit to keep the stored value (#442). */
  hostedTools?: AiHostedToolsSettings;
  /**
   * Omit to keep the stored value (#450). When sent it REPLACES the stored
   * limits wholesale — `{}` lifts every limit, and a `perModel` entry left out
   * is lifted too.
   */
  limits?: AiLimits;
  /** Omit to keep the stored value (#739). */
  deploymentKeyServesOrgs?: boolean;
  /** Each entry carries only `enabled` plus that provider's `settingsFields` — see {@link aiProviderSettingsToInput}. */
  providers: Record<string, AiProviderSettingsInput>;
}

/**
 * The `PUT` body that re-saves `config` exactly as it stands — every value
 * explicit, because the PUT is a full replace. A read-modify-write caller
 * (the model dialog's per-model limits) spreads its one change over this.
 
 *
 * @stability experimental
 */
export function aiAdminConfigToInput(config: AiAdminConfig): AiAdminConfigInput {
  const providers: AiAdminConfigInput['providers'] = {};
  for (const provider of config.providers) {
    providers[provider.id] = aiProviderSettingsToInput(provider, { ...provider, own: provider.settings });
  }
  return {
    enabled: config.enabled,
    keyPolicy: config.keyPolicy,
    logPromptContent: config.logPromptContent,
    defaults: { ...config.defaults },
    ...(config.hostedTools ? { hostedTools: config.hostedTools } : {}),
    limits: config.limits ?? {},
    ...(config.deploymentKeyServesOrgs !== undefined
      ? { deploymentKeyServesOrgs: config.deploymentKeyServesOrgs }
      : {}),
    providers,
  };
}

/**
 * `limits` with one model's `perModel` entry replaced — or removed, when
 * `entry` sets nothing. Every other entry, and `perUser`/`orgKey`/`perOrg`, is kept.
 
 *
 * @stability experimental
 */
export function withModelLimits(
  limits: AiLimits | undefined,
  key: string,
  entry: AiModelLimits
): AiLimits {
  const perModel = { ...(limits?.perModel ?? {}) };
  if (entry.maxOutputTokens === undefined && entry.requestsPerMinutePerUser === undefined) {
    delete perModel[key];
  } else {
    perModel[key] = entry;
  }
  const next: AiLimits = { ...(limits ?? {}) };
  delete next.perModel;
  if (Object.keys(perModel).length > 0) next.perModel = perModel;
  return next;
}

/**
 * The AI probe check wire shape.
 *
 * @stability experimental
 */
export interface AiProbeCheck {
  /** The id. */
  id: 'credentials' | 'list_models' | 'responses_smoke' | (string & {});
  /** The label. */
  label: string;
  /** The status. */
  status: 'passed' | 'failed' | 'skipped';
  /** The code. */
  code: string;
  /** The detail. */
  detail: string;
  /** The error. */
  error: string | null;
}

/**
 * `POST /admin/ai/providers/:p/test` and `POST /ai/keys/:p/test` — always 200.
 *
 * @stability experimental
 */
export interface AiProbeResult {
  /** Whether success. */
  success: boolean;
  /** The provider. */
  provider: string;
  /** Whether used stored key. */
  usedStoredKey: boolean;
  /** Models the key can list; `null` when listing was not reached. */
  modelCount: number | null;
  /** The model the smoke call used; `null` when it was skipped. */
  smokeModelId: string | null;
  /** The checks. */
  checks: AiProbeCheck[];
  /** When attempted happened (ISO-8601). */
  attemptedAt: string;
}

// =============================================================================
// Models
// =============================================================================

/**
 * The AI model capabilities wire shape.
 *
 * @stability experimental
 */
export interface AiModelCapabilities {
  /** The capabilities. */
  capabilities: string[];
  /** The input modalities. */
  inputModalities: string[];
  /** The output modalities. */
  outputModalities: string[];
  /** The reasoning efforts. */
  reasoningEfforts?: string[];
  /** The context window. */
  contextWindow?: number;
  /** The max output tokens. */
  maxOutputTokens?: number;
  /** The voices an `audio_speech` model speaks in (#439), in the provider's order. */
  voices?: string[];
}

/**
 * A row of the organisation's model catalogue (`/admin/ai/models`).
 *
 * @stability experimental
 */
export interface AiModel {
  /** The id. */
  id: string;
  /** The provider. */
  provider: string;
  /** The model id. */
  modelId: string;
  /** The display name. */
  displayName: string | null;
  /** `null` for an `unclassified` model nobody has described yet. */
  capabilities: AiModelCapabilities | null;
  /** The capability source. */
  capabilitySource: 'catalog' | 'admin_override' | 'unclassified';
  /** Whether enabled. */
  enabled: boolean;
  /** The context window. */
  contextWindow: number | null;
  /** The max output tokens. */
  maxOutputTokens: number | null;
  /** When discovered happened (ISO-8601). */
  discoveredAt: string;
  /** When last seen happened (ISO-8601). */
  lastSeenAt: string;
  /** Set once the provider stopped listing the model. */
  deprecatedAt: string | null;
  /** When updated happened (ISO-8601). */
  updatedAt: string;
  /** The updated by user id. */
  updatedByUserId: string | null;
}

/**
 * The AI model list filter wire shape.
 *
 * @stability experimental
 */
export interface AiModelListFilter {
  /** The provider. */
  provider?: string;
  /** The capability. */
  capability?: string;
  /** Whether enabled. */
  enabled?: boolean;
  /** Whether include deprecated. */
  includeDeprecated?: boolean;
  /** The q. */
  q?: string;
  /** The page. */
  page?: number;
  /** The page size. */
  pageSize?: number;
}

/**
 * Paginated like `GET /admin/jobs`.
 *
 * @stability experimental
 */
export interface AiModelListResponse {
  /** The items. */
  items: AiModel[];
  /** The total. */
  total: number;
  /** The page. */
  page: number;
  /** The page size. */
  pageSize: number;
  /** The total pages. */
  totalPages: number;
}

/**
 * The AI model update input wire shape.
 *
 * @stability experimental
 */
export interface AiModelUpdateInput {
  /** Whether enabled. */
  enabled?: boolean;
  /** The display name. */
  displayName?: string | null;
  /** The capabilities. */
  capabilities?: AiModelCapabilities;
}

// =============================================================================
// Per-user keys and usable models
// =============================================================================

/**
 * The caller's own key for one provider, masked.
 *
 * @stability experimental
 */
export interface UserAiKey {
  /** The provider. */
  provider: string;
  /** Whether configured. */
  configured: boolean;
  /** The hint. */
  hint: string | null;
  /** When verified happened (ISO-8601). */
  verifiedAt: string | null;
  /** The last error code. */
  lastErrorCode: string | null;
  /** The reachable model count. */
  reachableModelCount: number;
  /** When reachable checked happened (ISO-8601). */
  reachableCheckedAt: string | null;
}

/**
 * A model this caller can actually call right now, and whose key pays.
 *
 * @stability experimental
 */
export interface UsableAiModel {
  /** The provider. */
  provider: string;
  /** The model id. */
  modelId: string;
  /** The display name. */
  displayName: string | null;
  /** The capabilities. */
  capabilities: AiModelCapabilities;
  /** `'none'` (#448): a keyless server — nobody's key pays. */
  keySource: AiKeySource;
}

/**
 * Whose key paid for a call (#448 added `'none'`, a keyless server).
 *
 * @stability experimental
 */
export type AiKeySource = 'user' | 'org' | 'none';

// =============================================================================
// Responses and runs
// =============================================================================

/**
 * The AI content part type.
 *
 * @stability experimental
 */
export type AiContentPart =
  | {
      /** Which variant this is (the discriminator). */
      type: 'text';
      /** The text. */
      text: string;
    }
  | {
      /** Which variant this is (the discriminator). */
      type: 'image';
      /** The url. */
      url?: string;
      /** The storage object id. */
      storageObjectId?: string;
      /** The detail. */
      detail?: 'low' | 'high' | 'auto';
    }
  | {
      /** Which variant this is (the discriminator). */
      type: 'file';
      /** The storage object id. */
      storageObjectId?: string;
      /** The url. */
      url?: string;
      /** The filename. */
      filename?: string;
    };

/**
 * The AI input item type.
 *
 * @stability experimental
 */
export type AiInputItem =
  | {
      /** Which variant this is (the discriminator). */
      type: 'message';
      /** The role. */
      role: 'user' | 'assistant' | 'system' | 'developer';
      /** The content. */
      content: AiContentPart[];
    }
  | {
      /** Which variant this is (the discriminator). */
      type: 'function_call_output';
      /** The call id. */
      callId: string;
      /** The output. */
      output: string;
    };

/**
 * `POST /ai/responses` (and `/stream`, `/ai/runs`) body. HTTP callers send a
 * JSON Schema for structured output, never Zod; function tools are not
 * accepted over HTTP in Phase 1.
 */
/**
 * A provider-hosted tool a request may carry (#442) — mirrors
 * `aiHostedToolSchema` (`apps/api/src/ai/core/hosted-tools.ts`), which is
 * `.strict()`. Offered only when the model has `hosted_tools` AND the tool's
 * `GET /ai/config` `hostedTools` flag is on; otherwise `403 AI_TOOL_DISABLED`.
 
 *
 * @stability experimental
 */
export type AiHostedTool =
  | {
      /** Which variant this is (the discriminator). */
      type: 'web_search';
      /** The search context size. */
      searchContextSize?: 'low' | 'medium' | 'high';
      /** The user location. */
      userLocation?: {
        /** The country. */
        country?: string;
        /** The city. */
        city?: string;
      };
    }
  | {
      /** Which variant this is (the discriminator). */
      type: 'file_search';
      /** The vector store ids. */
      vectorStoreIds: string[];
      /** The max results. */
      maxResults?: number;
    }
  | {
      /** Which variant this is (the discriminator). */
      type: 'code_interpreter';
      /** The container. */
      container?: {
        /** Which variant this is (the discriminator). */
        type: 'auto';
      };
    }
  | {
      /** Which variant this is (the discriminator). */
      type: 'image_generation';
      /** The size. */
      size?: string;
      /** The quality. */
      quality?: string;
    }
  | {
      /** Which variant this is (the discriminator). */
      type: 'mcp';
      /** The server label. */
      serverLabel: string;
      /** The server url. */
      serverUrl: string;
      /** The allowed tools. */
      allowedTools?: string[];
      /** The require approval. */
      requireApproval?: 'never' | 'always';
      /** ⚠ Secret; refused on a background run. */
      headers?: Record<string, string>;
    };

/**
 * `web_search` result (#442): what was searched and the sources consulted.
 *
 * @stability experimental
 */
export interface AiWebSearchCallResult {
  /** The queries. */
  queries: string[];
  /** The sources. */
  sources: Array<{
    /** The url. */
    url: string;
  }>;
}

/**
 * `file_search` result: queries run and chunks retrieved.
 *
 * @stability experimental
 */
export interface AiFileSearchCallResult {
  /** The queries. */
  queries: string[];
  /** The results. */
  results: Array<{
    /** The file id. */
    fileId?: string;
    /** The filename. */
    filename?: string;
    /** The score. */
    score?: number;
    /** The text. */
    text?: string;
  }>;
}

/**
 * `code_interpreter` result: the code run and what it printed or drew.
 *
 * @stability experimental
 */
export interface AiCodeInterpreterCallResult {
  /** The code. */
  code: string | null;
  /** The container id. */
  containerId: string;
  /** The outputs. */
  outputs: Array<
    | {
        /** Which variant this is (the discriminator). */
        type: 'logs';
        /** The logs. */
        logs: string;
      }
    | {
        /** Which variant this is (the discriminator). */
        type: 'image';
        /** The url. */
        url: string;
      }
  >;
}

/**
 * `image_generation` result: the image was saved as the caller's storage
 * object, or `storageObjectId` is `null` and `storageError` says why.
 
 *
 * @stability experimental
 */
export interface AiImageGenerationCallResult {
  /** The storage object id. */
  storageObjectId: string | null;
  /** The storage error. */
  storageError?: 'AI_STORAGE_UNAVAILABLE';
  /** The mime type. */
  mimeType?: string;
  /** The revised prompt. */
  revisedPrompt?: string;
  /** The size. */
  size?: string;
  /** The quality. */
  quality?: string;
}

/**
 * The AI response request wire shape.
 *
 * @stability experimental
 */
export interface AiResponseRequest {
  /** The provider. */
  provider?: string;
  /** The model. */
  model?: string;
  /** The instructions. */
  instructions?: string;
  /** The input. */
  input: string | AiInputItem[];
  /** Provider-hosted tools (#442); function tools are not accepted over HTTP. */
  tools?: AiHostedTool[];
  /** Whether structured output. */
  structuredOutput?: {
    /** The name. */
    name: string;
    /** The json schema. */
    jsonSchema: object;
    /** Whether strict. */
    strict?: boolean;
  };
  /** The reasoning. */
  reasoning?: {
    /** The effort. */
    effort?: 'minimal' | 'low' | 'medium' | 'high';
    /** The summary. */
    summary?: 'auto' | 'concise' | 'detailed';
  };
  /** The max output tokens. */
  maxOutputTokens?: number;
  /** The temperature. */
  temperature?: number;
  /** The previous response id. */
  previousResponseId?: string;
  /** The metadata. */
  metadata?: Record<string, string>;
  /** The provider options. */
  providerOptions?: Record<string, Record<string, unknown>>;
}

/**
 * A web-search citation: `text.slice(startIndex, endIndex)` is the passage it supports (#442).
 *
 * @stability experimental
 */
export interface AiUrlCitation {
  /** The url. */
  url: string;
  /** The title. */
  title: string;
  /** The start index. */
  startIndex: number;
  /** The end index. */
  endIndex: number;
}

/**
 * The AI output item type.
 *
 * @stability experimental
 */
export type AiOutputItem =
  | {
      /** Which variant this is (the discriminator). */
      type: 'message';
      /** The text. */
      text: string;
      /** The citations. */
      citations?: AiUrlCitation[];
    }
  | {
      /** Which variant this is (the discriminator). */
      type: 'reasoning';
      /** The summary. */
      summary: string[];
    }
  | {
      /** Which variant this is (the discriminator). */
      type: 'function_call';
      /** The call id. */
      callId: string;
      /** The name. */
      name: string;
      /** The arguments. */
      arguments: string;
    }
  | {
      /** Which variant this is (the discriminator). */
      type: 'hosted_tool_call';
      /** The id. */
      id?: string;
      /** The tool. */
      tool: string;
      /** The status. */
      status: string;
      /** The result. */
      result?: unknown;
    };

/**
 * The AI usage wire shape.
 *
 * @stability experimental
 */
export interface AiUsage {
  /** The input tokens. */
  inputTokens?: number;
  /** The output tokens. */
  outputTokens?: number;
  /** The reasoning tokens. */
  reasoningTokens?: number;
  /** The cached input tokens. */
  cachedInputTokens?: number;
}

/**
 * The AI response wire shape.
 *
 * @stability experimental
 */
export interface AiResponse<T = unknown> {
  /** The id. */
  id: string;
  /** The provider. */
  provider: string;
  /** The model. */
  model: string;
  /** The output. */
  output: AiOutputItem[];
  /** The output text. */
  outputText: string;
  /** The parsed. */
  parsed?: T;
  /** The usage. */
  usage: AiUsage;
  /** The finish reason. */
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error';
  /** The provider request id. */
  providerRequestId?: string;
}

/**
 * One SSE frame of `POST /ai/responses/stream`; `type` is the frame's `event:`.
 *
 * @stability experimental
 */
export type AiStreamEvent =
  | {
      /** Which variant this is (the discriminator). */
      type: 'response.created';
      /** The id. */
      id: string;
    }
  | {
      /** Which variant this is (the discriminator). */
      type: 'output_text.delta';
      /** The delta. */
      delta: string;
    }
  | {
      /** Which variant this is (the discriminator). */
      type: 'reasoning_summary.delta';
      /** The delta. */
      delta: string;
    }
  | {
      /** Which variant this is (the discriminator). */
      type: 'function_call.arguments.delta';
      /** The call id. */
      callId: string;
      /** The delta. */
      delta: string;
    }
  | {
      /** Which variant this is (the discriminator). */
      type: 'output_item.done';
      /** The item. */
      item: AiOutputItem;
    }
  | {
      /** Which variant this is (the discriminator). */
      type: 'response.completed';
      /** The response. */
      response: AiResponse;
    }
  | {
      /** Which variant this is (the discriminator). */
      type: 'error';
      /** The code. */
      code: AiErrorCode;
      /** The message. */
      message: string;
    };

/**
 * The AI run status type.
 *
 * @stability experimental
 */
export type AiRunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

/**
 * `POST /ai/runs` — 202.
 *
 * @stability experimental
 */
export interface AiRunStarted {
  /** The run id. */
  runId: string;
  /** The job id. */
  jobId: string;
}

/**
 * A succeeded image run's `output` (#437): storage objects the caller owns.
 * Download each through `GET /storage/objects/:id/download`
 * (`services/storage.ts`); the bytes are never in the run.
 
 *
 * @stability experimental
 */
export interface AiImageRunOutput {
  /** Which variant this is (the discriminator). */
  type: 'images';
  /** The provider. */
  provider: string;
  /** The model. */
  model: string;
  /** One per image, in the order the provider returned them. */
  storageObjectIds: string[];
  /** The images. */
  images: {
    /** The storage object id. */
    storageObjectId: string;
    /** The mime type. */
    mimeType: string;
    /** Bytes. */
    size: number;
    /** The prompt the provider actually used, where it rewrote it. */
    revisedPrompt?: string;
  }[];
  /** The usage. */
  usage: AiUsage;
}

/**
 * A succeeded transcription run's `output` (#438): the transcript.
 *
 * @stability experimental
 */
export interface AiTranscriptionRunOutput {
  /** Which variant this is (the discriminator). */
  type: 'transcription';
  /** The provider. */
  provider: string;
  /** The model. */
  model: string;
  /** The recording that was transcribed (the caller's storage object). */
  storageObjectId: string;
  /** The text. */
  text: string;
  /** As the provider reports it — an ISO code or a name such as `english`. */
  language?: string;
  /** The duration seconds. */
  durationSeconds?: number;
  /** Timestamped segments, where the model produces them. */
  segments?: {
    /** The start seconds. */
    startSeconds: number;
    /** The end seconds. */
    endSeconds: number;
    /** The text. */
    text: string;
  }[];
  /** The words. */
  words?: {
    /** The start seconds. */
    startSeconds: number;
    /** The end seconds. */
    endSeconds: number;
    /** The word. */
    word: string;
  }[];
  /** The usage. */
  usage: AiUsage;
}

/**
 * A succeeded speech run's `output` (#439): the audio as a storage object the
 * caller owns. `aiGenerated` is always true — a player must say so.
 
 *
 * @stability experimental
 */
export interface AiSpeechRunOutput {
  /** Which variant this is (the discriminator). */
  type: 'speech';
  /** The provider. */
  provider: string;
  /** The model. */
  model: string;
  /** The storage object id. */
  storageObjectId: string;
  /** The mime type. */
  mimeType: string;
  /** Bytes. */
  size: number;
  /** The format. */
  format: AiSpeechFormat;
  /** The voice. */
  voice: string;
  /** Characters spoken. */
  characters: number;
  /** The AI generated. */
  aiGenerated: true;
  /** The usage. */
  usage: AiUsage;
}

/**
 * Every shape a succeeded run's `output` can take — discriminate with the guards below.
 *
 * @stability experimental
 */
export type AiRunOutput =
  AiResponse | AiImageRunOutput | AiTranscriptionRunOutput | AiSpeechRunOutput;

function runOutputType(output: AiRunOutput | null | undefined): string | null {
  return output && 'type' in output && typeof output.type === 'string' ? output.type : null;
}

/**
 * Is AI image run output.
 *
 * @stability experimental
 */
export function isAiImageRunOutput(
  output: AiRunOutput | null | undefined
): output is AiImageRunOutput {
  return runOutputType(output) === 'images';
}

/**
 * Is AI transcription run output.
 *
 * @stability experimental
 */
export function isAiTranscriptionRunOutput(
  output: AiRunOutput | null | undefined
): output is AiTranscriptionRunOutput {
  return runOutputType(output) === 'transcription';
}

/**
 * Is AI speech run output.
 *
 * @stability experimental
 */
export function isAiSpeechRunOutput(
  output: AiRunOutput | null | undefined
): output is AiSpeechRunOutput {
  return runOutputType(output) === 'speech';
}

/**
 * A text run's output (`POST /ai/runs`): an {@link AiResponse} — the one shape with no `type`.
 *
 * @stability experimental
 */
export function isAiResponseRunOutput(
  output: AiRunOutput | null | undefined
): output is AiResponse {
  return !!output && runOutputType(output) === null;
}

/**
 * `GET /ai/runs/:id` — scoped to the caller.
 *
 * @stability experimental
 */
export interface AiRun {
  /** The id. */
  id: string;
  /** The status. */
  status: AiRunStatus;
  /** The provider. */
  provider: string;
  /** The model id. */
  modelId: string;
  /** Once `succeeded`; otherwise `null`. */
  output: AiRunOutput | null;
  /** The error code. */
  errorCode: string | null;
  /** A safe, generic description of the failure once `failed`. */
  errorMessage: string | null;
  /** When created happened (ISO-8601). */
  createdAt: string;
  /** When completed happened (ISO-8601). */
  completedAt: string | null;
}

// =============================================================================
// Administration (`ai_config:*`)
// =============================================================================

/**
 * `POST /admin/ai/models/refresh` — the queued job.
 *
 * @stability experimental
 */
export interface AiCatalogRefreshQueued {
  /** The job id. */
  jobId: string;
  /** The status. */
  status: string;
}

/**
 * Callbacks for {@link streamAiResponse}. Every one is optional.
 *
 * @stability experimental
 */
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

// =============================================================================
// Images (#437) — always asynchronous: 202 { runId, jobId }, then poll the run
// =============================================================================

/**
 * Mirrors `apps/api/src/ai/core/types/media.types.ts`.
 *
 * @stability experimental
 */
export const AI_IMAGES_MAX_N = 4;
/**
 * The AI image qualities.
 *
 * @stability experimental
 */
export const AI_IMAGE_QUALITIES = ['low', 'medium', 'high', 'auto'] as const;
/**
 * The AI image input mime types.
 *
 * @stability experimental
 */
export const AI_IMAGE_INPUT_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
/**
 * The AI image mask mime types.
 *
 * @stability experimental
 */
export const AI_IMAGE_MASK_MIME_TYPES = ['image/png'] as const;
/**
 * The largest source image (or mask) an edit reads, in bytes (25 MiB).
 *
 * @stability experimental
 */
export const AI_IMAGE_INPUT_MAX_BYTES = 25 * 1024 * 1024;
/**
 * The AI image prompt max chars.
 *
 * @stability experimental
 */
export const AI_IMAGE_PROMPT_MAX_CHARS = 32_000;

/**
 * `POST /ai/images` body. `model` is required — never inferred from the chat default.
 *
 * @stability experimental
 */
export interface AiImageGenerateRequest {
  /** The provider. */
  provider?: string;
  /** The model. */
  model: string;
  /** The prompt. */
  prompt: string;
  /** `WIDTHxHEIGHT` or `auto`; the provider decides which sizes a model accepts. */
  size?: string;
  /** The quality. */
  quality?: (typeof AI_IMAGE_QUALITIES)[number];
  /** The background. */
  background?: 'transparent' | 'opaque' | 'auto';
  /** The output format. */
  outputFormat?: 'png' | 'jpeg' | 'webp';
  /** 1 to {@link AI_IMAGES_MAX_N}. */
  n?: number;
  /** The provider options. */
  providerOptions?: Record<string, Record<string, unknown>>;
}

/**
 * `POST /ai/images/edits` body: inputs are the caller's own, `ready` storage objects.
 *
 * @stability experimental
 */
export interface AiImageEditRequest extends AiImageGenerateRequest {
  /** The image storage object ids. */
  imageStorageObjectIds: string[];
  /** The mask storage object id. */
  maskStorageObjectId?: string;
}

// =============================================================================
// Audio (#438 transcription, #439 speech) — always asynchronous runs
// =============================================================================

/**
 * Recording types a transcription accepts (`audio/*` plus MP4/WebM video).
 *
 * @stability experimental
 */
export const AI_TRANSCRIPTION_INPUT_ACCEPT = 'audio/*,video/mp4,video/webm';
/**
 * The largest recording the provider takes (OpenAI: 25 MiB).
 *
 * @stability experimental
 */
export const AI_TRANSCRIPTION_MAX_BYTES = 25 * 1024 * 1024;
/**
 * The AI transcription prompt max chars.
 *
 * @stability experimental
 */
export const AI_TRANSCRIPTION_PROMPT_MAX_CHARS = 4_000;

/**
 * `POST /ai/audio/transcriptions` body.
 *
 * @stability experimental
 */
export interface AiTranscriptionRequest {
  /** The provider. */
  provider?: string;
  /** The storage object id. */
  storageObjectId: string;
  /** The model. */
  model?: string;
  /** ISO-639-1 (`en`). */
  language?: string;
  /** The prompt. */
  prompt?: string;
  /** The timestamp granularities. */
  timestampGranularities?: ('segment' | 'word')[];
}

/**
 * The AI speech formats.
 *
 * @stability experimental
 */
export const AI_SPEECH_FORMATS = ['mp3', 'wav', 'opus', 'aac', 'flac', 'pcm'] as const;
/**
 * The AI speech format type.
 *
 * @stability experimental
 */
export type AiSpeechFormat = (typeof AI_SPEECH_FORMATS)[number];
/**
 * The longest text one speech run speaks.
 *
 * @stability experimental
 */
export const AI_SPEECH_INPUT_MAX_CHARS = 4_096;

/**
 * `POST /ai/audio/speech` body.
 *
 * @stability experimental
 */
export interface AiSpeechRequest {
  /** The provider. */
  provider?: string;
  /** The input. */
  input: string;
  /** The model. */
  model?: string;
  /** One of the model's `capabilities.voices`. */
  voice?: string;
  /** The format. */
  format?: AiSpeechFormat;
  /** The instructions. */
  instructions?: string;
  /** 0.25 to 4; 1 is normal. */
  speed?: number;
}

// =============================================================================
// Realtime voice sessions (#449)
// =============================================================================

/**
 * The longest `instructions` one realtime session accepts.
 *
 * @stability experimental
 */
export const AI_REALTIME_INSTRUCTIONS_MAX_CHARS = 16_000;

/**
 * `POST /ai/realtime/sessions` body. Every field is optional.
 *
 * @stability experimental
 */
export interface AiRealtimeSessionRequest {
  /** The provider. */
  provider?: string;
  /** A model with `realtime`; omitted, the first usable one. */
  model?: string;
  /** One of the model's `capabilities.voices`; omitted, its first. */
  voice?: string;
  /** Initial system instructions (at most {@link AI_REALTIME_INSTRUCTIONS_MAX_CHARS}). */
  instructions?: string;
}

/**
 * `POST /ai/realtime/sessions` → 201.
 *
 * ⚠ `clientSecret` is the provider's EPHEMERAL, single-session secret (never
 * the user's key — that stays on the server). It is still a credential: keep
 * it in a local variable for the one SDP exchange it exists for, and never
 * log, render or store it.
 
 *
 * @stability experimental
 */
export interface AiRealtimeSession {
  /** The provider. */
  provider: string;
  /** The model. */
  model: string;
  /** The voice. */
  voice: string;
  /** The client secret. */
  clientSecret: string;
  /** ISO 8601 — the deadline to CONNECT with `clientSecret`; a connected call continues. */
  expiresAt: string;
  /** Where the browser POSTs its SDP offer (`Content-Type: application/sdp`). */
  connectUrl: string;
}

// =============================================================================
// Embeddings (#440) — synchronous
// =============================================================================

/**
 * The most inputs one `POST /ai/embeddings` accepts; a larger batch is `AI_INVALID_REQUEST`.
 *
 * @stability experimental
 */
export const AI_EMBEDDINGS_MAX_INPUTS = 256;

/**
 * `POST /ai/embeddings` body. `model` is required: vectors compare only within one model.
 *
 * @stability experimental
 */
export interface AiEmbeddingsRequest {
  /** The provider. */
  provider?: string;
  /** The model. */
  model: string;
  /** The input. */
  input: string | string[];
  /** Shorten every vector, where the model supports it. */
  dimensions?: number;
  /** The provider options. */
  providerOptions?: Record<string, Record<string, unknown>>;
}

/**
 * The AI embeddings response wire shape.
 *
 * @stability experimental
 */
export interface AiEmbeddingsResponse {
  /** The provider. */
  provider: string;
  /** The model. */
  model: string;
  /** The length of every vector. */
  dimensions: number;
  /** One per input, in input order. */
  vectors: number[][];
  /** The usage. */
  usage: AiUsage;
}

// =============================================================================
// Usage aggregates (#443 API, #444 UI)
// =============================================================================
//
// ⚠ EVERY usage type lives HERE and nowhere else, so a backend report that
// differs slightly from #443's contract is a one-place edit. Both routes answer
// the same shape; only the scope (everyone vs. the caller) and the allowed
// `groupBy` values differ.

/**
 * `groupBy` values `GET /admin/ai/usage` accepts (`org`: #739).
 *
 * @stability experimental
 */
export const AI_USAGE_ADMIN_GROUP_BY = [
  'day',
  'user',
  'model',
  'provider',
  'keySource',
  'org',
] as const;
/**
 * The AI usage group by type.
 *
 * @stability experimental
 */
export type AiUsageGroupBy = (typeof AI_USAGE_ADMIN_GROUP_BY)[number];

/**
 * `groupBy` values `GET /ai/usage/me` accepts — a user sees only their own rows.
 *
 * @stability experimental
 */
export const AI_USAGE_MY_GROUP_BY = ['day', 'model'] as const;
/**
 * The AI my usage group by type.
 *
 * @stability experimental
 */
export type AiMyUsageGroupBy = (typeof AI_USAGE_MY_GROUP_BY)[number];

/**
 * The range options the UI offers. The API caps a range at 90 days.
 *
 * @stability experimental
 */
export const AI_USAGE_RANGE_OPTIONS = [7, 30, 90] as const;
/**
 * The AI usage range days type.
 *
 * @stability experimental
 */
export type AiUsageRangeDays = (typeof AI_USAGE_RANGE_OPTIONS)[number];
/**
 * The API's own default when `from`/`to` are omitted.
 *
 * @stability experimental
 */
export const AI_USAGE_DEFAULT_RANGE_DAYS: AiUsageRangeDays = 30;

/**
 * Counters shared by the totals block and each series entry.
 *
 * @stability experimental
 */
export interface AiUsageCounters {
  /** The requests. */
  requests: number;
  /** The failed. */
  failed: number;
  /** The input tokens. */
  inputTokens: number;
  /** The output tokens. */
  outputTokens: number;
  /** The reasoning tokens. */
  reasoningTokens: number;
  /** The cached input tokens. */
  cachedInputTokens: number;
  /** Non-token units summed per key (`{ images: 2 }`, `{ audioSeconds: 31.4 }`). */
  units: Record<string, number>;
}

/**
 * The AI usage totals wire shape.
 *
 * @stability experimental
 */
export interface AiUsageTotals extends AiUsageCounters {
  /** The subset paid for by the organisation's key (`keySource = 'org'`). */
  orgKeyRequests: number;
  /** The org key input tokens. */
  orgKeyInputTokens: number;
  /** The org key output tokens. */
  orgKeyOutputTokens: number;
}

/**
 * One group. `key` is the grouping value — `YYYY-MM-DD` for `day`, the user id
 * for `user`, the model id for `model`, and so on; `label` is what to show
 * (the email for `user`).
 
 *
 * @stability experimental
 */
export interface AiUsageSeriesEntry extends AiUsageCounters {
  /** The key. */
  key: string;
  /** The label. */
  label: string;
}

/**
 * `GET /admin/ai/usage` and `GET /ai/usage/me`.
 *
 * @stability experimental
 */
export interface AiUsageReport<G extends string = AiUsageGroupBy> {
  /** The range. */
  range: {
    /** The from. */
    from: string;
    /** The to. */
    to: string;
  };
  /** The group by. */
  groupBy: G;
  /** The totals. */
  totals: AiUsageTotals;
  /** The series. */
  series: AiUsageSeriesEntry[];
}

/**
 * `from` / `to` as ISO dates (`YYYY-MM-DD`, inclusive, UTC).
 *
 * @stability experimental
 */
export interface AiUsageRange {
  /** The from. */
  from: string;
  /** The to. */
  to: string;
}

/**
 * The AI usage query wire shape.
 *
 * @stability experimental
 */
export interface AiUsageQuery extends Partial<AiUsageRange> {
  /** The group by. */
  groupBy: AiUsageGroupBy;
  /** The user id. */
  userId?: string;
  /** The provider. */
  provider?: string;
  /** The model. */
  model?: string;
  /** One organization's rows only (#739); `none` for the organization-less catalogue-sync rows. */
  orgId?: string;
}

/**
 * The AI my usage query wire shape.
 *
 * @stability experimental
 */
export interface AiMyUsageQuery extends Partial<AiUsageRange> {
  /** The group by. */
  groupBy: AiMyUsageGroupBy;
}

/**
 * The last `days` days, ending today (UTC), as the inclusive ISO-date pair the
 * usage routes take. `now` is injectable for tests.
 
 *
 * @stability experimental
 */
export function aiUsageRangeForDays(days: number, now: Date = new Date()): AiUsageRange {
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const from = new Date(to.getTime() - (days - 1) * 86_400_000);
  return { from: toIsoDate(from), to: toIsoDate(to) };
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The model a user's AI requests default to: a provider/model pair, never a
 * key (`user_settings.ai.defaultModel`).
 
 *
 * @stability experimental
 */
export interface AiDefaultModel {
  /** The provider. */
  provider: string;
  /** The model id. */
  modelId: string;
}

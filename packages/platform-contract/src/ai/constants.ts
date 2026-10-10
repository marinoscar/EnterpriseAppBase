// =============================================================================
// The AI slice's zod-free constants (issue #739, PP-8.6)
// =============================================================================
//
// Plain values and string-literal unions only, never zod (the contract
// convention, test/no-zod-in-constants.test.ts): a consumer that needs only a
// constant or a type (the web app) never pulls zod into its bundle. The
// schemas built from these are ./schemas.ts, ./org-keys.ts and ./features.ts.
// =============================================================================

// =============================================================================
// AI platform namespace (issue #423, epic #419, umbrella #418)
// =============================================================================
//
// Deployment-wide AI policy — declared on the same terms as `storage` above:
// all six places in one pass (this file's two schemas, the wire DTOs' two
// schemas, `DEFAULT_SYSTEM_SETTINGS`, and the hand-written merge in
// `system-settings.service.ts`), ahead of every consumer. THIS ISSUE OWNS
// SCHEMA ONLY — nothing in this build reads `ai.enabled` to gate a route, and
// no controller exists yet that lets a caller actually run a model (#427,
// #428, #431, #432).
//
// `BUILTIN_AI_PROVIDER_IDS` names the providers the platform SHIPS, not a closed
// set (PP-14.6, #924): an app or package adds its own with `registerAiProvider`
// (`@marinoscar/platform-api/ai`) and its id is any `AI_PROVIDER_ID_PATTERN`
// string. Append only to the built-in list: the order is the admin UI's order.
/**
 * The id pattern of an AI provider: a lower-case letter, then lower-case
 * letters, digits and hyphens, 2 to 48 characters. Also the provider part of
 * an `ai.limits.perModel` key (`AI_LIMIT_MODEL_KEY_PATTERN`). Permanent once a
 * provider's settings or keys are stored under it.
 *
 * @stability experimental
 */
export const AI_PROVIDER_ID_PATTERN = /^[a-z][a-z0-9-]{1,47}$/;

/**
 * The provider ids the platform ships an adapter and a settings slot for.
 * Permanent strings. An app's own providers are not listed here: ask the API
 * (`GET /api/admin/ai/config`, `GET /api/ai/config`) for the registered ones.
 *
 * @stability experimental
 */
export const BUILTIN_AI_PROVIDER_IDS = ['openai', 'anthropic', 'gemini', 'azure-openai', 'openai-compatible'] as const;

/**
 * The provider ids the platform ships.
 *
 * @deprecated Use {@link BUILTIN_AI_PROVIDER_IDS}. The list is no longer the set
 *   of providers a deployment can use (PP-14.6, #924); kept as an alias for one release.
 * @stability experimental
 */
export const AI_PROVIDER_IDS = BUILTIN_AI_PROVIDER_IDS;

/**
 * One of {@link BUILTIN_AI_PROVIDER_IDS}.
 *
 * @stability experimental
 */
export type BuiltinAiProviderId = (typeof BUILTIN_AI_PROVIDER_IDS)[number];

/**
 * An AI provider id: a built-in one (autocompleted) or any string an app or
 * package registered. See {@link AI_PROVIDER_ID_PATTERN}.
 *
 * @stability experimental
 */
export type AiProviderId = BuiltinAiProviderId | (string & {});

/**
 * How this deployment sources the API key a call actually authenticates
 * with.
 *
 *  - `byok`                    — every call uses the CALLING USER's own key
 *    (`UserAiKey`). No call succeeds for a user who has not saved one.
 *  - `byok_with_org_fallback`  — a user's own key is preferred; a user with
 *    none falls back to a deployment-wide org key. What that org key is, and
 *    where it lives, is deliberately not modelled here: like the object
 *    storage secret access key, an org-wide AI key is CREDENTIAL material and
 *    belongs in the encrypted credential store, never in this JSONB blob that
 *    `GET /api/system-settings` returns wholesale — see the block comment
 *    on `systemAiSchema` below.
 *
 * @stability experimental
 */
export const AI_KEY_POLICIES = ['byok', 'byok_with_org_fallback'] as const;

/**
 * The entries of the key-policy enum (`keyPolicyEnum()`).
 *
 * @stability experimental
 */
export type AiKeyPolicyEnum = { [K in (typeof AI_KEY_POLICIES)[number]]: K };

/**
 * Upper bound on `ai.usageRetentionDays` — ten years; anything longer is "forever" in practice.
 *
 * @stability experimental
 */
export const AI_USAGE_RETENTION_MAX_DAYS = 3650;

/**
 * One `ai.hostedTools.mcpAllowedHosts` entry: a hostname (`mcp.example.com`)
 * or a subdomain wildcard (`*.example.com`). No scheme, port or path — the
 * scheme is always `https`, and the entry is compared with the URL's host.
 *
 * @stability experimental
 */
export const AI_MCP_ALLOWED_HOST_PATTERN =
  /^(\*\.)?[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/**
 * Most entries `ai.hostedTools.mcpAllowedHosts` may hold.
 *
 * @stability experimental
 */
export const AI_MCP_ALLOWED_HOSTS_MAX = 100;

/**
 * One `ai.limits.perModel` key: `<provider>:<modelId>` — a lower-case
 * provider id, a colon, then the model id exactly as the catalog lists it
 * (`openai:gpt-4.1-mini`). The model id may itself contain colons.
 *
 * @stability experimental
 */
export const AI_LIMIT_MODEL_KEY_PATTERN = /^[a-z0-9-]+:.+$/;

/**
 * Longest accepted `ai.limits.perModel` key.
 *
 * @stability experimental
 */
export const AI_LIMIT_MODEL_KEY_MAX = 256;

/**
 * Most entries `ai.limits.perModel` may hold.
 *
 * @stability experimental
 */
export const AI_LIMITS_PER_MODEL_MAX = 500;

/**
 * Upper bound on any one `ai.limits` number — a billion is "unlimited" in practice.
 *
 * @stability experimental
 */
export const AI_LIMIT_VALUE_MAX = 1_000_000_000;

/**
 * How the deployment sources a call's API key. See {@link AI_KEY_POLICIES}.
 *
 * @stability experimental
 */
export type AiKeyPolicy = (typeof AI_KEY_POLICIES)[number];

/**
 * Longest accepted `baseUrl` for the #448 slots.
 *
 * @stability experimental
 */
export const AI_ENDPOINT_URL_MAX = 2048;

/**
 * Why an endpoint URL is refused, or null when it is acceptable. Shared with the admin DTOs.
 *
 * @stability experimental
 */
export function aiEndpointUrlProblem(value: string, schemes: readonly string[]): string | null {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return 'Must be an absolute URL';
  }

  if (!schemes.includes(url.protocol.replace(/:$/, ''))) {
    return `The scheme must be ${schemes.join(' or ')}`;
  }

  if (url.username || url.password) return 'Credentials may not be embedded in the URL';
  if (url.hash || value.includes('#')) return 'A fragment (#...) is not allowed';
  if (!url.hostname) return 'A host is required';

  return null;
}

/**
 * Schemes a `providers['azure-openai'].baseUrl` may use.
 *
 * @stability experimental
 */
export const AI_AZURE_ENDPOINT_SCHEMES = ['https'] as const;

/**
 * Schemes a `providers['openai-compatible'].baseUrl` may use.
 *
 * @stability experimental
 */
export const AI_COMPATIBLE_ENDPOINT_SCHEMES = ['http', 'https'] as const;

/**
 * Which wire API an OpenAI-family adapter speaks.
 *
 * @stability experimental
 */
export const AI_OPENAI_API_STYLES = ['responses', 'chat_completions'] as const;

/**
 * The entries of the API-style enum (`apiStyleEnum()`).
 *
 * @stability experimental
 */
export type AiOpenAiApiStyleEnum = { [K in (typeof AI_OPENAI_API_STYLES)[number]]: K };


/**
 * One of `AI_OPENAI_API_STYLES`.
 *
 * @stability experimental
 */
export type AiOpenAiApiStyle = (typeof AI_OPENAI_API_STYLES)[number];

/**
 * An Azure `api-version` query value (`2025-04-01-preview`, `2024-10-21`,
 * `preview`). A plain token: it is sent as a query parameter and nothing else.
 *
 * @stability experimental
 */
export const AI_AZURE_API_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * An Azure deployment name: letters, digits, `.`, `_` and `-`, at most 64.
 *
 * @stability experimental
 */
export const AI_AZURE_DEPLOYMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * Most entries `providers['azure-openai'].deployments` may hold.
 *
 * @stability experimental
 */
export const AI_AZURE_DEPLOYMENTS_MAX = 200;

/**
 * Longest accepted model id key in `deployments`.
 *
 * @stability experimental
 */
export const AI_AZURE_MODEL_ID_MAX = 256;

/**
 * The property names a settings namespace must never carry.
 *
 * @stability experimental
 */
export type AiSecretFieldNames =
  | 'secretAccessKey'
  | 'secretKey'
  | 'sessionToken'
  | 'secret'
  | 'password'
  | 'apiKey'
  | 'apiKeys'
  | 'key'
  | 'token';

// ---- organization keys (`/api/admin/ai/org-keys`) ---------------------------

/**
 * Shortest key the org-key route accepts (the deployment-key route's bound).
 *
 * @stability experimental
 */
export const ORG_AI_KEY_MIN = 8;


/**
 * Longest key the org-key route accepts.
 *
 * @stability experimental
 */
export const ORG_AI_KEY_MAX = 512;

/** Field names no org-key response may carry, ever. */
/**
 * The property names an organization key view must never carry.
 *
 * @stability experimental
 */
export type KeyMaterialFieldNames = 'apiKey' | 'key' | 'secret' | 'token' | 'ciphertext';

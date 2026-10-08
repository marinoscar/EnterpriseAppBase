// =============================================================================
// The `ai` settings namespaces (issue #739, PP-8.6)
// =============================================================================
//
// The schemas of the AI platform's system namespace `ai` (stored shape, PATCH
// partial, PUT and PATCH request-body branches, response branch), of its org
// layer (#733: what one organization may set, tighten-only) and of the per-user
// namespace `ai`, moved verbatim from the reference app's
// `common/schemas/settings.schema.ts`, `system-settings-wire.schemas.ts` and
// `system-settings-response.schemas.ts`. The API registers the namespaces
// (`@marinoscar/platform-api/ai`); the web validates its forms with the same
// bounds. zod only: no Node API (this file also runs in the browser).
// =============================================================================

import { z } from 'zod';

// =============================================================================
// User namespace `ai`
// =============================================================================
/**
 * Per-user AI preferences (`ai`) — issue #423, epic #419, umbrella #418.
 *
 * `defaultModel` is the ONLY field this issue adds: which (provider, model)
 * a caller's AI surface should pre-select, so a user who has settled on one
 * model does not re-pick it every time. Nullable, and the namespace itself
 * optional — see below for why both.
 *
 * NON-SECRET ONLY, and this is the whole namespace, not a policy exception:
 * a user's own provider key is `UserAiKey.secret`, ciphertext in its own
 * table (`apps/api/prisma/schema.prisma`), never in `user_settings.value`,
 * which — like `system_settings.value` — is returned wholesale by
 * `GET /api/user-settings` and copied verbatim into whatever audit trail
 * later issues add. `provider`/`modelId` here are the same kind of
 * IDENTIFIER `systemStorageSchema.accessKeyId` is: they name a selection,
 * they authorise nothing.
 *
 * `provider`/`modelId` are plain strings, not `z.enum(AI_PROVIDER_IDS)` /
 * a foreign key into `AiModel`: this schema has no access to the database to
 * validate a model still exists, and — matching `Job.type`'s and
 * `AiModel.provider`'s own "a row must outlive the registry that produced it"
 * reasoning throughout this codebase — a user's saved preference for a model
 * later disabled or removed by an admin must remain a value this schema can
 * represent, even though nothing routes to it any more.
 */
export const userAiSettingsSchema = z.object({
  defaultModel: z
    .object({
      provider: z.string(),
      modelId: z.string(),
    })
    .nullable(),
});

export type UserAiSettingsValue = z.infer<typeof userAiSettingsSchema>;

/**
 * `ai`, PATCH counterpart. `defaultModel` stays required-but-nullable inside
 * the object (an explicit `{ "ai": { "defaultModel": null } }` clears the
 * selection back to "none chosen"; the whole `ai` object itself is optional
 * to send at all, matching `dataTables`/`navigation` above).
 */
export const userAiSettingsPatchSchema = z.object({
  defaultModel: z
    .object({
      provider: z.string(),
      modelId: z.string(),
    })
    .nullable(),
});

export type UserAiSettingsPatchValue = z.infer<typeof userAiSettingsPatchSchema>;

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
// `AI_PROVIDER_IDS` NAMES A REGISTRATION, NOT A CLOSED SET FOREVER — `as const`
// listed `'openai'` alone through Phase 1, and Phase 3 appends to the array
// rather than replacing it (`'anthropic'`, #446; `'gemini'`, #447;
// `'azure-openai'` and `'openai-compatible'`, #448). A fork adding its own
// provider extends this array; nothing about the shape below assumes a fixed
// number of members. Append only: the order is the admin UI's order.
export const AI_PROVIDER_IDS = ['openai', 'anthropic', 'gemini', 'azure-openai', 'openai-compatible'] as const;

/** A registered AI provider id. See {@link AI_PROVIDER_IDS}. */
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

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
 */
export const AI_KEY_POLICIES = ['byok', 'byok_with_org_fallback'] as const;

/** Upper bound on `ai.usageRetentionDays` — ten years; anything longer is "forever" in practice. */
export const AI_USAGE_RETENTION_MAX_DAYS = 3650;

/**
 * One `ai.hostedTools.mcpAllowedHosts` entry: a hostname (`mcp.example.com`)
 * or a subdomain wildcard (`*.example.com`). No scheme, port or path — the
 * scheme is always `https`, and the entry is compared with the URL's host.
 */
export const AI_MCP_ALLOWED_HOST_PATTERN =
  /^(\*\.)?[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/** Most entries `ai.hostedTools.mcpAllowedHosts` may hold. */
export const AI_MCP_ALLOWED_HOSTS_MAX = 100;

const mcpAllowedHostSchema = z.string().max(253).regex(AI_MCP_ALLOWED_HOST_PATTERN);

/**
 * One `ai.limits.perModel` key: `<provider>:<modelId>` — a lower-case
 * provider id, a colon, then the model id exactly as the catalog lists it
 * (`openai:gpt-4.1-mini`). The model id may itself contain colons.
 */
export const AI_LIMIT_MODEL_KEY_PATTERN = /^[a-z0-9-]+:.+$/;

/** Longest accepted `ai.limits.perModel` key. */
export const AI_LIMIT_MODEL_KEY_MAX = 256;

/** Most entries `ai.limits.perModel` may hold. */
export const AI_LIMITS_PER_MODEL_MAX = 500;

/** Upper bound on any one `ai.limits` number — a billion is "unlimited" in practice. */
export const AI_LIMIT_VALUE_MAX = 1_000_000_000;

export const aiLimitValueSchema = z.number().int().positive().max(AI_LIMIT_VALUE_MAX);

/**
 * `ai.limits` (#450) — per-user and per-model rate limits and output caps.
 * EVERY FIELD IS OPTIONAL, AND ABSENT MEANS UNLIMITED: `{}` (the default) is
 * a deployment with no limits at all, which is exactly Phase 1's behaviour.
 *
 *  - `perUser.requestsPerMinute` / `.requestsPerDay` — every inference call a
 *    user makes, whoever's key pays.
 *  - `orgKey.requestsPerDayPerUser` / `.tokensPerDayPerUser` — only calls the
 *    ORG key pays for (`keySource: 'org'`); a user on their own key is never
 *    counted against these.
 *  - `perModel['<provider>:<modelId>']` — `maxOutputTokens` clamps the call
 *    (together with `defaults.maxOutputTokensCap`, the smaller wins), and
 *    `requestsPerMinutePerUser` limits each user's calls to that one model.
 *
 * Enforced by `AiLimitsService` (`ai/runtime/ai-limits.service.ts`); see
 * `docs/specs/ai-platform.md` §2.22.
 */
export const systemAiLimitsSchema = z.object({
  perUser: z
    .object({
      requestsPerMinute: aiLimitValueSchema.optional(),
      requestsPerDay: aiLimitValueSchema.optional(),
    })
    .optional(),
  orgKey: z
    .object({
      requestsPerDayPerUser: aiLimitValueSchema.optional(),
      tokensPerDayPerUser: aiLimitValueSchema.optional(),
    })
    .optional(),
  // #739: the deployment default PER ORGANIZATION (requests and output tokens
  // per UTC day, counted over every call made in that organization); absent
  // means unlimited. An organization may only lower it (its org layer).
  perOrg: z
    .object({
      requestsPerDay: aiLimitValueSchema.optional(),
      outputTokensPerDay: aiLimitValueSchema.optional(),
    })
    .optional(),
  perModel: z
    .record(
      z.string().max(AI_LIMIT_MODEL_KEY_MAX).regex(AI_LIMIT_MODEL_KEY_PATTERN),
      z.object({
        maxOutputTokens: aiLimitValueSchema.optional(),
        requestsPerMinutePerUser: aiLimitValueSchema.optional(),
      }),
    )
    .refine((value) => Object.keys(value).length <= AI_LIMITS_PER_MODEL_MAX, {
      message: `At most ${AI_LIMITS_PER_MODEL_MAX} per-model limits`,
    })
    .optional(),
});

export type SystemAiLimitsValue = z.infer<typeof systemAiLimitsSchema>;

/** How the deployment sources a call's API key. See {@link AI_KEY_POLICIES}. */
export type AiKeyPolicy = (typeof AI_KEY_POLICIES)[number];

/**
 * Deployment-wide AI platform policy (`ai`).
 *
 * `enabled` is the master switch: OFF by default, matching every other
 * feature namespace in this file that ships ahead of its own UI
 * (`databaseBackup.enabled`, `nodes.jobSecretBrokerEnabled`) — a capability
 * this deployment did not ask for must not turn itself on by existing in the
 * schema.
 *
 * `providers.openai.baseUrl` IS AN ENDPOINT OVERRIDE, NOT A CREDENTIAL — the
 * exact counterpart of `systemStorageSchema.endpoint`. It exists for
 * OpenAI-compatible proxies and self-hosted gateways, and is optional because
 * absent means "use the provider's own default host". `providers` is closed
 * to `AI_PROVIDER_IDS` (`openai`, `anthropic`, `gemini`) rather than an open
 * `z.record`, for the same reason `STORAGE_PROVIDER_KINDS` is a closed enum
 * and not a free string: this value is read by name at the consuming layer, a
 * `z.record` cannot be validated field-by-field by `readNamespace` below (it
 * has no fixed `.shape` to iterate), and an operator-supplied provider id
 * would be a namespace with no fixed key set to keep parity with across the
 * six places a namespace must be declared.
 *
 * `defaults.maxOutputTokensCap` bounds every call regardless of what the
 * caller (or the model's own `maxOutputTokens`) requests, and is optional:
 * absent means "no deployment-wide cap", not zero.
 * `defaults.allowBackgroundRuns` decides whether a call may be queued as an `AiRun`
 * job at all rather than only served synchronously; ON by default, since the
 * job queue is this application's normal way of doing anything that takes a
 * while (see the "Every Long-Running Activity Is a Queue Job" rules) and a
 * deployment that has not thought about AI at all should not have quietly
 * disabled the queue path the moment this namespace materialises.
 *
 * `defaults.allowRealtime` (#449) decides whether a user may mint a realtime
 * voice session (`POST /api/ai/realtime/sessions`) — an ephemeral provider
 * secret handed to the BROWSER, after which the server can neither see nor
 * meter the conversation. OFF by default: that loss of per-call control is
 * an administrator's decision (docs/specs/ai-platform.md §2.15). A row
 * written before the field existed reads it as `false` without disturbing
 * the rest of `defaults` (`SystemSettingsService.withAiSlots`).
 *
 * `logPromptContent` is OFF by default and is a deliberate, named privacy
 * decision: whether this deployment's own logs/telemetry may capture prompt
 * text at all, independent of `enabled`. A deployment can turn AI on while
 * still refusing to let prompts (which may carry a user's own sensitive
 * input) land in a log line nobody scoped for that.
 *
 * ⚠ THERE IS NO API KEY FIELD ANYWHERE IN THIS NAMESPACE, AND THERE MUST
 * NEVER BE ONE — see the compile-time proof at the bottom of this file. A
 * user's own key is `UserAiKey.secret`, ciphertext in its own table, never
 * in this JSONB blob; an org-wide fallback key (
 * `AI_KEY_POLICIES.byok_with_org_fallback`) is credential material for the same reason
 * `systemStorageSchema`'s own header gives for the storage secret access
 * key: this object is returned WHOLESALE by `GET /api/system-settings` and
 * copied verbatim into every settings audit row, so a secret here is one
 * admin GET away from being on the wire.
 *
 * `usageRetentionDays` (#443) is how long `ai_usage_events` rows are kept
 * before the daily `ai.usage.purge` job deletes them — 180 days by default,
 * comfortably past the 90-day window the usage report can show. It is a data
 * retention decision, so it applies whether or not AI is currently enabled.
 *
 * `hostedTools` (#442) switches each provider-hosted tool type on for the
 * deployment — web search, file search, code interpreter, image generation
 * and remote MCP. ALL OFF BY DEFAULT: each one reaches outside this
 * deployment (the open web, a third-party MCP server) and bills per use, so
 * it is an administrator's decision, never a side effect of upgrading.
 * `mcpAllowedHosts` optionally narrows which hosts an MCP `serverUrl` may
 * name (`*.example.com` for subdomains); empty means any `https` host. It is
 * a list of HOSTNAMES — MCP credentials travel per request, in the tool's
 * `headers`, and are never stored here or anywhere else.
 *
 * `limits` (#450) holds the per-user and per-model rate limits and output
 * caps — see `systemAiLimitsSchema`. Every field inside it is optional and
 * absent means unlimited; the default is `{}`.
 *
 * NO `.default()` ON ANY FIELD, matching every namespace above it in this
 * file. The defaults live in `DEFAULT_SYSTEM_SETTINGS` (settings.types.ts)
 * and nowhere else.
 */
/**
 * One provider's slot in `ai.providers`: its switch and optional endpoint
 * override. Every provider id has at least this shape; the two #448 slots
 * below extend it.
 */
export const systemAiProviderSchema = z.object({
  enabled: z.boolean(),
  baseUrl: z.string().url().optional(),
});

// ---- OpenAI-family endpoints (#448) ------------------------------------------
//
// SSRF POSTURE. `azure-openai` and `openai-compatible` point this server's
// outbound AI calls at an administrator-chosen host, so their `baseUrl` is
// validated harder than `openai.baseUrl` (which is left as it was):
//
//   - scheme `https` only for Azure (every Azure OpenAI resource is https),
//     `http` or `https` for a compatible server (a self-hosted Ollama on a
//     private network is commonly plain http);
//   - no credentials in the URL (`https://user:pass@host`) — a key belongs in
//     the encrypted credential store, never in a JSONB blob `GET
//     /api/system-settings` returns wholesale;
//   - no fragment, which no HTTP request can carry anyway.
//
// POINTING AT AN INTERNAL HOST IS AN EXPLICIT ADMINISTRATOR DECISION, not
// something this validation refuses: `http://ollama.internal:11434/v1` is the
// canonical self-hosted setup, and the setting is writable only with
// `ai_config:write` / `system_settings:write`, both seeded Admin-only. What the
// adapters additionally refuse is being REDIRECTED somewhere else: their
// transport follows no redirect to another origin (see
// `ai/providers/openai/openai-redirect-guard.ts`).

/** Longest accepted `baseUrl` for the #448 slots. */
export const AI_ENDPOINT_URL_MAX = 2048;

/** Why an endpoint URL is refused, or null when it is acceptable. Shared with the admin DTOs. */
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

/** A `baseUrl` for an admin-chosen OpenAI-family endpoint, restricted to `schemes`. */
export function aiEndpointUrlSchema(schemes: readonly string[]) {
  return z
    .string()
    .max(AI_ENDPOINT_URL_MAX)
    .superRefine((value, ctx) => {
      const problem = aiEndpointUrlProblem(value, schemes);

      if (problem) ctx.addIssue({ code: 'custom', message: problem });
    });
}

/** Schemes a `providers['azure-openai'].baseUrl` may use. */
export const AI_AZURE_ENDPOINT_SCHEMES = ['https'] as const;

/** Schemes a `providers['openai-compatible'].baseUrl` may use. */
export const AI_COMPATIBLE_ENDPOINT_SCHEMES = ['http', 'https'] as const;

/** Which wire API an OpenAI-family adapter speaks. */
export const AI_OPENAI_API_STYLES = ['responses', 'chat_completions'] as const;
export type AiOpenAiApiStyle = (typeof AI_OPENAI_API_STYLES)[number];

/**
 * An Azure `api-version` query value (`2025-04-01-preview`, `2024-10-21`,
 * `preview`). A plain token: it is sent as a query parameter and nothing else.
 */
export const AI_AZURE_API_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** An Azure deployment name: letters, digits, `.`, `_` and `-`, at most 64. */
export const AI_AZURE_DEPLOYMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Most entries `providers['azure-openai'].deployments` may hold. */
export const AI_AZURE_DEPLOYMENTS_MAX = 200;

/** Longest accepted model id key in `deployments`. */
export const AI_AZURE_MODEL_ID_MAX = 256;

export const aiAzureDeploymentsSchema = z
  .record(
    z.string().min(1).max(AI_AZURE_MODEL_ID_MAX),
    z.string().regex(AI_AZURE_DEPLOYMENT_PATTERN, 'An Azure deployment name'),
  )
  .refine((value) => Object.keys(value).length <= AI_AZURE_DEPLOYMENTS_MAX, {
    message: `At most ${AI_AZURE_DEPLOYMENTS_MAX} deployments`,
  });

/**
 * `providers['azure-openai']` (#448).
 *
 *  - `baseUrl` — the resource endpoint, `https://<resource>.openai.azure.com`
 *    (the SDK appends `/openai`). Named `baseUrl`, like every other slot, so
 *    every generic consumer (the admin test's override, the catalog sync, the
 *    per-call context) handles it with no Azure special case. Required before
 *    the provider can be enabled — see `AiConfigAdminService`.
 *  - `apiVersion` — the `api-version` query value; absent means
 *    `AZURE_OPENAI_DEFAULT_API_VERSION` (`ai/providers/azure-openai`).
 *  - `apiStyle` — `responses` (the default: current api-versions serve the
 *    Responses API) or `chat_completions` for an older api-version or a
 *    deployment the Responses API does not cover.
 *  - `deployments` — model id → deployment name. Azure routes by DEPLOYMENT,
 *    and a deployment may be named anything; when this map is set its keys
 *    ARE the model list the catalog discovers, and a model id missing from it
 *    is sent as its own deployment name.
 */
export const systemAiAzureProviderSchema = systemAiProviderSchema.extend({
  baseUrl: aiEndpointUrlSchema(AI_AZURE_ENDPOINT_SCHEMES).optional(),
  apiVersion: z.string().regex(AI_AZURE_API_VERSION_PATTERN).optional(),
  apiStyle: z.enum(AI_OPENAI_API_STYLES).optional(),
  deployments: aiAzureDeploymentsSchema.optional(),
});

/**
 * `providers['openai-compatible']` (#448) — Ollama, vLLM, LM Studio or any
 * other server speaking the OpenAI wire protocol.
 *
 *  - `baseUrl` — the server's API root, INCLUDING its version segment
 *    (`http://ollama.internal:11434/v1`); required before enabling.
 *  - `apiStyle` — `chat_completions` (the default: what every compatible
 *    server serves) or `responses` for one that also serves the Responses API.
 *  - `requiresKey` — absent or `true`: a key is resolved like any provider's
 *    (BYOK, or the org fallback). `false` is the ADMINISTRATOR'S OPT-IN to a
 *    keyless server: calls carry no credential, no user needs a key, and
 *    usage is recorded with `keySource: 'none'` (docs/specs/ai-platform.md
 *    §2.24).
 */
export const systemAiCompatibleProviderSchema = systemAiProviderSchema.extend({
  baseUrl: aiEndpointUrlSchema(AI_COMPATIBLE_ENDPOINT_SCHEMES).optional(),
  apiStyle: z.enum(AI_OPENAI_API_STYLES).optional(),
  requiresKey: z.boolean().optional(),
});

export const systemAiSchema = z.object({
  enabled: z.boolean(),
  keyPolicy: z.enum(AI_KEY_POLICIES),
  providers: z.object({
    openai: systemAiProviderSchema,
    // #446. Appended; a stored row written before this slot existed is
    // salvaged per provider by `SystemSettingsService`, never reset.
    anthropic: systemAiProviderSchema,
    // #447. Appended, and salvaged per provider exactly like `anthropic`.
    gemini: systemAiProviderSchema,
    // #448. Appended, each with its own extended slot shape.
    'azure-openai': systemAiAzureProviderSchema,
    'openai-compatible': systemAiCompatibleProviderSchema,
  }),
  defaults: z.object({
    maxOutputTokensCap: z.number().int().positive().optional(),
    allowBackgroundRuns: z.boolean(),
    // #449. Appended; see the header for how an older row reads it.
    allowRealtime: z.boolean(),
  }),
  logPromptContent: z.boolean(),
  usageRetentionDays: z.number().int().min(1).max(AI_USAGE_RETENTION_MAX_DAYS),
  hostedTools: z.object({
    web_search: z.boolean(),
    file_search: z.boolean(),
    code_interpreter: z.boolean(),
    image_generation: z.boolean(),
    mcp: z.boolean(),
    mcpAllowedHosts: z.array(mcpAllowedHostSchema).max(AI_MCP_ALLOWED_HOSTS_MAX),
  }),
  limits: systemAiLimitsSchema,
  // #739: whether the DEPLOYMENT's provider key (the `ai` credential of the
  // system tier) may serve a call made in an organization that has no key of
  // its own, under the same rule an organization key does. `true`: today's
  // behaviour, where the deployment key is the only administrator key.
  deploymentKeyServesOrgs: z.boolean(),
});

export type SystemAiValue = z.infer<typeof systemAiSchema>;

/**
 * `ai`, one level deep — matching `systemStoragePatchSchema`'s own shape one
 * level further in: `providers` and `defaults` are each optional as a whole
 * AND optional field by field inside, so
 * `{ "ai": { "providers": { "openai": { "enabled": true } } } }` is a legal body that leaves `defaults` and
 * `logPromptContent` untouched. See `SystemSettingsService.patchSettings`
 * for the merge this shape is built to support.
 */
//
// `baseUrl` and `maxOutputTokensCap` are the two OPTIONAL fields of the stored
// value, so they are the two a PATCH must be able to REMOVE: absent leaves the
// stored value alone, explicit `null` deletes it (back to "provider default
// host" / "no cap"). The same absent-vs-null distinction
// `storage.forcePathStyle` and `maintenance.startedAt` already draw; without
// it an override, once set, could be changed but never cleared (#428).
/** One provider's slot in a PATCH: each field optional, `baseUrl: null` removes the override. */
const systemAiProviderPatchSchema = z.object({
  enabled: z.boolean().optional(),
  baseUrl: z.string().url().nullable().optional(),
});

/**
 * The #448 slots in a PATCH: every optional field takes `null` to remove it
 * (back to its default). `deployments` REPLACES wholesale when present — the
 * same rule as `mcpAllowedHosts` and `limits`: a merge could never remove one.
 */
const systemAiAzureProviderPatchSchema = z.object({
  enabled: z.boolean().optional(),
  baseUrl: aiEndpointUrlSchema(AI_AZURE_ENDPOINT_SCHEMES).nullable().optional(),
  apiVersion: z.string().regex(AI_AZURE_API_VERSION_PATTERN).nullable().optional(),
  apiStyle: z.enum(AI_OPENAI_API_STYLES).nullable().optional(),
  deployments: aiAzureDeploymentsSchema.nullable().optional(),
});

const systemAiCompatibleProviderPatchSchema = z.object({
  enabled: z.boolean().optional(),
  baseUrl: aiEndpointUrlSchema(AI_COMPATIBLE_ENDPOINT_SCHEMES).nullable().optional(),
  apiStyle: z.enum(AI_OPENAI_API_STYLES).nullable().optional(),
  requiresKey: z.boolean().nullable().optional(),
});

export const systemAiPatchSchema = z.object({
  enabled: z.boolean().optional(),
  keyPolicy: z.enum(AI_KEY_POLICIES).optional(),
  providers: z
    .object({
      openai: systemAiProviderPatchSchema.optional(),
      anthropic: systemAiProviderPatchSchema.optional(),
      gemini: systemAiProviderPatchSchema.optional(),
      'azure-openai': systemAiAzureProviderPatchSchema.optional(),
      'openai-compatible': systemAiCompatibleProviderPatchSchema.optional(),
    })
    .optional(),
  defaults: z
    .object({
      maxOutputTokensCap: z.number().int().positive().nullable().optional(),
      allowBackgroundRuns: z.boolean().optional(),
      allowRealtime: z.boolean().optional(),
    })
    .optional(),
  logPromptContent: z.boolean().optional(),
  usageRetentionDays: z.number().int().min(1).max(AI_USAGE_RETENTION_MAX_DAYS).optional(),
  // Field by field; `mcpAllowedHosts` REPLACES wholesale (RFC 7396's rule
  // for arrays, and `notifications.disabledEvents`' precedent).
  hostedTools: z
    .object({
      web_search: z.boolean().optional(),
      file_search: z.boolean().optional(),
      code_interpreter: z.boolean().optional(),
      image_generation: z.boolean().optional(),
      mcp: z.boolean().optional(),
      mcpAllowedHosts: z.array(mcpAllowedHostSchema).max(AI_MCP_ALLOWED_HOSTS_MAX).optional(),
    })
    .optional(),
  // #450. REPLACES WHOLESALE when present — the whole `limits` object is the
  // new value. A field-by-field merge could never REMOVE a limit (or a
  // per-model entry), and "absent means unlimited" is the one way to lift
  // one; the same reasoning as `mcpAllowedHosts` above.
  limits: systemAiLimitsSchema.optional(),
  // #739. See `systemAiSchema`.
  deploymentKeyServesOrgs: z.boolean().optional(),
});


// =============================================================================
// AI platform policy on the wire (#423, epic #419, umbrella #418)
// =============================================================================
//
// Restated here rather than imported, for the reason at the top of this file.
// Optional in the PUT body like the operations namespaces and `storage`
// above, and for the identical reason: this block ships ahead of every
// client that knows it exists.
//
// NO API KEY FIELD, ON EITHER SCHEMA, EVER. A user's own key is
// `UserAiKey.secret`, written through its own dedicated endpoint (#428), not
// through this document; an org-wide fallback key belongs in the encrypted
// credential store. See `common/schemas/settings.schema.ts`, which carries
// the argument and a compile-time proof of the absence.
//
// Bounds mirror `systemAiSchema` exactly.

// `ai.limits` (#450). Every field optional — absent means unlimited. Used by
// the PUT body and (whole, since a PATCH replaces it wholesale) the PATCH body.
export const aiLimitsSettingsSchema = z.object({
  perUser: z
    .object({
      requestsPerMinute: aiLimitValueSchema.optional(),
      requestsPerDay: aiLimitValueSchema.optional(),
    })
    .optional(),
  orgKey: z
    .object({
      requestsPerDayPerUser: aiLimitValueSchema.optional(),
      tokensPerDayPerUser: aiLimitValueSchema.optional(),
    })
    .optional(),
  // #739: the deployment default PER ORGANIZATION (requests and output tokens
  // per UTC day, counted over every call made in that organization); absent
  // means unlimited. An organization may only lower it (its org layer).
  perOrg: z
    .object({
      requestsPerDay: aiLimitValueSchema.optional(),
      outputTokensPerDay: aiLimitValueSchema.optional(),
    })
    .optional(),
  perModel: z
    .record(
      z.string().max(AI_LIMIT_MODEL_KEY_MAX).regex(AI_LIMIT_MODEL_KEY_PATTERN),
      z.object({
        maxOutputTokens: aiLimitValueSchema.optional(),
        requestsPerMinutePerUser: aiLimitValueSchema.optional(),
      }),
    )
    .refine((value) => Object.keys(value).length <= AI_LIMITS_PER_MODEL_MAX, {
      message: `At most ${AI_LIMITS_PER_MODEL_MAX} per-model limits`,
    })
    .optional(),
});

export const aiSettingsSchema = z.object({
  enabled: z.boolean(),
  keyPolicy: z.enum(AI_KEY_POLICIES),
  providers: z.object({
    openai: z.object({
      enabled: z.boolean(),
      baseUrl: z.string().url().optional(),
    }),
    anthropic: z.object({
      enabled: z.boolean(),
      baseUrl: z.string().url().optional(),
    }),
    gemini: z.object({
      enabled: z.boolean(),
      baseUrl: z.string().url().optional(),
    }),
    // #448 — see `systemAiAzureProviderSchema` / `systemAiCompatibleProviderSchema`.
    'azure-openai': z.object({
      enabled: z.boolean(),
      baseUrl: aiEndpointUrlSchema(AI_AZURE_ENDPOINT_SCHEMES).optional(),
      apiVersion: z.string().regex(AI_AZURE_API_VERSION_PATTERN).optional(),
      apiStyle: z.enum(AI_OPENAI_API_STYLES).optional(),
      deployments: aiAzureDeploymentsSchema.optional(),
    }),
    'openai-compatible': z.object({
      enabled: z.boolean(),
      baseUrl: aiEndpointUrlSchema(AI_COMPATIBLE_ENDPOINT_SCHEMES).optional(),
      apiStyle: z.enum(AI_OPENAI_API_STYLES).optional(),
      requiresKey: z.boolean().optional(),
    }),
  }),
  defaults: z.object({
    maxOutputTokensCap: z.number().int().positive().optional(),
    allowBackgroundRuns: z.boolean(),
    allowRealtime: z.boolean(),
  }),
  logPromptContent: z.boolean(),
  usageRetentionDays: z.number().int().min(1).max(AI_USAGE_RETENTION_MAX_DAYS),
  hostedTools: z.object({
    web_search: z.boolean(),
    file_search: z.boolean(),
    code_interpreter: z.boolean(),
    image_generation: z.boolean(),
    mcp: z.boolean(),
    mcpAllowedHosts: z
      .array(z.string().max(253).regex(AI_MCP_ALLOWED_HOST_PATTERN))
      .max(AI_MCP_ALLOWED_HOSTS_MAX),
  }),
  limits: aiLimitsSettingsSchema,
  // #739: optional on the wire, so a client that predates it still PUTs a
  // legal body; absent keeps the stored value (default `true`).
  deploymentKeyServesOrgs: z.boolean().optional(),
});

// #423, epic #419. Optional at the namespace level and field by field
// inside, one level into each `providers.<id>` and `defaults`, matching
// `storage` above — `{ "ai": { "enabled": true } }` must be a legal body,
// or the admin page has to send the whole namespace to flip one switch.
// NO API KEY FIELD — see the section header above.
export const aiSettingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  keyPolicy: z.enum(AI_KEY_POLICIES).optional(),
  providers: z
    .object({
      openai: z
        .object({
          enabled: z.boolean().optional(),
          // Absent leaves it alone; explicit `null` removes the override.
          baseUrl: z.string().url().nullable().optional(),
        })
        .optional(),
      anthropic: z
        .object({
          enabled: z.boolean().optional(),
          baseUrl: z.string().url().nullable().optional(),
        })
        .optional(),
      gemini: z
        .object({
          enabled: z.boolean().optional(),
          baseUrl: z.string().url().nullable().optional(),
        })
        .optional(),
      // #448. `null` removes an optional field (back to its default);
      // `deployments` replaces wholesale when present.
      'azure-openai': z
        .object({
          enabled: z.boolean().optional(),
          baseUrl: aiEndpointUrlSchema(AI_AZURE_ENDPOINT_SCHEMES).nullable().optional(),
          apiVersion: z.string().regex(AI_AZURE_API_VERSION_PATTERN).nullable().optional(),
          apiStyle: z.enum(AI_OPENAI_API_STYLES).nullable().optional(),
          deployments: aiAzureDeploymentsSchema.nullable().optional(),
        })
        .optional(),
      'openai-compatible': z
        .object({
          enabled: z.boolean().optional(),
          baseUrl: aiEndpointUrlSchema(AI_COMPATIBLE_ENDPOINT_SCHEMES).nullable().optional(),
          apiStyle: z.enum(AI_OPENAI_API_STYLES).nullable().optional(),
          requiresKey: z.boolean().nullable().optional(),
        })
        .optional(),
    })
    .optional(),
  defaults: z
    .object({
      // Absent leaves it alone; explicit `null` removes the cap.
      maxOutputTokensCap: z.number().int().positive().nullable().optional(),
      allowBackgroundRuns: z.boolean().optional(),
      allowRealtime: z.boolean().optional(),
    })
    .optional(),
  logPromptContent: z.boolean().optional(),
  usageRetentionDays: z.number().int().min(1).max(AI_USAGE_RETENTION_MAX_DAYS).optional(),
  // #442. Booleans field by field; `mcpAllowedHosts` replaces wholesale.
  hostedTools: z
    .object({
      web_search: z.boolean().optional(),
      file_search: z.boolean().optional(),
      code_interpreter: z.boolean().optional(),
      image_generation: z.boolean().optional(),
      mcp: z.boolean().optional(),
      mcpAllowedHosts: z
        .array(z.string().max(253).regex(AI_MCP_ALLOWED_HOST_PATTERN))
        .max(AI_MCP_ALLOWED_HOSTS_MAX)
        .optional(),
    })
    .optional(),
  // #450. Replaces wholesale when present — see `systemAiPatchSchema`.
  limits: aiLimitsSettingsSchema.optional(),
  deploymentKeyServesOrgs: z.boolean().optional(),
});

// #423, epic #419, umbrella #418 — the AI platform policy, published for
// the same reason the operations namespaces and `storage` above are: a
// block this response omits is a block no client can echo back in a PUT.
//
// THERE IS NO API KEY FIELD AND THERE MUST NEVER BE ONE. A user's own key
// is `UserAiKey.secret`, in its own table; an org-wide fallback key belongs
// in the encrypted credential store. See
// `common/schemas/settings.schema.ts` for the full argument and its
// compile-time proof.
export const aiResponseSchema = z.object({
  enabled: z.boolean(),
  keyPolicy: z.enum(['byok', 'byok_with_org_fallback']),
  providers: z.object({
    openai: z.object({
      enabled: z.boolean(),
      baseUrl: z.string().optional(),
    }),
    anthropic: z.object({
      enabled: z.boolean(),
      baseUrl: z.string().optional(),
    }),
    gemini: z.object({
      enabled: z.boolean(),
      baseUrl: z.string().optional(),
    }),
    'azure-openai': z.object({
      enabled: z.boolean(),
      baseUrl: z.string().optional(),
      apiVersion: z.string().optional(),
      apiStyle: z.enum(['responses', 'chat_completions']).optional(),
      deployments: z.record(z.string(), z.string()).optional(),
    }),
    'openai-compatible': z.object({
      enabled: z.boolean(),
      baseUrl: z.string().optional(),
      apiStyle: z.enum(['responses', 'chat_completions']).optional(),
      requiresKey: z.boolean().optional(),
    }),
  }),
  defaults: z.object({
    maxOutputTokensCap: z.number().optional(),
    allowBackgroundRuns: z.boolean(),
    allowRealtime: z.boolean(),
  }),
  logPromptContent: z.boolean(),
  usageRetentionDays: z.number().int(),
  hostedTools: z.object({
    web_search: z.boolean(),
    file_search: z.boolean(),
    code_interpreter: z.boolean(),
    image_generation: z.boolean(),
    mcp: z.boolean(),
    mcpAllowedHosts: z.array(z.string()),
  }),
  limits: z.object({
    perUser: z
      .object({ requestsPerMinute: z.number().int().optional(), requestsPerDay: z.number().int().optional() })
      .optional(),
    orgKey: z
      .object({
        requestsPerDayPerUser: z.number().int().optional(),
        tokensPerDayPerUser: z.number().int().optional(),
      })
      .optional(),
    perOrg: z
      .object({ requestsPerDay: z.number().int().optional(), outputTokensPerDay: z.number().int().optional() })
      .optional(),
    perModel: z
      .record(
        z.string(),
        z.object({
          maxOutputTokens: z.number().int().optional(),
          requestsPerMinutePerUser: z.number().int().optional(),
        }),
      )
      .optional(),
  }),
  deploymentKeyServesOrgs: z.boolean(),
});

// =============================================================================
// The org layer of `ai` (issue #739): what one organization may set
// =============================================================================
//
// An organization can only TIGHTEN the deployment's policy (`/api/org-settings`,
// `org_ai_config:write`): turn AI off for its members, narrow `keyPolicy` from
// `byok_with_org_fallback` to `byok` (never the reverse), lower the per-org
// daily caps, and switch providers off. Every field optional (an org stores
// only what it overrides), no `.default()`, no secret.

const orgAiProviderSlotSchema = z.object({ enabled: z.boolean().optional() }).optional();

/**
 * The fields of the `ai` namespace an organization may set for itself.
 *
 * @stability experimental
 */
export const orgAiSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  keyPolicy: z.enum(AI_KEY_POLICIES).optional(),
  providers: z
    .object({
      openai: orgAiProviderSlotSchema,
      anthropic: orgAiProviderSlotSchema,
      gemini: orgAiProviderSlotSchema,
      'azure-openai': orgAiProviderSlotSchema,
      'openai-compatible': orgAiProviderSlotSchema,
    })
    .optional(),
  limits: z
    .object({
      perOrg: z
        .object({
          requestsPerDay: aiLimitValueSchema.optional(),
          outputTokensPerDay: aiLimitValueSchema.optional(),
        })
        .optional(),
    })
    .optional(),
});

/**
 * One organization's stored `ai` overrides.
 *
 * @stability experimental
 */
export type OrgAiSettingsValue = z.infer<typeof orgAiSettingsSchema>;

function lower(system: number | undefined, org: number | undefined): number | undefined {
  if (system === undefined) return org;
  if (org === undefined) return system;
  return Math.min(system, org);
}

/**
 * The effective `ai` policy of an organization: the deployment's value with
 * the organization's overrides applied, each of which can only tighten it.
 *
 * @param system - the deployment's `ai` value.
 * @param org - the organization's stored overrides.
 * @returns the effective value (a new object; `system` is not modified).
 *
 * @stability experimental
 */
export function tightenAiPolicy(system: SystemAiValue, org: Partial<OrgAiSettingsValue>): SystemAiValue {
  const keyPolicy: AiKeyPolicy = system.keyPolicy === 'byok' || org.keyPolicy === 'byok' ? 'byok' : system.keyPolicy;
  const providers = Object.fromEntries(
    Object.entries(system.providers).map(([id, slot]) => {
      const override = (org.providers as Record<string, { enabled?: boolean } | undefined> | undefined)?.[id];
      return [id, { ...slot, enabled: slot.enabled && (override?.enabled ?? true) }];
    }),
  ) as SystemAiValue['providers'];
  const systemPerOrg = system.limits.perOrg;
  const orgPerOrg = org.limits?.perOrg;
  const requestsPerDay = lower(systemPerOrg?.requestsPerDay, orgPerOrg?.requestsPerDay);
  const outputTokensPerDay = lower(systemPerOrg?.outputTokensPerDay, orgPerOrg?.outputTokensPerDay);
  const perOrg =
    requestsPerDay !== undefined || outputTokensPerDay !== undefined
      ? {
          ...(requestsPerDay !== undefined ? { requestsPerDay } : {}),
          ...(outputTokensPerDay !== undefined ? { outputTokensPerDay } : {}),
        }
      : undefined;
  const { perOrg: _drop, ...limits } = system.limits;

  return {
    ...system,
    enabled: system.enabled && (org.enabled ?? true),
    keyPolicy,
    providers,
    limits: { ...limits, ...(perOrg ? { perOrg } : {}) },
  };
}

// -----------------------------------------------------------------------------
// Compile-time proof that the `ai` namespace carries no secret (#423)
// -----------------------------------------------------------------------------
//
// Identical technique, one namespace over. Adding an `apiKey`/`secretKey`/…
// field (or any of the names below) to `systemAiSchema` makes
// `AiSettingsCarriesNoSecret` resolve to `never`, and this file stops
// compiling.
//
// If you are here because this line went red: a user's own provider key is
// `UserAiKey.secret` (ciphertext, in its own table — see
// `apps/api/prisma/schema.prisma`'s block comment on that model); an org-wide
// fallback key for `AI_KEY_POLICIES.byok_with_org_fallback` belongs in the
// encrypted credential store (`CredentialsService`), exactly as the storage
// secret access key does. Neither belongs in a document
// `GET /api/system-settings` returns wholesale and every settings audit row
// copies verbatim.

type AiSecretFieldNames =
  | 'secretAccessKey'
  | 'secretKey'
  | 'sessionToken'
  | 'secret'
  | 'password'
  | 'apiKey'
  | 'apiKeys'
  | 'key'
  | 'token';

export type AiSettingsCarriesNoSecret =
  Extract<keyof SystemAiValue, AiSecretFieldNames> extends never ? true : never;

export const AI_SETTINGS_CARRIES_NO_SECRET: AiSettingsCarriesNoSecret = true;

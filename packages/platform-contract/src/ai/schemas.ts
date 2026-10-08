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

import {
  AI_AZURE_API_VERSION_PATTERN,
  AI_AZURE_DEPLOYMENT_PATTERN,
  AI_AZURE_DEPLOYMENTS_MAX,
  AI_AZURE_ENDPOINT_SCHEMES,
  AI_AZURE_MODEL_ID_MAX,
  AI_COMPATIBLE_ENDPOINT_SCHEMES,
  AI_ENDPOINT_URL_MAX,
  AI_KEY_POLICIES,
  AI_LIMIT_MODEL_KEY_MAX,
  AI_LIMIT_MODEL_KEY_PATTERN,
  AI_LIMIT_VALUE_MAX,
  AI_LIMITS_PER_MODEL_MAX,
  AI_MCP_ALLOWED_HOST_PATTERN,
  AI_MCP_ALLOWED_HOSTS_MAX,
  AI_OPENAI_API_STYLES,
  AI_USAGE_RETENTION_MAX_DAYS,
  aiEndpointUrlProblem,
  type AiKeyPolicy,
  type AiKeyPolicyEnum,
  type AiOpenAiApiStyleEnum,
  type AiSecretFieldNames,
} from './constants.js';

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
  /** The model an AI surface pre-selects; `null` means none chosen. */
  defaultModel: z
    .object({
      /** Provider id. */
      provider: z.string(),
      /** Model id. */
      modelId: z.string(),
    })
    .nullable(),
});

/**
 * The per-user `ai` settings namespace (`userAiSettingsSchema`'s output).
 *
 * @stability experimental
 */
export type UserAiSettingsValue = z.infer<typeof userAiSettingsSchema>;

/**
 * `ai`, PATCH counterpart. `defaultModel` stays required-but-nullable inside
 * the object (an explicit `{ "ai": { "defaultModel": null } }` clears the
 * selection back to "none chosen"; the whole `ai` object itself is optional
 * to send at all, matching `dataTables`/`navigation` above).
 */
export const userAiSettingsPatchSchema = z.object({
  /** The model an AI surface pre-selects; `null` means none chosen. */
  defaultModel: z
    .object({
      /** Provider id. */
      provider: z.string(),
      /** Model id. */
      modelId: z.string(),
    })
    .nullable(),
});

/**
 * A `PATCH` of the per-user `ai` namespace.
 *
 * @stability experimental
 */
export type UserAiSettingsPatchValue = z.infer<typeof userAiSettingsPatchSchema>;





// A factory, not a shared instance: every field gets its own enum, exactly as
// when each was written inline (the generated OpenAPI document is unchanged).
const keyPolicyEnum = (): z.ZodEnum<AiKeyPolicyEnum> => z.enum(AI_KEY_POLICIES);




const mcpAllowedHostSchema = z.string().max(253).regex(AI_MCP_ALLOWED_HOST_PATTERN);





/**
 * One limit value: a positive integer up to `AI_LIMIT_VALUE_MAX`.
 *
 * @stability experimental
 */
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
  /** Limits on every call a user makes, whoever's key pays. */
  perUser: z
    .object({
      /** Requests per minute. */
      requestsPerMinute: aiLimitValueSchema.optional(),
      /** Requests per UTC day. */
      requestsPerDay: aiLimitValueSchema.optional(),
    })
    .optional(),
  /** Limits on the calls an administrator-managed key pays for. */
  orgKey: z
    .object({
      /** Requests per UTC day, per user. */
      requestsPerDayPerUser: aiLimitValueSchema.optional(),
      /** Input plus output tokens per UTC day, per user. */
      tokensPerDayPerUser: aiLimitValueSchema.optional(),
    })
    .optional(),
  // #739: the deployment default PER ORGANIZATION (requests and output tokens
  // per UTC day, counted over every call made in that organization); absent
  // means unlimited. An organization may only lower it (its org layer).
  /** Limits on one organization's whole daily volume, whoever's key pays (#739). */
  perOrg: z
    .object({
      /** Requests per UTC day. */
      requestsPerDay: aiLimitValueSchema.optional(),
      /** Output tokens per UTC day. */
      outputTokensPerDay: aiLimitValueSchema.optional(),
    })
    .optional(),
  /** Per-model limits, keyed `<provider>:<modelId>`. */
  perModel: z
    .record(
      z.string().max(AI_LIMIT_MODEL_KEY_MAX).regex(AI_LIMIT_MODEL_KEY_PATTERN),
      z.object({
        /** Output-token ceiling for every call to the model. */
        maxOutputTokens: aiLimitValueSchema.optional(),
        /** Requests per minute, per user, to the model. */
        requestsPerMinutePerUser: aiLimitValueSchema.optional(),
      }),
    )
    .refine((value) => Object.keys(value).length <= AI_LIMITS_PER_MODEL_MAX, {
      message: `At most ${AI_LIMITS_PER_MODEL_MAX} per-model limits`,
    })
    .optional(),
});

/**
 * `ai.limits`, as stored.
 *
 * @stability experimental
 */
export type SystemAiLimitsValue = z.infer<typeof systemAiLimitsSchema>;


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
  /** Whether AI is switched on (the kill switch). */
  enabled: z.boolean(),
  /** The endpoint override; absent means the provider's default. */
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





const apiStyleEnum = (): z.ZodEnum<AiOpenAiApiStyleEnum> => z.enum(AI_OPENAI_API_STYLES);




/**
 * Azure OpenAI's model id to deployment name map.
 *
 * @stability experimental
 */
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
  /** The endpoint override; absent means the provider's default. */
  baseUrl: aiEndpointUrlSchema(AI_AZURE_ENDPOINT_SCHEMES).optional(),
  /** Azure OpenAI: the API version. */
  apiVersion: z.string().regex(AI_AZURE_API_VERSION_PATTERN).optional(),
  /** Which API shape the server speaks (`responses` or `chat_completions`). */
  apiStyle: apiStyleEnum().optional(),
  /** Azure OpenAI: model id to deployment name. */
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
  /** The endpoint override; absent means the provider's default. */
  baseUrl: aiEndpointUrlSchema(AI_COMPATIBLE_ENDPOINT_SCHEMES).optional(),
  /** Which API shape the server speaks (`responses` or `chat_completions`). */
  apiStyle: apiStyleEnum().optional(),
  /** OpenAI-compatible: whether the server needs a key. */
  requiresKey: z.boolean().optional(),
});

/**
 * The stored `ai` system settings namespace: the deployment's AI policy.
 * It carries no key (see `AI_SETTINGS_CARRIES_NO_SECRET`).
 *
 * @stability experimental
 */
export const systemAiSchema = z.object({
  /** Whether AI is switched on (the kill switch). */
  enabled: z.boolean(),
  /** Whose key pays: the caller's own only (`byok`), or an administrator's as a fallback. */
  keyPolicy: keyPolicyEnum(),
  /** Per-provider settings, by provider id. */
  providers: z.object({
    /** The OpenAI slot. */
    openai: systemAiProviderSchema,
    // #446. Appended; a stored row written before this slot existed is
    // salvaged per provider by `SystemSettingsService`, never reset.
    /** The Anthropic slot. */
    anthropic: systemAiProviderSchema,
    // #447. Appended, and salvaged per provider exactly like `anthropic`.
    /** The Gemini slot. */
    gemini: systemAiProviderSchema,
    // #448. Appended, each with its own extended slot shape.
    /** The Azure OpenAI slot. */
    'azure-openai': systemAiAzureProviderSchema,
    /** The OpenAI-compatible server slot. */
    'openai-compatible': systemAiCompatibleProviderSchema,
  }),
  /** Deployment-wide defaults a call cannot exceed. */
  defaults: z.object({
    /** Output-token ceiling for every call; `null` means no cap. */
    maxOutputTokensCap: z.number().int().positive().optional(),
    /** Whether a call may be queued as a background run. */
    allowBackgroundRuns: z.boolean(),
    // #449. Appended; see the header for how an older row reads it.
    /** Whether realtime voice sessions may be minted. */
    allowRealtime: z.boolean(),
  }),
  /** Whether prompt and response text is written to the logs. */
  logPromptContent: z.boolean(),
  /** Days usage rows are kept. */
  usageRetentionDays: z.number().int().min(1).max(AI_USAGE_RETENTION_MAX_DAYS),
  /** Which provider-hosted tools are switched on (all off by default). */
  hostedTools: z.object({
    /** Hosted web search. */
    web_search: z.boolean(),
    /** Hosted file search. */
    file_search: z.boolean(),
    /** Hosted code execution. */
    code_interpreter: z.boolean(),
    /** Hosted image generation. */
    image_generation: z.boolean(),
    /** Remote MCP servers. */
    mcp: z.boolean(),
    /** Hosts a remote MCP server may be on; empty means any `https://` host. */
    mcpAllowedHosts: z.array(mcpAllowedHostSchema).max(AI_MCP_ALLOWED_HOSTS_MAX),
  }),
  /** Rate limits and output caps; every absent field is unlimited. */
  limits: systemAiLimitsSchema,
  // #739: whether the DEPLOYMENT's provider key (the `ai` credential of the
  // system tier) may serve a call made in an organization that has no key of
  // its own, under the same rule an organization key does. `true`: today's
  // behaviour, where the deployment key is the only administrator key.
  /** Whether the deployment's keys pay for an organization that stores no key of its own (#739). */
  deploymentKeyServesOrgs: z.boolean(),
});

/**
 * The stored `ai` namespace (`systemAiSchema`'s output).
 *
 * @stability experimental
 */
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
  /** Whether the provider is switched on. */
  enabled: z.boolean().optional(),
  /** The endpoint override; `null` removes it. */
  baseUrl: z.string().url().nullable().optional(),
});

/**
 * The #448 slots in a PATCH: every optional field takes `null` to remove it
 * (back to its default). `deployments` REPLACES wholesale when present — the
 * same rule as `mcpAllowedHosts` and `limits`: a merge could never remove one.
 */
const systemAiAzureProviderPatchSchema = z.object({
  /** Whether the provider is switched on. */
  enabled: z.boolean().optional(),
  /** The Azure endpoint; `null` removes it. */
  baseUrl: aiEndpointUrlSchema(AI_AZURE_ENDPOINT_SCHEMES).nullable().optional(),
  /** The API version; `null` restores the default. */
  apiVersion: z.string().regex(AI_AZURE_API_VERSION_PATTERN).nullable().optional(),
  /** The API shape; `null` restores the default. */
  apiStyle: apiStyleEnum().nullable().optional(),
  /** Model id to deployment name, replaced whole; `null` clears it. */
  deployments: aiAzureDeploymentsSchema.nullable().optional(),
});

const systemAiCompatibleProviderPatchSchema = z.object({
  /** Whether the provider is switched on. */
  enabled: z.boolean().optional(),
  /** The server's endpoint; `null` removes it. */
  baseUrl: aiEndpointUrlSchema(AI_COMPATIBLE_ENDPOINT_SCHEMES).nullable().optional(),
  /** The API shape; `null` restores the default. */
  apiStyle: apiStyleEnum().nullable().optional(),
  /** Whether the server needs a key; `null` restores the default (yes). */
  requiresKey: z.boolean().nullable().optional(),
});

/**
 * A `PATCH /api/system-settings` body's `ai` member: every field optional.
 *
 * @stability experimental
 */
export const systemAiPatchSchema = z.object({
  /** Whether AI is switched on (the kill switch). */
  enabled: z.boolean().optional(),
  /** Whose key pays: the caller's own only (`byok`), or an administrator's as a fallback. */
  keyPolicy: keyPolicyEnum().optional(),
  /** Per-provider settings, by provider id. */
  providers: z
    .object({
      /** The OpenAI slot. */
      openai: systemAiProviderPatchSchema.optional(),
      /** The Anthropic slot. */
      anthropic: systemAiProviderPatchSchema.optional(),
      /** The Gemini slot. */
      gemini: systemAiProviderPatchSchema.optional(),
      /** The Azure OpenAI slot. */
      'azure-openai': systemAiAzureProviderPatchSchema.optional(),
      /** The OpenAI-compatible server slot. */
      'openai-compatible': systemAiCompatibleProviderPatchSchema.optional(),
    })
    .optional(),
  /** Deployment-wide defaults a call cannot exceed. */
  defaults: z
    .object({
      /** Output-token ceiling for every call; `null` means no cap. */
      maxOutputTokensCap: z.number().int().positive().nullable().optional(),
      /** Whether a call may be queued as a background run. */
      allowBackgroundRuns: z.boolean().optional(),
      /** Whether realtime voice sessions may be minted. */
      allowRealtime: z.boolean().optional(),
    })
    .optional(),
  /** Whether prompt and response text is written to the logs. */
  logPromptContent: z.boolean().optional(),
  /** Days usage rows are kept. */
  usageRetentionDays: z.number().int().min(1).max(AI_USAGE_RETENTION_MAX_DAYS).optional(),
  // Field by field; `mcpAllowedHosts` REPLACES wholesale (RFC 7396's rule
  // for arrays, and `notifications.disabledEvents`' precedent).
  /** Which provider-hosted tools are switched on (all off by default). */
  hostedTools: z
    .object({
      /** Hosted web search. */
      web_search: z.boolean().optional(),
      /** Hosted file search. */
      file_search: z.boolean().optional(),
      /** Hosted code execution. */
      code_interpreter: z.boolean().optional(),
      /** Hosted image generation. */
      image_generation: z.boolean().optional(),
      /** Remote MCP servers. */
      mcp: z.boolean().optional(),
      /** Hosts a remote MCP server may be on; empty means any `https://` host. */
      mcpAllowedHosts: z.array(mcpAllowedHostSchema).max(AI_MCP_ALLOWED_HOSTS_MAX).optional(),
    })
    .optional(),
  // #450. REPLACES WHOLESALE when present — the whole `limits` object is the
  // new value. A field-by-field merge could never REMOVE a limit (or a
  // per-model entry), and "absent means unlimited" is the one way to lift
  // one; the same reasoning as `mcpAllowedHosts` above.
  /** Rate limits and output caps; every absent field is unlimited. */
  limits: systemAiLimitsSchema.optional(),
  // #739. See `systemAiSchema`.
  /** Whether the deployment's keys pay for an organization that stores no key of its own (#739). */
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
/**
 * The admin `PUT /api/admin/ai/config` body's `limits`.
 *
 * @stability experimental
 */
export const aiLimitsSettingsSchema = z.object({
  /** Limits on every call a user makes, whoever's key pays. */
  perUser: z
    .object({
      /** Requests per minute. */
      requestsPerMinute: aiLimitValueSchema.optional(),
      /** Requests per UTC day. */
      requestsPerDay: aiLimitValueSchema.optional(),
    })
    .optional(),
  /** Limits on the calls an administrator-managed key pays for. */
  orgKey: z
    .object({
      /** Requests per UTC day, per user. */
      requestsPerDayPerUser: aiLimitValueSchema.optional(),
      /** Input plus output tokens per UTC day, per user. */
      tokensPerDayPerUser: aiLimitValueSchema.optional(),
    })
    .optional(),
  // #739: the deployment default PER ORGANIZATION (requests and output tokens
  // per UTC day, counted over every call made in that organization); absent
  // means unlimited. An organization may only lower it (its org layer).
  /** Limits on one organization's whole daily volume, whoever's key pays (#739). */
  perOrg: z
    .object({
      /** Requests per UTC day. */
      requestsPerDay: aiLimitValueSchema.optional(),
      /** Output tokens per UTC day. */
      outputTokensPerDay: aiLimitValueSchema.optional(),
    })
    .optional(),
  /** Per-model limits, keyed `<provider>:<modelId>`. */
  perModel: z
    .record(
      z.string().max(AI_LIMIT_MODEL_KEY_MAX).regex(AI_LIMIT_MODEL_KEY_PATTERN),
      z.object({
        /** Output-token ceiling for every call to the model. */
        maxOutputTokens: aiLimitValueSchema.optional(),
        /** Requests per minute, per user, to the model. */
        requestsPerMinutePerUser: aiLimitValueSchema.optional(),
      }),
    )
    .refine((value) => Object.keys(value).length <= AI_LIMITS_PER_MODEL_MAX, {
      message: `At most ${AI_LIMITS_PER_MODEL_MAX} per-model limits`,
    })
    .optional(),
});

/**
 * The `ai` namespace on the wire of `PUT /api/system-settings`.
 *
 * @stability experimental
 */
export const aiSettingsSchema = z.object({
  /** Whether AI is switched on (the kill switch). */
  enabled: z.boolean(),
  /** Whose key pays: the caller's own only (`byok`), or an administrator's as a fallback. */
  keyPolicy: keyPolicyEnum(),
  /** Per-provider settings, by provider id. */
  providers: z.object({
    /** The OpenAI slot. */
    openai: z.object({
      /** Whether the provider is switched on. */
      enabled: z.boolean(),
      /** The endpoint override; absent means the provider's default. */
      baseUrl: z.string().url().optional(),
    }),
    /** The Anthropic slot. */
    anthropic: z.object({
      /** Whether the provider is switched on. */
      enabled: z.boolean(),
      /** The endpoint override; absent means the provider's default. */
      baseUrl: z.string().url().optional(),
    }),
    /** The Gemini slot. */
    gemini: z.object({
      /** Whether the provider is switched on. */
      enabled: z.boolean(),
      /** The endpoint override; absent means the provider's default. */
      baseUrl: z.string().url().optional(),
    }),
    // #448 — see `systemAiAzureProviderSchema` / `systemAiCompatibleProviderSchema`.
    /** The Azure OpenAI slot. */
    'azure-openai': z.object({
      /** Whether the provider is switched on. */
      enabled: z.boolean(),
      /** The endpoint override; absent means the provider's default. */
      baseUrl: aiEndpointUrlSchema(AI_AZURE_ENDPOINT_SCHEMES).optional(),
      /** Azure OpenAI: the API version. */
      apiVersion: z.string().regex(AI_AZURE_API_VERSION_PATTERN).optional(),
      /** Which API shape the server speaks (`responses` or `chat_completions`). */
      apiStyle: apiStyleEnum().optional(),
      /** Azure OpenAI: model id to deployment name. */
      deployments: aiAzureDeploymentsSchema.optional(),
    }),
    /** The OpenAI-compatible server slot. */
    'openai-compatible': z.object({
      /** Whether the provider is switched on. */
      enabled: z.boolean(),
      /** The endpoint override; absent means the provider's default. */
      baseUrl: aiEndpointUrlSchema(AI_COMPATIBLE_ENDPOINT_SCHEMES).optional(),
      /** Which API shape the server speaks (`responses` or `chat_completions`). */
      apiStyle: apiStyleEnum().optional(),
      /** OpenAI-compatible: whether the server needs a key. */
      requiresKey: z.boolean().optional(),
    }),
  }),
  /** Deployment-wide defaults a call cannot exceed. */
  defaults: z.object({
    /** Output-token ceiling for every call; `null` means no cap. */
    maxOutputTokensCap: z.number().int().positive().optional(),
    /** Whether a call may be queued as a background run. */
    allowBackgroundRuns: z.boolean(),
    /** Whether realtime voice sessions may be minted. */
    allowRealtime: z.boolean(),
  }),
  /** Whether prompt and response text is written to the logs. */
  logPromptContent: z.boolean(),
  /** Days usage rows are kept. */
  usageRetentionDays: z.number().int().min(1).max(AI_USAGE_RETENTION_MAX_DAYS),
  /** Which provider-hosted tools are switched on (all off by default). */
  hostedTools: z.object({
    /** Hosted web search. */
    web_search: z.boolean(),
    /** Hosted file search. */
    file_search: z.boolean(),
    /** Hosted code execution. */
    code_interpreter: z.boolean(),
    /** Hosted image generation. */
    image_generation: z.boolean(),
    /** Remote MCP servers. */
    mcp: z.boolean(),
    /** Hosts a remote MCP server may be on; empty means any `https://` host. */
    mcpAllowedHosts: z
      .array(z.string().max(253).regex(AI_MCP_ALLOWED_HOST_PATTERN))
      .max(AI_MCP_ALLOWED_HOSTS_MAX),
  }),
  /** Rate limits and output caps; every absent field is unlimited. */
  limits: aiLimitsSettingsSchema,
  // #739: optional on the wire, so a client that predates it still PUTs a
  // legal body; absent keeps the stored value (default `true`).
  /** Whether the deployment's keys pay for an organization that stores no key of its own (#739). */
  deploymentKeyServesOrgs: z.boolean().optional(),
});

// #423, epic #419. Optional at the namespace level and field by field
// inside, one level into each `providers.<id>` and `defaults`, matching
// `storage` above — `{ "ai": { "enabled": true } }` must be a legal body,
// or the admin page has to send the whole namespace to flip one switch.
// NO API KEY FIELD — see the section header above.
/**
 * The `ai` namespace on the wire of `PATCH /api/system-settings`.
 *
 * @stability experimental
 */
export const aiSettingsPatchSchema = z.object({
  /** Whether AI is switched on (the kill switch). */
  enabled: z.boolean().optional(),
  /** Whose key pays: the caller's own only (`byok`), or an administrator's as a fallback. */
  keyPolicy: keyPolicyEnum().optional(),
  /** Per-provider settings, by provider id. */
  providers: z
    .object({
      /** The OpenAI slot. */
      openai: z
        .object({
          /** Whether the provider is switched on. */
          enabled: z.boolean().optional(),
          // Absent leaves it alone; explicit `null` removes the override.
          /** The endpoint override; absent means the provider's default. */
          baseUrl: z.string().url().nullable().optional(),
        })
        .optional(),
      /** The Anthropic slot. */
      anthropic: z
        .object({
          /** Whether the provider is switched on. */
          enabled: z.boolean().optional(),
          /** The endpoint override; absent means the provider's default. */
          baseUrl: z.string().url().nullable().optional(),
        })
        .optional(),
      /** The Gemini slot. */
      gemini: z
        .object({
          /** Whether the provider is switched on. */
          enabled: z.boolean().optional(),
          /** The endpoint override; absent means the provider's default. */
          baseUrl: z.string().url().nullable().optional(),
        })
        .optional(),
      // #448. `null` removes an optional field (back to its default);
      // `deployments` replaces wholesale when present.
      /** The Azure OpenAI slot. */
      'azure-openai': z
        .object({
          /** Whether the provider is switched on. */
          enabled: z.boolean().optional(),
          /** The endpoint override; absent means the provider's default. */
          baseUrl: aiEndpointUrlSchema(AI_AZURE_ENDPOINT_SCHEMES).nullable().optional(),
          /** Azure OpenAI: the API version. */
          apiVersion: z.string().regex(AI_AZURE_API_VERSION_PATTERN).nullable().optional(),
          /** Which API shape the server speaks (`responses` or `chat_completions`). */
          apiStyle: apiStyleEnum().nullable().optional(),
          /** Azure OpenAI: model id to deployment name. */
          deployments: aiAzureDeploymentsSchema.nullable().optional(),
        })
        .optional(),
      /** The OpenAI-compatible server slot. */
      'openai-compatible': z
        .object({
          /** Whether the provider is switched on. */
          enabled: z.boolean().optional(),
          /** The endpoint override; absent means the provider's default. */
          baseUrl: aiEndpointUrlSchema(AI_COMPATIBLE_ENDPOINT_SCHEMES).nullable().optional(),
          /** Which API shape the server speaks (`responses` or `chat_completions`). */
          apiStyle: apiStyleEnum().nullable().optional(),
          /** OpenAI-compatible: whether the server needs a key. */
          requiresKey: z.boolean().nullable().optional(),
        })
        .optional(),
    })
    .optional(),
  /** Deployment-wide defaults a call cannot exceed. */
  defaults: z
    .object({
      // Absent leaves it alone; explicit `null` removes the cap.
      /** Output-token ceiling for every call; `null` means no cap. */
      maxOutputTokensCap: z.number().int().positive().nullable().optional(),
      /** Whether a call may be queued as a background run. */
      allowBackgroundRuns: z.boolean().optional(),
      /** Whether realtime voice sessions may be minted. */
      allowRealtime: z.boolean().optional(),
    })
    .optional(),
  /** Whether prompt and response text is written to the logs. */
  logPromptContent: z.boolean().optional(),
  /** Days usage rows are kept. */
  usageRetentionDays: z.number().int().min(1).max(AI_USAGE_RETENTION_MAX_DAYS).optional(),
  // #442. Booleans field by field; `mcpAllowedHosts` replaces wholesale.
  /** Which provider-hosted tools are switched on (all off by default). */
  hostedTools: z
    .object({
      /** Hosted web search. */
      web_search: z.boolean().optional(),
      /** Hosted file search. */
      file_search: z.boolean().optional(),
      /** Hosted code execution. */
      code_interpreter: z.boolean().optional(),
      /** Hosted image generation. */
      image_generation: z.boolean().optional(),
      /** Remote MCP servers. */
      mcp: z.boolean().optional(),
      /** Hosts a remote MCP server may be on; empty means any `https://` host. */
      mcpAllowedHosts: z
        .array(z.string().max(253).regex(AI_MCP_ALLOWED_HOST_PATTERN))
        .max(AI_MCP_ALLOWED_HOSTS_MAX)
        .optional(),
    })
    .optional(),
  // #450. Replaces wholesale when present — see `systemAiPatchSchema`.
  /** Rate limits and output caps; every absent field is unlimited. */
  limits: aiLimitsSettingsSchema.optional(),
  /** Whether the deployment's keys pay for an organization that stores no key of its own (#739). */
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
/**
 * The `ai` namespace as `GET /api/system-settings` answers it.
 *
 * @stability experimental
 */
export const aiResponseSchema = z.object({
  /** Whether AI is switched on (the kill switch). */
  enabled: z.boolean(),
  /** Whose key pays: the caller's own only (`byok`), or an administrator's as a fallback. */
  keyPolicy: keyPolicyEnum(),
  /** Per-provider settings, by provider id. */
  providers: z.object({
    /** The OpenAI slot. */
    openai: z.object({
      /** Whether the provider is switched on. */
      enabled: z.boolean(),
      /** The endpoint override; absent means the provider's default. */
      baseUrl: z.string().optional(),
    }),
    /** The Anthropic slot. */
    anthropic: z.object({
      /** Whether the provider is switched on. */
      enabled: z.boolean(),
      /** The endpoint override; absent means the provider's default. */
      baseUrl: z.string().optional(),
    }),
    /** The Gemini slot. */
    gemini: z.object({
      /** Whether the provider is switched on. */
      enabled: z.boolean(),
      /** The endpoint override; absent means the provider's default. */
      baseUrl: z.string().optional(),
    }),
    /** The Azure OpenAI slot. */
    'azure-openai': z.object({
      /** Whether the provider is switched on. */
      enabled: z.boolean(),
      /** The endpoint override; absent means the provider's default. */
      baseUrl: z.string().optional(),
      /** Azure OpenAI: the API version. */
      apiVersion: z.string().optional(),
      /** Which API shape the server speaks (`responses` or `chat_completions`). */
      apiStyle: apiStyleEnum().optional(),
      /** Azure OpenAI: model id to deployment name. */
      deployments: z.record(z.string(), z.string()).optional(),
    }),
    /** The OpenAI-compatible server slot. */
    'openai-compatible': z.object({
      /** Whether the provider is switched on. */
      enabled: z.boolean(),
      /** The endpoint override; absent means the provider's default. */
      baseUrl: z.string().optional(),
      /** Which API shape the server speaks (`responses` or `chat_completions`). */
      apiStyle: apiStyleEnum().optional(),
      /** OpenAI-compatible: whether the server needs a key. */
      requiresKey: z.boolean().optional(),
    }),
  }),
  /** Deployment-wide defaults a call cannot exceed. */
  defaults: z.object({
    /** Output-token ceiling for every call; `null` means no cap. */
    maxOutputTokensCap: z.number().optional(),
    /** Whether a call may be queued as a background run. */
    allowBackgroundRuns: z.boolean(),
    /** Whether realtime voice sessions may be minted. */
    allowRealtime: z.boolean(),
  }),
  /** Whether prompt and response text is written to the logs. */
  logPromptContent: z.boolean(),
  /** Days usage rows are kept. */
  usageRetentionDays: z.number().int(),
  /** Which provider-hosted tools are switched on (all off by default). */
  hostedTools: z.object({
    /** Hosted web search. */
    web_search: z.boolean(),
    /** Hosted file search. */
    file_search: z.boolean(),
    /** Hosted code execution. */
    code_interpreter: z.boolean(),
    /** Hosted image generation. */
    image_generation: z.boolean(),
    /** Remote MCP servers. */
    mcp: z.boolean(),
    /** Hosts a remote MCP server may be on; empty means any `https://` host. */
    mcpAllowedHosts: z.array(z.string()),
  }),
  /** Rate limits and output caps; every absent field is unlimited. */
  limits: z.object({
    /** Limits on every call a user makes, whoever's key pays. */
    perUser: z
      .object({
        /** Requests per minute. */
        requestsPerMinute: z.number().int().optional(),
        /** Requests per UTC day. */
        requestsPerDay: z.number().int().optional(),
      })
      .optional(),
    /** Limits on the calls an administrator-managed key pays for. */
    orgKey: z
      .object({
        /** Requests per UTC day, per user. */
        requestsPerDayPerUser: z.number().int().optional(),
        /** Input plus output tokens per UTC day, per user. */
        tokensPerDayPerUser: z.number().int().optional(),
      })
      .optional(),
    /** Limits on one organization's whole daily volume, whoever's key pays (#739). */
    perOrg: z
      .object({
        /** Requests per UTC day. */
        requestsPerDay: z.number().int().optional(),
        /** Output tokens per UTC day. */
        outputTokensPerDay: z.number().int().optional(),
      })
      .optional(),
    /** Per-model limits, keyed `<provider>:<modelId>`. */
    perModel: z
      .record(
        z.string(),
        z.object({
          /** Output-token ceiling for every call to the model. */
          maxOutputTokens: z.number().int().optional(),
          /** Requests per minute, per user, to the model. */
          requestsPerMinutePerUser: z.number().int().optional(),
        }),
      )
      .optional(),
  }),
  /** Whether the deployment's keys pay for an organization that stores no key of its own (#739). */
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

const orgAiProviderSlotSchema = z
  .object({
    /** `false` switches the provider off for the organization's members. */
    enabled: z.boolean().optional(),
  })
  .optional();

/**
 * The fields of the `ai` namespace an organization may set for itself.
 *
 * @stability experimental
 */
export const orgAiSettingsSchema = z.object({
  /** Whether AI is switched on (the kill switch). */
  enabled: z.boolean().optional(),
  /** Whose key pays: the caller's own only (`byok`), or an administrator's as a fallback. */
  keyPolicy: keyPolicyEnum().optional(),
  /** Per-provider settings, by provider id. */
  providers: z
    .object({
      /** The OpenAI slot. */
      openai: orgAiProviderSlotSchema,
      /** The Anthropic slot. */
      anthropic: orgAiProviderSlotSchema,
      /** The Gemini slot. */
      gemini: orgAiProviderSlotSchema,
      /** The Azure OpenAI slot. */
      'azure-openai': orgAiProviderSlotSchema,
      /** The OpenAI-compatible server slot. */
      'openai-compatible': orgAiProviderSlotSchema,
    })
    .optional(),
  /** Rate limits and output caps; every absent field is unlimited. */
  limits: z
    .object({
      /** Limits on one organization's whole daily volume, whoever's key pays (#739). */
      perOrg: z
        .object({
          /** Requests per UTC day. */
          requestsPerDay: aiLimitValueSchema.optional(),
          /** Output tokens per UTC day. */
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


/**
 * Compile-time proof that the `ai` namespace has no secret-bearing field:
 * `true`, or `never` (and the file stops compiling) when one is added.
 *
 * @stability experimental
 */
export type AiSettingsCarriesNoSecret =
  Extract<keyof SystemAiValue, AiSecretFieldNames> extends never ? true : never;

/**
 * The proof's witness value.
 *
 * @stability experimental
 */
export const AI_SETTINGS_CARRIES_NO_SECRET: AiSettingsCarriesNoSecret = true;

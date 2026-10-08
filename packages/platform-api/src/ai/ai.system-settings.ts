// =============================================================================
// System settings namespace `ai` (issue #677; namespace #423, epic #419, umbrella #418)
// =============================================================================
//
// A declaration file: pure data, imports only leaf modules. Registered by
// `settings/registry/system-settings.manifest.ts`. Recipe:
// `settings/registry/README.md`.
//
// NO API KEY HERE, AND THERE NEVER MAY BE ONE: a user's own key is
// `UserAiKey.secret`, in its own table; an org-wide fallback key belongs in the
// encrypted credential store. Proved at compile time in
// `common/schemas/settings.schema.ts` (`AI_SETTINGS_CARRIES_NO_SECRET`) and at
// import time by the registry.
// =============================================================================

import type { z } from 'zod';
import {
  AI_PROVIDER_IDS,
  orgAiSettingsSchema,
  systemAiPatchSchema,
  systemAiSchema,
  tightenAiPolicy,
  type OrgAiSettingsValue,
  type SystemAiValue,
} from '@marinoscar/platform-contract/ai';
import { aiSettingsPatchSchema, aiSettingsSchema } from '@marinoscar/platform-contract/ai';
import { aiResponseSchema } from '@marinoscar/platform-contract/ai';
import { mergeOptional } from '../settings/index';
import type {
  SettingsReadHelpers,
  SystemSettingsNamespace,
} from '../settings/index';

// OFF, and INERT: `enabled: false` is the point, matching every other feature
// namespace that ships ahead of its own UI (`databaseBackup.enabled`,
// `nodes.jobSecretBrokerEnabled`) — a fresh deployment does not gain an AI
// capability nobody asked for by this namespace merely existing. `byok` is the
// default key policy: every call uses its caller's own saved key, with no
// deployment-wide fallback key to reason about or secure.
// `allowBackgroundRuns: true` mirrors `jobs.history.purgeEnabled` being the one
// "on" value in the operations block — the queue is this application's normal
// way of doing anything that takes a while, and a deployment that has not
// thought about AI at all should not have quietly disabled that path.
// `logPromptContent: false` is a deliberate, named privacy default: prompt text
// may carry a user's own sensitive input, and it must not land in a log line
// nobody scoped for that.
const AI_SYSTEM_DEFAULTS: SystemAiValue = {
  enabled: false,
  keyPolicy: 'byok',
  providers: {
    openai: {
      enabled: false,
    },
    // #446 — off, like every provider slot: enabling one is an
    // administrator's decision, made alongside its key.
    anthropic: {
      enabled: false,
    },
    // #447 — off, like every provider slot.
    gemini: {
      enabled: false,
    },
    // #448 — off, and with no endpoint: each needs a `baseUrl` before it can
    // be enabled. Every other field is optional and absent means its default.
    'azure-openai': {
      enabled: false,
    },
    'openai-compatible': {
      enabled: false,
    },
  },
  defaults: {
    allowBackgroundRuns: true,
    // #449: realtime voice sessions OFF — minting one hands the browser an
    // ephemeral provider secret and the server stops seeing the call.
    allowRealtime: false,
  },
  logPromptContent: false,
  // #443: `ai_usage_events` kept 180 days — twice the longest usage report
  // window, so a 90-day report never reads a half-purged range.
  usageRetentionDays: 180,
  // #442: every provider-hosted tool OFF — each reaches outside the
  // deployment and bills per use, so it is an administrator's decision.
  hostedTools: {
    web_search: false,
    file_search: false,
    code_interpreter: false,
    image_generation: false,
    mcp: false,
    mcpAllowedHosts: [],
  },
  // #450: no limits — every field of `ai.limits` is optional and absent
  // means unlimited, so an upgrade never starts refusing calls by itself.
  limits: {},
  // #739: ON — the deployment key keeps serving every organization that has
  // no key of its own, exactly as before organizations had keys.
  deploymentKeyServesOrgs: true,
};

/**
 * `stored` (the raw `ai` namespace) with `providers` rebuilt slot by slot —
 * each `AI_PROVIDER_IDS` slot that passes its own slot schema is kept,
 * any other falls back to that provider's default — and `defaults` rebuilt
 * field by field the same way (#449). Everything else in the namespace is
 * left for `readNamespace` to salvage as usual.
 *
 * Why: a slot appended to `AI_PROVIDER_IDS` later (`anthropic`, #446;
 * `gemini`, #447) is absent from every row written before it, and validating
 * `providers` as one unit would then reset the operator's OpenAI switch and
 * endpoint to the defaults on the first read after upgrading. `defaults` gets
 * the same treatment, field by field, so a field appended to it later
 * (`allowRealtime`, #449) cannot reset a stored `maxOutputTokensCap` or
 * `allowBackgroundRuns` beside it.
 */
function withAiSlots(stored: unknown, helpers: SettingsReadHelpers): unknown {
  const source = helpers.asPlainObject(stored);

  if (!source) return stored;

  const providers = helpers.asPlainObject(source.providers) ?? {};
  const providerDefaults = AI_SYSTEM_DEFAULTS.providers as Record<string, unknown>;
  const storedDefaults = helpers.asPlainObject(source.defaults);

  return {
    ...source,
    providers: Object.fromEntries(
      AI_PROVIDER_IDS.map((id) => {
        // Each slot against its OWN schema (#448: the Azure and
        // OpenAI-compatible slots carry more than `enabled`/`baseUrl`).
        const slotSchema = systemAiSchema.shape.providers.shape[id];
        const parsed = slotSchema.safeParse(providers[id]);

        return [id, parsed.success ? parsed.data : structuredClone(providerDefaults[id])];
      }),
    ),
    ...(storedDefaults
      ? {
          // An absent optional field (`maxOutputTokensCap`) stays absent.
          defaults: Object.fromEntries(
            Object.entries(
              helpers.readNamespace(storedDefaults, systemAiSchema.shape.defaults, AI_SYSTEM_DEFAULTS.defaults),
            ).filter(([, value]) => value !== undefined),
          ),
        }
      : {}),
  };
}

export const AI_SYSTEM_SETTINGS = {
  key: 'ai',
  description: 'Deployment-wide AI platform policy: the kill switch, key policy, provider slots, call defaults, hosted tools and limits.',
  storedSchema: systemAiSchema,
  patchSchema: systemAiPatchSchema,
  putSchema: aiSettingsSchema,
  wirePatchSchema: aiSettingsPatchSchema,
  responseSchema: aiResponseSchema,
  defaults: AI_SYSTEM_DEFAULTS,
  requiredOnPut: false,
  // A damaged `providers` block degrading to the default leaves `enabled`
  // and `logPromptContent` next to it untouched — the same field-by-field
  // salvage every namespace gets — and `providers` is salvaged one level
  // deeper, per provider, first (`withAiSlots`).
  read(stored, helpers) {
    return helpers.readNamespace(withAiSlots(stored, helpers), systemAiSchema, AI_SYSTEM_DEFAULTS);
  },
  merge(current, patch) {
    // Field by field, one level deep into each `providers.<id>` and
    // `defaults`, exactly matching `storage`'s own shape. `??` is right for
    // every REQUIRED field: none of them is nullable, and `??` leaves an
    // omitted field at its current stored value.
    //
    // The OPTIONAL fields (`baseUrl`, `maxOutputTokensCap`, …) take the
    // `storage.forcePathStyle` form instead (`mergeOptional`): absent keeps
    // the stored value, explicit `null` REMOVES it. With `??` a null would
    // fall through to the stored value and an override, once set, could never
    // be cleared (#428).
    //
    // NOTHING HERE TOUCHES AN API KEY. There is no such field on this DTO,
    // this stored value, or this merge.
    return {
      enabled: patch?.enabled ?? current.enabled,
      keyPolicy: patch?.keyPolicy ?? current.keyPolicy,
      providers: {
        openai: {
          enabled: patch?.providers?.openai?.enabled ?? current.providers.openai.enabled,
          baseUrl: mergeOptional(patch?.providers?.openai?.baseUrl, current.providers.openai.baseUrl),
        },
        anthropic: {
          enabled: patch?.providers?.anthropic?.enabled ?? current.providers.anthropic.enabled,
          baseUrl: mergeOptional(patch?.providers?.anthropic?.baseUrl, current.providers.anthropic.baseUrl),
        },
        gemini: {
          enabled: patch?.providers?.gemini?.enabled ?? current.providers.gemini.enabled,
          baseUrl: mergeOptional(patch?.providers?.gemini?.baseUrl, current.providers.gemini.baseUrl),
        },
        // #448. Every optional field merges like `baseUrl` (absent keeps,
        // `null` removes); `deployments` is one value, replaced whole.
        'azure-openai': {
          enabled: patch?.providers?.['azure-openai']?.enabled ?? current.providers['azure-openai'].enabled,
          baseUrl: mergeOptional(
            patch?.providers?.['azure-openai']?.baseUrl,
            current.providers['azure-openai'].baseUrl,
          ),
          apiVersion: mergeOptional(
            patch?.providers?.['azure-openai']?.apiVersion,
            current.providers['azure-openai'].apiVersion,
          ),
          apiStyle: mergeOptional(
            patch?.providers?.['azure-openai']?.apiStyle,
            current.providers['azure-openai'].apiStyle,
          ),
          deployments: mergeOptional(
            patch?.providers?.['azure-openai']?.deployments,
            current.providers['azure-openai'].deployments,
          ),
        },
        'openai-compatible': {
          enabled:
            patch?.providers?.['openai-compatible']?.enabled ?? current.providers['openai-compatible'].enabled,
          baseUrl: mergeOptional(
            patch?.providers?.['openai-compatible']?.baseUrl,
            current.providers['openai-compatible'].baseUrl,
          ),
          apiStyle: mergeOptional(
            patch?.providers?.['openai-compatible']?.apiStyle,
            current.providers['openai-compatible'].apiStyle,
          ),
          requiresKey: mergeOptional(
            patch?.providers?.['openai-compatible']?.requiresKey,
            current.providers['openai-compatible'].requiresKey,
          ),
        },
      },
      defaults: {
        maxOutputTokensCap: mergeOptional(patch?.defaults?.maxOutputTokensCap, current.defaults.maxOutputTokensCap),
        allowBackgroundRuns: patch?.defaults?.allowBackgroundRuns ?? current.defaults.allowBackgroundRuns,
        allowRealtime: patch?.defaults?.allowRealtime ?? current.defaults.allowRealtime,
      },
      logPromptContent: patch?.logPromptContent ?? current.logPromptContent,
      usageRetentionDays: patch?.usageRetentionDays ?? current.usageRetentionDays,
      // #442: each switch field by field; the host list replaces wholesale
      // (a merge could never remove a host). A fresh array either way, so
      // the stored value never aliases the caller's or the default's.
      hostedTools: {
        web_search: patch?.hostedTools?.web_search ?? current.hostedTools.web_search,
        file_search: patch?.hostedTools?.file_search ?? current.hostedTools.file_search,
        code_interpreter: patch?.hostedTools?.code_interpreter ?? current.hostedTools.code_interpreter,
        image_generation: patch?.hostedTools?.image_generation ?? current.hostedTools.image_generation,
        mcp: patch?.hostedTools?.mcp ?? current.hostedTools.mcp,
        mcpAllowedHosts: [...(patch?.hostedTools?.mcpAllowedHosts ?? current.hostedTools.mcpAllowedHosts)],
      },
      // #450: WHOLESALE — a present `limits` is the new value, an absent
      // one keeps the stored value. A merge could never lift a limit (or
      // drop a per-model entry), and absent is how a limit is lifted.
      // Cloned either way so the stored value never aliases the caller's
      // object or the module-level default.
      limits: structuredClone(patch?.limits ?? current.limits),
      deploymentKeyServesOrgs: patch?.deploymentKeyServesOrgs ?? current.deploymentKeyServesOrgs,
    };
  },
  // #739: the org layer. An organization may only TIGHTEN the deployment's
  // policy (`tightenAiPolicy`): AI off for its members, `byok` instead of
  // `byok_with_org_fallback`, lower per-org daily caps, providers off.
  org: {
    schema: orgAiSettingsSchema,
    // Typed `unknown` in, so the declaration also fits the registry's
    // `SystemSettingsNamespace<string, unknown>` list (parameters are
    // contravariant); the registry hands in the salvaged value and the
    // org's validated fields.
    merge: (system: unknown, org: unknown) =>
      tightenAiPolicy(system as SystemAiValue, org as OrgAiSettingsValue),
    readPermission: 'org_ai_config:read',
    writePermission: 'org_ai_config:write',
  },
} satisfies SystemSettingsNamespace<'ai', SystemAiValue, z.infer<typeof aiSettingsPatchSchema>>;

declare module '../settings/index' {
  interface SystemSettingsNamespaces {
    /**
     * Deployment-wide AI platform policy (#423, epic #419, umbrella #418):
     * whether AI is enabled at all, how a call sources its API key,
     * per-provider configuration, and the deployment-wide defaults a call
     * cannot exceed.
     */
    ai: SystemAiValue;
  }
  interface SystemSettingsNamespaceDeclarations {
    ai: typeof AI_SYSTEM_SETTINGS;
  }
}

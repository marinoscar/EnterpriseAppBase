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

import { BadRequestException, Logger } from '@nestjs/common';
import type { z } from 'zod';
import {
  orgAiSettingsSchema,
  systemAiPatchSchema,
  systemAiSchema,
  tightenAiPolicy,
  type OrgAiSettingsValue,
  type SystemAiValue,
} from '@marinoscar/platform-contract/ai';
import { aiSettingsPatchSchema, aiSettingsSchema } from '@marinoscar/platform-contract/ai';
import { aiResponseSchema } from '@marinoscar/platform-contract/ai';
import { PluggableSettingsError, PluggableUnknownError } from '../core/pluggable/index';
import { mergeOptional } from '../settings/index';
import type {
  SettingsReadHelpers,
  SystemSettingsNamespace,
} from '../settings/index';
import { aiProviderKind, defaultAiProviderSlot } from './providers/ai-provider-definition';
// Registers the five built-in providers (side effect): the namespace below reads the registry.
import './providers/builtin-ai-providers';

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

const logger = new Logger('AiSettings');

/**
 * Each distinct read warning is logged ONCE per process: the namespace is read
 * on every settings read and every five seconds by the policy cache, and a
 * stored slot for a provider that is no longer registered stays stored until
 * the next save.
 */
const warnedOnce = new Set<string>();
function warnOnce(message: string): void {
  if (warnedOnce.has(message)) return;
  warnedOnce.add(message);
  logger.warn(message);
}

/**
 * The 400 for a `providers` PATCH or PUT the registry refuses: an id nobody
 * registered, or settings that do not parse with the provider's own schema.
 */
function providerRejection(error: unknown): never {
  if (error instanceof PluggableUnknownError) {
    throw new BadRequestException({
      message: `Unknown AI provider "${error.id}". Registered: ${error.registeredIds.join(', ') || '(none)'}.`,
      details: { reason: 'AI_UNKNOWN_PROVIDER', provider: error.id },
    });
  }
  if (error instanceof PluggableSettingsError) {
    throw new BadRequestException({
      message: `The settings for AI provider "${error.id}" are not valid: ${error.message}`,
      details: {
        reason: 'AI_PROVIDER_SETTINGS_INVALID',
        provider: error.id,
        fields: [...new Set(error.issues.map((issue) => String(issue.path[0] ?? '')))].filter(Boolean),
      },
    });
  }
  throw error;
}

/**
 * The `providers` record, validated against the provider registry: every
 * entry must belong to a registered provider and parse with that provider's
 * own `settingsSchema` (defaults filled). Used as the stored schema's
 * `providers` field, so a PUT, and any value that reaches the stored schema,
 * is checked by the provider that owns each slot.
 */
const registeredProvidersSchema = systemAiSchema.shape.providers.transform((providers, ctx) => {
  const next: Record<string, { enabled: boolean } & Record<string, unknown>> = {};

  for (const [id, slot] of Object.entries(providers)) {
    try {
      next[id] = aiProviderKind.parseSettings(id, slot) as { enabled: boolean } & Record<string, unknown>;
    } catch (error) {
      if (!(error instanceof PluggableUnknownError) && !(error instanceof PluggableSettingsError)) throw error;
      ctx.addIssue({ code: 'custom', message: error.message, path: [id] });
    }
  }

  return next;
});

/**
 * The stored `ai` schema the settings registry uses: `systemAiSchema` with
 * `providers` checked against the provider registry (which the contract
 * package cannot see).
 */
const storedAiSchema = systemAiSchema.extend({ providers: registeredProvidersSchema });

/**
 * `stored` (the raw `ai` namespace) with `providers` rebuilt from the
 * provider registry — each REGISTERED provider's slot that parses with its
 * own settings schema is kept, any other falls back to that provider's
 * defaults, and a stored slot for a provider that is no longer registered is
 * dropped with one warning — and `defaults` rebuilt field by field the same
 * way (#449). Everything else in the namespace is left for `readNamespace` to
 * salvage as usual.
 *
 * Why: a provider registered after a row was written (a built-in appended
 * later, `anthropic` #446 and `gemini` #447; an app's own, PP-14.6) is absent
 * from that row, and validating `providers` as one unit would then reset the
 * operator's OpenAI switch and endpoint to the defaults on the first read
 * after upgrading. Removing a provider's definition must not brick the row
 * either, so its stored slot is ignored, never an error. `defaults` gets the
 * same treatment, field by field, so a field appended to it later
 * (`allowRealtime`, #449) cannot reset a stored `maxOutputTokensCap` or
 * `allowBackgroundRuns` beside it.
 */
function withAiSlots(stored: unknown, helpers: SettingsReadHelpers): unknown {
  // A missing or unusable namespace reads as an empty one: every registered
  // provider still gets its default slot (the static defaults know only the built-ins).
  const source = helpers.asPlainObject(stored) ?? {};

  const known = aiProviderKind.readSettingsRecord(helpers.asPlainObject(source.providers) ?? {}, warnOnce);
  const storedDefaults = helpers.asPlainObject(source.defaults);

  return {
    ...source,
    // Registered order (the built-ins first), every registered provider present.
    providers: Object.fromEntries(aiProviderKind.ids().map((id) => [id, known[id] ?? defaultAiProviderSlot(id)])),
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

/**
 * PATCH merge of `providers`: for each provider the patch names, `undefined`
 * keeps a setting, `null` removes it (back to the provider's default) and
 * anything else replaces it; the result is validated with that provider's own
 * schema (`mergeSettingsRecord`). A provider the patch does not name keeps its
 * stored slot. An unregistered id, or settings that do not parse, are a 400.
 */
function mergeProviders(
  current: SystemAiValue['providers'],
  patch: Record<string, Record<string, unknown>> | undefined,
): SystemAiValue['providers'] {
  const stored: Record<string, Record<string, unknown>> = structuredClone(current);

  if (!patch) return stored as SystemAiValue['providers'];

  const cleaned: Record<string, Record<string, unknown>> = {};

  for (const [id, slotPatch] of Object.entries(patch)) {
    const kept: Record<string, unknown> = {};

    for (const [field, value] of Object.entries(slotPatch)) {
      if (value === undefined) continue;
      if (value === null) {
        // Drop the stored value so the default applies; the merge below cannot "unset" a key.
        if (stored[id]) delete stored[id][field];
        continue;
      }
      kept[field] = value;
    }

    cleaned[id] = kept;
  }

  try {
    return aiProviderKind.mergeSettingsRecord(stored, cleaned) as SystemAiValue['providers'];
  } catch (error) {
    return providerRejection(error);
  }
}

/**
 * Exported for the reference app's wiring and tests (route discovery, contract
 * and egress suites); not part of the slice's documented surface.
 *
 * @internal
 */
export const AI_SYSTEM_SETTINGS = {
  key: 'ai',
  description: 'Deployment-wide AI platform policy: the kill switch, key policy, provider slots, call defaults, hosted tools and limits.',
  storedSchema: storedAiSchema,
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
    return helpers.readNamespace(withAiSlots(stored, helpers), storedAiSchema, AI_SYSTEM_DEFAULTS);
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
      providers: mergeProviders(current.providers, patch?.providers),
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
    /**
     * The `ai` namespace's declaration (`AI_SYSTEM_SETTINGS`), for the composed
     * schemas' types. Documented on the constant itself.
     *
     * @internal
     */
    ai: typeof AI_SYSTEM_SETTINGS;
  }
}

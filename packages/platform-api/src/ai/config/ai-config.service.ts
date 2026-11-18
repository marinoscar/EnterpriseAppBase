import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { tightenAiPolicy } from '@marinoscar/platform-contract/ai';

import { type AiOpenAiApiStyle, type SystemAiValue } from '@marinoscar/platform-contract/ai';
import { CredentialsService } from '../../credentials/index';
import { OrgSettingsService, SystemSettingsService } from '../../settings/index';
import { AI_MODULE_OPTIONS, DEFAULT_AI_OPTIONS, type AiResolvedOptions } from '../ai.options';
import { AiError } from '../core/ai-error';
import { AiProviderRegistry } from '../core/provider-registry';
import { aiProviderSettingsFields, getAiProviderDefinition } from '../providers/ai-provider-definition';
// Registers the five built-in providers (side effect): the policy helpers below read the registry.
import '../providers/builtin-ai-providers';
import { AI_CREDENTIAL_PURPOSE, aiCredentialName } from './ai-credential.constants';
import type { AiPublicConfig } from './dto/ai-public-config.dto';

// =============================================================================
// AiConfigService — the one cached answer to "is AI on?" (issue #428, epic #419)
// =============================================================================
//
// Every other AI story asks this service, never `SystemSettingsService`
// directly, so the kill switch (docs/specs/ai-platform.md §2.19) has exactly one
// reading and one cache. Modelled on `StorageConfigService`:
//
//   - The `ai` settings namespace is cached for AI_POLICY_CACHE_MS. A burst of
//     AI calls costs one `system_settings` read, and an edit made on another
//     instance lands within one TTL.
//   - The instance that HANDLED an admin write does not wait at all: the admin
//     service calls `invalidateCache()` synchronously after the write.
//   - ⚠ THE ORG KEY IS NEVER CACHED. `getOrgKey` decrypts on every call, so a
//     rotation or a removal is live on the very next call, and no plaintext
//     key sits in this process's memory between calls.
// =============================================================================

/**
 * How long a settings read is reused. The same five seconds as
 * `STORAGE_POLICY_CACHE_MS` and `MAINTENANCE_PERSISTED_CACHE_MS`, for the same
 * reasons — see `storage-config.service.ts`.
 *
 * @stability experimental
 */
export const AI_POLICY_CACHE_MS = 5_000;

/**
 * The deployment-wide AI policy (`ai` settings namespace).
 *
 * @stability experimental
 */
export type AiPolicy = SystemAiValue;

/**
 * One provider's slot in the policy — `enabled` plus the provider's own
 * non-secret settings (PP-14.6, #924). The typed fields are the built-in
 * providers' (#448: the Azure OpenAI and OpenAI-compatible slots carry more than
 * `enabled`/`baseUrl`); a provider an app or package registered adds its own,
 * reachable through the index signature. A generic reader asks for any of them
 * and gets `undefined` where a provider has no such field.
 *
 * @stability experimental
 */
export interface AiProviderPolicy {
  /** Whether an administrator switched the provider on. */
  enabled: boolean;
  /** The endpoint override. */
  baseUrl?: string;
  /** Azure OpenAI: the API version. */
  apiVersion?: string;
  /** Azure OpenAI and OpenAI-compatible: which API shape the server speaks. */
  apiStyle?: AiOpenAiApiStyle;
  /** Azure OpenAI: model id to deployment name. */
  deployments?: Record<string, string>;
  /** OpenAI-compatible: whether the server needs a key. */
  requiresKey?: boolean;
  /** Any other setting the provider's own `settingsSchema` declares. */
  [setting: string]: unknown;
}

/**
 * The settings fields `providerId`'s slot accepts besides `enabled`, read off
 * its registered definition — so a provider that gains a field gains it here
 * with no list to update. Empty for an id with no definition.
 *
 * @stability experimental
 */
export function providerSettingsFields(providerId: string): string[] {
  return aiProviderSettingsFields(providerId);
}

/**
 * Whether calls to this provider need a key. A provider whose definition says
 * `requiresKey: false` never does. Otherwise the slot may opt out: the
 * OpenAI-compatible slot's `requiresKey: false` is the administrator's opt-in
 * to a keyless server (#448), resolved as `keySource: 'none'`, and absent
 * means yes, as it does for every other provider.
 *
 * @param slot - the provider's policy slot.
 * @param providerId - the provider, to consult its definition (omit to read the slot alone).
 * @stability experimental
 */
export function providerRequiresKey(slot: AiProviderPolicy | undefined, providerId?: string): boolean {
  if (providerId !== undefined && getAiProviderDefinition(providerId)?.requiresKey === false) return false;

  return slot?.requiresKey !== false;
}

/**
 * What an adapter call carries from the provider's slot (#448): the endpoint
 * as `baseUrl`, and every other non-secret setting (`apiVersion`,
 * `apiStyle`, `deployments`, `requiresKey`) as `providerSettings`, for the
 * adapter to read with its own schema. `enabled` is the runtime's business,
 * never the adapter's. Nothing here can hold a secret — the slot has no
 * field able to (see `settings.schema.ts`'s compile-time proof).
 *
 * @stability experimental
 */
export function providerCallSettings(
  slot: AiProviderPolicy | undefined,
): {
  /** The endpoint override, when the slot carries one. */
  baseUrl?: string;
  /** Every other non-secret setting, for the adapter's own schema. */
  providerSettings?: Readonly<Record<string, unknown>>;
} {
  if (!slot) return {};

  const { enabled: _enabled, baseUrl, ...rest } = slot;
  const settings = Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined));

  return {
    ...(baseUrl ? { baseUrl } : {}),
    ...(Object.keys(settings).length > 0 ? { providerSettings: settings } : {}),
  };
}

/**
 * A provider's policy slot by id, or `undefined` for an id with no slot (an
 * adapter registered without a provider definition). `providers` is a record
 * keyed by provider id; this is the one place that indexes it by an arbitrary string.
 *
 * @stability experimental
 */
export function providerPolicy(policy: AiPolicy, providerId: string): AiProviderPolicy | undefined {
  const providers = policy.providers as Record<string, AiProviderPolicy | undefined>;

  return Object.prototype.hasOwnProperty.call(providers, providerId)
    ? providers[providerId]
    : undefined;
}

/**
 * The AI policy, as the runtime reads it: the `ai` system settings namespace
 * (cached for `AI_POLICY_CACHE_MS`), narrowed per organization by the org
 * layer (#739), plus the deployment's provider keys in the credential store.
 * `assertEnabled` and `assertProviderEnabled` are the kill-switch gates every
 * AI path runs.
 *
 * @stability experimental
 */
@Injectable()
export class AiConfigService implements OnModuleInit {
  private readonly logger = new Logger(AiConfigService.name);

  /** Last successful settings read. Carries no secret — `SystemAiValue` has no field able to. */
  private cache: { value: AiPolicy; readAt: number } | null = null;

  /** Last read of each organization's effective policy (#739), on the same window. */
  private readonly orgCache = new Map<string, { value: AiPolicy; readAt: number }>();

  constructor(
    private readonly systemSettings: SystemSettingsService,
    private readonly credentials: CredentialsService,
    private readonly registry: AiProviderRegistry,
    // #739: the org layer of the `ai` namespace. Optional so a unit test (or
    // an app that mounts no org layer) gets the deployment policy only.
    @Optional() private readonly orgSettings?: OrgSettingsService,
    @Optional() @Inject(AI_MODULE_OPTIONS) private readonly options: AiResolvedOptions = DEFAULT_AI_OPTIONS,
  ) {}

  /**
   * One best-effort settings read at startup, so the first request after a
   * restart is answered from a warm cache. Detached and swallowed on purpose:
   * it must never delay or prevent boot. It reads the SETTINGS only — never
   * a key (see `StorageConfigService.onModuleInit` for why boot is not a
   * moment to decrypt anything).
   */
  onModuleInit(): void {
    void this.resolve({ fresh: true })
      .then((policy) => {
        this.logger.log(
          `AI policy loaded: enabled=${policy.enabled} keyPolicy=${policy.keyPolicy}`,
        );
      })
      .catch((error: unknown) => {
        this.logger.warn(
          'Could not read the AI settings at startup; they will be read again on ' +
            `first use: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }

  /**
   * The current policy. `fresh: true` bypasses the cache — for a caller that
   * is SHOWING or TESTING the configuration, never for a hot path.
   */
  async resolve(opts: { fresh?: boolean } = {}): Promise<AiPolicy> {
    const now = Date.now();

    if (!opts.fresh && this.cache && now - this.cache.readAt < AI_POLICY_CACHE_MS) {
      return this.cache.value;
    }

    const value = await this.systemSettings.getAiPolicy();
    this.cache = { value, readAt: Date.now() };

    return value;
  }

  /**
   * The effective policy of one organization (#739): the deployment policy
   * with the organization's `ai` overrides applied, each of which can only
   * tighten it (`tightenAiPolicy`). Without an organization, or with no org
   * layer, the deployment policy itself. Cached on the same window as
   * {@link resolve}.
   */
  async resolveForOrg(orgId: string | undefined, opts: { fresh?: boolean } = {}): Promise<AiPolicy> {
    const system = await this.resolve(opts);

    if (!orgId || !this.orgSettings?.isEnabled()) {
      return system;
    }

    const now = Date.now();
    const cached = this.orgCache.get(orgId);

    if (!opts.fresh && cached && now - cached.readAt < AI_POLICY_CACHE_MS && this.cache?.value === system) {
      return cached.value;
    }

    const fields = await this.orgSettings.getNamespace(orgId, 'ai');
    const value = fields ? tightenAiPolicy(system, fields) : system;

    this.orgCache.set(orgId, { value, readAt: Date.now() });

    return value;
  }

  /** The kill switch (§2.19). */
  async isEnabled(): Promise<boolean> {
    return (await this.resolve()).enabled;
  }

  /**
   * Throws `AiError('AI_DISABLED')` (403) when the kill switch is off:
   * `details.scope` is `'system'` for the deployment's switch and, given an
   * organization (#739), `'org'` for that organization's own.
   */
  async assertEnabled(orgId?: string): Promise<void> {
    if (!(await this.isEnabled())) {
      throw new AiError('AI_DISABLED', 'AI features are disabled in this deployment.', {
        details: { scope: 'system' },
      });
    }

    if (orgId && !(await this.resolveForOrg(orgId)).enabled) {
      throw new AiError('AI_DISABLED', 'AI features are disabled in this organization.', {
        details: { scope: 'org' },
      });
    }
  }

  /**
   * The provider's policy slot, when AI is on, the provider is enabled in
   * settings AND an adapter for it is registered in this process.
   *
   * @param providerId - the provider.
   * @param orgId - the organization the call runs in (#739): its own switches apply too.
   * @throws AiError('AI_DISABLED') when the kill switch (the deployment's or the organization's) is off.
   * @throws AiError('AI_PROVIDER_DISABLED') for any other "no".
   */
  async assertProviderEnabled(providerId: string, orgId?: string): Promise<AiProviderPolicy> {
    // #739: an organization may switch AI, or a provider, off for itself.
    await this.assertEnabled(orgId);
    const policy = await this.resolveForOrg(orgId);

    const slot = providerPolicy(policy, providerId);

    if (!slot?.enabled || !this.registry.get(providerId)) {
      throw new AiError(
        'AI_PROVIDER_DISABLED',
        `AI provider "${providerId}" is not enabled in this deployment.`,
        { details: { provider: providerId } },
      );
    }

    return slot;
  }

  /**
   * The admin (org) key for `providerId`, decrypted, or `null` when none is
   * stored.
   *
   * ⚠ PLAINTEXT, AND NEVER CACHED. Call it at the moment of use, hand the value
   * straight to an adapter, and never log, persist or return it. Whether a
   * caller may USE it to serve a user is `AiKeyResolver`'s decision (§2.2), not
   * this method's.
   */
  async getOrgKey(providerId: string): Promise<string | null> {
    return this.credentials.getSecret(AI_CREDENTIAL_PURPOSE, aiCredentialName(providerId));
  }

  /**
   * Whether an admin (org) key is stored for `providerId` — answered from the
   * credential's metadata, WITHOUT decrypting it. For callers that only need
   * to know a key exists (the usable-models listing), so they never hold
   * plaintext they will not use.
   */
  async hasOrgKey(providerId: string): Promise<boolean> {
    return (await this.credentials.describe(AI_CREDENTIAL_PURPOSE, aiCredentialName(providerId))) !== null;
  }

  /**
   * `GET /api/ai/config` — the narrow projection any signed-in user may read.
   *
   * Answered from the CACHED policy (it is polled by every browser) and only
   * ever `describe`s a key, never decrypts one. Lists REGISTERED providers
   * only: a settings slot with no adapter is nothing a user can call.
   */
  async describePublic(orgId?: string): Promise<AiPublicConfig> {
    // #739: the caller's organization's EFFECTIVE policy.
    const policy = await this.resolveForOrg(orgId);

    if (!policy.enabled) {
      // Nothing is available while AI is off — background runs included.
      return {
        enabled: false,
        keyPolicy: policy.keyPolicy,
        allowBackgroundRuns: false,
        allowRealtime: false,
        perUserDefaultModel: this.options.perUserDefaultModel,
        hostedTools: {
          web_search: false,
          file_search: false,
          code_interpreter: false,
          image_generation: false,
          mcp: false,
        },
        providers: [],
      };
    }

    const providers = await Promise.all(
      this.registry.ids().map(async (id) => {
        const adapter = this.registry.get(id);
        const info = await this.credentials.describe(AI_CREDENTIAL_PURPOSE, aiCredentialName(id));

        return {
          id,
          displayName: adapter?.displayName ?? id,
          enabled: providerPolicy(policy, id)?.enabled ?? false,
          hasOrgKey: info !== null,
          supportsPreviousResponseId: this.registry.supportsPreviousResponseId(id),
          requiresKey: providerRequiresKey(providerPolicy(policy, id), id),
        };
      }),
    );

    return {
      enabled: true,
      keyPolicy: policy.keyPolicy,
      allowBackgroundRuns: policy.defaults.allowBackgroundRuns,
      allowRealtime: policy.defaults.allowRealtime,
      perUserDefaultModel: this.options.perUserDefaultModel,
      // Named booleans only — never the host allowlist.
      hostedTools: {
        web_search: policy.hostedTools.web_search,
        file_search: policy.hostedTools.file_search,
        code_interpreter: policy.hostedTools.code_interpreter,
        image_generation: policy.hostedTools.image_generation,
        mcp: policy.hostedTools.mcp,
      },
      providers,
    };
  }

  /**
   * Drop the cached policy so the next read consults the row. Call it
   * SYNCHRONOUSLY right after any write to the `ai` namespace, before the audit
   * row — the ordering `StorageConfigService.invalidateCache` explains.
   */
  invalidateCache(): void {
    this.cache = null;
    this.orgCache.clear();
  }
}

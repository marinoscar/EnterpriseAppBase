import { Injectable, Optional } from '@nestjs/common';

import { AiConfigService, providerPolicy, providerRequiresKey } from '../config/ai-config.service';
import { AiError } from '../core/ai-error';
import { AI_KEYLESS_API_KEY } from '../core/provider-adapter.interface';
import { AiConfigWriterLookup } from './ai-config-writer.lookup';
import { AiOrgKeyService } from './org-key.service';
import { UserAiKeysService } from './user-ai-keys.service';

/**
 * Whose key serves a user's call — `'none'` (#448) for a keyless provider.
 * `'admin_discovery'` is never a runtime answer.
 *
 * @stability experimental
 */
export type AiKeySource = 'user' | 'org' | 'none';

/**
 * Which tier paid (#739), recorded as the span attribute `ai.key.tier`:
 * `'org'` is the organization's own key, `'deployment'` the deployment's.
 *
 * @stability experimental
 */
export type AiKeyTier = 'user' | 'org' | 'deployment' | 'none';

/**
 * One call's key, as `AiKeyResolver.resolve` hands it to the runtime.
 *
 * @stability experimental
 */
export interface ResolvedAiKey {
  /**
   * ⚠ PLAINTEXT. Hand it straight to an adapter; never log, persist or return
   * it. `AI_KEYLESS_API_KEY` when `keySource` is `'none'`.
   */
  apiKey: string;
  /** Who pays: `user`, `org` (an administrator-managed key) or `none` (keyless). */
  keySource: AiKeySource;
  /** The tier the key came from (#739). Never persisted. */
  tier: AiKeyTier;
}

/**
 * The organization a resolution runs for, and memoised permission lookups.
 *
 * @stability experimental
 */
export interface AiKeyScope {
  /** The call's organization: the principal's active one, or a job's. Absent: no org tier. */
  orgId?: string;
  /** Memoised `ai_config:write` lookup (rule 3). */
  holdsAiConfigWrite?: () => Promise<boolean>;
  /** Memoised `org_ai_config:write` lookup in `orgId` (rule 2). */
  holdsOrgAiConfigWrite?: () => Promise<boolean>;
}

/**
 * Exported for the reference app's wiring and tests (route discovery, contract
 * and egress suites); not part of the slice's documented surface.
 *
 * @internal
 */
@Injectable()
export class AiKeyResolver {
  constructor(
    private readonly userKeys: UserAiKeysService,
    private readonly aiConfig: AiConfigService,
    private readonly configWriters: AiConfigWriterLookup,
    @Optional() private readonly orgKeys?: AiOrgKeyService,
  ) {}

  /**
   * The key that serves `userId`'s call to `provider`, decrypted.
   *
   * @throws AiError('AI_KEY_REQUIRED') when no rule applies.
   */
  async resolve(userId: string, provider: string, scope: AiKeyScope = {}): Promise<ResolvedAiKey> {
    if (await this.keyless(provider)) {
      return { apiKey: AI_KEYLESS_API_KEY, keySource: 'none', tier: 'none' };
    }

    const userKey = await this.userKeys.getDecrypted(userId, provider);

    if (userKey) {
      return { apiKey: userKey, keySource: 'user', tier: 'user' };
    }

    const fallback = await this.fallbackPolicy(scope.orgId);

    // Rule 2: the organization's own key. Read only once the rule allows it.
    if (scope.orgId && this.orgKeys && (fallback || (await this.holdsOrgWrite(userId, scope)))) {
      const orgKey = await this.orgKeys.getKey(scope.orgId, provider);

      if (orgKey) {
        return { apiKey: orgKey, keySource: 'org', tier: 'org' };
      }
    }

    // Rule 3: the deployment's key.
    if ((await this.deploymentKeyServes(scope.orgId)) && (fallback || (await this.holdsSystemWrite(userId, scope)))) {
      const deploymentKey = await this.aiConfig.getOrgKey(provider);

      if (deploymentKey) {
        return { apiKey: deploymentKey, keySource: 'org', tier: 'deployment' };
      }
    }

    throw keyRequired(provider);
  }

  /**
   * The same rule, answered WITHOUT decrypting anything: which source WOULD
   * serve the call, or null when none would. For listings that must not hold
   * plaintext they will not use.
   *
   * `hasUserKey` is the caller's own knowledge of whether a `user_ai_keys`
   * row exists (it usually just read it); the rest of the rule is applied
   * here, so the ordering and the byok invariant live in one file.
   *
   * `holdsAiConfigWrite` lets a caller that asks about several providers for
   * the same user (the usable-models listing) share one memoised permission
   * lookup; omitted, it is looked up here, and only if rule 3 is reached.
   */
  async sourceFor(
    userId: string,
    provider: string,
    hasUserKey: boolean,
    holdsAiConfigWrite: () => Promise<boolean> = () => this.holdsAiConfigWrite(userId),
    scope: Omit<AiKeyScope, 'holdsAiConfigWrite'> = {},
  ): Promise<AiKeySource | null> {
    if (await this.keyless(provider)) {
      return 'none';
    }

    if (hasUserKey) {
      return 'user';
    }

    const withLookups: AiKeyScope = { ...scope, holdsAiConfigWrite };
    const fallback = await this.fallbackPolicy(scope.orgId);

    if (
      scope.orgId &&
      this.orgKeys &&
      (fallback || (await this.holdsOrgWrite(userId, withLookups))) &&
      (await this.orgKeys.hasKey(scope.orgId, provider))
    ) {
      return 'org';
    }

    if (
      (await this.deploymentKeyServes(scope.orgId)) &&
      (fallback || (await holdsAiConfigWrite())) &&
      (await this.aiConfig.hasOrgKey(provider))
    ) {
      return 'org';
    }

    return null;
  }

  /**
   * Whether `userId` holds `ai_config:write` (rule 3's permission half). One
   * query; callers resolving several providers for one user should memoise it.
   */
  holdsAiConfigWrite(userId: string): Promise<boolean> {
    return this.configWriters.holdsAiConfigWrite(userId);
  }

  /**
   * Whether `userId` holds `org_ai_config:write` in `orgId` (rule 2's
   * permission half). One query; read from the database, never a token.
   */
  holdsOrgAiConfigWrite(userId: string, orgId: string): Promise<boolean> {
    return this.configWriters.holdsOrgAiConfigWrite(userId, orgId);
  }

  /** Rule 0: the administrator marked this provider `requiresKey: false`. */
  private async keyless(provider: string): Promise<boolean> {
    return !providerRequiresKey(providerPolicy(await this.aiConfig.resolve(), provider));
  }

  /**
   * Whether the EFFECTIVE key policy (the deployment's, narrowed by the
   * organization's own) is the fallback. Checked first, so under the
   * fallback no permission query runs; under 'byok' only a permission can
   * open an administrator key.
   */
  private async fallbackPolicy(orgId: string | undefined): Promise<boolean> {
    return (await this.aiConfig.resolveForOrg(orgId)).keyPolicy === 'byok_with_org_fallback';
  }

  /** `ai.deploymentKeyServesOrgs` (#739; default true). */
  private async deploymentKeyServes(_orgId: string | undefined): Promise<boolean> {
    return (await this.aiConfig.resolve()).deploymentKeyServesOrgs !== false;
  }

  private holdsSystemWrite(userId: string, scope: AiKeyScope): Promise<boolean> {
    return scope.holdsAiConfigWrite ? scope.holdsAiConfigWrite() : this.holdsAiConfigWrite(userId);
  }

  private holdsOrgWrite(userId: string, scope: AiKeyScope): Promise<boolean> {
    if (!scope.orgId) return Promise.resolve(false);
    return scope.holdsOrgAiConfigWrite
      ? scope.holdsOrgAiConfigWrite()
      : this.holdsOrgAiConfigWrite(userId, scope.orgId);
  }
}

/** `AI_KEY_REQUIRED` (403), naming the provider so a client can link to the keys page. */
export function keyRequired(provider: string): AiError {
  return new AiError(
    'AI_KEY_REQUIRED',
    `Add your own API key for "${provider}" to use it.`,
    { details: { provider } },
  );
}

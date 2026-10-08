// =============================================================================
// AiOrgKeyService — an organization's own AI provider keys (issue #739)
// =============================================================================
//
// The org tier of AI key resolution. An organization's key for a provider is
// an `org_credentials` row of the credentials slice (#735): purpose `ai`, name
// the provider id, encrypted under the org-bound domain `org:<orgId>:ai` and
// read only inside that organization's row-level-security scope. This slice
// creates NO key table of its own.
//
// SAME INVARIANTS AS EVERY OTHER KEY (§2.2): `getKey` returns plaintext and is
// server-side only (the resolver hands it straight to an adapter); `list`
// returns `OrgAiKeyView`, which has no field able to carry a key; a key is
// VERIFIED with the provider before it is stored (nothing is written for a
// rejected key); no log line, audit row or error carries one.
// =============================================================================

import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { OrgAiKeyView } from '@marinoscar/platform-contract/ai';

import { PLATFORM_PRISMA, isCanonicalUuid } from '../../core/index';
import { OrgCredentialsService } from '../../credentials/index';
import { AI_CREDENTIAL_PURPOSE, aiCredentialLabel, aiCredentialName } from '../config/ai-credential.constants';
import { AiConfigAdminService } from '../config/ai-config-admin.service';
import { AiProviderRegistry } from '../core/provider-registry';
import type { AiPrisma } from '../data/ai-db';

/** The audit actions of the org-key routes. */
export const ORG_AI_KEY_AUDIT_ACTIONS = Object.freeze({
  set: 'org_ai_config:set_key',
  delete: 'org_ai_config:delete_key',
} as const);

/**
 * An organization's own AI provider keys, stored through `OrgCredentialsService`.
 *
 * @stability experimental
 */
@Injectable()
export class AiOrgKeyService {
  private readonly logger = new Logger(AiOrgKeyService.name);

  constructor(
    private readonly orgCredentials: OrgCredentialsService,
    private readonly registry: AiProviderRegistry,
    private readonly configAdmin: AiConfigAdminService,
    @Inject(PLATFORM_PRISMA) private readonly prisma: AiPrisma,
  ) {}

  /**
   * The organization's key for `provider`, decrypted, or `null`.
   *
   * ⚠ PLAINTEXT, NEVER CACHED. Hand it straight to an adapter; never log,
   * persist or return it. Whether it may serve a call is `AiKeyResolver`'s
   * decision.
   *
   * @param orgId - the organization (the principal's, or a job's; never request input).
   * @param provider - the provider id.
   */
  async getKey(orgId: string, provider: string): Promise<string | null> {
    // An organization id is a canonical UUID; anything else has no key.
    if (!isCanonicalUuid(orgId)) return null;
    return this.orgCredentials.getSecret(orgId, AI_CREDENTIAL_PURPOSE, aiCredentialName(provider));
  }

  /**
   * Whether the organization stored a key for `provider`, from the
   * credential's metadata, WITHOUT decrypting it.
   *
   * @param orgId - the organization.
   * @param provider - the provider id.
   */
  async hasKey(orgId: string, provider: string): Promise<boolean> {
    if (!isCanonicalUuid(orgId)) return false;
    return (await this.orgCredentials.describe(orgId, AI_CREDENTIAL_PURPOSE, aiCredentialName(provider))) !== null;
  }

  /**
   * One masked entry per registered provider: whether the organization
   * stored a key, its last characters and when it was stored (it is verified
   * before it is stored). Never the key.
   *
   * @param orgId - the organization.
   */
  async list(orgId: string): Promise<OrgAiKeyView[]> {
    const stored = new Map(
      (await this.orgCredentials.list(orgId, AI_CREDENTIAL_PURPOSE)).map((info) => [info.name, info]),
    );

    return this.registry.ids().map((provider) => {
      const info = stored.get(aiCredentialName(provider));
      return {
        provider,
        displayName: this.registry.get(provider)?.displayName ?? provider,
        configured: info !== undefined,
        hint: info?.hint ?? null,
        verifiedAt: info ? info.updatedAt.toISOString() : null,
      };
    });
  }

  /**
   * Verifies `apiKey` with the provider, then stores it as the
   * organization's key for `provider` and audits the change (with the
   * organization's id, never the key). A rejected key stores nothing.
   *
   * @param orgId - the organization (the principal's active one).
   * @param provider - a registered provider id.
   * @param apiKey - the key; never logged, returned or audited.
   * @param actorUserId - who set it.
   * @returns the provider's masked entry.
   * @throws NotFoundException for an unregistered provider.
   * @throws AiError `AI_KEY_INVALID` (400) for a rejected key.
   */
  async set(orgId: string, provider: string, apiKey: string, actorUserId: string): Promise<OrgAiKeyView> {
    const adapter = this.registry.get(provider);
    if (!adapter) throw this.unknownProvider(provider);

    await this.configAdmin.verifyProviderKey(provider, apiKey);

    await this.orgCredentials.setSecret(orgId, AI_CREDENTIAL_PURPOSE, aiCredentialName(provider), apiKey, {
      label: aiCredentialLabel(adapter.displayName),
      updatedByUserId: actorUserId,
    });
    await this.audit(orgId, actorUserId, ORG_AI_KEY_AUDIT_ACTIONS.set, provider);
    this.logger.log(`Organization ${orgId}: AI provider key for "${provider}" set by user ${actorUserId}`);

    return (await this.list(orgId)).find((view) => view.provider === provider)!;
  }

  /**
   * Removes the organization's key for `provider` and audits it. Idempotent.
   *
   * @param orgId - the organization.
   * @param provider - a registered provider id.
   * @param actorUserId - who removed it.
   */
  async remove(orgId: string, provider: string, actorUserId: string): Promise<void> {
    if (!this.registry.get(provider)) throw this.unknownProvider(provider);

    await this.orgCredentials.deleteSecret(orgId, AI_CREDENTIAL_PURPOSE, aiCredentialName(provider));
    await this.audit(orgId, actorUserId, ORG_AI_KEY_AUDIT_ACTIONS.delete, provider);
    this.logger.log(`Organization ${orgId}: AI provider key for "${provider}" removed by user ${actorUserId}`);
  }

  /** Audit row with the organization's id and codes only: never key material. */
  private async audit(orgId: string, actorUserId: string, action: string, provider: string): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        actorUserId,
        orgId,
        action,
        targetType: 'org_ai_config',
        targetId: provider,
        meta: { provider },
      },
    });
  }

  private unknownProvider(provider: string): NotFoundException {
    return new NotFoundException({
      message: `Unknown AI provider "${provider}".`,
      details: { reason: 'AI_UNKNOWN_PROVIDER', provider },
    });
  }
}

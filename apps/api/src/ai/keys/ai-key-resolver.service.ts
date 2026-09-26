import { Injectable } from '@nestjs/common';

import { AiConfigService } from '../config/ai-config.service';
import { AiError } from '../core/ai-error';
import { UserAiKeysService } from './user-ai-keys.service';

// =============================================================================
// AiKeyResolver — THE key-resolution rule (issue #431, epic #419)
// =============================================================================
//
// docs/specs/ai-platform.md §3. Every caller that needs a key to serve a user
// — the runtime facade (#432) and the usable-models computation — goes through
// this file rather than re-deriving the rule:
//
//   1. the user has a key for the provider                    -> { user }
//   2. keyPolicy 'byok_with_org_fallback' AND an org key exists -> { org }
//   3. otherwise                                               -> AI_KEY_REQUIRED
//
// ⚠ UNDER keyPolicy = 'byok' THE ORG (ADMIN) KEY IS NEVER RETURNED — not read,
// not decrypted, not handed to anyone. That is the platform's core security
// invariant: an administrator who chose strict BYOK promised every user that
// only their own provider account can be billed for their calls.
// `ai-key-resolver.service.spec.ts` pins the full matrix, and #435 re-verifies
// it end to end.
//
// The policy is read on every call (through `AiConfigService`'s 5 s cache), so
// an admin switching to strict BYOK stops the fallback within one cache window.
// =============================================================================

/** Whose key serves a user's call. `'admin_discovery'` is never a runtime answer. */
export type AiKeySource = 'user' | 'org';

export interface ResolvedAiKey {
  /** ⚠ PLAINTEXT. Hand it straight to an adapter; never log, persist or return it. */
  apiKey: string;
  keySource: AiKeySource;
}

@Injectable()
export class AiKeyResolver {
  constructor(
    private readonly userKeys: UserAiKeysService,
    private readonly aiConfig: AiConfigService,
  ) {}

  /**
   * The key that serves `userId`'s call to `provider`, decrypted.
   *
   * @throws AiError('AI_KEY_REQUIRED') when neither rule applies.
   */
  async resolve(userId: string, provider: string): Promise<ResolvedAiKey> {
    const userKey = await this.userKeys.getDecrypted(userId, provider);

    if (userKey) {
      return { apiKey: userKey, keySource: 'user' };
    }

    if (await this.orgFallbackApplies()) {
      const orgKey = await this.aiConfig.getOrgKey(provider);

      if (orgKey) {
        return { apiKey: orgKey, keySource: 'org' };
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
   */
  async sourceFor(provider: string, hasUserKey: boolean): Promise<AiKeySource | null> {
    if (hasUserKey) {
      return 'user';
    }

    if ((await this.orgFallbackApplies()) && (await this.aiConfig.hasOrgKey(provider))) {
      return 'org';
    }

    return null;
  }

  private async orgFallbackApplies(): Promise<boolean> {
    return (await this.aiConfig.resolve()).keyPolicy === 'byok_with_org_fallback';
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

// =============================================================================
// AiKeyResolver — the org tier (issue #739, extends ai-platform.md §2.2)
// =============================================================================
//
//   0. keyless provider                                         -> none
//   1. the user's own key                                       -> user
//   2. the ORGANIZATION's key, when the user holds
//      org_ai_config:write in that org OR the org's EFFECTIVE
//      keyPolicy is byok_with_org_fallback                      -> org  (tier 'org')
//   3. the DEPLOYMENT key, same rule with the SYSTEM permission
//      (ai_config:write), AND ai.deploymentKeyServesOrgs          -> org  (tier 'deployment')
//   4. otherwise                                                -> AI_KEY_REQUIRED
//
// The core invariant: under a strict `byok` (the deployment's, or the one an
// organization narrowed itself to) neither administrator key is READ for a
// non-administrator.
// =============================================================================

import { AiConfigService, type AiPolicy } from '../config/ai-config.service';
import { AiError } from '../core/ai-error';
import { AI_KEYLESS_API_KEY } from '../core/provider-adapter.interface';
import { AiProviderRegistry } from '../core/provider-registry';
import { FakeAiProvider } from '../testing/fake-ai-provider';
import { AiKeyResolver } from './ai-key-resolver.service';

const ORG = '33333333-3333-4333-8333-333333333333';
const USER_KEY = 'sk-user-own-key-1111';
const ORG_KEY = 'sk-org-tenant-key-7777';
const DEPLOYMENT_KEY = 'sk-deployment-key-9999';

interface Setup {
  keyPolicy?: AiPolicy['keyPolicy'];
  /** The organization's own `ai` overrides (its org layer). */
  orgLayer?: Record<string, unknown>;
  userKey?: boolean;
  orgKey?: boolean;
  deploymentKey?: boolean;
  /** `ai_config:write` (system). */
  systemAdmin?: boolean;
  /** `org_ai_config:write` in ORG. */
  orgAdmin?: boolean;
  deploymentKeyServesOrgs?: boolean;
  requiresKey?: boolean;
}

function build(o: Setup) {
  const registry = new AiProviderRegistry();
  registry.register(new FakeAiProvider({ id: 'openai' }));
  registry.register(new FakeAiProvider({ id: 'openai-compatible' }));
  const policy: AiPolicy = {
    enabled: true,
    keyPolicy: o.keyPolicy ?? 'byok',
    providers: {
      openai: { enabled: true },
      anthropic: { enabled: false },
      gemini: { enabled: false },
      'azure-openai': { enabled: false },
      'openai-compatible': { enabled: true, ...(o.requiresKey === false ? { requiresKey: false } : {}) },
    },
    defaults: { allowBackgroundRuns: true, allowRealtime: false },
    logPromptContent: false,
    usageRetentionDays: 180,
    hostedTools: {
      web_search: false,
      file_search: false,
      code_interpreter: false,
      image_generation: false,
      mcp: false,
      mcpAllowedHosts: [],
    },
    limits: {},
    deploymentKeyServesOrgs: o.deploymentKeyServesOrgs ?? true,
  };
  const deploymentGetSecret = jest.fn(async () => (o.deploymentKey ? DEPLOYMENT_KEY : null));
  const deploymentDescribe = jest.fn(async () => (o.deploymentKey ? { hint: '••••9999' } : null));
  const orgSettings = {
    isEnabled: () => true,
    getNamespace: jest.fn(async () => o.orgLayer),
  };
  const aiConfig = new AiConfigService(
    { getAiPolicy: jest.fn(async () => policy) } as never,
    { getSecret: deploymentGetSecret, describe: deploymentDescribe } as never,
    registry,
    orgSettings as never,
  );
  const orgKeys = {
    getKey: jest.fn(async () => (o.orgKey ? ORG_KEY : null)),
    hasKey: jest.fn(async () => o.orgKey === true),
  };
  const writers = {
    holdsAiConfigWrite: jest.fn(async () => o.systemAdmin === true),
    holdsOrgAiConfigWrite: jest.fn(async () => o.orgAdmin === true),
  };
  const resolver = new AiKeyResolver(
    { getDecrypted: jest.fn(async () => (o.userKey ? USER_KEY : null)) } as never,
    aiConfig,
    writers as never,
    orgKeys as never,
  );
  return { resolver, orgKeys, deploymentGetSecret, writers };
}

async function outcome(o: Setup, provider = 'openai'): Promise<string> {
  const { resolver } = build(o);
  try {
    const res = await resolver.resolve('user-1', provider, { orgId: ORG });
    return `${res.keySource}/${res.tier}/${res.apiKey}`;
  } catch (err) {
    expect(err).toBeInstanceOf(AiError);
    expect(JSON.stringify(err)).not.toContain(ORG_KEY);
    expect(JSON.stringify(err)).not.toContain(DEPLOYMENT_KEY);
    return (err as AiError).code;
  }
}

describe('AiKeyResolver org tier (#739)', () => {
  it.each<[string, Setup, string]>([
    ['the user key wins over every administrator key', { userKey: true, orgKey: true, deploymentKey: true, keyPolicy: 'byok_with_org_fallback' }, `user/user/${USER_KEY}`],
    ['the org key serves under byok_with_org_fallback', { orgKey: true, deploymentKey: true, keyPolicy: 'byok_with_org_fallback' }, `org/org/${ORG_KEY}`],
    ['the org key is NOT returned under byok to a non-admin', { orgKey: true, deploymentKey: true, keyPolicy: 'byok' }, 'AI_KEY_REQUIRED'],
    ['an org admin is served by the org key under byok', { orgKey: true, keyPolicy: 'byok', orgAdmin: true }, `org/org/${ORG_KEY}`],
    ['an org admin is NOT served by the deployment key under byok (that needs ai_config:write)', { deploymentKey: true, keyPolicy: 'byok', orgAdmin: true }, 'AI_KEY_REQUIRED'],
    ['a system admin is served by the deployment key under byok (#593, unchanged)', { deploymentKey: true, keyPolicy: 'byok', systemAdmin: true }, `org/deployment/${DEPLOYMENT_KEY}`],
    ['without an org key the deployment key serves under the fallback', { deploymentKey: true, keyPolicy: 'byok_with_org_fallback' }, `org/deployment/${DEPLOYMENT_KEY}`],
    ['deploymentKeyServesOrgs: false stops the deployment key', { deploymentKey: true, keyPolicy: 'byok_with_org_fallback', deploymentKeyServesOrgs: false }, 'AI_KEY_REQUIRED'],
    ['deploymentKeyServesOrgs: false leaves the org key', { orgKey: true, deploymentKey: true, keyPolicy: 'byok_with_org_fallback', deploymentKeyServesOrgs: false }, `org/org/${ORG_KEY}`],
    ['an organization that narrowed keyPolicy to byok is served by neither administrator key', { orgKey: true, deploymentKey: true, keyPolicy: 'byok_with_org_fallback', orgLayer: { keyPolicy: 'byok' } }, 'AI_KEY_REQUIRED'],
    ['an organization cannot widen a byok deployment', { orgKey: true, deploymentKey: true, keyPolicy: 'byok', orgLayer: { keyPolicy: 'byok_with_org_fallback' } }, 'AI_KEY_REQUIRED'],
    ['no key anywhere is AI_KEY_REQUIRED', { keyPolicy: 'byok_with_org_fallback' }, 'AI_KEY_REQUIRED'],
  ])('%s', async (_name, setup, expected) => {
    expect(await outcome(setup)).toBe(expected);
  });

  it('a keyless provider reads no key at all', async () => {
    const { resolver, orgKeys, deploymentGetSecret } = build({ requiresKey: false, orgKey: true, deploymentKey: true });
    await expect(resolver.resolve('user-1', 'openai-compatible', { orgId: ORG })).resolves.toEqual({
      apiKey: AI_KEYLESS_API_KEY,
      keySource: 'none',
      tier: 'none',
    });
    expect(orgKeys.getKey).not.toHaveBeenCalled();
    expect(deploymentGetSecret).not.toHaveBeenCalled();
  });

  it('under byok neither administrator key is even READ for a non-admin', async () => {
    const { resolver, orgKeys, deploymentGetSecret } = build({ orgKey: true, deploymentKey: true, keyPolicy: 'byok' });
    await expect(resolver.resolve('user-1', 'openai', { orgId: ORG })).rejects.toBeInstanceOf(AiError);
    expect(orgKeys.getKey).not.toHaveBeenCalled();
    expect(deploymentGetSecret).not.toHaveBeenCalled();
  });

  it('sourceFor agrees, without decrypting anything', async () => {
    const { resolver, orgKeys, deploymentGetSecret } = build({ orgKey: true, keyPolicy: 'byok_with_org_fallback' });
    await expect(resolver.sourceFor('user-1', 'openai', false, undefined, { orgId: ORG })).resolves.toBe('org');
    expect(orgKeys.getKey).not.toHaveBeenCalled();
    expect(deploymentGetSecret).not.toHaveBeenCalled();

    const strict = build({ orgKey: true, keyPolicy: 'byok' });
    await expect(strict.resolver.sourceFor('user-1', 'openai', false, undefined, { orgId: ORG })).resolves.toBeNull();
  });

  it('without an organization (single-org callers that name none) behaves exactly as before', async () => {
    const { resolver, orgKeys } = build({ orgKey: true, deploymentKey: true, keyPolicy: 'byok_with_org_fallback' });
    await expect(resolver.resolve('user-1', 'openai')).resolves.toEqual({
      apiKey: DEPLOYMENT_KEY,
      keySource: 'org',
      tier: 'deployment',
    });
    expect(orgKeys.getKey).not.toHaveBeenCalled();
  });
});

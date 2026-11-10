import { nodeCredentialPurposeRegistry } from '../../src/jobs/node-credential-purpose';
import { AI_KEYLESS_API_KEY } from '../../src/ai/core/provider-adapter.interface';
import { AiKeyResolver } from '../../src/ai/keys/ai-key-resolver.service';
import {
  aiNodeCredentialPurposeId,
  registerAiNodeCredentialPurposes,
  resolveAiNodeCredential,
} from '../../src/ai/keys/ai-node-credential-purposes';
import { registerAiFeature, getAiFeature } from '../../src/ai/features/ai-feature.registry';
import { findAiJobsMissingFromServerOnly, findNodeEligibleAiJobs } from '../../src/ai/testing/conformance/ai-jobs-server-only.suite';

// The AI slice's node credential purposes (issue #1083): org or deployment
// tier only, never a user's key, and the amended ai-jobs-server-only rule.

function ctx(resolver: Partial<AiKeyResolver>, orgId: string | null = 'org-1') {
  return { orgId, job: null, get: <T>(token: unknown): T => (token === AiKeyResolver ? (resolver as T) : (undefined as T)) };
}

describe('ai:<provider> node credential purposes', () => {
  it('registers one purpose per provider, idempotently', () => {
    registerAiNodeCredentialPurposes(['openai', 'anthropic']);
    registerAiNodeCredentialPurposes(['openai']);
    expect(nodeCredentialPurposeRegistry.get('ai:openai')).toBeDefined();
    expect(nodeCredentialPurposeRegistry.get('ai:anthropic')).toBeDefined();
    expect(aiNodeCredentialPurposeId('gemini')).toBe('ai:gemini');
  });

  it('resolves through resolveForSystem (organization, then deployment), never the user tier', async () => {
    const resolveForSystem = jest.fn().mockResolvedValue({ apiKey: 'sk-org', keySource: 'org', tier: 'org' });
    const resolve = jest.fn();
    await expect(resolveAiNodeCredential('openai', ctx({ resolveForSystem, resolve } as never))).resolves.toEqual({ material: { apiKey: 'sk-org' } });
    expect(resolveForSystem).toHaveBeenCalledWith('openai', { orgId: 'org-1' });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('returns null when neither tier has a key, and never delivers the keyless marker', async () => {
    const missing = jest.fn().mockRejectedValue(new Error('AI_KEY_REQUIRED'));
    await expect(resolveAiNodeCredential('openai', ctx({ resolveForSystem: missing } as never, null))).resolves.toBeNull();
    const keyless = jest.fn().mockResolvedValue({ apiKey: AI_KEYLESS_API_KEY, keySource: 'none', tier: 'none' });
    const delivered = await resolveAiNodeCredential('local', ctx({ resolveForSystem: keyless } as never));
    expect(delivered).toEqual({ material: { keyless: 'true' } });
    expect(JSON.stringify(delivered)).not.toContain(AI_KEYLESS_API_KEY);
  });
});

describe('ai-jobs-server-only, amended (#1083)', () => {
  registerAiFeature({ id: 'test_node_delivery', label: 'Test node delivery', needs: ['responses'], nodeCredentialDelivery: true });
  registerAiFeature({ id: 'test_server_only', label: 'Test server only', needs: ['responses'] });
  const members = { nodeResultSchema: {}, persistNodeResult: () => undefined };

  const view = (handlers: Record<string, object>, serverOnly: string[]) => ({
    types: () => Object.keys(handlers),
    get: (type: string) => handlers[type],
    serverOnlyTypes: () => serverOnly,
  });

  it('accepts a node-eligible ai.* type with ai: purposes and every feature opted in', () => {
    const registry = view({ 'ai.test.tag': { ...members, nodeCredentialPurposes: ['ai:openai'], aiFeatures: ['test_node_delivery'] } }, []);
    expect(getAiFeature('test_node_delivery')?.nodeCredentialDelivery).toBe(true);
    expect(findNodeEligibleAiJobs(registry)).toEqual([]);
    expect(findAiJobsMissingFromServerOnly(registry)).toEqual([]);
  });

  it('still fails an undeclared node-eligible ai.* type, and one serving a feature that did not opt in', () => {
    const registry = view(
      {
        'ai.test.bare': { ...members },
        'ai.test.mixed': { ...members, nodeCredentialPurposes: ['ai:openai'], aiFeatures: ['test_node_delivery', 'test_server_only'] },
      },
      [],
    );
    expect(findNodeEligibleAiJobs(registry)).toHaveLength(4);
    expect(findAiJobsMissingFromServerOnly(registry)).toEqual(['ai.test.bare', 'ai.test.mixed']);
  });

  it('refuses a non-boolean nodeCredentialDelivery', () => {
    expect(() => registerAiFeature({ id: 'test_bad_flag', label: 'x', needs: ['responses'], nodeCredentialDelivery: 'yes' as never })).toThrow();
  });
});

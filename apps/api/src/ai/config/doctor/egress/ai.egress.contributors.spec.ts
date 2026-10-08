import { EgressRegistry } from '@marinoscar/platform-api/doctor';

import { SystemSettingsService } from '@marinoscar/platform-api/settings';
import { AiCatalogRefreshTask } from '../../../catalog/ai-catalog-refresh.task';
import { AiCatalogRefreshEgressContributor } from '../../../catalog/doctor/egress/ai-catalog-refresh.egress.contributor';
import { AiProviderRegistry } from '../../../core/provider-registry';
import { AiConfigService, AiPolicy } from '../../ai-config.service';
import { AiProvidersEgressContributor } from './ai-providers.egress.contributor';
import { AiRealtimeEgressContributor } from './ai-realtime.egress.contributor';

/** A policy with every provider slot; overrides merge into the named slot. */
function policy(enabled: boolean, slots: Record<string, Record<string, unknown>> = {}): AiPolicy {
  const providers: Record<string, Record<string, unknown>> = {
    openai: { enabled: false },
    anthropic: { enabled: false },
    gemini: { enabled: false },
    'azure-openai': { enabled: false },
    'openai-compatible': { enabled: false },
  };
  for (const [id, slot] of Object.entries(slots)) providers[id] = { ...providers[id], ...slot };
  return { enabled, keyPolicy: 'org_only', providers } as unknown as AiPolicy;
}

/** Adapters as the real ones declare them: id, name, default endpoint, realtime port. */
function registry(): AiProviderRegistry {
  const reg = new AiProviderRegistry();
  const adapter = (id: string, displayName: string, extra: Record<string, unknown> = {}) =>
    reg.register({ id, displayName, ...extra } as never);
  adapter('openai', 'OpenAI', { defaultBaseUrl: 'https://api.openai.com/v1', realtime: {} });
  adapter('anthropic', 'Anthropic', { defaultBaseUrl: 'https://api.anthropic.com' });
  adapter('gemini', 'Google Gemini', { defaultBaseUrl: 'https://generativelanguage.googleapis.com' });
  adapter('azure-openai', 'Azure OpenAI');
  adapter('openai-compatible', 'OpenAI-compatible');
  return reg;
}

function config(value: AiPolicy) {
  return { resolve: jest.fn().mockResolvedValue(value) } as unknown as AiConfigService;
}

describe('AiProvidersEgressContributor (#773)', () => {
  it('registers itself', () => {
    const egress = new EgressRegistry();
    const subject = new AiProvidersEgressContributor(egress, config(policy(true)), registry());
    subject.onModuleInit();
    expect(egress.list()).toEqual([subject]);
  });

  it('lists every slot, enabled only when AI is on, the slot is on and an adapter exists', async () => {
    const reg = registry();
    const deps = await new AiProvidersEgressContributor(
      new EgressRegistry(),
      config(policy(true, { openai: { enabled: true } })),
      reg,
    ).describe();

    expect(deps.map((d) => [d.id, d.enabled])).toEqual([
      ['ai.provider.openai', true],
      ['ai.provider.anthropic', false],
      ['ai.provider.gemini', false],
      ['ai.provider.azure-openai', false],
      ['ai.provider.openai-compatible', false],
    ]);
    expect(deps[0]).toMatchObject({
      capability: 'AI provider: OpenAI',
      direction: 'server',
      hosts: ['api.openai.com'],
      scope: 'public',
      required: false,
      settingsPath: '/admin/settings/ai',
    });
    expect(deps[1]).toMatchObject({ hosts: ['api.anthropic.com'] });
    expect(deps[2]).toMatchObject({ hosts: ['generativelanguage.googleapis.com'] });
    expect(deps[3]).toMatchObject({ hosts: [], scope: 'unknown' });
  });

  it('is disabled everywhere while the kill switch is off', async () => {
    const deps = await new AiProvidersEgressContributor(
      new EgressRegistry(),
      config(policy(false, { openai: { enabled: true } })),
      registry(),
    ).describe();
    expect(deps.every((d) => !d.enabled)).toBe(true);
  });

  it('is disabled for an enabled slot with no adapter registered', async () => {
    const deps = await new AiProvidersEgressContributor(
      new EgressRegistry(),
      config(policy(true, { openai: { enabled: true } })),
      new AiProviderRegistry(),
    ).describe();
    expect(deps[0]).toMatchObject({ id: 'ai.provider.openai', enabled: false, hosts: [] });
  });

  it('takes the host of a custom baseUrl, never its scheme, port, path or userinfo', async () => {
    const deps = await new AiProvidersEgressContributor(
      new EgressRegistry(),
      config(
        policy(true, {
          'openai-compatible': { enabled: true, baseUrl: 'http://user:pw@ollama:11434/v1?x=1', requiresKey: false },
          'azure-openai': { enabled: true, baseUrl: 'https://contoso.openai.azure.com/', apiVersion: '2024-10-21' },
          openai: { enabled: true, baseUrl: 'https://proxy.corp.internal/openai/v1' },
        }),
      ),
      registry(),
    ).describe();
    const byId = Object.fromEntries(deps.map((d) => [d.id, d]));

    expect(byId['ai.provider.openai-compatible']).toMatchObject({ hosts: ['ollama'], scope: 'private', enabled: true });
    expect(byId['ai.provider.azure-openai']).toMatchObject({ hosts: ['contoso.openai.azure.com'], scope: 'public' });
    expect(byId['ai.provider.openai']).toMatchObject({ hosts: ['proxy.corp.internal'], scope: 'private' });
    expect(JSON.stringify(deps)).not.toMatch(/pw|11434|\/v1|x=1/);
  });
});

describe('AiRealtimeEgressContributor (#773)', () => {
  it('derives realtime providers from the adapter port, with a browser direction', async () => {
    const deps = await new AiRealtimeEgressContributor(
      new EgressRegistry(),
      config(policy(true, { openai: { enabled: true } })),
      registry(),
    ).describe();

    expect(deps).toEqual([
      expect.objectContaining({
        id: 'ai.realtime.openai',
        direction: 'browser',
        enabled: true,
        hosts: ['api.openai.com'],
      }),
    ]);
  });

  it('is disabled when the provider is off, and empty with no realtime adapter (no settings read)', async () => {
    const off = await new AiRealtimeEgressContributor(new EgressRegistry(), config(policy(true)), registry()).describe();
    expect(off[0]).toMatchObject({ enabled: false });

    const cfg = config(policy(true));
    expect(await new AiRealtimeEgressContributor(new EgressRegistry(), cfg, new AiProviderRegistry()).describe()).toEqual([]);
    expect(cfg.resolve).not.toHaveBeenCalled();
  });
});

describe('AiCatalogRefreshEgressContributor (#773)', () => {
  function subject(due: string[], value: AiPolicy) {
    const task = { dueProviders: jest.fn().mockResolvedValue(due) } as unknown as AiCatalogRefreshTask;
    const settings = { getAiPolicy: jest.fn().mockResolvedValue(value) } as unknown as SystemSettingsService;
    return { task, contributor: new AiCatalogRefreshEgressContributor(new EgressRegistry(), task, settings, registry()) };
  }

  it("lists exactly the task's due providers, through the task's own read-only logic", async () => {
    const { task, contributor } = subject(
      ['openai', 'openai-compatible'],
      policy(true, { openai: { enabled: true }, 'openai-compatible': { enabled: true, baseUrl: 'http://ollama:11434/v1' } }),
    );
    const deps = await contributor.describe();

    expect(task.dueProviders).toHaveBeenCalledTimes(1);
    expect(deps.map((d) => [d.id, d.enabled, d.hosts])).toEqual([
      ['ai.catalog-refresh.openai', true, ['api.openai.com']],
      ['ai.catalog-refresh.openai-compatible', true, ['ollama']],
    ]);
    expect(deps[0]?.degradation).toMatch(/ai\.catalog\.refresh/);
  });

  it('is empty when nothing is due (AI off)', async () => {
    expect(await subject([], policy(false)).contributor.describe()).toEqual([]);
  });
});

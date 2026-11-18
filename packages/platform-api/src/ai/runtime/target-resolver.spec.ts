// AI_TARGET_RESOLVER (issue #739): the default resolver is the base
// behaviour extracted unchanged from AiService, and a resolver bound through
// the token wins.

import { AiError } from '../core/ai-error';
import { AiProviderRegistry } from '../core/provider-registry';
import { FakeAiProvider } from '../testing/fake-ai-provider';
import { createAiRuntimeHarness, HARNESS_MODEL, HARNESS_USER } from '../testing/ai-runtime-harness';
import { DefaultAiTargetResolver, type AiTargetContext, type AiTargetResolver } from './target-resolver';

const USER = '11111111-1111-4111-8111-111111111111';

function resolverWith(opts: {
  defaultModel?: { provider: string; modelId: string } | null;
  providers?: string[];
  perUserDefaultModel?: boolean;
}) {
  const registry = new AiProviderRegistry();
  for (const id of opts.providers ?? ['openai']) registry.register(new FakeAiProvider({ id }));
  const prisma = {
    userSettings: {
      findUnique: jest.fn(async () =>
        opts.defaultModel === undefined ? null : { value: { ai: { defaultModel: opts.defaultModel } } },
      ),
    },
  };
  return new DefaultAiTargetResolver(prisma as never, registry, { perUserDefaultModel: opts.perUserDefaultModel ?? true });
}

const ctx = (requested: AiTargetContext['requested']): AiTargetContext => ({ userId: USER, requested });

describe('DefaultAiTargetResolver (the base behaviour, unchanged)', () => {
  it('a named model on a named provider is taken as is', async () => {
    await expect(resolverWith({ providers: ['openai', 'gemini'] }).resolve(ctx({ provider: 'gemini', model: 'g-1' }))).resolves.toEqual({
      provider: 'gemini',
      model: 'g-1',
    });
  });

  it('a named model without a provider takes the default model provider, else the sole provider', async () => {
    const withDefault = resolverWith({ defaultModel: { provider: 'gemini', modelId: 'x' }, providers: ['openai', 'gemini'] });
    await expect(withDefault.resolve(ctx({ model: ' m-1 ' }))).resolves.toEqual({ provider: 'gemini', model: 'm-1' });

    await expect(resolverWith({ providers: ['openai'] }).resolve(ctx({ model: 'm-1' }))).resolves.toEqual({
      provider: 'openai',
      model: 'm-1',
    });
  });

  it('a named model with no way to pick a provider is AI_INVALID_REQUEST "No provider selected."', async () => {
    const err = await resolverWith({ providers: ['openai', 'gemini'] })
      .resolve(ctx({ model: 'm-1' }))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiError);
    expect((err as AiError).code).toBe('AI_INVALID_REQUEST');
    expect((err as AiError).message).toBe('No provider selected.');
  });

  it('no model falls back to ai.defaultModel, and is "no model" (null) without one or on another provider', async () => {
    const def = { provider: 'openai', modelId: 'fallback' };
    await expect(resolverWith({ defaultModel: def }).resolve(ctx({}))).resolves.toEqual({ provider: 'openai', model: 'fallback' });
    await expect(resolverWith({ defaultModel: def }).resolve(ctx({ provider: 'gemini' }))).resolves.toBeNull();
    await expect(resolverWith({}).resolve(ctx({}))).resolves.toBeNull();
    await expect(resolverWith({ defaultModel: null }).resolve(ctx({}))).resolves.toBeNull();
  });
});

describe('AiModule.forRoot({ perUserDefaultModel: false })', () => {
  it('the default resolver ignores the ai.defaultModel user setting', async () => {
    const off = resolverWith({ defaultModel: { provider: 'openai', modelId: 'fallback' }, perUserDefaultModel: false });
    await expect(off.resolve(ctx({}))).resolves.toBeNull();
    await expect(off.resolve(ctx({ model: 'm-1' }))).resolves.toEqual({ provider: 'openai', model: 'm-1' });
  });
});

describe('AiService and AI_TARGET_RESOLVER', () => {
  it('without a binding keeps the old answer: no model and no default is "No model selected."', async () => {
    const h = createAiRuntimeHarness();
    const err = await h.ai.forUser(HARNESS_USER).respond({ input: 'hi' }).catch((e: unknown) => e);
    expect((err as AiError).code).toBe('AI_INVALID_REQUEST');
    expect((err as AiError).message).toBe('No model selected.');
  });

  it('a bound resolver wins: it picks the model, and is told the caller, the organization and the feature', async () => {
    const resolve = jest.fn(async () => ({ provider: 'openai', model: HARNESS_MODEL }));
    const custom: AiTargetResolver = { resolve };
    const h = createAiRuntimeHarness({ targetResolver: custom });

    const res = await h.ai.forUser(HARNESS_USER, { orgId: '33333333-3333-4333-8333-333333333333' }).respond({ input: 'hi' });

    expect(res.model).toBe(HARNESS_MODEL);
    expect(resolve).toHaveBeenCalledWith({
      userId: HARNESS_USER,
      orgId: '33333333-3333-4333-8333-333333333333',
      requested: {},
    });
  });

  it('a bound resolver returning null is "No model selected."', async () => {
    const h = createAiRuntimeHarness({ targetResolver: { resolve: async () => null } });
    const err = await h.ai.forUser(HARNESS_USER).respond({ model: HARNESS_MODEL, input: 'hi' }).catch((e: unknown) => e);
    expect((err as AiError).message).toBe('No model selected.');
  });
});

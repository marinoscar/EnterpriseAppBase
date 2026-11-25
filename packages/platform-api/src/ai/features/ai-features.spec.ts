// registerAiFeature + forUser(userId, { feature }) (issue #739, rung 2).

import { withTemporaryEntries } from '../../core/index';
import { AiError } from '../core/ai-error';
import type { AiModelCapabilities } from '../core/capabilities';
import { createAiRuntimeHarness, HARNESS_MODEL, HARNESS_USER } from '../testing/ai-runtime-harness';
import { aiFeatureRegistry, registerAiFeature, type AiFeatureDefinition } from './ai-feature.registry';
import { AiFeaturesService, modelFitsFeature } from './ai-features.service';

const TEXT_ONLY: AiModelCapabilities = {
  capabilities: ['responses'],
  inputModalities: ['text'],
  outputModalities: ['text'],
};

const SUMMARY: AiFeatureDefinition = { id: 'spec_summary', label: 'Summaries', needs: ['responses'] };
const STRUCTURED: AiFeatureDefinition = {
  id: 'spec_structured',
  label: 'Structured',
  needs: ['responses', 'structured_output'],
};
const PHOTO: AiFeatureDefinition = { id: 'spec_photo', label: 'Photo reading', needs: ['responses'], inputModalities: ['image'] };
const ELSEWHERE: AiFeatureDefinition = { id: 'spec_elsewhere', label: 'Elsewhere', needs: ['responses'], providers: ['anthropic'] };

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'resolved';
  } catch (err) {
    return err instanceof AiError ? err.code : String(err);
  }
}

describe('the AI feature registry', () => {
  it('refuses a malformed feature', async () => {
    await withTemporaryEntries(aiFeatureRegistry, [], () => {
      expect(() => registerAiFeature({ id: 'Bad-Id', label: 'x', needs: ['responses'] })).toThrow();
      expect(() => registerAiFeature({ id: 'no_needs', label: 'x', needs: [] })).toThrow(/needs/);
      expect(() => registerAiFeature({ id: 'bad_need', label: 'x', needs: ['telepathy' as never] })).toThrow(/telepathy/);
      expect(() => registerAiFeature({ id: 'bad_modality', label: 'x', needs: ['responses'], inputModalities: ['smell' as never] })).toThrow(/smell/);
      expect(() => registerAiFeature({ id: 'no_label', label: ' ', needs: ['responses'] })).toThrow(/label/);
      expect(() => registerAiFeature({ id: 'empty_providers', label: 'x', needs: ['responses'], providers: [] })).toThrow(/providers/);
      registerAiFeature(SUMMARY);
      expect(() => registerAiFeature(SUMMARY)).toThrow();
    });
  });

  it('modelFitsFeature checks providers, needs and input modalities', () => {
    const model = { provider: 'openai', capabilities: TEXT_ONLY };
    expect(modelFitsFeature(SUMMARY, model)).toBe(true);
    expect(modelFitsFeature(STRUCTURED, model)).toBe(false);
    expect(modelFitsFeature(PHOTO, model)).toBe(false);
    expect(modelFitsFeature(ELSEWHERE, model)).toBe(false);
  });
});

describe('AiService.forUser(userId, { feature })', () => {
  it('an unregistered feature is AI_INVALID_REQUEST, before any provider call', async () => {
    const h = createAiRuntimeHarness();
    expect(await codeOf(h.ai.forUser(HARNESS_USER, { feature: 'nope' }).respond({ model: HARNESS_MODEL, input: 'hi' }))).toBe(
      'AI_INVALID_REQUEST',
    );
    expect(h.fake.calls).toHaveLength(0);
  });

  it('a model with what the feature needs serves it', async () => {
    await withTemporaryEntries(aiFeatureRegistry, [SUMMARY], async () => {
      const h = createAiRuntimeHarness();
      const res = await h.ai.forUser(HARNESS_USER, { feature: 'spec_summary' }).respond({ model: HARNESS_MODEL, input: 'hi' });
      expect(res.model).toBe(HARNESS_MODEL);
    });
  });

  it.each([
    ['a missing capability', STRUCTURED],
    ['a missing input modality', PHOTO],
    ['a provider outside the allow-list', ELSEWHERE],
  ])('a model lacking %s is refused with AI_INVALID_REQUEST', async (_name, feature) => {
    await withTemporaryEntries(aiFeatureRegistry, [feature], async () => {
      const h = createAiRuntimeHarness({ models: [{ modelId: HARNESS_MODEL, capabilities: TEXT_ONLY }] });
      const err = await h.ai.forUser(HARNESS_USER, { feature: feature.id }).respond({ model: HARNESS_MODEL, input: 'hi' }).catch((e: unknown) => e);
      expect((err as AiError).code).toBe('AI_INVALID_REQUEST');
      expect((err as AiError).toJSON().details).toMatchObject({ feature: feature.id });
      expect(h.fake.calls).toHaveLength(0);
    });
  });

  it('routes through AI_TARGET_RESOLVER with the feature id', async () => {
    await withTemporaryEntries(aiFeatureRegistry, [SUMMARY], async () => {
      const resolve = jest.fn(async () => ({ provider: 'openai', model: HARNESS_MODEL }));
      const h = createAiRuntimeHarness({ targetResolver: { resolve } });
      await h.ai.forUser(HARNESS_USER, { feature: 'spec_summary' }).respond({ input: 'hi' });
      expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ userId: HARNESS_USER, feature: 'spec_summary' }));
    });
  });
});

describe('AiFeaturesService (GET /api/ai/features)', () => {
  it('lists the registered features in order, each with whether the caller has a usable model', async () => {
    await withTemporaryEntries(aiFeatureRegistry, [SUMMARY, STRUCTURED], async () => {
      const h = createAiRuntimeHarness({ models: [{ modelId: HARNESS_MODEL, capabilities: TEXT_ONLY }] });
      const service = new AiFeaturesService(h.usableModels);
      const views = await service.listForUser(HARNESS_USER);
      expect(views.map((v) => [v.id, v.usable])).toEqual([
        ['spec_summary', true],
        ['spec_structured', false],
      ]);
      expect(views[0]).toEqual({
        id: 'spec_summary',
        label: 'Summaries',
        group: null,
        needs: ['responses'],
        inputModalities: [],
        providers: null,
        requiresHostedTools: [],
        defaultEffort: null,
        usable: true,
      });
    });
  });

  it('is empty when nothing is registered', async () => {
    const h = createAiRuntimeHarness();
    await expect(new AiFeaturesService(h.usableModels).listForUser(HARNESS_USER)).resolves.toEqual([]);
  });
});

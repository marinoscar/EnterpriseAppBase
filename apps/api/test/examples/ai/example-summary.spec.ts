// =============================================================================
// The AI reference examples (issue #739), over the fake provider
// =============================================================================
//
// - `example_summary` is registered and `ExampleSummaryService` calls AI for
//   it through `AiService.forUser(userId, { feature })`.
// - A model lacking the feature's needs is refused (AI_INVALID_REQUEST).
// - A custom `AI_TARGET_RESOLVER` (`FeatureMapTargetResolver`) bound in a
//   test module wins: it picks the model for the feature.
// =============================================================================

import { Test } from '@nestjs/testing';
import { AI_TARGET_RESOLVER, AiError, getAiFeature, type AiTargetResolver } from '@marinoscar/platform-api/ai';
import { createAiRuntimeHarness, HARNESS_MODEL, HARNESS_USER } from '@marinoscar/platform-api/ai/testing';

import { EXAMPLE_SUMMARY_FEATURE_ID } from '../../../src/examples/ai/example-summary.feature';
import { ExampleSummaryService } from '../../../src/examples/ai/example-summary.service';
import { FeatureMapTargetResolver } from '../../../src/examples/ai/example-target-resolver';

describe('AI reference examples (#739)', () => {
  it('registers example_summary', () => {
    expect(getAiFeature(EXAMPLE_SUMMARY_FEATURE_ID)).toMatchObject({ needs: ['responses'], inputModalities: ['text'] });
  });

  it('ExampleSummaryService answers through AiService.forUser(userId, { feature })', async () => {
    const h = createAiRuntimeHarness({ fake: { responses: () => ({ outputText: 'A short summary.' }) } });
    const service = new ExampleSummaryService(h.ai);

    await expect(service.summarize(HARNESS_USER, 'A long text.', { model: HARNESS_MODEL })).resolves.toBe('A short summary.');
    expect(h.fake.callsTo('responses.create')).toHaveLength(1);
  });

  it('a model lacking the feature needs is refused with AI_INVALID_REQUEST', async () => {
    const h = createAiRuntimeHarness({
      models: [{ modelId: HARNESS_MODEL, capabilities: { capabilities: ['responses'], inputModalities: ['image'], outputModalities: ['text'] } }],
    });
    const err = await new ExampleSummaryService(h.ai)
      .summarize(HARNESS_USER, 'A long text.', { model: HARNESS_MODEL })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AiError);
    expect((err as AiError).code).toBe('AI_INVALID_REQUEST');
  });

  it('a custom AI_TARGET_RESOLVER bound in a test module wins: it picks the model for the feature', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        {
          provide: AI_TARGET_RESOLVER,
          useValue: new FeatureMapTargetResolver({ [EXAMPLE_SUMMARY_FEATURE_ID]: { provider: 'openai', model: HARNESS_MODEL } }),
        },
      ],
    }).compile();
    const resolver = moduleRef.get<AiTargetResolver>(AI_TARGET_RESOLVER);
    const h = createAiRuntimeHarness({
      targetResolver: resolver,
      fake: { responses: () => ({ outputText: 'Mapped.' }) },
    });

    // No model named: without the resolver this is "No model selected."
    await expect(new ExampleSummaryService(h.ai).summarize(HARNESS_USER, 'A long text.')).resolves.toBe('Mapped.');
    expect(h.fake.callsTo('responses.create')[0]).toMatchObject({ request: expect.objectContaining({ model: HARNESS_MODEL }) });

    const defaultHarness = createAiRuntimeHarness();
    await expect(new ExampleSummaryService(defaultHarness.ai).summarize(HARNESS_USER, 'A long text.')).rejects.toMatchObject({
      code: 'AI_INVALID_REQUEST',
    });
  });
});

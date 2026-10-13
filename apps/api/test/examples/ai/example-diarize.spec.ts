// =============================================================================
// A custom AI operation and its capability, added from the app (PP-14.17, #935)
// =============================================================================
//
// `speaker_diarization` (a capability) and `audio.diarize` (an operation) are
// registered by `app-registrations/ai.ts`; `example-transcribe` implements the
// operation under `AiProviderAdapter.operations`. No package was edited. This
// spec runs the REAL gate pipeline (`AiService.run`, key policy, limits, usage
// recorder) over the AI runtime harness and proves what the issue asks:
//
//   - the app capability and operation run through the full gate pipeline;
//   - they are metered per feature (a usage row with the feature and units);
//   - the built-in ports are unchanged (a plain transcription still works).
// =============================================================================

import { AiError, AiProviderRegistry, getAiCapability, getAiFeature, getAiOperation } from '@marinoscar/platform-api/ai';
import { createAiRuntimeHarness, HARNESS_USER, HARNESS_USER_KEY } from '@marinoscar/platform-api/ai/testing';

import '../../../src/app-registrations/ai';
import {
  EXAMPLE_DIARIZE_CAPABILITY,
  EXAMPLE_DIARIZE_MAX_BASE64_CHARS,
  EXAMPLE_DIARIZE_OPERATION,
} from '../../../src/platform-extensions/ai/example-transcribe/example-diarize.operation';
import { ExampleTranscribeAdapter } from '../../../src/platform-extensions/ai/example-transcribe/example-transcribe.adapter';
import { exampleTranscribeProvider } from '../../../src/platform-extensions/ai/example-transcribe/example-transcribe.provider';
import {
  EXAMPLE_TRANSCRIBE_MODEL,
  FakeExampleTranscribeTransport,
} from '../../../src/platform-extensions/ai/example-transcribe/example-transcribe.transport';

const PROVIDER = 'example-transcribe';
const FEATURE = 'example_meeting_notes';
const PLAIN_MODEL = 'example-asr-plain';

const recordingOf = (bytes: number) => Buffer.alloc(bytes, 7).toString('base64');

function setup(opts: { userKey?: boolean } = {}) {
  const transport = new FakeExampleTranscribeTransport();
  const adapter = new ExampleTranscribeAdapter(new AiProviderRegistry(), transport);
  const h = createAiRuntimeHarness({
    extraProviders: [exampleTranscribeProvider],
    extraAdapters: [adapter],
    userKey: opts.userKey,
    models: [
      // The adapter's own classification: transcription AND diarization.
      { modelId: EXAMPLE_TRANSCRIBE_MODEL, provider: PROVIDER, capabilities: adapter.classifyModel(EXAMPLE_TRANSCRIBE_MODEL)! },
      // A model that only transcribes.
      {
        modelId: PLAIN_MODEL,
        provider: PROVIDER,
        capabilities: { capabilities: ['audio_transcription'], inputModalities: ['audio'], outputModalities: ['text'] },
      },
    ],
  });

  return { h, transport, client: h.ai.forUser(HARNESS_USER, { feature: FEATURE }) };
}

describe('the app registered a capability, an operation and a feature (no package edit)', () => {
  it('has them in the open registries', () => {
    expect(getAiCapability(EXAMPLE_DIARIZE_CAPABILITY)).toMatchObject({ label: 'Diarization' });
    expect(getAiOperation(EXAMPLE_DIARIZE_OPERATION)).toMatchObject({ capability: EXAMPLE_DIARIZE_CAPABILITY, label: 'Diarization' });
    expect(getAiFeature(FEATURE)).toMatchObject({ needs: ['audio_transcription', EXAMPLE_DIARIZE_CAPABILITY] });
  });
});

describe('AiService.run(audio.diarize) over the example provider', () => {
  it('goes through the full pipeline: the user key pays, the output is validated, ONE usage row names the feature and meters the audio', async () => {
    const { h, transport, client } = setup();

    const output = await client.run<{ speakers: string[]; durationSeconds: number }>(
      EXAMPLE_DIARIZE_OPERATION,
      { audioBase64: recordingOf(2500) },
      { provider: PROVIDER, model: EXAMPLE_TRANSCRIBE_MODEL },
    );

    expect(output.speakers).toEqual(['A', 'B']);
    expect(output.durationSeconds).toBe(2.5);
    expect(transport.callsTo('diarize')).toEqual([
      expect.objectContaining({ operation: 'diarize', model: EXAMPLE_TRANSCRIBE_MODEL, bytes: 2500 }),
    ]);
    expect(transport.callsTo('diarize')[0].apiKey).toContain(HARNESS_USER_KEY);
    expect(h.usageEvents).toEqual([
      expect.objectContaining({
        userId: HARNESS_USER,
        provider: PROVIDER,
        modelId: EXAMPLE_TRANSCRIBE_MODEL,
        operation: EXAMPLE_DIARIZE_OPERATION,
        feature: FEATURE,
        keySource: 'user',
        status: 'succeeded',
        units: { audioSeconds: 2.5 },
      }),
    ]);
    expect(JSON.stringify(h.usageEvents)).not.toContain(recordingOf(2500));
  });

  it('an omitted model is the first usable model that declares the capability, never the transcribe-only one', async () => {
    const { transport, client } = setup();

    await client.run(EXAMPLE_DIARIZE_OPERATION, { audioBase64: recordingOf(1000) });

    expect(transport.callsTo('diarize')[0].model).toBe(EXAMPLE_TRANSCRIBE_MODEL);
  });

  it('a model that only transcribes is refused with AI_CAPABILITY_UNSUPPORTED, before any vendor call or row', async () => {
    const { h, transport, client } = setup();
    const error = await client
      .run(EXAMPLE_DIARIZE_OPERATION, { audioBase64: recordingOf(1000) }, { provider: PROVIDER, model: PLAIN_MODEL })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AiError);
    expect((error as AiError).code).toBe('AI_CAPABILITY_UNSUPPORTED');
    expect(transport.calls).toEqual([]);
    expect(h.usageEvents).toEqual([]);
  });

  it('an input over its schema bound is AI_INVALID_REQUEST, before the key is read', async () => {
    const { h, transport, client } = setup();
    const error = await client
      .run(EXAMPLE_DIARIZE_OPERATION, { audioBase64: 'A'.repeat(EXAMPLE_DIARIZE_MAX_BASE64_CHARS + 1) })
      .catch((e: unknown) => e);

    expect((error as AiError).code).toBe('AI_INVALID_REQUEST');
    expect(h.getSecret).not.toHaveBeenCalled();
    expect(transport.calls).toEqual([]);
  });

  it('the kill switch and the key policy apply: AI off is AI_DISABLED, no key is AI_KEY_REQUIRED', async () => {
    const off = setup();
    off.h.setPolicy({ enabled: false });
    expect(((await off.client.run(EXAMPLE_DIARIZE_OPERATION, { audioBase64: recordingOf(100) }).catch((e: unknown) => e)) as AiError).code).toBe(
      'AI_DISABLED',
    );

    const keyless = setup({ userKey: false });
    const refused = await keyless.client
      .run(EXAMPLE_DIARIZE_OPERATION, { audioBase64: recordingOf(100) }, { provider: PROVIDER, model: EXAMPLE_TRANSCRIBE_MODEL })
      .catch((e: unknown) => e);
    expect((refused as AiError).code).toBe('AI_KEY_REQUIRED');
    expect(keyless.transport.calls).toEqual([]);
  });

  it('a vendor failure leaves as an AiError with no key and no vendor message, and the round trip is recorded failed', async () => {
    // The broken model id makes the fake vendor answer 500.
    const harness = createAiRuntimeHarness({
      extraProviders: [exampleTranscribeProvider],
      extraAdapters: [new ExampleTranscribeAdapter(new AiProviderRegistry(), new FakeExampleTranscribeTransport())],
      models: [
        {
          modelId: 'example-asr-broken',
          provider: PROVIDER,
          capabilities: { capabilities: ['audio_transcription', EXAMPLE_DIARIZE_CAPABILITY], inputModalities: ['audio'], outputModalities: ['text'] },
        },
      ],
    });
    const error = await harness.ai
      .forUser(HARNESS_USER, { feature: FEATURE })
      .run(EXAMPLE_DIARIZE_OPERATION, { audioBase64: recordingOf(100) }, { provider: PROVIDER, model: 'example-asr-broken' })
      .catch((e: unknown) => e);

    expect((error as AiError).code).toBe('AI_PROVIDER_UNAVAILABLE');
    expect(JSON.stringify((error as AiError).toJSON())).not.toContain('the vendor failed');
    expect(harness.usageEvents).toEqual([
      expect.objectContaining({ operation: EXAMPLE_DIARIZE_OPERATION, feature: FEATURE, status: 'failed', errorCode: 'AI_PROVIDER_UNAVAILABLE' }),
    ]);
  });
});

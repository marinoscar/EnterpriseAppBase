// =============================================================================
// The example AI provider passes the provider conformance kit (PP-14.6, #924)
// =============================================================================
//
// `describeAiProviderConformance` is the kit every adapter runs, the built-ins
// and an app's own alike. The example carries one port, `audio.transcribe`, so
// the kit runs the listing, key, classification and transcription scenarios and
// has nothing to ask of the ports it does not carry. The vendor is the fake
// transport: no network.
//
// Beyond the kit, this file pins what the kit cannot know about this adapter:
// it carries NO other port, so the registry derives `audio_transcription` and
// nothing else; its one setting reaches the transport; its transport sees the
// key of the call and no log or error carries it.
// =============================================================================

import { AiError, AiProviderRegistry, adapterCapabilities } from '@marinoscar/platform-api/ai';
import { describeAiProviderConformance } from '@marinoscar/platform-api/ai/testing';

import { ExampleTranscribeAdapter } from '../../../src/platform-extensions/ai/example-transcribe/example-transcribe.adapter';
import {
  EXAMPLE_TRANSCRIBE_BROKEN_MODEL,
  EXAMPLE_TRANSCRIBE_MODEL,
  EXAMPLE_TRANSCRIBE_REJECTED_KEY,
  FakeExampleTranscribeTransport,
} from '../../../src/platform-extensions/ai/example-transcribe/example-transcribe.transport';

const VALID_KEY = 'example-valid-key-1234';

function build() {
  const transport = new FakeExampleTranscribeTransport();
  const registry = new AiProviderRegistry();
  const adapter = new ExampleTranscribeAdapter(registry, transport);

  return { transport, registry, adapter };
}

describeAiProviderConformance('ExampleTranscribeAdapter (app-side, transcription only)', () => ({
  adapter: build().adapter,
  ctx: { apiKey: VALID_KEY, requestId: 'conformance-1' },
  fixtures: {
    invalidApiKey: EXAMPLE_TRANSCRIBE_REJECTED_KEY,
    expectedModelIds: [EXAMPLE_TRANSCRIBE_MODEL],
    classify: { known: [EXAMPLE_TRANSCRIBE_MODEL], unknown: ['some-other-model'] },
    transcription: { model: EXAMPLE_TRANSCRIBE_MODEL, failingModel: EXAMPLE_TRANSCRIBE_BROKEN_MODEL },
  },
}));

describe('ExampleTranscribeAdapter beyond the kit', () => {
  it('registers itself in the adapter registry at module init, under the id its definition declares', () => {
    const { registry, adapter } = build();

    adapter.onModuleInit();

    expect(registry.get('example-transcribe')).toBe(adapter);
  });

  it('carries the audio.transcribe port and no other: that is its whole capability set', () => {
    const { adapter } = build();

    expect(adapterCapabilities(adapter)).toEqual(['audio_transcription']);
    expect(adapter.responses).toBeUndefined();
    expect(adapter.images).toBeUndefined();
    expect(adapter.embeddings).toBeUndefined();
    expect(adapter.realtime).toBeUndefined();
    expect(adapter.audio?.speech).toBeUndefined();
    expect(typeof adapter.audio?.transcribe).toBe('function');
  });

  it("passes the call's key and its region setting to the transport, and defaults the region to us", async () => {
    const { adapter, transport } = build();
    const audio = { data: new Uint8Array(2000), mimeType: 'audio/wav' };

    const eu = await adapter.audio!.transcribe!(
      { model: EXAMPLE_TRANSCRIBE_MODEL, audio },
      { apiKey: VALID_KEY, requestId: 'r1', providerSettings: { region: 'eu' } },
    );
    await adapter.audio!.transcribe!({ model: EXAMPLE_TRANSCRIBE_MODEL, audio }, { apiKey: VALID_KEY, requestId: 'r2' });

    expect(transport.callsTo('transcribe').map((call) => [call.apiKey, call.region])).toEqual([
      [VALID_KEY, 'eu'],
      [VALID_KEY, 'us'],
    ]);
    expect(eu).toMatchObject({ provider: 'example-transcribe', text: 'example transcript (eu, 2000 bytes)', durationSeconds: 2 });
  });

  it('turns a vendor failure into an AiError that carries neither the key nor the vendor message', async () => {
    const { adapter } = build();
    const failure = await adapter
      .audio!.transcribe!(
        { model: EXAMPLE_TRANSCRIBE_BROKEN_MODEL, audio: { data: new Uint8Array(10), mimeType: 'audio/wav' } },
        { apiKey: VALID_KEY, requestId: 'r' },
      )
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AiError);
    expect((failure as AiError).code).toBe('AI_PROVIDER_UNAVAILABLE');
    expect(JSON.stringify(failure)).not.toContain(VALID_KEY);
    expect(JSON.stringify(failure)).not.toContain('the vendor failed');
  });
});

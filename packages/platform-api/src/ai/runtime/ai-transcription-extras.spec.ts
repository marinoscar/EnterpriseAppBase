// =============================================================================
// Richer transcription results and per-feature runs (PP-14.17, issue #935)
//
//   - `AiTranscriptionResult.extras` (speaker-labelled segments, language, any
//     JSON) is kept on the run's output when bounded and well-formed, and
//     dropped (never the transcript) when not;
//   - `providerOptions` on a transcription is a JSON object of at most 4 KiB,
//     reaches the adapter, and is in no log line, no usage row and no span;
//   - the feature a run was started for is persisted on `ai_runs` and carried to
//     the usage row of the round-trip the job makes.
// =============================================================================

import { Logger } from '@nestjs/common';
import type { Job } from '../../jobs/index';

import { JobHandlerRegistry } from '../../jobs/index';
import { AiError } from '../core/ai-error';
import { AI_PROVIDER_OPTIONS_MAX_BYTES, AI_TRANSCRIPTION_EXTRAS_MAX_BYTES } from '../core/types/media.types';
import { registerAiFeature } from '../features/ai-feature.registry';
import {
  createAiRuntimeHarness,
  HARNESS_MODEL,
  HARNESS_TRANSCRIPTION_MODEL,
  HARNESS_USER,
  type AiRuntimeHarnessOptions,
} from '../testing/ai-runtime-harness';
import { AiAudioTranscribeHandler } from './ai-audio-transcribe.handler';
import { AiResponseRunHandler } from './ai-response-run.handler';
import { AI_AUDIO_TRANSCRIBE_TYPE, AI_RESPONSE_RUN_TYPE } from './ai-runs.service';
import { boundTranscriptionExtras } from './ai-transcription-extras';
import type { AiTranscriptionRunOutput } from './ai-runtime.types';

registerAiFeature({ id: 'example_dictation', label: 'Dictation', needs: ['audio_transcription'] });

const RECORDING = Buffer.from('a'.repeat(2000));
const DIARIZED = {
  language: 'en',
  segments: [
    { start: 0, end: 1.2, text: 'hello there', speaker: 'A' },
    { start: 1.2, end: 2, text: 'hi', speaker: 'B' },
  ],
  confidence: 0.93,
};

function setup(opts: AiRuntimeHarnessOptions = {}) {
  const h = createAiRuntimeHarness(opts);
  const handler = new AiAudioTranscribeHandler(new JobHandlerRegistry(), h.ai, h.runs);
  const jobFor = (handle: { runId: string; jobId: string }) =>
    ({ id: handle.jobId, type: AI_AUDIO_TRANSCRIBE_TYPE, payload: { runId: handle.runId }, attempts: 1 }) as unknown as Job;
  const transcribe = (patch: Record<string, unknown> = {}, scope: { feature?: string } = {}) =>
    h.ai.forUser(HARNESS_USER, scope).transcribe({
      storageObjectId: h.storage.addObject({ uploadedById: HARNESS_USER, bytes: RECORDING, mimeType: 'audio/mp4', name: 'a.m4a' }).id,
      model: HARNESS_TRANSCRIPTION_MODEL,
      ...patch,
    });
  const outputOf = (runId: string) => h.runRows.find((r) => r.id === runId)!.output as AiTranscriptionRunOutput;

  return { h, handler, jobFor, transcribe, outputOf };
}

describe('transcription extras', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('keeps speaker-labelled segments and any extra JSON on the run output', async () => {
    const { handler, jobFor, transcribe, outputOf } = setup({ fake: { transcriptionExtras: DIARIZED } });
    const handle = await transcribe();

    await handler.process(jobFor(handle));

    expect(outputOf(handle.runId).extras).toEqual(DIARIZED);
    expect(outputOf(handle.runId).text).toBe('fake transcript of 2000 bytes');
  });

  it('a result with no extras has none on its output (the neutral shape is unchanged)', async () => {
    const { handler, jobFor, transcribe, outputOf } = setup();
    const handle = await transcribe();

    await handler.process(jobFor(handle));

    expect(outputOf(handle.runId)).not.toHaveProperty('extras');
  });

  it.each<[string, unknown]>([
    ['larger than the bound', { blob: 'x'.repeat(AI_TRANSCRIPTION_EXTRAS_MAX_BYTES + 1) }],
    ['malformed (a segment with no end)', { segments: [{ start: 0, text: 'x' }] }],
    ['not an object', 'a string'],
    ['an array', [1, 2, 3]],
  ])('extras %s are dropped, the transcript and the billed row are kept', async (_name, extras) => {
    const { h, handler, jobFor, transcribe, outputOf } = setup({ fake: { transcriptionExtras: extras } });
    const handle = await transcribe();

    await handler.process(jobFor(handle));

    expect(h.runRows[0].status).toBe('succeeded');
    expect(outputOf(handle.runId)).not.toHaveProperty('extras');
    expect(outputOf(handle.runId).text).toBe('fake transcript of 2000 bytes');
    expect(h.usageEvents).toHaveLength(1);
  });

  it('the dropped value is never logged', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { handler, jobFor, transcribe } = setup({ fake: { transcriptionExtras: { segments: [{ start: 0, text: 'PRIVATE-WORDS' }] } } });

    await handler.process(jobFor(await transcribe()));

    expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE-WORDS');
  });
});

describe('boundTranscriptionExtras', () => {
  it('returns a plain JSON copy, not the adapter object', () => {
    const live = { language: 'en', fn: () => 1, nested: { a: 1 } };
    const { extras } = boundTranscriptionExtras(live);

    expect(extras).toEqual({ language: 'en', nested: { a: 1 } });
    expect(extras).not.toBe(live);
  });

  it('refuses a cyclic value and a bigint as not JSON', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(boundTranscriptionExtras(cyclic)).toEqual({ rejected: 'not_json' });
    expect(boundTranscriptionExtras({ n: BigInt(1) })).toEqual({ rejected: 'not_json' });
  });

  it('refuses a very long segment list by its size', () => {
    const segments = Array.from({ length: 5001 }, () => ({ start: 0, end: 1, text: 'x' }));

    expect(boundTranscriptionExtras({ segments })).toEqual({ rejected: 'too_large' });
  });

  it('absent or null extras are simply none', () => {
    expect(boundTranscriptionExtras(undefined)).toEqual({});
    expect(boundTranscriptionExtras(null)).toEqual({});
  });
});

describe('transcription providerOptions', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  const options = (bytes: number) => ({ openai: { vocabulary: 'x'.repeat(bytes) } });

  it('reach the adapter and stay out of the usage row', async () => {
    const { h, handler, jobFor, transcribe } = setup();
    const providerOptions = { openai: { diarize: true, vocabulary: 'SECRET-JARGON' } };

    await handler.process(jobFor(await transcribe({ providerOptions })));

    expect(h.fake.callsTo('audio.transcribe')[0].transcriptionRequest?.providerOptions).toEqual(providerOptions);
    expect(JSON.stringify(h.usageEvents)).not.toContain('SECRET-JARGON');
  });

  it('are never logged, even with prompt logging on', async () => {
    const lines: string[] = [];
    for (const level of ['log', 'debug', 'verbose', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => void lines.push(JSON.stringify(args)));
    }
    const { handler, jobFor, transcribe } = setup({ policy: { logPromptContent: true } });

    await handler.process(jobFor(await transcribe({ providerOptions: { openai: { vocabulary: 'SECRET-JARGON' } } })));

    expect(lines.join('\n')).not.toContain('SECRET-JARGON');
  });

  it('are accepted up to the bound and refused over it, without echoing the value', async () => {
    const { transcribe } = setup();
    const overhead = Buffer.byteLength(JSON.stringify(options(0)), 'utf8');

    await expect(transcribe({ providerOptions: options(AI_PROVIDER_OPTIONS_MAX_BYTES - overhead) })).resolves.toBeDefined();

    const refused = await transcribe({ providerOptions: options(AI_PROVIDER_OPTIONS_MAX_BYTES - overhead + 1) }).then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(refused).toBeInstanceOf(AiError);
    expect((refused as AiError).code).toBe('AI_INVALID_REQUEST');
    expect(JSON.stringify((refused as AiError).toJSON())).not.toContain('xxxxxxxx');
  });

  it('must be an object', async () => {
    const { transcribe } = setup();

    await expect(transcribe({ providerOptions: ['x'] })).rejects.toMatchObject({ code: 'AI_INVALID_REQUEST' });
  });
});

describe('the feature on a background run', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('is stored on the run row and recorded on the job round-trip usage row', async () => {
    const { h, handler, jobFor, transcribe } = setup();
    const handle = await transcribe({}, { feature: 'example_dictation' });

    expect(h.runRows.find((r) => r.id === handle.runId)?.feature).toBe('example_dictation');

    await handler.process(jobFor(handle));

    expect(h.usageEvents).toEqual([
      expect.objectContaining({ operation: 'audio.transcribe', feature: 'example_dictation', jobId: handle.jobId }),
    ]);
  });

  it('a run started without a feature has none, and its usage row none', async () => {
    const { h, handler, jobFor, transcribe } = setup();
    const handle = await transcribe();

    await handler.process(jobFor(handle));

    expect(h.runRows[0].feature).toBeNull();
    expect(h.usageEvents[0].feature).toBeNull();
  });

  it('a response run carries the feature to its usage row too', async () => {
    const h = createAiRuntimeHarness();
    const handler = new AiResponseRunHandler(new JobHandlerRegistry(), h.ai, h.runs, h.outputs);
    registerAiFeature({ id: 'example_text_run', label: 'Text run', needs: ['responses'] });
    const handle = await h.ai.forUser(HARNESS_USER, { feature: 'example_text_run' }).startRun({ input: 'hello', model: HARNESS_MODEL });

    expect(h.runRows.find((r) => r.id === handle.runId)?.feature).toBe('example_text_run');

    await handler.process({ id: handle.jobId, type: AI_RESPONSE_RUN_TYPE, payload: { runId: handle.runId } } as unknown as Job);

    expect(h.usageEvents).toEqual([expect.objectContaining({ operation: 'responses', feature: 'example_text_run' })]);
  });
});

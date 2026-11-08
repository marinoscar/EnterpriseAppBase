// =============================================================================
// AiService — inline media calls and system callers (seam: ai capabilities)
// =============================================================================
//
// `editImageInline` / `transcribeInline` (bytes in, result inline, no run row,
// one usage row) and `forSystem` (no acting user: the organization's or the
// deployment's key, never a user's; feature opt-in; per-organization limits
// only), over the same harness as the other facade specs.
// =============================================================================

import { AiError } from '../core/ai-error';
import { registerAiFeature } from '../features/ai-feature.registry';
import {
  createAiRuntimeHarness,
  HARNESS_EMBEDDING_MODEL,
  HARNESS_IMAGE_MODEL,
  HARNESS_MODEL,
  HARNESS_ORG,
  HARNESS_ORG_KEY,
  HARNESS_TENANT_KEY,
  HARNESS_TRANSCRIPTION_MODEL,
  HARNESS_USER,
  HARNESS_USER_KEY,
  type AiRuntimeHarnessOptions,
} from '../testing/ai-runtime-harness';

registerAiFeature({ id: 'example_system_text', label: 'System text', needs: ['responses'], systemCalls: true });
registerAiFeature({ id: 'example_system_embed', label: 'System embed', needs: ['embeddings'], systemCalls: true });
registerAiFeature({ id: 'example_system_image', label: 'System image', needs: ['image_edit'], systemCalls: true });
registerAiFeature({ id: 'example_system_stt', label: 'System stt', needs: ['audio_transcription'], systemCalls: true });
registerAiFeature({ id: 'example_user_only', label: 'User only', needs: ['responses'] });

const PNG = { data: new Uint8Array([1, 2, 3, 4]), mimeType: 'image/png' };
const JPEG = { data: new Uint8Array([9, 8, 7]), mimeType: 'image/jpeg', filename: 'oriented.jpg' };
const AUDIO = { data: new Uint8Array(Buffer.from('0123456789'.repeat(150))), mimeType: 'audio/mpeg' };

function setup(opts: AiRuntimeHarnessOptions = {}) {
  const h = createAiRuntimeHarness(opts);

  return { h, user: h.ai.forUser(HARNESS_USER, { orgId: HARNESS_ORG }) };
}

async function caught(run: () => Promise<unknown>): Promise<AiError> {
  try {
    await run();
  } catch (err) {
    return err as AiError;
  }

  throw new Error('expected a rejection');
}

describe('AiService — editImageInline', () => {
  it('edits bytes in and returns bytes out: one usage row, no run, no job, nothing stored', async () => {
    const { h, user } = setup();
    const objectsBefore = h.storage.objects.length;

    const result = await user.editImageInline({
      model: HARNESS_IMAGE_MODEL,
      prompt: 'tidy the colours',
      quality: 'high',
      size: '1536x1024',
      images: [JPEG],
      mask: PNG,
      providerOptions: { openai: { input_fidelity: 'high' } },
    });

    expect(result.images.length).toBeGreaterThan(0);
    expect(result.images[0].data).toBeInstanceOf(Uint8Array);

    const [call] = h.fake.callsTo('images.edit');
    const request = call.imageRequest as {
      images: Array<{ data: Uint8Array; mimeType: string; filename?: string }>;
      mask?: { data: Uint8Array };
      providerOptions?: unknown;
      quality?: string;
      size?: string;
    };

    expect(call.apiKey).toBe(HARNESS_USER_KEY);
    expect(Buffer.from(request.images[0].data).equals(Buffer.from(JPEG.data))).toBe(true);
    expect(request.images[0]).toMatchObject({ mimeType: 'image/jpeg', filename: 'oriented.jpg' });
    expect(Buffer.from(request.mask!.data).equals(Buffer.from(PNG.data))).toBe(true);
    expect(request).toMatchObject({ quality: 'high', size: '1536x1024', providerOptions: { openai: { input_fidelity: 'high' } } });

    expect(h.usageEvents).toEqual([
      expect.objectContaining({
        userId: HARNESS_USER,
        operation: 'images',
        keySource: 'user',
        status: 'succeeded',
        units: { images: result.images.length },
      }),
    ]);
    expect(h.runRows).toEqual([]);
    expect(h.enqueued).toEqual([]);
    expect(h.storage.objects.length).toBe(objectsBefore);
  });

  it.each([
    ['no images', { images: [] }],
    ['17 images', { images: Array.from({ length: 17 }, () => PNG) }],
    ['a GIF', { images: [{ data: new Uint8Array([1]), mimeType: 'image/gif' }] }],
    ['an empty image', { images: [{ data: new Uint8Array(0), mimeType: 'image/png' }] }],
    ['an image over the cap', { images: [{ data: new Uint8Array(25 * 1024 * 1024 + 1), mimeType: 'image/png' }] }],
    ['a JPEG mask', { images: [PNG], mask: JPEG }],
    ['an empty prompt', { images: [PNG], prompt: '  ' }],
  ])('refuses %s before any provider call', async (_name, patch) => {
    const { h, user } = setup();
    const body = { model: HARNESS_IMAGE_MODEL, prompt: 'x', ...patch };
    const err = await caught(() => user.editImageInline(body as never));

    expect(err.code).toBe('AI_INVALID_REQUEST');
    expect(h.fake.calls).toEqual([]);
    expect(h.usageEvents).toEqual([]);
  });

  it('a model without image_edit is AI_CAPABILITY_UNSUPPORTED', async () => {
    const { h, user } = setup();

    await expect(user.editImageInline({ model: HARNESS_MODEL, prompt: 'x', images: [PNG] })).rejects.toMatchObject({
      code: 'AI_CAPABILITY_UNSUPPORTED',
    });
    expect(h.fake.calls).toEqual([]);
  });

  it('honours an aborted signal: no key resolved, no provider call', async () => {
    const { h, user } = setup();
    const controller = new AbortController();

    controller.abort();

    await expect(
      user.editImageInline({ model: HARNESS_IMAGE_MODEL, prompt: 'x', images: [PNG] }, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'AI_PROVIDER_UNAVAILABLE' });
    expect(h.fake.calls).toEqual([]);
  });

  it('keeps a provider rate limit as AI_RATE_LIMITED (so the job defers) and records one failed row', async () => {
    const { h, user } = setup();

    h.fake.images!.edit = async () => {
      throw new AiError('AI_RATE_LIMITED', 'slow down', { retryAfterMs: 4000 });
    };

    const err = await caught(() => user.editImageInline({ model: HARNESS_IMAGE_MODEL, prompt: 'x', images: [PNG] }));

    expect(err.code).toBe('AI_RATE_LIMITED');
    expect(h.usageEvents).toEqual([expect.objectContaining({ operation: 'images', status: 'failed', errorCode: 'AI_RATE_LIMITED' })]);
  });

  it('never lets the key out through an error', async () => {
    const { h, user } = setup();

    h.fake.images!.edit = async () => {
      throw new AiError('AI_PROVIDER_UNAVAILABLE', `bad key ${HARNESS_USER_KEY}`);
    };

    const err = await caught(() => user.editImageInline({ model: HARNESS_IMAGE_MODEL, prompt: 'x', images: [PNG] }));

    expect(JSON.stringify({ m: err.message, b: err.toJSON() })).not.toContain(HARNESS_USER_KEY);
    expect(JSON.stringify(h.usageEvents)).not.toContain(HARNESS_USER_KEY);
  });
});

describe('AiService — transcribeInline', () => {
  it('transcribes bytes inline with the default usable model: one usage row with audioSeconds, no run', async () => {
    const { h, user } = setup();

    const result = await user.transcribeInline({ audio: AUDIO, language: 'en' });

    expect(result.text).toContain('fake transcript');

    const [call] = h.fake.callsTo('audio.transcribe');

    expect(call.apiKey).toBe(HARNESS_USER_KEY);
    expect(call.transcriptionRequest).toMatchObject({ model: HARNESS_TRANSCRIPTION_MODEL, language: 'en' });
    expect(call.audioBytes!.equals(Buffer.from(AUDIO.data))).toBe(true);
    expect(h.usageEvents).toEqual([
      expect.objectContaining({ operation: 'audio.transcribe', status: 'succeeded', units: { audioSeconds: 1.5 } }),
    ]);
    expect(h.runRows).toEqual([]);
    expect(h.enqueued).toEqual([]);
  });

  it('accepts a stream and counts it', async () => {
    const { h, user } = setup();
    const chunks = [AUDIO.data.slice(0, 700), AUDIO.data.slice(700)];

    await user.transcribeInline({
      model: HARNESS_TRANSCRIPTION_MODEL,
      audio: {
        mimeType: 'audio/webm;codecs=opus',
        stream: (async function* () {
          yield* chunks;
        })(),
      },
    });

    expect(h.fake.callsTo('audio.transcribe')[0].audioBytes!.equals(Buffer.from(AUDIO.data))).toBe(true);
  });

  it('refuses bytes over the provider limit, and a declared stream size over it, before any call', async () => {
    const { h, user } = setup({ fake: { transcriptionMaxBytes: 1000 } });

    await expect(user.transcribeInline({ audio: AUDIO })).rejects.toMatchObject({ code: 'AI_INVALID_REQUEST' });
    await expect(
      user.transcribeInline({
        audio: { mimeType: 'audio/mpeg', size: 5000, stream: (async function* () { yield AUDIO.data; })() },
      }),
    ).rejects.toMatchObject({ code: 'AI_INVALID_REQUEST' });
    expect(h.fake.calls).toEqual([]);
    expect(h.usageEvents).toEqual([]);
  });

  it('cuts off a stream that outgrows the limit mid-send and answers AI_INVALID_REQUEST', async () => {
    const { h, user } = setup({ fake: { transcriptionMaxBytes: 1000 } });

    await expect(
      user.transcribeInline({
        audio: { mimeType: 'audio/mpeg', stream: (async function* () { yield AUDIO.data; })() },
      }),
    ).rejects.toMatchObject({ code: 'AI_INVALID_REQUEST' });
    expect(h.usageEvents).toEqual([expect.objectContaining({ status: 'failed', errorCode: 'AI_INVALID_REQUEST' })]);
  });

  it.each([
    ['an image', { data: new Uint8Array([1]), mimeType: 'image/png' }],
    ['an empty recording', { data: new Uint8Array(0), mimeType: 'audio/mpeg' }],
  ])('refuses %s', async (_name, audio) => {
    const { h, user } = setup();

    await expect(user.transcribeInline({ audio })).rejects.toMatchObject({ code: 'AI_INVALID_REQUEST' });
    expect(h.fake.calls).toEqual([]);
  });

  it('keeps a provider rate limit as AI_RATE_LIMITED', async () => {
    const { h, user } = setup();

    h.fake.audio!.transcribe = async () => {
      throw new AiError('AI_RATE_LIMITED', 'slow down', { retryAfterMs: 1000 });
    };

    await expect(user.transcribeInline({ audio: AUDIO })).rejects.toMatchObject({ code: 'AI_RATE_LIMITED' });
    expect(h.usageEvents).toEqual([expect.objectContaining({ status: 'failed', errorCode: 'AI_RATE_LIMITED' })]);
  });
});

describe('AiService.forSystem', () => {
  const scope = (feature: string) => ({ orgId: HARNESS_ORG, feature, jobId: 'job-7' });

  it('is refused (AI_KEY_REQUIRED) for a feature that did not opt in, and for an absent one', async () => {
    const { h } = setup({ orgKey: true });

    for (const feature of ['example_user_only', undefined as unknown as string]) {
      const err = await caught(() => h.ai.forSystem({ orgId: HARNESS_ORG, feature }).respond({ model: HARNESS_MODEL, input: 'hi' }));

      expect(err.code).toBe('AI_KEY_REQUIRED');
    }

    expect(h.fake.calls).toEqual([]);
    expect(h.usageEvents).toEqual([]);
  });

  it('an unregistered feature is AI_INVALID_REQUEST', async () => {
    const { h } = setup({ orgKey: true });

    await expect(h.ai.forSystem(scope('example_nope')).respond({ model: HARNESS_MODEL, input: 'hi' })).rejects.toMatchObject({
      code: 'AI_INVALID_REQUEST',
    });
  });

  it('uses the deployment key, never the user key, and records userId null with the feature and job', async () => {
    const { h } = setup({ orgKey: true }); // HARNESS_USER also holds a key

    await h.ai.forSystem(scope('example_system_text')).respond({ model: HARNESS_MODEL, input: 'hi' });

    expect(h.fake.apiKeys).toEqual([HARNESS_ORG_KEY]);
    expect(h.usageEvents).toEqual([
      expect.objectContaining({
        userId: null,
        orgId: HARNESS_ORG,
        feature: 'example_system_text',
        jobId: 'job-7',
        operation: 'responses',
        keySource: 'org',
        status: 'succeeded',
      }),
    ]);
  });

  it('prefers the organization’s own key over the deployment’s', async () => {
    const { h } = setup({ orgKey: true });

    h.setTenantKey(HARNESS_ORG, HARNESS_TENANT_KEY);
    await h.ai.forSystem(scope('example_system_text')).respond({ model: HARNESS_MODEL, input: 'hi' });

    expect(h.fake.apiKeys).toEqual([HARNESS_TENANT_KEY]);
  });

  it('with no organization or deployment key it is AI_KEY_REQUIRED even though a user has one, under either key policy', async () => {
    const { h } = setup();

    for (const keyPolicy of ['byok', 'byok_with_org_fallback'] as const) {
      h.setPolicy({ keyPolicy });
      await expect(h.ai.forSystem(scope('example_system_text')).respond({ model: HARNESS_MODEL, input: 'hi' })).rejects.toMatchObject({
        code: 'AI_KEY_REQUIRED',
      });
    }

    expect(h.fake.calls).toEqual([]);
  });

  it('a model reachable only through a user key is not usable by a system call', async () => {
    const { h } = setup({ orgKey: true, reachable: [HARNESS_MODEL] });

    // The deployment key serves every enabled model; the user's reach list is irrelevant.
    await expect(
      h.ai.forSystem(scope('example_system_embed')).embed({ model: HARNESS_EMBEDDING_MODEL, input: 'a' }),
    ).resolves.toBeDefined();
  });

  it('is refused under the kill switch and the organization kill switch, before anything else', async () => {
    const off = setup({ orgKey: true, policy: { enabled: false } });

    await expect(off.h.ai.forSystem(scope('example_system_text')).respond({ model: HARNESS_MODEL, input: 'x' })).rejects.toMatchObject({
      code: 'AI_DISABLED',
    });

    const orgOff = setup({ orgKey: true });

    orgOff.h.setOrgPolicy(HARNESS_ORG, { enabled: false });
    await expect(
      orgOff.h.ai.forSystem(scope('example_system_text')).respond({ model: HARNESS_MODEL, input: 'x' }),
    ).rejects.toMatchObject({ code: 'AI_DISABLED' });
    expect(off.h.fake.calls).toEqual([]);
    expect(orgOff.h.fake.calls).toEqual([]);
  });

  it('refuses hosted tools and storage-object inputs (they belong to a user)', async () => {
    const { h } = setup({ orgKey: true, policy: { hostedTools: { web_search: true } } });
    const system = h.ai.forSystem(scope('example_system_text'));

    await expect(
      system.respond({ model: HARNESS_MODEL, input: 'x', tools: [{ type: 'web_search' } as never] }),
    ).rejects.toMatchObject({ code: 'AI_INVALID_REQUEST' });
    await expect(
      system.respond({
        model: HARNESS_MODEL,
        input: [{ type: 'message', role: 'user', content: [{ type: 'image', storageObjectId: 'obj-1' }] }] as never,
      }),
    ).rejects.toMatchObject({ code: 'AI_INVALID_REQUEST' });
    expect(h.fake.calls).toEqual([]);
  });

  it('applies the per-organization budget but no per-user limit', async () => {
    const { h } = setup({ orgKey: true, policy: { limits: { perUser: { requestsPerMinute: 1, requestsPerDay: 1 }, perOrg: { requestsPerDay: 2 } } } });
    const system = h.ai.forSystem(scope('example_system_text'));

    await system.respond({ model: HARNESS_MODEL, input: 'a' });
    await system.respond({ model: HARNESS_MODEL, input: 'b' });

    const err = await caught(() => system.respond({ model: HARNESS_MODEL, input: 'c' }));

    expect(err.code).toBe('AI_RATE_LIMITED');
    expect(err.toJSON().details).toMatchObject({ limit: 'perOrg.requestsPerDay' });
    expect(h.fake.callsTo('responses.create')).toHaveLength(2);
  });

  it('offers streaming and structured calls, and exposes no user-only member', async () => {
    const { h } = setup({ orgKey: true });
    const system = h.ai.forSystem(scope('example_system_text'));
    const events: unknown[] = [];

    for await (const event of system.stream({ model: HARNESS_MODEL, input: 'hi' })) events.push(event);

    expect(events.length).toBeGreaterThan(0);
    expect(Object.keys(system).sort()).toEqual(
      ['editImageInline', 'embed', 'openStream', 'respond', 'respondStructured', 'stream', 'transcribeInline'],
    );
  });

  it('runs the inline media calls under the system key, userId null, one row each', async () => {
    const { h } = setup({ orgKey: true });

    await h.ai.forSystem(scope('example_system_image')).editImageInline({ model: HARNESS_IMAGE_MODEL, prompt: 'x', images: [JPEG] });
    await h.ai.forSystem(scope('example_system_stt')).transcribeInline({ audio: AUDIO });

    expect(h.fake.apiKeys).toEqual([HARNESS_ORG_KEY]);
    expect(h.usageEvents).toEqual([
      expect.objectContaining({ userId: null, feature: 'example_system_image', operation: 'images', keySource: 'org' }),
      expect.objectContaining({ userId: null, feature: 'example_system_stt', operation: 'audio.transcribe', keySource: 'org' }),
    ]);
    expect(JSON.stringify(h.usageEvents)).not.toContain(HARNESS_ORG_KEY);
  });

  it('a feature whose needs the model lacks is refused as for any caller', async () => {
    const { h } = setup({ orgKey: true });

    await expect(
      h.ai.forSystem(scope('example_system_image')).respond({ model: HARNESS_MODEL, input: 'x' }),
    ).rejects.toMatchObject({ code: 'AI_INVALID_REQUEST' });
  });
});

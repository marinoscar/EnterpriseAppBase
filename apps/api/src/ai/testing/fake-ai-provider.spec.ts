import { z } from 'zod';

import { AiError } from '../core/ai-error';
import { AiCallContext } from '../core/provider-adapter.interface';
import { AiProviderRegistry } from '../core/provider-registry';
import { AiStreamEvent } from '../core/types/responses.types';
import { FakeAiProvider } from './fake-ai-provider';

const ctx = (apiKey = 'k', extra: Partial<AiCallContext> = {}): AiCallContext => ({
  apiKey,
  requestId: 'req',
  ...extra,
});

async function collect(stream: AsyncIterable<AiStreamEvent>): Promise<AiStreamEvent[]> {
  const events: AiStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe('FakeAiProvider', () => {
  it('records every call with the key it was called with', async () => {
    const fake = new FakeAiProvider();

    await fake.listModels(ctx('ORG-KEY'));
    await fake.verifyKey(ctx('USER-KEY'));
    await fake.responses!.create({ model: 'fake-model', input: 'hi' }, ctx('USER-KEY'));
    await collect(fake.responses!.stream({ model: 'fake-model', input: 'hi' }, ctx('USER-KEY')));

    expect(fake.calls.map((c) => c.method)).toEqual([
      'listModels',
      'verifyKey',
      'responses.create',
      'responses.stream',
    ]);
    expect(fake.apiKeys).toEqual(['ORG-KEY', 'USER-KEY']);
    expect(fake.callsTo('responses.create')[0].request?.input).toBe('hi');

    fake.reset();
    expect(fake.calls).toEqual([]);
  });

  it('echoes the last user text by default', async () => {
    const res = await new FakeAiProvider().responses!.create(
      {
        model: 'fake-model',
        input: [
          { type: 'message', role: 'user', content: [{ type: 'text', text: 'first' }] },
          { type: 'message', role: 'assistant', content: [{ type: 'text', text: 'reply' }] },
          { type: 'message', role: 'user', content: [{ type: 'text', text: 'second' }] },
        ],
      },
      ctx(),
    );

    expect(res.outputText).toBe('fake: second');
    expect(res.provider).toBe('fake');
    expect(res.finishReason).toBe('stop');
  });

  it('plays an array script in order and fails as AiError when exhausted', async () => {
    const fake = new FakeAiProvider({ responses: [{ outputText: 'one' }, { outputText: 'two' }] });
    const req = { model: 'fake-model', input: 'x' };

    await expect(fake.responses!.create(req, ctx())).resolves.toMatchObject({ outputText: 'one' });
    await expect(fake.responses!.create(req, ctx())).resolves.toMatchObject({ outputText: 'two' });
    await expect(fake.responses!.create(req, ctx())).rejects.toBeInstanceOf(AiError);
  });

  it('wraps a raw error thrown by a script function', async () => {
    const fake = new FakeAiProvider({
      responses: () => {
        throw new TypeError('boom');
      },
    });

    await expect(fake.responses!.create({ model: 'fake-model', input: 'x' }, ctx())).rejects.toMatchObject({
      code: 'AI_PROVIDER_UNAVAILABLE',
    });
  });

  it('honours validKeys', async () => {
    const fake = new FakeAiProvider({ validKeys: ['good'] });

    await expect(fake.verifyKey(ctx('bad'))).resolves.toEqual(
      expect.objectContaining({ ok: false, code: 'AI_KEY_INVALID' }),
    );
    await expect(fake.responses!.create({ model: 'fake-model', input: 'x' }, ctx('bad'))).rejects.toMatchObject({
      code: 'AI_KEY_INVALID',
    });
    await expect(fake.verifyKey(ctx('good'))).resolves.toEqual({ ok: true });
  });

  it('refuses a capability the model is not classified with', async () => {
    const fake = new FakeAiProvider({
      classify: {
        'plain-model': { capabilities: ['responses'], inputModalities: ['text'], outputModalities: ['text'] },
      },
    });

    await expect(
      fake.responses!.create(
        { model: 'plain-model', input: 'x', structuredOutput: { name: 's', schema: z.object({}) } },
        ctx(),
      ),
    ).rejects.toMatchObject({ code: 'AI_CAPABILITY_UNSUPPORTED' });

    const events = await collect(fake.responses!.stream({ model: 'plain-model', input: 'x' }, ctx()));
    expect(events).toEqual([expect.objectContaining({ type: 'error', code: 'AI_CAPABILITY_UNSUPPORTED' })]);
  });

  it('validates structured output into parsed', async () => {
    const fake = new FakeAiProvider({ responses: [{ outputText: '{"n":1}' }, { outputText: '{"n":"x"}' }] });
    const req = { model: 'fake-model', input: 'x', structuredOutput: { name: 's', schema: z.object({ n: z.number() }) } };

    await expect(fake.responses!.create(req, ctx())).resolves.toMatchObject({ parsed: { n: 1 } });
    await expect(fake.responses!.create(req, ctx())).rejects.toMatchObject({ code: 'AI_STRUCTURED_OUTPUT_INVALID' });
  });

  it('streams by chunking outputText', async () => {
    const fake = new FakeAiProvider({ responses: [{ outputText: 'abcdefg' }], chunkSize: 3 });
    const events = await collect(fake.responses!.stream({ model: 'fake-model', input: 'x' }, ctx()));

    expect(events.map((e) => e.type)).toEqual([
      'response.created',
      'output_text.delta',
      'output_text.delta',
      'output_text.delta',
      'output_item.done',
      'response.completed',
    ]);
    expect(
      events.flatMap((e) => (e.type === 'output_text.delta' ? [e.delta] : [])),
    ).toEqual(['abc', 'def', 'g']);
  });

  it('observes an abort mid-stream and records it', async () => {
    const fake = new FakeAiProvider({ responses: [{ outputText: 'a long answer indeed' }], chunkSize: 2, delayMs: 5 });
    const controller = new AbortController();
    const seen: AiStreamEvent[] = [];

    await expect(
      (async () => {
        for await (const event of fake.responses!.stream(
          { model: 'fake-model', input: 'x' },
          ctx('k', { signal: controller.signal }),
        )) {
          seen.push(event);
          if (seen.length === 2) controller.abort();
        }
      })(),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(seen.some((e) => e.type === 'response.completed')).toBe(false);
    expect(fake.callsTo('responses.stream')[0].aborted).toBe(true);
  });

  it('observes an abort during create', async () => {
    const fake = new FakeAiProvider({ delayMs: 50 });
    const controller = new AbortController();
    const pending = fake.responses!.create({ model: 'fake-model', input: 'x' }, ctx('k', { signal: controller.signal }));

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fake.calls[0].aborted).toBe(true);
  });

  it('carries only the ports it was given, which the registry reads', () => {
    const registry = new AiProviderRegistry();

    registry.register(new FakeAiProvider({ id: 'text-only' }));
    registry.register(
      new FakeAiProvider({ id: 'embed-only', responsesPort: false, ports: { embeddings: { embed: jest.fn() } } }),
    );

    expect(registry.supports('text-only', 'responses')).toBe(true);
    expect(registry.supports('text-only', 'embeddings')).toBe(false);
    expect(registry.capabilities('embed-only')).toEqual(['embeddings']);
  });
});

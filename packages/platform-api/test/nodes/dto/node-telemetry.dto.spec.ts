// =============================================================================
// The span relay body (issue #608): strict, bounded, allowlisted
// =============================================================================

import {
  INVALID_NODE_SPAN,
  MAX_NODE_SPAN_AGE_MS,
  MAX_NODE_SPAN_DURATION_MS,
  MAX_NODE_SPAN_FUTURE_SKEW_MS,
  MAX_NODE_SPANS_PER_REQUEST,
  NODE_SPAN_NAMES,
  isValidNodeSpan,
  nodeTelemetrySchema,
} from '../../../src/nodes/dto/node-telemetry.dto';

describe('nodeTelemetrySchema', () => {
  const JOB_ID = '22222222-2222-4222-8222-222222222222';

  const span = (overrides: Record<string, unknown> = {}) => ({
    jobId: JOB_ID,
    name: 'job.execute',
    startTimeUnixMs: Date.now() - 5_000,
    durationMs: 1_200,
    status: 'ok',
    ...overrides,
  });

  // A span that fails validation no longer fails the batch: it parses to the
  // marker and is dropped on its own. `parse` reads "refused" as either, so the
  // single-span cases below keep their meaning; the per-span cases further down
  // pin the new behaviour directly.
  const parse = (body: unknown) => {
    const result = nodeTelemetrySchema.safeParse(body);
    if (!result.success) return result;
    return result.data.spans.every(isValidNodeSpan) ? result : ({ success: false } as const);
  };

  it('accepts a minimal span and a fully populated one', () => {
    expect(parse({ spans: [span()] }).success).toBe(true);
    expect(
      parse({
        spans: [
          span({
            name: 'job.download',
            status: 'error',
            errorType: 'MissingJobInputError',
            attributes: { bytes: 1024, attempt: 2, exitCode: 1, httpStatus: 404 },
          }),
        ],
      }).success
    ).toBe(true);
  });

  it.each(NODE_SPAN_NAMES)('accepts the phase name %s', (name) => {
    expect(parse({ spans: [span({ name })] }).success).toBe(true);
  });

  it.each(['job.other', 'http.request', 'job.execute ', 'JOB.EXECUTE', ''])(
    'refuses the span name %p',
    (name) => {
      expect(parse({ spans: [span({ name })] }).success).toBe(false);
    }
  );

  it('refuses an empty batch and one over the cap', () => {
    expect(parse({ spans: [] }).success).toBe(false);
    expect(
      parse({ spans: Array.from({ length: MAX_NODE_SPANS_PER_REQUEST + 1 }, () => span()) }).success
    ).toBe(false);
    expect(
      parse({ spans: Array.from({ length: MAX_NODE_SPANS_PER_REQUEST }, () => span()) }).success
    ).toBe(true);
  });

  it('refuses unknown keys at every level', () => {
    expect(parse({ spans: [span()], nodeId: 'x' }).success).toBe(false);
    expect(parse({ spans: [span({ traceId: 'a'.repeat(32) })] }).success).toBe(false);
    expect(parse({ spans: [span({ message: 'boom' })] }).success).toBe(false);
  });

  it('refuses a string value under a built-in integer key', () => {
    expect(parse({ spans: [span({ attributes: { bytes: '1024' } })] }).success).toBe(false);
  });

  describe('executor spans and app attributes (job.app.<name>)', () => {
    it.each(['job.app.transcode', 'job.app.a1', 'job.app.t.frames-out_2'])('accepts the app span name %s', (name) => {
      expect(parse({ spans: [span({ name })] }).success).toBe(true);
    });

    it.each(['job.app.', 'job.app.X', 'job.app.1x', 'job.app.a', `job.app.${'a'.repeat(49)}`, 'job.app.a b', 'job.app.x\n', 'node.id'])(
      'refuses the app span name %p',
      (name) => {
        expect(parse({ spans: [span({ name })] }).success).toBe(false);
      }
    );

    it('accepts an app attribute as a bounded integer or a short token-shaped string', () => {
      expect(parse({ spans: [span({ attributes: { frames: 240, codec: 'h264', profile: 'main.4+1_x-y' } })] }).success).toBe(true);
    });

    it('refuses an app attribute that could carry a path, a URL, a sentence or a negative number', () => {
      for (const value of ['/var/lib/state', 'https://bucket/key', 'two words', 'a:b', "x'y", '', 'x'.repeat(129), -1, 1.5, true, null, { a: 1 }, [1]]) {
        expect(parse({ spans: [span({ attributes: { codec: value } })] }).success).toBe(false);
      }
    });

    it('refuses an attribute key outside the key pattern', () => {
      for (const key of ['Bad', 'a', '1x', 'has space', 'a.b', 'x'.repeat(33)]) {
        const attributes = JSON.parse(`{${JSON.stringify(key)}: 1}`) as Record<string, unknown>;
        expect(parse({ spans: [span({ attributes })] }).success).toBe(false);
      }
    });

    it('never lets a __proto__ key through or onto Object.prototype', () => {
      const attributes = JSON.parse('{"__proto__": 1, "constructor": 2, "frames": 3}') as Record<string, unknown>;
      const result = nodeTelemetrySchema.safeParse({ spans: [span({ attributes })] });

      expect(({} as Record<string, unknown>)['frames']).toBeUndefined();
      expect(Object.keys(Object.prototype)).toEqual([]);
      // `constructor` fits the key pattern, so it parses as an ordinary key; the
      // registry (not the wire) decides what is emitted, and it emits neither.
      expect(result.success).toBe(true);
    });

    it('refuses more than 16 attributes in a span', () => {
      const sixteen = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`attr${i}`, i]));
      expect(parse({ spans: [span({ attributes: sixteen })] }).success).toBe(true);
      expect(parse({ spans: [span({ attributes: { ...sixteen, attr16: 16 } })] }).success).toBe(false);
    });
  });

  describe('a refused span is dropped on its own, not the batch', () => {
    it('parses the other spans of the batch and leaves a marker where the bad one was', () => {
      const result = nodeTelemetrySchema.safeParse({
        spans: [span({ name: 'job.execute' }), span({ name: 'job.transcribe' }), span({ name: 'job.app.transcode' }), span({ durationMs: -1 })],
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.spans.map(isValidNodeSpan)).toEqual([true, false, true, false]);
      expect(result.data.spans[1]).toBe(INVALID_NODE_SPAN);
    });

    it('still refuses the whole body when it is not a bounded list of spans', () => {
      expect(nodeTelemetrySchema.safeParse({ spans: 'x' }).success).toBe(false);
      expect(nodeTelemetrySchema.safeParse({ spans: [span()], extra: 1 }).success).toBe(false);
      expect(nodeTelemetrySchema.safeParse({ spans: [] }).success).toBe(false);
    });

    it('treats a non-object entry as a dropped span, not a crash', () => {
      const result = nodeTelemetrySchema.safeParse({ spans: [null, 5, 'x', [], span()] });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.spans.map(isValidNodeSpan)).toEqual([false, false, false, false, true]);
    });
  });

  it('refuses out-of-range attributes', () => {
    expect(parse({ spans: [span({ attributes: { bytes: -1 } })] }).success).toBe(false);
    expect(parse({ spans: [span({ attributes: { bytes: 1.5 } })] }).success).toBe(false);
    expect(parse({ spans: [span({ attributes: { httpStatus: 99 } })] }).success).toBe(false);
  });

  it('refuses a free-form errorType — no spaces, slashes, colons or overlong names', () => {
    for (const errorType of [
      'connect ECONNREFUSED 10.0.0.1:5432',
      'https://bucket/key?X-Amz-Signature=abc',
      '/var/lib/node/state',
      'x'.repeat(65),
      '',
    ]) {
      expect(parse({ spans: [span({ status: 'error', errorType })] }).success).toBe(false);
    }
    expect(parse({ spans: [span({ status: 'error', errorType: 'ApiError.409' })] }).success).toBe(
      true
    );
  });

  it('refuses a non-uuid jobId and an unknown status', () => {
    expect(parse({ spans: [span({ jobId: 'job-1' })] }).success).toBe(false);
    expect(parse({ spans: [span({ status: 'unset' })] }).success).toBe(false);
  });

  it('refuses a span that starts more than a day ago', () => {
    expect(
      parse({ spans: [span({ startTimeUnixMs: Date.now() - MAX_NODE_SPAN_AGE_MS - 60_000 })] })
        .success
    ).toBe(false);
  });

  it('refuses a span that ends too far in the future, but tolerates small skew', () => {
    expect(
      parse({
        spans: [span({ startTimeUnixMs: Date.now() + MAX_NODE_SPAN_FUTURE_SKEW_MS + 60_000 })],
      }).success
    ).toBe(false);
    expect(parse({ spans: [span({ startTimeUnixMs: Date.now() + 30_000 })] }).success).toBe(true);
  });

  it('refuses a negative, fractional or over-long duration', () => {
    expect(parse({ spans: [span({ durationMs: -1 })] }).success).toBe(false);
    expect(parse({ spans: [span({ durationMs: 1.5 })] }).success).toBe(false);
    expect(
      parse({ spans: [span({ durationMs: MAX_NODE_SPAN_DURATION_MS + 1 })] }).success
    ).toBe(false);
  });
});

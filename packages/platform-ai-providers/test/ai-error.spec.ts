// `AiError` without Nest (#991): the HTTP-shaped members the platform's
// exception filter reads, the queue's self-classification symbol, and the
// secret-handling rules (`cause` never serialised). The platform side
// (`instanceof HttpException`, `toRateLimitError()`) is pinned in
// packages/platform-api/src/ai/core/ai-error.spec.ts.

import { AI_CLASSIFY_RATE_LIMIT, AI_ERROR_STATUS, AiError } from '../src/index';

describe('AiError (framework-free)', () => {
  it('carries the code, status and body an HttpException would', () => {
    const err = new AiError('AI_RATE_LIMITED', 'Slow down.', { retryAfterMs: 1500, details: { provider: 'openai' } });

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AiError);
    expect(err.name).toBe('AiError');
    expect(err.message).toBe('Slow down.');
    expect(err.code).toBe('AI_RATE_LIMITED');
    expect(err.getStatus()).toBe(AI_ERROR_STATUS.AI_RATE_LIMITED);
    expect(err.getResponse()).toEqual({
      code: 'AI_RATE_LIMITED',
      message: 'Slow down.',
      details: { provider: 'openai', reason: 'AI_RATE_LIMITED', retryAfterMs: 1500 },
    });
    expect(Object.keys(err)).toEqual(['response', 'status', 'options', 'message', 'name', 'code', 'retryAfterMs']);
  });

  it('never serialises its cause', () => {
    const err = AiError.wrap(new Error('Bearer sk-secret-123456'));

    expect(err.cause).toBeInstanceOf(Error);
    expect(JSON.stringify(err)).not.toContain('sk-secret');
    expect(Object.keys(err)).not.toContain('cause');
  });

  it('classifies itself for the job queue by its code, under the registered symbol', () => {
    expect(AI_CLASSIFY_RATE_LIMIT).toBe(Symbol.for('jobs.classifyRateLimit'));
    expect(new AiError('AI_RATE_LIMITED', 'x', { retryAfterMs: 10 })[AI_CLASSIFY_RATE_LIMIT]()).toEqual({ rateLimited: true, retryAfterMs: 10 });
    expect(new AiError('AI_PROVIDER_UNAVAILABLE', 'x')[AI_CLASSIFY_RATE_LIMIT]()).toEqual({ rateLimited: false, retryAfterMs: null });
  });
});

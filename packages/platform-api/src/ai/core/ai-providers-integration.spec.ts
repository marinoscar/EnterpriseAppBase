// The seams to `@marinoscar/platform-ai-providers` (#991). The adapters and
// the core types moved there; this spec pins what the platform relies on:
//
//   - `AiError` is ONE class, and once `./ai-error` has loaded every instance
//     (even one built from the lean package directly, as an adapter does) is
//     a Nest `HttpException` with `toRateLimitError()`;
//   - the vocabulary the lean package copied from the contract (to avoid
//     depending on it) is identical to the contract's;
//   - the span constants the lean package defines are OpenTelemetry's;
//   - `parseRetryAfterMs` in `jobs/` is the lean package's function.

import { HttpException } from '@nestjs/common';
import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import {
  AI_AZURE_API_VERSION_PATTERN as CONTRACT_AZURE_API_VERSION_PATTERN,
  AI_CAPABILITY_ID_PATTERN as CONTRACT_CAPABILITY_ID_PATTERN,
  AI_OPENAI_API_STYLES as CONTRACT_OPENAI_API_STYLES,
} from '@marinoscar/platform-contract/ai';
import * as lean from '@marinoscar/platform-ai-providers';

import { parseRetryAfterMs } from '../../jobs/index';
import { AiError } from './ai-error';

describe('@marinoscar/platform-ai-providers integration', () => {
  it('re-exports the lean AiError class itself, not a copy', () => {
    expect(AiError).toBe(lean.AiError);
  });

  it('makes every AiError an HttpException, including one built by the lean package', () => {
    const fromLean = new lean.AiError('AI_PROVIDER_UNAVAILABLE', 'down');
    const asHttp: HttpException = fromLean;

    expect(fromLean).toBeInstanceOf(HttpException);
    expect(asHttp.getStatus()).toBe(503);
    expect(asHttp.getResponse()).toEqual({
      code: 'AI_PROVIDER_UNAVAILABLE',
      message: 'down',
      details: { reason: 'AI_PROVIDER_UNAVAILABLE' },
    });
    expect(lean.AiError.wrap(new Error('x')).toRateLimitError()).toBeNull();
    expect(new lean.AiError('AI_RATE_LIMITED', 'slow', { retryAfterMs: 5 }).toRateLimitError()?.retryAfterMs).toBe(5);
  });

  it('keeps toRateLimitError off the serialised body (a non-enumerable prototype method)', () => {
    const err = new AiError('AI_RATE_LIMITED', 'slow');

    expect(Object.keys(err)).not.toContain('toRateLimitError');
    expect(Object.getOwnPropertyDescriptor(Object.getPrototypeOf(err), 'toRateLimitError')?.enumerable).toBe(false);
  });

  it('copies the contract vocabulary unchanged', () => {
    expect(lean.AI_CAPABILITY_ID_PATTERN.source).toBe(CONTRACT_CAPABILITY_ID_PATTERN.source);
    expect(lean.AI_CAPABILITY_ID_PATTERN.flags).toBe(CONTRACT_CAPABILITY_ID_PATTERN.flags);
    expect(lean.AI_AZURE_API_VERSION_PATTERN.source).toBe(CONTRACT_AZURE_API_VERSION_PATTERN.source);
    expect(lean.AI_AZURE_API_VERSION_PATTERN.flags).toBe(CONTRACT_AZURE_API_VERSION_PATTERN.flags);
    expect([...lean.AI_OPENAI_API_STYLES]).toEqual([...CONTRACT_OPENAI_API_STYLES]);
  });

  it("uses OpenTelemetry's span kind and status values", () => {
    expect(lean.AI_SPAN_KIND_CLIENT).toBe(SpanKind.CLIENT);
    expect(lean.AI_SPAN_STATUS_OK).toBe(SpanStatusCode.OK);
    expect(lean.AI_SPAN_STATUS_ERROR).toBe(SpanStatusCode.ERROR);
  });

  it('re-exports parseRetryAfterMs from jobs as the same function', () => {
    expect(parseRetryAfterMs).toBe(lean.parseRetryAfterMs);
    expect(parseRetryAfterMs('120')).toBe(120_000);
  });
});

import { classifyEmailRateLimit } from '@marinoscar/platform-api/email';

import { EMAIL_MODULE_OPTIONS } from './email.options';

// =============================================================================
// The email rate-limit rules over the queue's classifier (issues #456, #737)
// =============================================================================
//
// The email slice layers its SMTP and SES rules over a GENERIC classifier the
// app passes to `EmailModule.forRoot({ classifyRateLimit })`. This app passes
// the job queue's own, so a throttled SES send reads exactly as a throttled job
// does. These are the HTTP-shaped cases the package can only test with a
// stand-in.
// =============================================================================

const NOW = 1_700_000_000_000;
const generic = EMAIL_MODULE_OPTIONS.classifyRateLimit;

describe('classifyEmailRateLimit with the queue classifier (reference app)', () => {
  it('wires the queue classifier', () => {
    expect(typeof generic).toBe('function');
  });

  it('recognises a 429 TooManyRequestsException', () => {
    const err = { name: 'TooManyRequestsException', $metadata: { httpStatusCode: 429 }, message: 'Maximum sending rate exceeded.' };
    expect(classifyEmailRateLimit(err, NOW, generic)).toEqual({ rateLimited: true, retryAfterMs: null });
  });

  it('recognises a "Throttling" name even at HTTP 400', () => {
    const err = { name: 'Throttling', $metadata: { httpStatusCode: 400 }, message: 'Rate exceeded' };
    expect(classifyEmailRateLimit(err, NOW, generic)).toEqual({ rateLimited: true, retryAfterMs: null });
  });

  it('extracts a Retry-After header into retryAfterMs', () => {
    const err = { name: 'ThrottlingException', $metadata: { httpStatusCode: 429 }, headers: { 'retry-after': '30' } };
    expect(classifyEmailRateLimit(err, NOW, generic)).toEqual({ rateLimited: true, retryAfterMs: 30_000 });
  });

  it('recognises a bare 503 Service Unavailable as a throttle', () => {
    expect(classifyEmailRateLimit({ $metadata: { httpStatusCode: 503 } }, NOW, generic).rateLimited).toBe(true);
  });

  it('still reads the SES daily quota as a failure, not a throttle', () => {
    const err = { name: 'Throttling', $metadata: { httpStatusCode: 400 }, message: 'Daily message quota exceeded.' };
    expect(classifyEmailRateLimit(err, NOW, generic)).toEqual({ rateLimited: false, retryAfterMs: null });
  });
});

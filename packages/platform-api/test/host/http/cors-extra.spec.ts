import { InvalidCorsOriginError, buildCorsOptions, isSameOriginOnly } from '../../../src/host/index';

describe('buildCorsOptions extra options (PP-14.13)', () => {
  it('is unchanged without the second argument', () => {
    expect(buildCorsOptions('https://a.example')).toEqual({ origin: ['https://a.example'], credentials: true });
    expect(buildCorsOptions(undefined)).toEqual({ origin: false });
    expect(buildCorsOptions(undefined, undefined)).toEqual({ origin: false });
    expect(buildCorsOptions('https://a.example', {})).toEqual({ origin: ['https://a.example'], credentials: true });
  });

  it('adds methods, headers and max age to the allowlist policy', () => {
    expect(
      buildCorsOptions('https://a.example', {
        methods: ['GET', 'POST'],
        allowedHeaders: 'content-type',
        exposedHeaders: ['x-request-id', 'retry-after'],
        maxAge: 600,
      }),
    ).toEqual({
      origin: ['https://a.example'],
      credentials: true,
      methods: ['GET', 'POST'],
      allowedHeaders: 'content-type',
      exposedHeaders: ['x-request-id', 'retry-after'],
      maxAge: 600,
    });
  });

  it('keeps the policy same-origin whatever the extras say', () => {
    const options = buildCorsOptions('', { exposedHeaders: 'x-request-id' });
    expect(isSameOriginOnly(options)).toBe(true);
    expect(options.origin).toBe(false);
  });

  it('copies arrays, so a later change to the caller array changes nothing', () => {
    const methods = ['GET'];
    const options = buildCorsOptions('https://a.example', { methods });
    methods.push('DELETE');
    expect(options.methods).toEqual(['GET']);
  });

  it('cannot reach the origin policy: origin and credentials throw', () => {
    expect(() => buildCorsOptions('https://a.example', { origin: '*' } as never)).toThrow(InvalidCorsOriginError);
    expect(() => buildCorsOptions('https://a.example', { origin: true } as never)).toThrow(/CORS_ORIGIN alone/);
    expect(() => buildCorsOptions('https://a.example', { credentials: false } as never)).toThrow(/CORS_ORIGIN alone/);
    expect(() => buildCorsOptions('', { origin: ['https://evil.example'] } as never)).toThrow(InvalidCorsOriginError);
  });

  it('still refuses a wildcard in CORS_ORIGIN when extras are given', () => {
    expect(() => buildCorsOptions('*', { maxAge: 1 })).toThrow(/wildcard/);
  });

  it.each([
    [{ maxAge: -1 }],
    [{ maxAge: 1.5 }],
    [{ maxAge: '600' }],
    [{ methods: [] }],
    [{ methods: [''] }],
    [{ exposedHeaders: ['a\r\nSet-Cookie: x=1'] }],
    [{ allowedHeaders: 7 }],
    [{ unknownOption: true }],
  ])('refuses %j', (extra) => {
    expect(() => buildCorsOptions('https://a.example', extra as never)).toThrow(InvalidCorsOriginError);
  });
});

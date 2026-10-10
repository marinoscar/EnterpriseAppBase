import { DEFAULT_SERVICE_NAME, resolveServiceName } from '../../src/otel-core/sdk/service-name';

// =============================================================================
// resolveServiceName() (issue #343, epic #341; packaged by issue #700)
// =============================================================================
//
// Both branches, plus the one property that makes this worth testing at all:
// the function reads process.env.OTEL_SERVICE_NAME on EVERY call rather than
// caching it in a module-level constant, specifically so a test that sets the
// variable is not defeated by whichever module happened to import this one
// first. The fallback is the caller's (the reference app passes
// `${APP_SLUG}-api`; its binding is pinned by
// apps/api/src/common/otel/telemetry-identity.spec.ts).
// =============================================================================

describe('resolveServiceName', () => {
  const ORIGINAL = process.env.OTEL_SERVICE_NAME;

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.OTEL_SERVICE_NAME;
    } else {
      process.env.OTEL_SERVICE_NAME = ORIGINAL;
    }
  });

  it('returns OTEL_SERVICE_NAME verbatim when set, whatever the fallback', () => {
    process.env.OTEL_SERVICE_NAME = 'custom-service-name';

    expect(resolveServiceName('my-app-api')).toBe('custom-service-name');
    expect(resolveServiceName()).toBe('custom-service-name');
  });

  it("falls back to the caller's name when unset", () => {
    delete process.env.OTEL_SERVICE_NAME;

    expect(resolveServiceName('my-app-api')).toBe('my-app-api');
  });

  it("falls back to the caller's name when set to an empty string", () => {
    process.env.OTEL_SERVICE_NAME = '';

    expect(resolveServiceName('my-app-api')).toBe('my-app-api');
  });

  it("falls back to OpenTelemetry's own default without a fallback (never empty)", () => {
    delete process.env.OTEL_SERVICE_NAME;

    expect(resolveServiceName()).toBe(DEFAULT_SERVICE_NAME);
    expect(resolveServiceName('')).toBe(DEFAULT_SERVICE_NAME);
    expect(DEFAULT_SERVICE_NAME).toBe('unknown_service:node');
  });

  it('resolves per call rather than caching, so a change between calls is observed', () => {
    delete process.env.OTEL_SERVICE_NAME;
    expect(resolveServiceName('my-app-api')).toBe('my-app-api');

    process.env.OTEL_SERVICE_NAME = 'second-value';
    expect(resolveServiceName('my-app-api')).toBe('second-value');
  });
});

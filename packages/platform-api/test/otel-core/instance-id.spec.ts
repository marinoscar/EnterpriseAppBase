import {
  ATTR_APP_INSTANCE_ID,
  DEFAULT_INSTANCE_ID,
  resolveTelemetryInstanceId,
} from '../../src/otel-core/sdk/instance-id';

// =============================================================================
// resolveTelemetryInstanceId() (issue #565; packaged by issue #700)
// =============================================================================
//
// `null` (the stored default) and "absent" both mean "follow the app's
// default"; a configured value wins verbatim. The default is the caller's (the
// reference app passes APP_SLUG; its binding is pinned by
// apps/api/src/common/otel/telemetry-identity.spec.ts).
// =============================================================================

describe('resolveTelemetryInstanceId', () => {
  it("follows the caller's default when nothing is configured (null)", () => {
    expect(resolveTelemetryInstanceId(null, 'my-app')).toBe('my-app');
  });

  it("follows the caller's default when the field is absent (undefined)", () => {
    expect(resolveTelemetryInstanceId(undefined, 'my-app')).toBe('my-app');
  });

  it('treats an empty string like null rather than exporting an empty label', () => {
    expect(resolveTelemetryInstanceId('', 'my-app')).toBe('my-app');
  });

  it('returns an administrator-set value verbatim', () => {
    expect(resolveTelemetryInstanceId('prod-eu.1', 'my-app')).toBe('prod-eu.1');
  });

  it('falls back to the package placeholder without a default (never empty)', () => {
    expect(resolveTelemetryInstanceId(null)).toBe(DEFAULT_INSTANCE_ID);
    expect(resolveTelemetryInstanceId(null, '')).toBe(DEFAULT_INSTANCE_ID);
    expect(DEFAULT_INSTANCE_ID).toBe('unknown');
  });

  it('exports under the app.instance.id attribute key', () => {
    expect(ATTR_APP_INSTANCE_ID).toBe('app.instance.id');
  });
});

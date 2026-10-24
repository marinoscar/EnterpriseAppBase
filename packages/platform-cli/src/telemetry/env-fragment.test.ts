import { describe, expect, it } from 'vitest';

import { telemetryEnvSpecFragment } from './env-fragment.js';

const PASSWORDS = ['GREPTIME_WRITER_PASSWORD', 'GREPTIME_READER_PASSWORD', 'GREPTIME_ADMIN_PASSWORD'] as const;

describe('telemetryEnvSpecFragment', () => {
  const metadata = telemetryEnvSpecFragment.metadata as unknown as Readonly<Record<string, Record<string, unknown>>>;

  it('is the telemetry fragment and covers exactly the telemetry keys', () => {
    expect(telemetryEnvSpecFragment.id).toBe('telemetry');
    expect(Object.keys(metadata).sort()).toEqual(
      [
        'POSTGRES_MONITOR_USER',
        'POSTGRES_MONITOR_PASSWORD',
        'OTEL_ENABLED',
        'OTEL_EXPORTER_OTLP_ENDPOINT',
        'OTEL_SERVICE_NAME',
        'GREPTIME_HOST',
        'GREPTIME_HTTP_PORT',
        'GREPTIME_PG_PORT',
        'GREPTIME_BIND_PG_PORT',
        'GREPTIME_DB',
        'GREPTIME_WRITER_USER',
        'GREPTIME_READER_USER',
        'GREPTIME_ADMIN_USER',
        ...PASSWORDS,
      ].sort(),
    );
    // STACK_AGENT_TOKEN belongs to vps.compose.yml, not to telemetry.
    expect(metadata.STACK_AGENT_TOKEN).toBeUndefined();
  });

  it('puts every key in the observability group', () => {
    for (const [key, entry] of Object.entries(metadata)) {
      expect(entry.group, key).toBe('observability');
    }
  });

  it.each(PASSWORDS)('generates %s as hex-32, secret, without asking', (key) => {
    expect(metadata[key]).toEqual({ group: 'observability', secret: true, generate: 'hex-32', autoGenerate: true });
  });

  it('asks for the monitor login as a pair that may be blank, and never generates it', () => {
    expect(metadata.POSTGRES_MONITOR_USER).toEqual({ group: 'observability', essential: true, allowBlank: true });
    expect(metadata.POSTGRES_MONITOR_PASSWORD).toEqual({
      group: 'observability',
      essential: true,
      secret: true,
      allowBlank: true,
    });
  });

  it('marks nothing else secret', () => {
    const secret = Object.entries(metadata)
      .filter(([, entry]) => entry.secret === true)
      .map(([key]) => key)
      .sort();
    expect(secret).toEqual(['POSTGRES_MONITOR_PASSWORD', ...PASSWORDS].sort());
  });
});

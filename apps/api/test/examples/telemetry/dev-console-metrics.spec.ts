import { devConsoleMetricReaders, DEV_CONSOLE_METRICS_INTERVAL_MS } from '../../../src/platform-extensions/telemetry/dev-console-metrics';

// =============================================================================
// The dev console metric reader: off unless a developer asks (PP-14.18)
// =============================================================================
//
// The example of `initializeOtel({ metricReaders })`. It adds no environment
// variable: it exists only for NODE_ENV=development with OTEL_DEBUG=true. The
// SDK wraps whatever is returned in the runtime gate (proved in the package's
// gated-extensions spec), so this file proves only WHEN a reader exists.
// =============================================================================

describe('devConsoleMetricReaders', () => {
  it('is empty in production and in a plain development process', () => {
    expect(devConsoleMetricReaders({ NODE_ENV: 'production', OTEL_DEBUG: 'true' })).toEqual([]);
    expect(devConsoleMetricReaders({ NODE_ENV: 'development' })).toEqual([]);
    expect(devConsoleMetricReaders({ NODE_ENV: 'development', OTEL_DEBUG: 'false' })).toEqual([]);
    expect(devConsoleMetricReaders({})).toEqual([]);
  });

  it('is one reader in a development process that asked for diagnostics', async () => {
    const readers = devConsoleMetricReaders({ NODE_ENV: 'development', OTEL_DEBUG: 'true' });
    expect(readers).toHaveLength(1);
    expect(DEV_CONSOLE_METRICS_INTERVAL_MS).toBeGreaterThanOrEqual(1000);
    await readers[0]!.shutdown();
  });
});

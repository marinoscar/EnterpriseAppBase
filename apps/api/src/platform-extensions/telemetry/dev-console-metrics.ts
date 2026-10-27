import { ConsoleMetricExporter, PeriodicExportingMetricReader, type MetricReader } from '@opentelemetry/sdk-metrics';

// =============================================================================
// An extra metric reader for development: the console (PP-14.18)
// =============================================================================
//
// The worked example of `initializeOtel({ metricReaders })`: a second metric
// output next to the OTLP one, here the SDK's console exporter, so a developer
// sees what the API measures without a collector. `apps/api/src/instrumentation.ts`
// passes it, and the SDK wraps it in a `GatedMetricReader` itself: while the
// runtime telemetry gate (the `telemetry.enabled` setting) is closed the reader
// reads nothing, so it prints nothing and an administrator who switched
// telemetry off sees no output from it either.
//
// OFF BY DEFAULT, WITH NO NEW ENVIRONMENT VARIABLE. It exists only when the
// process is a development server that already asked for the SDK's diagnostics:
// `NODE_ENV=development` and `OTEL_DEBUG=true` (the same two variables that turn
// on the SDK's own console diagnostics). In a production process it is an empty
// list.
// =============================================================================

/** How often the console reader prints, in milliseconds. */
export const DEV_CONSOLE_METRICS_INTERVAL_MS = 30_000;

/**
 * The extra metric readers for `initializeOtel`: the console reader in a
 * development process that set `OTEL_DEBUG=true`, else none.
 *
 * @param env - the process environment (a test passes its own).
 * @returns the readers to hand to `initializeOtel({ metricReaders })`.
 */
export function devConsoleMetricReaders(env: NodeJS.ProcessEnv = process.env): MetricReader[] {
  if (env.NODE_ENV !== 'development' || env.OTEL_DEBUG !== 'true') return [];
  return [
    new PeriodicExportingMetricReader({
      exporter: new ConsoleMetricExporter(),
      exportIntervalMillis: DEV_CONSOLE_METRICS_INTERVAL_MS,
    }),
  ];
}

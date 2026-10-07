// =============================================================================
// The OpenTelemetry SDK bootstrap (from apps/api/src/instrumentation.ts;
// packaged and parameterised by issue #700)
// =============================================================================
//
// LOAD ORDER IS THE WHOLE CONTRACT
// -----------------------------------------------------------------------------
//
// Auto-instrumentation can only patch modules that are required AFTER
// `sdk.start()`. So the app calls `initializeOtel()` from a file its entry
// point imports FIRST (the reference app: `apps/api/src/instrumentation.ts`,
// line 2 of `main.ts`), and this module, like everything in the `sdk`
// subpath, imports no `@nestjs/*`, `http`, `pg` or `pino`
// (`test/otel-core/load-order.spec.ts` proves the first).
//
// OFF COSTS NOTHING
// -----------------------------------------------------------------------------
//
// With `OTEL_ENABLED` not `true` the function logs one line and returns
// `null`: no SDK, no exporter, and the SDK packages (`sdk-node`, the
// auto-instrumentation bundle, the OTLP exporters) are never even required.
// They are loaded lazily, inside the enabled branch, for that reason. The
// OpenTelemetry API then keeps its no-op providers, so every instrument and
// span the app creates is a no-op.
//
// ON EXPORTS NOTHING UNTIL THE GATE OPENS
// -----------------------------------------------------------------------------
//
// Every exporter is wrapped in a gated exporter (`telemetry-gate.ts`) that
// starts CLOSED, so OTEL_ENABLED installs the SDK but nothing is exported
// until the app opens the gate (the reference app: the `telemetry.enabled`
// system setting, issue #532).
// =============================================================================

import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import type { NodeSDK } from '@opentelemetry/sdk-node';

import { resolveServiceName } from './service-name';
import {
  GatedLogRecordExporter,
  GatedPushMetricExporter,
  GatedSpanExporter,
  telemetryGate,
} from './telemetry-gate';

/**
 * Incoming URL substrings the HTTP instrumentation never traces by default:
 * the liveness and readiness probes, which an orchestrator calls every few
 * seconds.
 *
 * @stability stable
 */
export const DEFAULT_IGNORED_INCOMING_PATHS: readonly string[] = Object.freeze([
  '/api/health/live',
  '/api/health/ready',
]);

/**
 * The OTLP/HTTP endpoint used when neither the option nor
 * `OTEL_EXPORTER_OTLP_ENDPOINT` names one.
 *
 * @stability stable
 */
export const DEFAULT_OTLP_ENDPOINT = 'http://localhost:4318';

/**
 * How often the metric reader collects and exports, in milliseconds.
 *
 * @stability stable
 */
export const METRIC_EXPORT_INTERVAL_MS = 60_000;

/**
 * Options of {@link initializeOtel}. Every field is optional; the defaults
 * reproduce the reference app's bootstrap exactly.
 *
 * @extensionPoint option
 * @stability experimental
 */
export interface InitializeOtelOptions {
  /**
   * Whether to install the SDK at all.
   *
   * @defaultValue `process.env.OTEL_ENABLED === 'true'`
   */
  enabled?: boolean;
  /**
   * Base URL of the OTLP/HTTP collector; `/v1/traces`, `/v1/metrics` and
   * `/v1/logs` are appended.
   *
   * @defaultValue `process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318'`
   */
  endpoint?: string;
  /**
   * The `service.name` resource attribute.
   *
   * @defaultValue `resolveServiceName()` (`OTEL_SERVICE_NAME`, else `DEFAULT_SERVICE_NAME`)
   */
  serviceName?: string;
  /**
   * The `service.version` resource attribute.
   *
   * @defaultValue `process.env.npm_package_version || '0.0.1'`
   */
  serviceVersion?: string;
  /**
   * The instance identifier the telemetry gate stamps until the app sets its
   * own (`telemetryGate.setInstanceId`). Pass the app's slug so the first
   * exported batch is never unlabelled. Left unchanged when omitted.
   */
  instanceId?: string;
  /**
   * Incoming URL substrings never traced.
   *
   * @defaultValue {@link DEFAULT_IGNORED_INCOMING_PATHS}
   */
  ignoreIncomingPaths?: readonly string[];
  /**
   * Extra auto-instrumentation configuration, by instrumentation package
   * name, merged over the defaults (fs disabled, pino log sending on, the
   * http ignore hook). An entry for a package with a default is merged into
   * it field by field.
   */
  instrumentationOverrides?: Record<string, Record<string, unknown>>;
  /**
   * Whether to register a SIGTERM handler that shuts the SDK down (flushing
   * what the gate lets through) and exits the process.
   *
   * @defaultValue `true`
   */
  shutdownOnSigterm?: boolean;
}

type Log = (message: string) => void;

/**
 * Installs and starts the OpenTelemetry Node SDK, or does nothing.
 *
 * Disabled (the default unless `OTEL_ENABLED=true`): logs
 * `OpenTelemetry disabled (OTEL_ENABLED !== true)` and returns `null`; no SDK
 * or exporter is constructed and no SDK package is loaded.
 *
 * Enabled: OTLP/HTTP trace, metric (every 60 s) and log exporters, each
 * behind the closed-by-default telemetry gate; the Node auto-instrumentations
 * (health probes ignored, fs off, pino log sending on); a SIGTERM handler
 * that shuts the SDK down. Call it before anything else is required: import
 * the `sdk` subpath, never the Nest-facing `otel-core` index, from the file
 * the entry point loads first.
 *
 * When `OTEL_DEBUG=true` and `NODE_ENV=development`, OpenTelemetry's own
 * diagnostics go to the console (both cases).
 *
 * @param options - See {@link InitializeOtelOptions}.
 * @returns The started SDK, or `null` when disabled.
 *
 * @example
 * ```ts
 * // apps/api/src/instrumentation.ts, imported first by main.ts
 * import { initializeOtel } from '@marinoscar/platform-api/otel-core/sdk';
 * export const sdk = initializeOtel({ serviceName: resolveServiceName(), instanceId: APP_SLUG });
 * ```
 *
 * @extensionPoint option
 * @stability experimental
 */
export function initializeOtel(options: InitializeOtelOptions = {}): NodeSDK | null {
  // Enable OTEL diagnostics in development.
  if (process.env.NODE_ENV === 'development' && process.env.OTEL_DEBUG === 'true') {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
  }

  const log: Log = (message) => console.log(message);
  const enabled = options.enabled ?? process.env.OTEL_ENABLED === 'true';
  if (!enabled) {
    log('OpenTelemetry disabled (OTEL_ENABLED !== true)');
    return null;
  }

  // Loaded only here: a disabled process never pays for the SDK, and nothing
  // below is required before the app has decided to install it.
  const { NodeSDK: NodeSdk } = require('@opentelemetry/sdk-node') as typeof import('@opentelemetry/sdk-node');
  const { getNodeAutoInstrumentations } =
    require('@opentelemetry/auto-instrumentations-node') as typeof import('@opentelemetry/auto-instrumentations-node');
  const { OTLPTraceExporter } =
    require('@opentelemetry/exporter-trace-otlp-http') as typeof import('@opentelemetry/exporter-trace-otlp-http');
  const { OTLPMetricExporter } =
    require('@opentelemetry/exporter-metrics-otlp-http') as typeof import('@opentelemetry/exporter-metrics-otlp-http');
  const { OTLPLogExporter } =
    require('@opentelemetry/exporter-logs-otlp-http') as typeof import('@opentelemetry/exporter-logs-otlp-http');
  const { PeriodicExportingMetricReader } =
    require('@opentelemetry/sdk-metrics') as typeof import('@opentelemetry/sdk-metrics');
  const { BatchLogRecordProcessor } = require('@opentelemetry/sdk-logs') as typeof import('@opentelemetry/sdk-logs');
  const { resourceFromAttributes } = require('@opentelemetry/resources') as typeof import('@opentelemetry/resources');
  const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION, SEMRESATTRS_DEPLOYMENT_ENVIRONMENT } =
    require('@opentelemetry/semantic-conventions') as typeof import('@opentelemetry/semantic-conventions');

  const endpoint = options.endpoint ?? (process.env.OTEL_EXPORTER_OTLP_ENDPOINT || DEFAULT_OTLP_ENDPOINT);
  const serviceName = options.serviceName ?? resolveServiceName();
  const ignored = [...(options.ignoreIncomingPaths ?? DEFAULT_IGNORED_INCOMING_PATHS)];

  if (options.instanceId) telemetryGate.setInstanceId(options.instanceId);

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: options.serviceVersion ?? (process.env.npm_package_version || '0.0.1'),
    [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development',
  });

  const sdk = new NodeSdk({
    resource,
    traceExporter: new GatedSpanExporter(
      new OTLPTraceExporter({
        url: `${endpoint}/v1/traces`,
      }),
    ),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new GatedPushMetricExporter(
        new OTLPMetricExporter({
          url: `${endpoint}/v1/metrics`,
        }),
      ),
      exportIntervalMillis: METRIC_EXPORT_INTERVAL_MS,
    }),
    // Registers the global LoggerProvider. The pino instrumentation below
    // forwards every pino record to it ("log sending"); stdout is unchanged.
    logRecordProcessors: [
      new BatchLogRecordProcessor({
        exporter: new GatedLogRecordExporter(
          new OTLPLogExporter({
            url: `${endpoint}/v1/logs`,
          }),
        ),
      }),
    ],
    instrumentations: [
      getNodeAutoInstrumentations(
        instrumentationConfig(ignored, options.instrumentationOverrides) as Parameters<
          typeof getNodeAutoInstrumentations
        >[0],
      ),
    ],
  });

  sdk.start();

  log(`OpenTelemetry initialized - exporting to ${endpoint} once the telemetry.enabled setting opens the gate`);

  // Graceful shutdown
  if (options.shutdownOnSigterm ?? true) {
    process.on('SIGTERM', () => {
      sdk
        .shutdown()
        .then(() => console.log('OpenTelemetry SDK shut down'))
        .catch((err) => console.error('Error shutting down OTEL SDK', err))
        .finally(() => process.exit(0));
    });
  }

  return sdk;
}

/**
 * The auto-instrumentation configuration: the defaults, with `overrides`
 * merged over them per instrumentation (field by field). Exported for the
 * spec; an app passes `instrumentationOverrides` instead.
 *
 * @param ignoreIncomingPaths - Incoming URL substrings the http instrumentation skips.
 * @param overrides - Per-instrumentation fields merged over the defaults.
 * @returns The object handed to `getNodeAutoInstrumentations`.
 *
 * @stability experimental
 */
export function instrumentationConfig(
  ignoreIncomingPaths: readonly string[],
  overrides: Record<string, Record<string, unknown>> = {},
): Record<string, Record<string, unknown>> {
  const defaults: Record<string, Record<string, unknown>> = {
    '@opentelemetry/instrumentation-http': {
      ignoreIncomingRequestHook: (request: { url?: string }) => {
        const url = request.url || '';
        return ignoreIncomingPaths.some((path) => url.includes(path));
      },
    },
    '@opentelemetry/instrumentation-fs': {
      enabled: false, // Disable noisy FS instrumentation
    },
    // Log sending is the instrumentation's default (disableLogSending:
    // false); spelled out so the OTLP log pipeline does not silently depend
    // on an upstream default. It adds an OTel destination next to the
    // logger's own stream via pino.multistream, so stdout output (and
    // pino-pretty in development) is untouched. Requires `pino` to be
    // required after `sdk.start()`, which the load order ensures.
    '@opentelemetry/instrumentation-pino': {
      disableLogSending: false,
    },
  };

  const merged: Record<string, Record<string, unknown>> = { ...defaults };
  for (const [name, config] of Object.entries(overrides)) {
    merged[name] = { ...(defaults[name] ?? {}), ...config };
  }
  return merged;
}

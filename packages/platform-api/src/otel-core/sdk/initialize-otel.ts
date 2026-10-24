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
//
// AN APP CAN EXTEND THE PIPELINE (PP-14.18)
// -----------------------------------------------------------------------------
//
// `spanProcessors`, `logRecordProcessors` and `metricReaders` add outputs next
// to the OTLP ones; `views`, `sampler`, `textMapPropagator` and
// `resourceAttributes` shape what is measured. Every processor and reader the
// app passes is wrapped in its Gated* twin before the SDK sees it, so NOTHING
// reaches it while the gate is closed: an app cannot add an output that leaks
// past the administrator's `telemetry.enabled` switch by forgetting to wrap it.
// With none of these options the SDK is configured exactly as before.
// =============================================================================

import { diag, DiagConsoleLogger, DiagLogLevel, type TextMapPropagator } from '@opentelemetry/api';
import type { LogRecordProcessor } from '@opentelemetry/sdk-logs';
import type { MetricReader, ViewOptions } from '@opentelemetry/sdk-metrics';
import type { NodeSDK } from '@opentelemetry/sdk-node';
import type { Sampler, SpanProcessor } from '@opentelemetry/sdk-trace-base';

import { ATTR_APP_INSTANCE_ID } from './instance-id';
import { resolveServiceName } from './service-name';
import {
  GatedLogRecordExporter,
  GatedLogRecordProcessor,
  GatedMetricReader,
  GatedPushMetricExporter,
  GatedSpanExporter,
  GatedSpanProcessor,
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
  /**
   * Extra span processors, next to the OTLP one (a console exporter in
   * development, a second backend). Each is wrapped in a `GatedSpanProcessor`:
   * it sees no span while the telemetry gate is closed. Build a batching one
   * over a `GatedSpanExporter` to check the gate at export time too.
   */
  spanProcessors?: readonly SpanProcessor[];
  /**
   * Extra log record processors, next to the OTLP one. Each is wrapped in a
   * `GatedLogRecordProcessor`.
   */
  logRecordProcessors?: readonly LogRecordProcessor[];
  /**
   * Extra metric readers, next to the OTLP one (a console exporter, a
   * Prometheus pull reader). Each is wrapped in a `GatedMetricReader`: it reads
   * nothing while the gate is closed.
   */
  metricReaders?: readonly MetricReader[];
  /** Metric views (rename an instrument, drop an attribute, change an aggregation); they shape what every reader sees. */
  views?: readonly ViewOptions[];
  /** The span sampler. Default: the SDK's (`OTEL_TRACES_SAMPLER`, else parent-based always-on). */
  sampler?: Sampler;
  /** The context propagator. Default: the SDK's (`OTEL_PROPAGATORS`, else W3C trace context and baggage). */
  textMapPropagator?: TextMapPropagator;
  /**
   * Extra resource attributes (`deployment.region`, `k8s.pod.name`), stamped on
   * every span, log record and metric batch. `deployment.environment` may be
   * overridden; `service.name`, `service.version` (their own options) and
   * `app.instance.id` (the gate stamps it) may not. At most
   * {@link RESOURCE_ATTRIBUTES_MAX} attributes; keys of at most 256 and string
   * values of at most 1 024 characters.
   */
  resourceAttributes?: Readonly<Record<string, string | number | boolean>>;
}

/**
 * The most extra resource attributes `initializeOtel` accepts.
 *
 * @stability experimental
 */
export const RESOURCE_ATTRIBUTES_MAX = 32;

const RESERVED_RESOURCE_ATTRIBUTES: ReadonlySet<string> = new Set(['service.name', 'service.version', ATTR_APP_INSTANCE_ID]);

/**
 * Checks the extra resource attributes: plain, bounded, none of the reserved
 * keys. Exported for the spec.
 *
 * @param attributes - the app's `resourceAttributes`.
 * @returns the attributes, unchanged.
 * @throws Error naming the offending key.
 *
 * @stability experimental
 */
export function validateResourceAttributes(
  attributes: Readonly<Record<string, string | number | boolean>> | undefined,
): Readonly<Record<string, string | number | boolean>> {
  if (attributes === undefined) return {};
  if (attributes === null || typeof attributes !== 'object' || Array.isArray(attributes)) {
    throw new Error('initializeOtel: `resourceAttributes` must be an object of attribute names and values.');
  }
  const keys = Object.keys(attributes);
  if (keys.length > RESOURCE_ATTRIBUTES_MAX) {
    throw new Error(`initializeOtel: \`resourceAttributes\` has ${keys.length} attributes; at most ${RESOURCE_ATTRIBUTES_MAX}.`);
  }
  for (const key of keys) {
    if (key === '' || key.length > 256) throw new Error('initializeOtel: a `resourceAttributes` key must be 1 to 256 characters.');
    if (RESERVED_RESOURCE_ATTRIBUTES.has(key)) {
      throw new Error(
        `initializeOtel: \`resourceAttributes\` may not set "${key}" ` +
          `(${key === ATTR_APP_INSTANCE_ID ? 'the telemetry gate stamps it' : 'it has its own option'}).`,
      );
    }
    const value = attributes[key];
    const ok =
      (typeof value === 'string' && value.length <= 1024) ||
      (typeof value === 'number' && Number.isFinite(value)) ||
      typeof value === 'boolean';
    if (!ok) throw new Error(`initializeOtel: \`resourceAttributes\` "${key}" must be a string (at most 1 024 characters), a finite number or a boolean.`);
  }
  return attributes;
}

/** `list` must be an array of objects: the SDK would fail later and further from the cause. */
function assertList(name: string, list: readonly unknown[] | undefined): readonly unknown[] {
  if (list === undefined) return [];
  if (!Array.isArray(list) || list.some((item) => item === null || typeof item !== 'object')) {
    throw new Error(`initializeOtel: \`${name}\` must be an array of objects.`);
  }
  return list;
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
  // A bad extension option fails here, enabled or not: it must not wait for the day OTEL_ENABLED flips.
  const extraResourceAttributes = validateResourceAttributes(options.resourceAttributes);
  const extraSpanProcessors = assertList('spanProcessors', options.spanProcessors) as readonly SpanProcessor[];
  const extraLogProcessors = assertList('logRecordProcessors', options.logRecordProcessors) as readonly LogRecordProcessor[];
  const extraMetricReaders = assertList('metricReaders', options.metricReaders) as readonly MetricReader[];
  const views = assertList('views', options.views) as readonly ViewOptions[];

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
  const { BatchSpanProcessor } =
    require('@opentelemetry/sdk-trace-base') as typeof import('@opentelemetry/sdk-trace-base');
  const { BatchLogRecordProcessor } = require('@opentelemetry/sdk-logs') as typeof import('@opentelemetry/sdk-logs');
  const { resourceFromAttributes } = require('@opentelemetry/resources') as typeof import('@opentelemetry/resources');
  const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION, SEMRESATTRS_DEPLOYMENT_ENVIRONMENT } =
    require('@opentelemetry/semantic-conventions') as typeof import('@opentelemetry/semantic-conventions');

  const endpoint = options.endpoint ?? (process.env.OTEL_EXPORTER_OTLP_ENDPOINT || DEFAULT_OTLP_ENDPOINT);
  const serviceName = options.serviceName ?? resolveServiceName();
  const ignored = [...(options.ignoreIncomingPaths ?? DEFAULT_IGNORED_INCOMING_PATHS)];

  if (options.instanceId) telemetryGate.setInstanceId(options.instanceId);

  // The platform's attributes win over the app's: service.name and service.version
  // are reserved (validated above); only deployment.environment may be replaced.
  const resource = resourceFromAttributes({
    [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development',
    ...extraResourceAttributes,
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: options.serviceVersion ?? (process.env.npm_package_version || '0.0.1'),
  });

  const otlpTraceExporter = new GatedSpanExporter(
    new OTLPTraceExporter({
      url: `${endpoint}/v1/traces`,
    }),
  );
  const otlpMetricReader = new PeriodicExportingMetricReader({
    exporter: new GatedPushMetricExporter(
      new OTLPMetricExporter({
        url: `${endpoint}/v1/metrics`,
      }),
    ),
    exportIntervalMillis: METRIC_EXPORT_INTERVAL_MS,
  });

  const sdk = new NodeSdk({
    resource,
    // The SDK takes EITHER `traceExporter` OR `spanProcessors`: with extra
    // processors the OTLP one is built here the way the SDK builds its own, and
    // the app's follow it, each behind the gate. Without any the configuration
    // is exactly what it always was.
    ...(extraSpanProcessors.length > 0
      ? {
          spanProcessors: [
            new BatchSpanProcessor(otlpTraceExporter),
            ...extraSpanProcessors.map((processor) => new GatedSpanProcessor(processor)),
          ],
        }
      : { traceExporter: otlpTraceExporter }),
    ...(extraMetricReaders.length > 0
      ? { metricReaders: [otlpMetricReader, ...extraMetricReaders.map((reader) => new GatedMetricReader(reader))] }
      : { metricReader: otlpMetricReader }),
    ...(views.length > 0 ? { views: [...views] } : {}),
    ...(options.sampler ? { sampler: options.sampler } : {}),
    ...(options.textMapPropagator ? { textMapPropagator: options.textMapPropagator } : {}),
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
      ...extraLogProcessors.map((processor) => new GatedLogRecordProcessor(processor)),
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

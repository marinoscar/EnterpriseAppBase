import {
  DEFAULT_IGNORED_INCOMING_PATHS,
  initializeOtel,
  instrumentationConfig,
} from '../../src/otel-core/sdk/initialize-otel';
import {
  GatedLogRecordExporter,
  GatedPushMetricExporter,
  GatedSpanExporter,
  telemetryGate,
} from '../../src/otel-core/sdk/telemetry-gate';

// =============================================================================
// initializeOtel() (issue #700)
// =============================================================================
//
// The SDK, the auto-instrumentation bundle and the OTLP exporters are mocked:
// the disabled path must construct NONE of them (and never even require
// them), and the enabled path must wire exactly what the reference app's
// `instrumentation.ts` wired before the extraction: three OTLP/HTTP exporters
// under `<endpoint>/v1/{traces,metrics,logs}`, each behind its gated exporter,
// a 60 s metric reader, the resource, and the started SDK.
// =============================================================================

const mockConstructed: Record<string, unknown[]> = {};
/** Every mocked SDK module, each time a module registry requires it. */
const mockRequired: string[] = [];
function mockRecord(name: string) {
  mockRequired.push(name);
  return jest.fn().mockImplementation(function (this: Record<string, unknown>, config: unknown) {
    (mockConstructed[name] ??= []).push(config);
    this.config = config;
  });
}

jest.mock('@opentelemetry/sdk-node', () => {
  mockRequired.push('sdk-node');
  const NodeSDK = jest.fn().mockImplementation(function (this: Record<string, unknown>, config: unknown) {
    (mockConstructed.NodeSDK ??= []).push(config);
    this.config = config;
    this.start = jest.fn();
    this.shutdown = jest.fn(async () => undefined);
  });
  return { NodeSDK };
});
jest.mock('@opentelemetry/auto-instrumentations-node', () => {
  mockRequired.push('auto-instrumentations-node');
  return { getNodeAutoInstrumentations: jest.fn((config: unknown) => [{ autoConfig: config }]) };
});
jest.mock('@opentelemetry/exporter-trace-otlp-http', () => ({ OTLPTraceExporter: mockRecord('OTLPTraceExporter') }));
jest.mock('@opentelemetry/exporter-metrics-otlp-http', () => ({ OTLPMetricExporter: mockRecord('OTLPMetricExporter') }));
jest.mock('@opentelemetry/exporter-logs-otlp-http', () => ({ OTLPLogExporter: mockRecord('OTLPLogExporter') }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { NodeSDK } = require('@opentelemetry/sdk-node') as { NodeSDK: jest.Mock };

const ENV_KEYS = ['OTEL_ENABLED', 'OTEL_EXPORTER_OTLP_ENDPOINT', 'OTEL_SERVICE_NAME', 'npm_package_version', 'NODE_ENV'];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

let log: jest.SpyInstance;

beforeEach(() => {
  for (const key of Object.keys(mockConstructed)) delete mockConstructed[key];
  NodeSDK.mockClear();
  for (const key of ENV_KEYS) delete process.env[key];
  log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  log.mockRestore();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  telemetryGate.setEnabled(false);
});

describe('initializeOtel: disabled (OTEL_ENABLED unset or not "true")', () => {
  it.each([
    ['OTEL_ENABLED unset', undefined, {}],
    ['OTEL_ENABLED=false', 'false', {}],
    ['OTEL_ENABLED=1 (only the literal "true" enables)', '1', {}],
    ['enabled: false, whatever the env', 'true', { enabled: false }],
  ])('%s: returns null, constructs no SDK or exporter, logs the disabled line once', (_name, env, options) => {
    if (env !== undefined) process.env.OTEL_ENABLED = env;

    expect(initializeOtel(options)).toBeNull();

    expect(NodeSDK).not.toHaveBeenCalled();
    expect(mockConstructed).toEqual({});
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('OpenTelemetry disabled (OTEL_ENABLED !== true)');
  });

  it('does not even require the SDK packages', () => {
    jest.isolateModules(() => {
      const before = mockRequired.length;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fresh = require('../../src/otel-core/sdk/index') as typeof import('../../src/otel-core/sdk/index');
      expect(fresh.initializeOtel()).toBeNull();
      expect(mockRequired.slice(before)).toEqual([]);

      // Control: the enabled path in the same registry does require them.
      fresh.initializeOtel({ enabled: true, shutdownOnSigterm: false });
      expect(mockRequired.slice(before)).toEqual(
        expect.arrayContaining(['auto-instrumentations-node', 'OTLPTraceExporter', 'OTLPMetricExporter', 'OTLPLogExporter']),
      );
    });
  });
});

describe('initializeOtel: enabled', () => {
  function sdkConfig(): Record<string, any> {
    expect(NodeSDK).toHaveBeenCalledTimes(1);
    return mockConstructed.NodeSDK[0] as Record<string, any>;
  }

  it('starts the SDK with gated OTLP/HTTP exporters on the default endpoint and the env defaults', () => {
    process.env.OTEL_ENABLED = 'true';
    process.env.OTEL_SERVICE_NAME = 'svc-from-env';

    const sdk = initializeOtel({ shutdownOnSigterm: false }) as unknown as { start: jest.Mock };

    expect(sdk).not.toBeNull();
    expect(sdk.start).toHaveBeenCalledTimes(1);
    expect(mockConstructed.OTLPTraceExporter).toEqual([{ url: 'http://localhost:4318/v1/traces' }]);
    expect(mockConstructed.OTLPMetricExporter).toEqual([{ url: 'http://localhost:4318/v1/metrics' }]);
    expect(mockConstructed.OTLPLogExporter).toEqual([{ url: 'http://localhost:4318/v1/logs' }]);

    const config = sdkConfig();
    expect(config.traceExporter).toBeInstanceOf(GatedSpanExporter);
    expect(config.metricReader._exporter).toBeInstanceOf(GatedPushMetricExporter);
    expect(config.metricReader._exportInterval).toBe(60_000);
    expect(config.logRecordProcessors).toHaveLength(1);
    expect(config.logRecordProcessors[0]._exporter).toBeInstanceOf(GatedLogRecordExporter);
    expect(config.resource.attributes).toEqual({
      'service.name': 'svc-from-env',
      'service.version': '0.0.1',
      'deployment.environment': 'development',
    });
    expect(log).toHaveBeenCalledWith(
      'OpenTelemetry initialized - exporting to http://localhost:4318 once the telemetry.enabled setting opens the gate',
    );
  });

  it('takes the endpoint from OTEL_EXPORTER_OTLP_ENDPOINT, the version from npm_package_version', () => {
    process.env.OTEL_ENABLED = 'true';
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://otel-collector:4318';
    process.env.npm_package_version = '2.3.4';
    process.env.NODE_ENV = 'production';

    initializeOtel({ shutdownOnSigterm: false, serviceName: 'my-app-api' });

    expect(mockConstructed.OTLPTraceExporter).toEqual([{ url: 'http://otel-collector:4318/v1/traces' }]);
    expect(sdkConfig().resource.attributes).toEqual({
      'service.name': 'my-app-api',
      'service.version': '2.3.4',
      'deployment.environment': 'production',
    });
  });

  it('options win over the environment, and seed the gate instance id', () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://ignored:4318';
    const before = telemetryGate.instanceId();

    initializeOtel({
      enabled: true,
      endpoint: 'http://collector.test:4318',
      serviceName: 'svc',
      serviceVersion: '9.9.9',
      instanceId: 'my-app',
      shutdownOnSigterm: false,
    });

    expect(mockConstructed.OTLPMetricExporter).toEqual([{ url: 'http://collector.test:4318/v1/metrics' }]);
    expect(sdkConfig().resource.attributes['service.version']).toBe('9.9.9');
    expect(telemetryGate.instanceId()).toBe('my-app');
    telemetryGate.setInstanceId(before);
  });

  it('leaves the gate CLOSED: installing the SDK exports nothing until the app opens it', () => {
    initializeOtel({ enabled: true, shutdownOnSigterm: false });
    expect(telemetryGate.isEnabled()).toBe(false);
  });

  it('registers a SIGTERM handler that shuts the SDK down (by default)', () => {
    const on = jest.spyOn(process, 'on').mockImplementation(() => process);
    try {
      initializeOtel({ enabled: true });
      expect(on).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    } finally {
      on.mockRestore();
    }
  });

  it('hands the auto-instrumentations the default configuration', () => {
    initializeOtel({ enabled: true, shutdownOnSigterm: false });

    const [instrumentation] = sdkConfig().instrumentations[0] as Array<{ autoConfig: Record<string, any> }>;
    const auto = instrumentation.autoConfig;
    expect(auto['@opentelemetry/instrumentation-fs']).toEqual({ enabled: false });
    expect(auto['@opentelemetry/instrumentation-pino']).toEqual({ disableLogSending: false });
    const ignore = auto['@opentelemetry/instrumentation-http'].ignoreIncomingRequestHook;
    expect(ignore({ url: '/api/health/live' })).toBe(true);
    expect(ignore({ url: '/api/health/ready?x=1' })).toBe(true);
    expect(ignore({ url: '/api/gyms/1' })).toBe(false);
  });
});

describe('instrumentationConfig', () => {
  it('ignores exactly the default health probes', () => {
    expect(DEFAULT_IGNORED_INCOMING_PATHS).toEqual(['/api/health/live', '/api/health/ready']);
    const hook = instrumentationConfig(DEFAULT_IGNORED_INCOMING_PATHS)['@opentelemetry/instrumentation-http']
      .ignoreIncomingRequestHook as (req: { url?: string }) => boolean;
    expect(hook({ url: '/api/health/live' })).toBe(true);
    expect(hook({ url: '/api/health' })).toBe(false);
    expect(hook({})).toBe(false);
  });

  it('honours custom paths and merges overrides field by field', () => {
    const config = instrumentationConfig(['/healthz'], {
      '@opentelemetry/instrumentation-fs': { enabled: true },
      '@opentelemetry/instrumentation-pg': { enhancedDatabaseReporting: true },
    });
    const hook = config['@opentelemetry/instrumentation-http'].ignoreIncomingRequestHook as (req: {
      url?: string;
    }) => boolean;
    expect(hook({ url: '/healthz' })).toBe(true);
    expect(hook({ url: '/api/health/live' })).toBe(false);
    expect(config['@opentelemetry/instrumentation-fs']).toEqual({ enabled: true });
    expect(config['@opentelemetry/instrumentation-pg']).toEqual({ enhancedDatabaseReporting: true });
    expect(config['@opentelemetry/instrumentation-pino']).toEqual({ disableLogSending: false });
  });
});

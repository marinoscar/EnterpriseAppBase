import { RegistryError, withTemporaryEntries } from '@marinoscar/platform-api/core';
import {
  APP_METRIC_NAMES,
  appMetricRegistry,
  registerAppMetrics,
  type AppMetricDef,
} from './app-metrics.service';
import { EVENT_BUS_APP_METRICS } from '../event-bus/event-bus.metrics';
import { ORGANIZATIONS_APP_METRICS } from '@marinoscar/platform-api/identity';
import { SHARING_APP_METRICS } from '@marinoscar/platform-api/sharing';
import { EXPORTS_APP_METRICS } from '@marinoscar/platform-api/exports';
import { PLATFORM_APP_METRICS } from './platform-app-metrics';

// =============================================================================
// The app-metric registry (issue #680)
// =============================================================================
//
// Read through `app-metrics.service.ts` (which imports the manifest), as
// production code reads it. Every rule runs at registration, so a malformed
// declaration fails at import time.
// =============================================================================

function def(overrides: Partial<AppMetricDef> = {}): AppMetricDef {
  return {
    key: 'testWidgets',
    name: 'app.test.widgets',
    kind: 'counter',
    unit: '{widget}',
    description: 'Test widgets.',
    ...overrides,
  };
}

async function writable(fn: () => void): Promise<void> {
  await withTemporaryEntries(appMetricRegistry, [], fn);
}

function rejection(fn: () => void): RegistryError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(RegistryError);
    return err as RegistryError;
  }
  throw new Error('expected the registration to be refused');
}

describe('app-metric registry', () => {
  it('holds the 31 platform metrics, then the three event bus metrics, the two organization metrics, the three sharing metrics and the three export metrics, in declaration order', () => {
    expect(appMetricRegistry.ids()).toEqual(
      [...PLATFORM_APP_METRICS, ...EVENT_BUS_APP_METRICS, ...ORGANIZATIONS_APP_METRICS, ...SHARING_APP_METRICS, ...EXPORTS_APP_METRICS].map((d) => d.key),
    );
    expect(PLATFORM_APP_METRICS).toHaveLength(31);
    expect(appMetricRegistry.size).toBe(42);
  });

  it('derives APP_METRIC_NAMES from the registry', () => {
    expect(APP_METRIC_NAMES).toEqual(Object.fromEntries(appMetricRegistry.list().map((d) => [d.key, d.name])));
    expect(Object.isFrozen(APP_METRIC_NAMES)).toBe(true);
  });

  it('declares every platform attribute key in snake_case and buckets only on histograms', () => {
    for (const metric of appMetricRegistry.list()) {
      for (const key of Object.keys(metric.attributes ?? {})) expect(key).toMatch(/^[a-z][a-z0-9_]*$/);
      if (metric.buckets) expect(metric.kind).toBe('histogram');
      if (metric.kind === 'histogram') expect(metric.buckets?.length).toBeGreaterThan(0);
    }
  });

  it('accepts an app counter, histogram and gauge', async () => {
    await withTemporaryEntries(
      appMetricRegistry,
      [
        def(),
        def({ key: 'testLatency', name: 'app.test.latency', kind: 'histogram', unit: 's', buckets: [0.1, 1, 10] }),
        def({ key: 'testBacklog', name: 'app.test.backlog', kind: 'gauge', unit: '{item}' }),
      ],
      () => {
        expect(appMetricRegistry.ids().slice(-3)).toEqual(['testWidgets', 'testLatency', 'testBacklog']);
      },
    );
    expect(appMetricRegistry.has('testWidgets')).toBe(false);
  });

  describe('refuses at registration', () => {
    const cases: Array<[string, AppMetricDef[], RegExp]> = [
      ['a name without the app. prefix', [def({ name: 'test.widgets' })], /must start with "app\."/],
      ['a dotted name with an upper-case segment', [def({ name: 'app.Test.widgets' })], /must start with "app\."/],
      ['a name a platform metric uses', [def({ name: 'app.jobs.enqueued' })], /already declared by "jobsEnqueued"/],
      ['buckets on a counter', [def({ buckets: [1, 2] })], /only a histogram takes/],
      [
        'buckets that do not ascend',
        [def({ kind: 'histogram', unit: 's', buckets: [1, 5, 5] })],
        /strictly ascending/,
      ],
      ['a dotted attribute key', [def({ attributes: { 'job.type': { kind: 'free' } } })], /snake_case without dots/],
      ['an enum without values', [def({ attributes: { outcome: { kind: 'enum', values: [] } } })], /enum without values/],
      ['an unknown kind', [def({ kind: 'summary' as never })], /counter, histogram or gauge/],
      ['an empty description', [def({ description: '' })], /description must be a non-empty string/],
      [
        'two declarations of one batch sharing a name',
        [def(), def({ key: 'testWidgetsAgain' })],
        /name "app\.test\.widgets" is already declared by "testWidgets"/,
      ],
    ];

    it.each(cases)('%s (INVALID_ENTRY), leaving the registry unchanged', async (_name, defs, message) => {
      await writable(() => {
        const before = appMetricRegistry.ids();
        const err = rejection(() => registerAppMetrics(defs));
        expect(err.code).toBe('INVALID_ENTRY');
        expect(err.registry).toBe('app-metrics');
        expect(err.message).toMatch(message);
        expect(appMetricRegistry.ids()).toEqual(before);
      });
    });

    it('a duplicate key (DUPLICATE_ID)', async () => {
      await writable(() => {
        const err = rejection(() => registerAppMetrics([def({ key: 'jobsEnqueued', name: 'app.test.other' })]));
        expect(err.code).toBe('DUPLICATE_ID');
        expect(err.message).toContain('Duplicate app metric key "jobsEnqueued"');
      });
    });

    it('a key that is not lowerCamelCase (INVALID_ID)', async () => {
      await writable(() => {
        expect(rejection(() => registerAppMetrics([def({ key: 'test_widgets' })])).code).toBe('INVALID_ID');
      });
    });
  });

  it('fails at IMPORT time when the app declares a malformed metric', () => {
    jest.isolateModules(() => {
      jest.doMock('../../app-registrations/telemetry', () => ({
        APP_METRIC_GROUPS: [],
        APP_METRICS: [def({ name: 'app.jobs.enqueued' })],
      }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      expect(() => require('./app-metric.manifest')).toThrow(/already declared by "jobsEnqueued"/);
    });
    jest.dontMock('../../app-registrations/telemetry');
  });

  it.each(['./platform-app-metrics', '../../app-registrations/telemetry'])(
    '%s loads without app-metrics.service.ts (framework-free leaf)',
    (path) => {
      jest.isolateModules(() => {
        jest.doMock('./app-metrics.service', () => {
          throw new Error(`${path} loaded app-metrics.service.ts`);
        });
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        expect(() => require(path)).not.toThrow();
      });
      jest.dontMock('./app-metrics.service');
    },
  );
});

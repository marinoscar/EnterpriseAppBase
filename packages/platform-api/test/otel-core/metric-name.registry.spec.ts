import { RegistryError, withTemporaryEntries } from '../../src/core/index';
import {
  APP_METRIC_ATTRIBUTE_KEY_PATTERN,
  APP_METRIC_KEY_PATTERN,
  APP_METRIC_NAME_PATTERN,
  appMetricRegistry,
  assertAppMetric,
  registerAppMetrics,
  type AppMetricDef,
} from '../../src/otel-core/index';

// =============================================================================
// The app-metric name registry (issue #680; packaged by issue #700)
// =============================================================================
//
// The package declares no metric: the registry starts empty and an app fills
// it from a manifest (the reference app's platform metrics and its own are
// pinned by apps/api/src/common/otel/app-metric.registry.spec.ts). Every rule
// runs at registration, so a malformed declaration fails at import time.
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

const EXISTING = def({ key: 'jobsEnqueued', name: 'app.jobs.enqueued', unit: '{job}', description: 'Jobs.' });

async function writable(fn: () => void): Promise<void> {
  await withTemporaryEntries(appMetricRegistry, [EXISTING], fn);
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

describe('appMetricRegistry', () => {
  it('starts empty: the package declares no metric of its own', () => {
    expect(appMetricRegistry.name).toBe('app-metrics');
    expect(appMetricRegistry.size).toBe(0);
  });

  it('accepts a counter, a histogram and a gauge, in order', async () => {
    await withTemporaryEntries(
      appMetricRegistry,
      [
        def(),
        def({ key: 'testLatency', name: 'app.test.latency', kind: 'histogram', unit: 's', buckets: [0.1, 1, 10] }),
        def({ key: 'testBacklog', name: 'app.test.backlog', kind: 'gauge', unit: '{item}' }),
      ],
      () => {
        expect(appMetricRegistry.ids()).toEqual(['testWidgets', 'testLatency', 'testBacklog']);
        expect(appMetricRegistry.require('testLatency').buckets).toEqual([0.1, 1, 10]);
      },
    );
    expect(appMetricRegistry.has('testWidgets')).toBe(false);
  });

  it('pins the naming patterns', () => {
    expect(APP_METRIC_NAME_PATTERN.test('app.jobs.queue.depth')).toBe(true);
    expect(APP_METRIC_NAME_PATTERN.test('jobs.enqueued')).toBe(false);
    expect(APP_METRIC_ATTRIBUTE_KEY_PATTERN.test('job_type')).toBe(true);
    expect(APP_METRIC_ATTRIBUTE_KEY_PATTERN.test('job.type')).toBe(false);
    expect(APP_METRIC_KEY_PATTERN.test('jobsEnqueued')).toBe(true);
    expect(APP_METRIC_KEY_PATTERN.test('jobs_enqueued')).toBe(false);
  });

  describe('refuses at registration', () => {
    const cases: Array<[string, AppMetricDef[], RegExp]> = [
      ['a name without the app. prefix', [def({ name: 'test.widgets' })], /must start with "app\."/],
      ['a dotted name with an upper-case segment', [def({ name: 'app.Test.widgets' })], /must start with "app\."/],
      ['a name another metric uses', [def({ name: 'app.jobs.enqueued' })], /already declared by "jobsEnqueued"/],
      ['buckets on a counter', [def({ buckets: [1, 2] })], /only a histogram takes/],
      ['empty buckets', [def({ kind: 'histogram', unit: 's', buckets: [] })], /non-empty array/],
      ['buckets that do not ascend', [def({ kind: 'histogram', unit: 's', buckets: [1, 5, 5] })], /strictly ascending/],
      ['a non-finite bucket', [def({ kind: 'histogram', unit: 's', buckets: [1, Infinity] })], /not a finite number/],
      ['a dotted attribute key', [def({ attributes: { 'job.type': { kind: 'free' } } })], /snake_case without dots/],
      ['an enum without values', [def({ attributes: { outcome: { kind: 'enum', values: [] } } })], /enum without values/],
      ['an enum with an empty value', [def({ attributes: { outcome: { kind: 'enum', values: [''] } } })], /non-empty strings/],
      ['an unknown attribute kind', [def({ attributes: { outcome: { kind: 'set' } as never } })], /"enum" or "free"/],
      ['an unknown kind', [def({ kind: 'summary' as never })], /counter, histogram or gauge/],
      ['an empty unit', [def({ unit: ' ' })], /unit must be a non-empty string/],
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

  it('assertAppMetric ignores a known declaration with the same key', () => {
    expect(() => assertAppMetric(def(), [def()])).not.toThrow();
    expect(() => assertAppMetric(def(), [def({ key: 'other' })])).toThrow(/already declared by "other"/);
  });
});

import { describe, expect, it, vi } from 'vitest';

import { formatWebConformanceSummary, runPlatformWebConformance, webConformanceSuites } from '../../src/testing/index.js';
import type { PlatformWebConformanceOptions, WebConformanceSuite } from '../../src/testing/index.js';
import { recordingWebTestApi, webOutcome } from '../support/web-conformance.js';

const base = (): Omit<PlatformWebConformanceOptions, 'testApi' | 'suites'> => ({
  adminSections: [],
  userSettingsSections: [],
  hubs: { admin: { path: '/admin/settings', title: 'Admin' }, user: { path: '/settings', title: 'Settings' } },
  routes: [],
  apiPermissions: [],
});

const fixtureSuite: WebConformanceSuite = {
  id: 'fixture-web-suite',
  title: 'a fixture web suite',
  description: 'Fixture for the harness tests.',
  register(api, context) {
    api.describe('a fixture web suite', () => {
      api.it(`sees ${context.apiPermissions.length} permissions`, () => undefined);
    });
  },
};

/** Registers the fixture suite once per module instance (a second registration of an id throws). */
function ensureFixture(): void {
  if (!webConformanceSuites.has(fixtureSuite.id)) webConformanceSuites.register(fixtureSuite);
}

describe('runPlatformWebConformance', () => {
  it('refuses to run before any slice registered a suite (the testing entry was not imported)', async () => {
    vi.resetModules();
    const fresh = await import('../../src/testing/index.js');

    expect(() => fresh.runPlatformWebConformance({ ...base(), testApi: recordingWebTestApi().api })).toThrow('no suite is registered');
  });

  it('registers every suite and passes it the app’s context; the summary table is printed, not a test', async () => {
    ensureFixture();
    const { api, tests, titles } = recordingWebTestApi();
    const printed: string[] = [];

    runPlatformWebConformance({ ...base(), apiPermissions: ['a:b', 'c:d'], testApi: api, summaryOutput: (table) => printed.push(table) });
    for (const test of tests) expect(await webOutcome(test)).toBeNull();

    expect(titles).toContain('a fixture web suite');
    expect(tests.map((test) => test.name)).toContain('a fixture web suite > sees 2 permissions');
    expect(printed.join('')).toContain('fixture-web-suite  run');
  });

  it('lets an app skip a suite with a reason, which stays visible as a passing test and in the summary', async () => {
    ensureFixture();
    const { api, tests } = recordingWebTestApi();
    const printed: string[] = [];

    runPlatformWebConformance({
      ...base(),
      suites: { 'fixture-web-suite': { skip: 'This app has no fixtures.' } },
      testApi: api,
      summaryOutput: (table) => printed.push(table),
    });
    for (const test of tests) expect(await webOutcome(test)).toBeNull();

    expect(tests.map((test) => test.name)).toContain('a fixture web suite > fixture-web-suite: skipped by the app (This app has no fixtures.)');
    expect(printed.join('')).toContain('fixture-web-suite  skipped: This app has no fixtures.');
  });

  it('throws when a skip has no reason', () => {
    ensureFixture();
    const run = (skip: unknown) => () =>
      runPlatformWebConformance({ ...base(), suites: { 'fixture-web-suite': { skip } } as never, testApi: recordingWebTestApi().api });

    expect(run('')).toThrow('skipped without a reason');
    expect(run('   ')).toThrow('skipped without a reason');
    expect(run(undefined)).toThrow('skipped without a reason');
  });

  it('throws on an unknown suite id, so a typo cannot disable a check', () => {
    ensureFixture();

    expect(() =>
      runPlatformWebConformance({ ...base(), suites: { 'fixture-web-suitee': { skip: 'typo' } }, testApi: recordingWebTestApi().api }),
    ).toThrow('unknown conformance suite "fixture-web-suitee"');
  });

  it('refuses a second suite under a registered id, even before the harness has run (a duplicate would silently never run)', () => {
    ensureFixture();

    expect(() => webConformanceSuites.register(fixtureSuite)).toThrow('a suite with id "fixture-web-suite" is already registered');
    expect(() => webConformanceSuites.register({ ...fixtureSuite, title: 'another' })).toThrow('already registered');
    expect(webConformanceSuites.has('fixture-web-suite')).toBe(true);
    expect(webConformanceSuites.has('nope')).toBe(false);
  });

  it('hands a suite the options the app passed under its id, and undefined when it passed none', async () => {
    const seen: unknown[] = [];
    const optionSuite: WebConformanceSuite<{ minRoutes: number }> = {
      id: 'option-web-suite',
      title: 'an option web suite',
      description: 'Fixture for the options tests.',
      register(api, _context, options) {
        seen.push(options);
        api.describe('an option web suite', () => {
          api.it('reads its option', () => api.expect(options?.minRoutes ?? -1).toBeGreaterThanOrEqual(0));
        });
      },
    };
    vi.resetModules();
    const fresh = await import('../../src/testing/index.js');
    fresh.webConformanceSuites.register(optionSuite);

    fresh.runPlatformWebConformance({ ...base(), suites: { 'option-web-suite': { minRoutes: 3 } }, testApi: recordingWebTestApi().api });
    expect(seen).toEqual([{ minRoutes: 3 }]);

    fresh.runPlatformWebConformance({ ...base(), testApi: recordingWebTestApi().api });
    expect(seen).toEqual([{ minRoutes: 3 }, undefined]);
  });

  it('treats an options object without a skip key as a configuration, and a skip with no reason as an error, whatever else it carries', async () => {
    vi.resetModules();
    const fresh = await import('../../src/testing/index.js');
    fresh.webConformanceSuites.register({ ...fixtureSuite, id: 'entry-web-suite' });
    const run = (entry: unknown) => () =>
      fresh.runPlatformWebConformance({ ...base(), suites: { 'entry-web-suite': entry as never }, testApi: recordingWebTestApi().api });

    expect(run({ anything: true })).not.toThrow();
    expect(run({ skip: '', anything: true })).toThrow('skipped without a reason');
  });

  it('freezes the registry on the first run, so a late registration fails loudly', () => {
    ensureFixture();
    runPlatformWebConformance({ ...base(), testApi: recordingWebTestApi().api });

    expect(() => webConformanceSuites.register({ ...fixtureSuite, id: 'late' })).toThrow('registered after');
  });

  it('offers the widened matcher subset (toBe, toMatchObject, toHaveLength, toThrow) to a suite', async () => {
    const matcherSuite: WebConformanceSuite = {
      id: 'matcher-web-suite',
      title: 'a matcher web suite',
      description: 'Uses every matcher of the subset.',
      register(api) {
        api.describe('a matcher web suite', () => {
          api.it('uses them', () => {
            api.expect(1 + 1).toBe(2);
            api.expect({ a: 1, b: 2 }).toMatchObject({ a: 1 });
            api.expect(['x', 'y']).toHaveLength(2);
            api.expect(() => {
              throw new Error('boom');
            }).toThrow('boom');
            api.expect(() => {
              throw new Error('boom');
            }).toThrow(/bo+m/);
          });
        });
      },
    };
    vi.resetModules();
    const fresh = await import('../../src/testing/index.js');
    fresh.webConformanceSuites.register(matcherSuite);
    const { api, tests } = recordingWebTestApi();

    fresh.runPlatformWebConformance({ ...base(), testApi: api });

    for (const test of tests) expect(await webOutcome(test)).toBeNull();
  });

  it('says what to do when there is no test runner', () => {
    ensureFixture();
    const g = globalThis as unknown as Record<string, unknown>;
    const saved = g.describe;
    g.describe = undefined;
    try {
      expect(() => runPlatformWebConformance(base())).toThrow('no global describe/it/expect');
    } finally {
      g.describe = saved;
    }
  });

  it('formats the summary table', () => {
    expect(
      formatWebConformanceSummary([
        { id: 'a', status: 'run' },
        { id: 'long-id', status: 'skipped', reason: 'why' },
      ]),
    ).toBe(['suite    status', 'a        run', 'long-id  skipped: why', '1 run, 1 skipped'].join('\n'));
  });
});

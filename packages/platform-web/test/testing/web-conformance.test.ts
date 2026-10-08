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

describe('runPlatformWebConformance', () => {
  it('refuses to run before any slice registered a suite (the testing entry was not imported)', async () => {
    vi.resetModules();
    const fresh = await import('../../src/testing/index.js');

    expect(() => fresh.runPlatformWebConformance({ ...base(), testApi: recordingWebTestApi().api })).toThrow('no suite is registered');
  });

  it('registers every suite, passes it the app’s context, and adds a summary test', async () => {
    webConformanceSuites.register(fixtureSuite);
    const { api, tests, titles } = recordingWebTestApi();
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    let printed = '';

    try {
      runPlatformWebConformance({ ...base(), apiPermissions: ['a:b', 'c:d'], testApi: api });
      for (const test of tests) expect(await webOutcome(test)).toBeNull();
      printed = info.mock.calls.map((call) => String(call[0])).join('\n');
    } finally {
      info.mockRestore();
    }

    expect(titles).toContain('a fixture web suite');
    expect(tests.map((test) => test.name)).toContain('a fixture web suite > sees 2 permissions');
    expect(printed).toContain('fixture-web-suite  run');
  });

  it('lets an app skip a suite with a reason, which stays visible as a passing test and in the summary', async () => {
    webConformanceSuites.register(fixtureSuite);
    const { api, tests } = recordingWebTestApi();
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    let printed = '';

    try {
      runPlatformWebConformance({ ...base(), suites: { 'fixture-web-suite': { skip: 'This app has no fixtures.' } }, testApi: api });
      for (const test of tests) expect(await webOutcome(test)).toBeNull();
      printed = info.mock.calls.map((call) => String(call[0])).join('\n');
    } finally {
      info.mockRestore();
    }

    expect(tests.map((test) => test.name)).toContain('a fixture web suite > fixture-web-suite: skipped by the app (This app has no fixtures.)');
    expect(printed).toContain('fixture-web-suite  skipped: This app has no fixtures.');
  });

  it('throws when a skip has no reason', () => {
    webConformanceSuites.register(fixtureSuite);
    const run = (skip: unknown) => () =>
      runPlatformWebConformance({ ...base(), suites: { 'fixture-web-suite': { skip } } as never, testApi: recordingWebTestApi().api });

    expect(run('')).toThrow('skipped without a reason');
    expect(run('   ')).toThrow('skipped without a reason');
    expect(run(undefined)).toThrow('skipped without a reason');
  });

  it('throws on an unknown suite id, so a typo cannot disable a check', () => {
    webConformanceSuites.register(fixtureSuite);

    expect(() =>
      runPlatformWebConformance({ ...base(), suites: { 'fixture-web-suitee': { skip: 'typo' } }, testApi: recordingWebTestApi().api }),
    ).toThrow('unknown conformance suite "fixture-web-suitee"');
  });

  it('freezes the registry on the first run, so a late registration fails loudly; re-registering a known id is harmless', () => {
    webConformanceSuites.register(fixtureSuite);
    runPlatformWebConformance({ ...base(), testApi: recordingWebTestApi().api });

    expect(() => webConformanceSuites.register(fixtureSuite)).not.toThrow();
    expect(() => webConformanceSuites.register({ ...fixtureSuite, id: 'late' })).toThrow('registered after');
  });

  it('says what to do when there is no test runner', () => {
    webConformanceSuites.register(fixtureSuite);
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

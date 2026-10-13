// The app-owned web suite example: options flow in, a planted violation fails,
// a missing option and a missing reason are refused (PP-14.26).

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runPlatformWebConformance } from '@marinoscar/platform-web/testing';
import type { PlatformWebConformanceOptions, WebConformanceTestApi } from '@marinoscar/platform-web/testing';

import { ADMIN_HUB_PATH, ADMIN_HUB_TITLE, ADMIN_SECTIONS } from '../../../config/adminSections';
import { USER_HUB_PATH, USER_HUB_TITLE, USER_SETTINGS_SECTIONS } from '../../../config/userSettingsSections';
import { APP_ROUTES_SUITE_ID } from './app-routes.suite';

const APP_TSX = resolve(dirname(fileURLToPath(import.meta.url)), '../../../App.tsx');

/** The app's real data, minus the suites, for the harness. */
const appData = (): Omit<PlatformWebConformanceOptions, 'suites' | 'testApi'> => ({
  adminSections: ADMIN_SECTIONS,
  userSettingsSections: USER_SETTINGS_SECTIONS,
  hubs: {
    admin: { path: ADMIN_HUB_PATH, title: ADMIN_HUB_TITLE },
    user: { path: USER_HUB_PATH, title: USER_HUB_TITLE },
  },
  routes: { appTsx: readFileSync(APP_TSX, 'utf8') },
  apiPermissions: [],
});

interface Recorded {
  name: string;
  run: () => void | Promise<void>;
}

/** A recording test API that runs each recorded test with Vitest's own `expect`. */
function recording(): { api: WebConformanceTestApi; tests: Recorded[] } {
  const tests: Recorded[] = [];
  const stack: string[] = [];
  const api: WebConformanceTestApi = {
    describe(name, fn) {
      stack.push(name);
      try {
        fn();
      } finally {
        stack.pop();
      }
    },
    it(name, fn) {
      tests.push({ name: [...stack, name].join(' > '), run: fn });
    },
    expect: (actual) => expect(actual) as never,
  };
  return { api, tests };
}

async function failures(tests: readonly Recorded[]): Promise<string[]> {
  const failed: string[] = [];
  for (const test of tests) {
    try {
      await test.run();
    } catch {
      failed.push(test.name);
    }
  }
  return failed;
}

describe('the app-owned web conformance suite (example)', () => {
  beforeAll(async () => {
    await import('./app-routes.suite');
  });

  it('passes over the real route table when the promised routes exist', async () => {
    const { api, tests } = recording();

    runPlatformWebConformance({
      ...appData(),
      testApi: api,
      summaryOutput: () => undefined,
      suites: { [APP_ROUTES_SUITE_ID]: { requiredRoutes: [USER_HUB_PATH, ADMIN_HUB_PATH], forbiddenRoutes: ['/retired-page'], minRoutes: 5 } },
    });

    const mine = tests.filter((test) => test.name.startsWith('the app declares the routes'));
    expect(mine).toHaveLength(3);
    expect(await failures(mine)).toEqual([]);
  });

  it('fails on a promised route that is not declared, and on a forbidden one that is (a planted violation)', async () => {
    const { api, tests } = recording();

    runPlatformWebConformance({
      ...appData(),
      testApi: api,
      summaryOutput: () => undefined,
      suites: { [APP_ROUTES_SUITE_ID]: { requiredRoutes: ['/never-declared'], forbiddenRoutes: [USER_HUB_PATH] } },
    });

    const mine = tests.filter((test) => test.name.startsWith('the app declares the routes'));
    expect(await failures(mine)).toEqual([
      'the app declares the routes its navigation promises > declares every required route',
      'the app declares the routes its navigation promises > declares none of the forbidden routes',
    ]);
  });

  it('is refused without options, and an opt-out needs a reason', () => {
    expect(() => runPlatformWebConformance({ ...appData(), testApi: recording().api, summaryOutput: () => undefined })).toThrow(
      `pass its options under suites['${APP_ROUTES_SUITE_ID}']`,
    );
    expect(() =>
      runPlatformWebConformance({ ...appData(), testApi: recording().api, summaryOutput: () => undefined, suites: { [APP_ROUTES_SUITE_ID]: { skip: ' ' } } }),
    ).toThrow('skipped without a reason');
  });

  it('can be opted out with a reason, which stays visible as a test', async () => {
    const { api, tests } = recording();

    runPlatformWebConformance({
      ...appData(),
      testApi: api,
      summaryOutput: () => undefined,
      suites: { [APP_ROUTES_SUITE_ID]: { skip: 'This example only runs in its own spec.' } },
    });

    expect(tests.map((test) => test.name)).toContain(
      'the app declares the routes its navigation promises > app-routes: skipped by the app (This example only runs in its own spec.)',
    );
    expect(await failures(tests)).toEqual([]);
  });
});

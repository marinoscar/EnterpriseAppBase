// A recording `WebConformanceTestApi` for the web conformance tests: it collects
// `describe`/`it` calls instead of running them, so a test can inspect the
// registered names and run each test itself, with Vitest's own `expect`.

import { expect } from 'vitest';

import type { WebConformanceTestApi } from '../../src/testing/index.js';

export interface RecordedWebTest {
  /** `describe` titles joined with ` > `, then the test title. */
  name: string;
  run: () => void | Promise<void>;
}

export function recordingWebTestApi(): { api: WebConformanceTestApi; tests: RecordedWebTest[]; titles: string[] } {
  const tests: RecordedWebTest[] = [];
  const titles: string[] = [];
  const stack: string[] = [];

  const api: WebConformanceTestApi = {
    describe(name, fn) {
      titles.push(name);
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

  return { api, tests, titles };
}

/** Runs one recorded test and returns the error it threw, or null. */
export async function webOutcome(test: RecordedWebTest): Promise<Error | null> {
  try {
    await test.run();
    return null;
  } catch (error) {
    return error as Error;
  }
}

/** The recorded tests that fail, each with its full name and the failure message. */
export async function failingTests(tests: readonly RecordedWebTest[]): Promise<Array<{ name: string; message: string }>> {
  const failing: Array<{ name: string; message: string }> = [];
  for (const test of tests) {
    const error = await webOutcome(test);
    if (error !== null) {
      // Vitest abbreviates long arrays in `message`; the full actual value is on the error.
      const actual = (error as { actual?: unknown }).actual;
      failing.push({ name: test.name, message: `${error.message}\n${Array.isArray(actual) ? actual.join('\n') : actual === undefined ? '' : JSON.stringify(actual)}` });
    }
  }
  return failing;
}

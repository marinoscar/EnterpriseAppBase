import { deepStrictEqual, ok } from 'node:assert';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import type { ConformanceTestApi } from '../../src/testing';

/** `test/fixtures/cron`: sources kept as `.ts.txt` so `tsc` and Jest never compile or discover them. */
export const CRON_FIXTURES = join(__dirname, '..', 'fixtures', 'cron');

/** A throwaway source root, removed by {@link removeSourceRoots}. */
const created: string[] = [];

/** Copies the cron fixtures into a fresh directory, renaming `*.ts.txt` to `*.ts`. */
export function fixtureSourceRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'platform-conformance-'));
  created.push(root);
  cpSync(CRON_FIXTURES, root, { recursive: true });

  const rename = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) rename(full);
      else if (entry.endsWith('.ts.txt')) renameSync(full, full.slice(0, -'.txt'.length));
    }
  };
  rename(root);
  return root;
}

/** An empty source root, for tests that write their own files. */
export function emptySourceRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'platform-conformance-'));
  created.push(root);
  return root;
}

/** Writes `source` to `file` under `root`, creating directories. */
export function writeSource(root: string, file: string, source: string): void {
  const full = join(root, file);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, source);
}

export function removeSourceRoots(): void {
  for (const root of created.splice(0)) rmSync(root, { recursive: true, force: true });
}

export interface RecordedTest {
  /** `describe` titles joined with ` > `, then the test title. */
  name: string;
  run: () => void | Promise<void>;
}

/**
 * A recording `ConformanceTestApi`: it collects `describe`/`it` calls instead of
 * running them, so a test can inspect the registered names and run each test
 * itself. The harness is thereby tested without relying on Jest globals.
 */
export function recordingTestApi(): { api: ConformanceTestApi; tests: RecordedTest[]; titles: string[] } {
  const tests: RecordedTest[] = [];
  const titles: string[] = [];
  const stack: string[] = [];

  const api: ConformanceTestApi = {
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
    expect(actual) {
      return {
        toEqual: (expected) => deepStrictEqual(actual, expected),
        toBeGreaterThanOrEqual: (n) => ok((actual as number) >= n, `expected ${String(actual)} >= ${n}`),
        toContain: (item) => ok((actual as unknown[]).includes(item), `expected ${JSON.stringify(actual)} to contain ${JSON.stringify(item)}`),
      };
    },
  };

  return { api, tests, titles };
}

/** Runs one recorded test and returns the error it threw, or null. */
export async function outcome(test: RecordedTest): Promise<Error | null> {
  try {
    await test.run();
    return null;
  } catch (error) {
    return error as Error;
  }
}

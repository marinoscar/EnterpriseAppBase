import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runDbConformance, type DbConformanceTestApi } from '../../src/drift/index.js';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const REFERENCE_APP = join(REPO_ROOT, 'apps', 'api');

/** Runs the registered tests for real and reports each one's outcome. */
function runSuite(options: { appRoot: string }): Array<{ name: string; error?: string }> {
  const tests: Array<{ name: string; fn: () => void }> = [];
  const api: DbConformanceTestApi = {
    describe: (_name, fn) => fn(),
    it: (name, fn) => void tests.push({ name, fn }),
  };
  runDbConformance({ ...options, testApi: api });
  return tests.map(({ name, fn }) => {
    try {
      fn();
      return { name };
    } catch (error) {
      return { name, error: (error as Error).message };
    }
  });
}

describe('runDbConformance', () => {
  let dir = '';
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it.skipIf(!existsSync(join(REFERENCE_APP, 'prisma', 'platform.lock')))('passes on the reference app', () => {
    const outcomes = runSuite({ appRoot: REFERENCE_APP });
    expect(outcomes.map((o) => o.name)).toEqual([
      expect.stringContaining('raw-sql-indexes'),
      expect.stringContaining('platform.lock'),
    ]);
    expect(outcomes.filter((o) => o.error)).toEqual([]);
  });

  it('fails the lock test, naming the migration, when an installed file is edited', () => {
    dir = mkdtempSync(join(tmpdir(), 'db-conformance-'));
    mkdirSync(join(dir, 'prisma'), { recursive: true });
    cpSync(join(REFERENCE_APP, 'prisma', 'platform.lock'), join(dir, 'prisma', 'platform.lock'));
    cpSync(join(REFERENCE_APP, 'prisma', 'migrations'), join(dir, 'prisma', 'migrations'), { recursive: true });
    writeFileSync(join(dir, 'prisma', 'migrations', '20260906120000_add_jobs', 'migration.sql'), '-- edited\n');
    const [tripwire, lock] = runSuite({ appRoot: dir });
    expect(tripwire!.error).toBeUndefined();
    expect(lock!.error).toMatch(/LOCAL_MODIFIED.*0008_add_jobs/s);
  });

  it('fails the lock test when the app has no platform.lock', () => {
    dir = mkdtempSync(join(tmpdir(), 'db-conformance-'));
    expect(runSuite({ appRoot: dir })[1]!.error).toMatch(/platform\.lock does not exist/);
  });

  it('throws without a test API when there are no globals', () => {
    expect(() => runDbConformance({ appRoot: REFERENCE_APP })).toThrow(/no global describe\/it/);
  });
});

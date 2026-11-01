import { describe, expect, it } from 'vitest';
import { main } from '../../src/bin/platform.js';
import { makeBaselineWorkspace } from '../helpers/baseline.js';

async function baseline(args: string[], env: NodeJS.ProcessEnv = {}) {
  const ws = makeBaselineWorkspace();
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(
    ['db', 'baseline', ...args],
    { out: (l) => out.push(l), err: (l) => err.push(l) },
    { cwd: ws.root + '/app', env, packageRoot: ws.packageDir },
  );
  return { code, out: out.join('\n'), err: err.join('\n') };
}

describe('platform db baseline (command line)', () => {
  it('exits 2 without DATABASE_URL, naming the npm script that builds it', async () => {
    const run = await baseline([]);
    expect(run.code).toBe(2);
    expect(run.err).toContain('DATABASE_URL is not set');
    expect(run.err).toContain('npm run db:baseline');
  });

  it('a dry run is the default, so --apply and --dry-run together make no sense', async () => {
    const run = await baseline(['--apply', '--dry-run'], { DATABASE_URL: 'postgresql://x@localhost/none' });
    expect(run.code).toBe(2);
    expect(run.err).toContain('exclude each other');
  });

  it('turns a bad --through into a printed refusal and exit 1, never a stack trace', async () => {
    // --through is resolved before the database is touched; the refusal path is `guarded`.
    const run = await baseline(['--through', '99'], { DATABASE_URL: 'postgresql://x@127.0.0.1:1/none' });
    expect(run.code).toBe(1);
    expect(run.err).toMatch(/platform db: /);
  });

  it('lists the baseline options in --help', async () => {
    const run = await baseline(['--help']);
    expect(run.out).toContain('--through <migration>');
    expect(run.out).toContain('--force-remap');
    expect(run.out).toContain('--apply');
  });
});

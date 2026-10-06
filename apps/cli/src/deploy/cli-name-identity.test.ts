import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

// =============================================================================
// What `deploy` writes under the binary's name comes from `CLI_NAME`
// =============================================================================
//
// A renamed fork's journals must be named after ITS binary, and pruning must
// find them: a literal prefix in the name or the matching regex would leave a
// fork's runs unpruned forever. The deploy document's `deployedBy.cli` and the
// version-bump commit's author name the binary too. `CLI_NAME` is replaced
// here by a name the base never uses, so a literal left behind fails.
// =============================================================================

vi.mock('../branding.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../branding.js')>();
  return { ...actual, CLI_NAME: 'forkctl' };
});

const { openJournal, pruneOldRuns } = await import('./journal.js');
const { buildDeployInfo } = await import('./deploy-info.js');
const { runVersionStep } = await import('./version-step.js');
const { VERSIONED_MANIFESTS } = await import('./app-version.js');

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), 'journal-cli-name-'));
}

describe('journal names follow CLI_NAME', () => {
  it('names both run files <CLI_NAME>-<command>-<timestamp>', () => {
    const root = makeRoot();
    const journal = openJournal({ deployRoot: root, command: 'update' });
    journal.finish('success');

    expect(basename(journal.path)).toMatch(/^forkctl-update-.+\.log$/);
    const names = readdirSync(join(root, 'logs'));
    expect(names).toHaveLength(2);
    for (const name of names) expect(name.startsWith('forkctl-update-')).toBe(true);
  });

  it('prunes runs carrying CLI_NAME and leaves other files alone', () => {
    const root = makeRoot();
    const logs = join(root, 'logs');
    mkdirSync(logs, { recursive: true });
    const runs = [
      'forkctl-install-2026-01-01T00-00-00-000Z',
      'forkctl-install-2026-02-01T00-00-00-000Z',
      'forkctl-update-2026-03-01T00-00-00-000Z',
    ];
    for (const run of runs) {
      writeFileSync(join(logs, `${run}.log`), 'x');
      writeFileSync(join(logs, `${run}.jsonl`), 'x');
    }
    // Another tool's file in the same directory is not this CLI's run.
    writeFileSync(join(logs, 'othertool-install-2025-01-01T00-00-00-000Z.log'), 'x');

    pruneOldRuns(logs, 1);

    expect(readdirSync(logs).sort()).toEqual([
      'forkctl-update-2026-03-01T00-00-00-000Z.jsonl',
      'forkctl-update-2026-03-01T00-00-00-000Z.log',
      'othertool-install-2025-01-01T00-00-00-000Z.log',
    ]);
  });
});

describe('deploy identity follows CLI_NAME', () => {
  it('records the binary in deployedBy.cli', () => {
    const info = buildDeployInfo({ name: 'demo' } as Parameters<typeof buildDeployInfo>[0]);

    expect(info.deployedBy).toMatchObject({ cli: 'forkctl' });
  });

  it('authors the version-bump commit as <CLI_NAME> deploy', async () => {
    const git = (cwd: string, ...args: string[]): string =>
      execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'Test',
          GIT_AUTHOR_EMAIL: 'test@example.test',
          GIT_COMMITTER_NAME: 'Test',
          GIT_COMMITTER_EMAIL: 'test@example.test',
        },
      }).trim();
    const repo = mkdtempSync(join(tmpdir(), 'cli-name-versionstep-'));
    git(repo, 'init', '--quiet', '--initial-branch=main');
    for (const relative of VERSIONED_MANIFESTS) {
      mkdirSync(join(repo, dirname(relative)), { recursive: true });
      writeFileSync(join(repo, relative), JSON.stringify({ name: 'x', version: '1.0.0' }) + '\n');
    }
    git(repo, 'add', '.');
    git(repo, 'commit', '--quiet', '-m', 'first');

    const result = await runVersionStep({ checkoutPath: repo });

    expect(result.bumped).toBe(true);
    expect(git(repo, 'log', '-1', '--format=%an <%ae>')).toBe('forkctl deploy <forkctl@localhost>');
  });
});

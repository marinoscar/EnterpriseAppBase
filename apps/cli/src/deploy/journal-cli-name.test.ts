import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

// =============================================================================
// Journal file names come from `CLI_NAME`, not a literal binary name
// =============================================================================
//
// A renamed fork's journals must be named after ITS binary, and pruning must
// find them: a literal prefix in the name or the matching regex would leave a
// fork's runs unpruned forever. `CLI_NAME` is replaced here by a name the base
// never uses, so a literal left anywhere in journal.ts fails these tests.
// =============================================================================

vi.mock('../branding.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../branding.js')>();
  return { ...actual, CLI_NAME: 'forkctl' };
});

const { openJournal, pruneOldRuns } = await import('./journal.js');

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

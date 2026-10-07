import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Command } from 'commander';
import { describe, expect, it } from 'vitest';

import { buildProgram } from './program.js';

// =============================================================================
// `--help` parity for every command  (PP-8.9, #715)
// =============================================================================
//
// #715 moves the CLI into `@marinoscar/platform-cli` and its acceptance bar is
// behaviour parity: the `--help` of `appctl` and of every subcommand must be
// byte-for-byte what it was before the move. `help-snapshot.json` was captured
// from the pre-move build (the first commit of #715) and is never regenerated
// to make this test pass: a difference here is a flag, a description or an
// order that the move changed.
//
// Commander wraps help at the output width, which is 80 when stdout is not a
// TTY (as under vitest), so the text is deterministic.
// =============================================================================

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = join(HERE, '__snapshots__', 'help-snapshot.json');

/** Every command's help text, keyed by its path (`appctl deploy install`). */
export function collectHelp(program: Command): Record<string, string> {
  const out: Record<string, string> = {};
  const visit = (command: Command, path: string): void => {
    out[path] = command.helpInformation();
    for (const child of command.commands) visit(child, `${path} ${child.name()}`);
  };
  visit(program, program.name());
  return out;
}

describe('--help output (pre-move parity, #715)', () => {
  const expected = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as Record<string, string>;
  const actual = collectHelp(buildProgram());

  it('covers the same commands, in the same order', () => {
    expect(Object.keys(actual)).toEqual(Object.keys(expected));
  });

  for (const path of Object.keys(expected)) {
    it(`\`${path} --help\` is unchanged`, () => {
      expect(actual[path]).toBe(expected[path]);
    });
  }
});

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import { metadataFor } from './env-metadata.js';

// =============================================================================
// Every compose `${VAR:?...}` is a value the CLI guarantees  (#1009)
// =============================================================================
//
// A compose file that refuses to render without a value turns every gap in the
// CLI's own bookkeeping into a failed build on a real server. So each required
// variable in a compose file the deploy runs must be one this CLI puts in the
// `.env` itself on install AND on update: generated without a question
// (`autoGenerate`), or recorded by the CLI (`DEPLOY_ROOT`, written by both the
// `environment` step and the update drift step).
//
// A NEW required variable that is none of those fails here, in this one-second
// test, instead of on a server whose CLI predates it.
// =============================================================================

/** Written by the CLI itself, not generated: install's environment step and update's drift step. */
const RECORDED_BY_THE_CLI = new Set(['DEPLOY_ROOT']);

const infraRoot = dirname(createRequire(import.meta.url).resolve('@marinoscar/platform-infra/package.json'));

function composeFiles(): string[] {
  const directories = [join(infraRoot, 'compose'), join(infraRoot, 'telemetry', 'compose')];
  return directories.flatMap((directory) =>
    readdirSync(directory)
      .filter((name) => name.endsWith('.yml'))
      .map((name) => join(directory, name)),
  );
}

function requiredVariables(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of composeFiles()) {
    for (const match of readFileSync(file, 'utf8').matchAll(/\$\{([A-Z][A-Z0-9_]*):?\?/g)) {
      const key = match[1] as string;
      found.set(key, [...new Set([...(found.get(key) ?? []), resolve(file).split('/').slice(-2).join('/')])]);
    }
  }
  return found;
}

describe('required compose variables', () => {
  const required = requiredVariables();

  it('finds the ones the platform ships', () => {
    expect([...required.keys()]).toEqual(
      expect.arrayContaining(['STACK_AGENT_TOKEN', 'DEPLOY_ROOT', 'GREPTIME_ADMIN_PASSWORD']),
    );
  });

  it.each([...required.entries()])('%s is generated or recorded by the CLI (%s)', (key) => {
    expect(
      RECORDED_BY_THE_CLI.has(key) || metadataFor(key).autoGenerate === true,
      `${key} is required by a compose file but nothing in the CLI guarantees a value for it`,
    ).toBe(true);
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { EXIT, createCli, githubRawManifest } from '@marinoscar/platform-cli';
import { resetCliForTests } from '@marinoscar/platform-cli/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_CLI_OPTIONS } from '../app.js';
import { CLI_VERSION } from '../package-info.js';

import { helloCommand } from './hello.command.js';
import { COACH_MANIFEST, COACH_UPDATE_NOTICE } from './coach.update-notice.js';

// The updateNotice example (issue #1033). The behaviour itself (the cache, every
// skip rule, the timeout, the exit code) is pinned in the package:
// update-notice.test.ts, update-notice-run.test.ts, github-raw-manifest.test.ts.

let home: string;
let written: string[];

beforeEach(() => {
  resetCliForTests();
  home = mkdtempSync(join(tmpdir(), 'coach-update-notice-'));
  written = [];
});
afterEach(() => {
  resetCliForTests();
  rmSync(home, { recursive: true, force: true });
});

describe('COACH_UPDATE_NOTICE', () => {
  it('is accepted by createCli', () => {
    expect(() => createCli({ ...APP_CLI_OPTIONS, updateNotice: COACH_UPDATE_NOTICE })).not.toThrow();
  });

  it('is not set by the shipped CLI: the reference app makes no network call at start', () => {
    expect(APP_CLI_OPTIONS.updateNotice).toBeUndefined();
  });

  it('refuses a bad option at createCli', () => {
    expect(() => createCli({ ...APP_CLI_OPTIONS, updateNotice: { ...COACH_UPDATE_NOTICE, upgradeHint: '' } })).toThrow(/upgradeHint/);
  });

  it('tells the operator, on stderr after the output, when the manifest names a newer version', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ version: '999.0.0' }), { status: 200 })) as unknown as typeof fetch;
    const cli = createCli({
      ...APP_CLI_OPTIONS,
      extraCommands: [...(APP_CLI_OPTIONS.extraCommands ?? []), helloCommand],
      updateNotice: { ...COACH_UPDATE_NOTICE, latestVersion: githubRawManifest({ ...COACH_MANIFEST, fetch: fetchImpl }) },
    });
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const updateCheck = { env: {}, home, stderr: { isTTY: true, write: (line: string) => (written.push(line), true) } };

    try {
      // --help never checks: the notice is for commands that do something.
      expect(await cli.run(['--help'], { updateCheck })).toBe(EXIT.OK);
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(written).toEqual([]);

      expect(await cli.run(['hello'], { updateCheck })).toBe(EXIT.OK);
    } finally {
      stdout.mockRestore();
    }

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String((fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0])).toBe(
      'https://raw.githubusercontent.com/kappa/coach/main/apps/cli/package.json',
    );
    expect(written).toEqual([`appctl 999.0.0 is available (you have ${CLI_VERSION}). Update: git pull && npm ci && npm run build\n`]);
  });
});

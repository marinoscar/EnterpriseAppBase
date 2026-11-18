import { createCli } from '@marinoscar/platform-cli';
import { detectDistro, listInstallSteps, type InstallContext } from '@marinoscar/platform-cli/node';
import { resetCliForTests } from '@marinoscar/platform-cli/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { APP_CLI_OPTIONS } from '../app.js';

import { OCR_PACKAGES, registerOcrInstallStep } from './ocr.install-step.js';

beforeEach(() => {
  resetCliForTests();
  createCli(APP_CLI_OPTIONS);
});
afterEach(() => resetCliForTests());

function context(overrides: Partial<InstallContext>): InstallContext & { ran: string[] } {
  const ran: string[] = [];
  return {
    distro: detectDistro({ platform: 'linux', osRelease: 'ID=ubuntu\nID_LIKE=debian\n' }),
    dryRun: false,
    stateDir: '/tmp/none',
    run: (command, args) => void ran.push([command, ...args].join(' ')),
    capture: async () => {
      throw new Error('not found');
    },
    log: () => {},
    ...overrides,
    ran,
  };
}

describe('registerOcrInstallStep', () => {
  it('runs right after the platform’s state-directory step', () => {
    registerOcrInstallStep();

    expect(listInstallSteps().map((step) => step.id)).toEqual(['state-dir', 'ocr-tools', 'node-runtime']);
  });

  it('is supported only on Debian-family systems, and detects the tool', async () => {
    registerOcrInstallStep();
    const step = listInstallSteps().find((candidate) => candidate.id === 'ocr-tools');

    expect(step?.requiresSudo).toBe(true);
    expect(await step?.supported(context({}))).toBe(true);
    expect(await step?.supported(context({ distro: detectDistro({ platform: 'darwin' }) }))).toBe(false);
    expect(await step?.detect(context({}))).toBe(false);
    expect(await step?.detect(context({ capture: async () => 'tesseract 5' }))).toBe(true);
  });

  it('installs only the missing package through an announced apt-get, and nothing in a dry run', async () => {
    registerOcrInstallStep();
    const step = listInstallSteps().find((candidate) => candidate.id === 'ocr-tools');

    const real = context({});
    await step?.install(real);
    expect(real.ran).toHaveLength(1);
    expect(real.ran[0]).toContain(`apt-get install -y ${OCR_PACKAGES.join(' ')}`);

    const dry = context({ dryRun: true });
    await step?.install(dry);
    expect(dry.ran).toEqual([]);
  });
});

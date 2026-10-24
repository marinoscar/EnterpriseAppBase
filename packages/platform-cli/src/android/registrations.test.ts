// The android slice's registrations (#746): the merged command group, the
// optional deploy step and the TUI screen.
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Command } from 'commander';
import { describe, expect, it } from 'vitest';

import { androidCommand, androidDeployStep, androidTuiScreen, deployAndroidEnvVar, readAndroidIdentity } from './index.js';
import { createAndroidCommand, createAndroidDeployStep } from './registrations.js';
import type { AndroidStepDeps } from './deploy-step.js';

function program(): Command {
  return new Command().exitOverride().configureOutput({ writeOut: () => {}, writeErr: () => {} });
}

describe('androidCommand', () => {
  it('lists the merged subcommands', () => {
    const root = program();
    androidCommand({ identity: { productName: 'Acme Hub', repoSlug: 'acme/acme-hub' } })(root);
    const android = root.commands.find((command) => command.name() === 'android')!;
    expect(android.commands.map((command) => command.name()).sort()).toEqual(
      ['build', 'doctor', 'keystore', 'publish', 'release', 'releases', 'version'],
    );
    expect(android.helpInformation()).toContain('doctor');
    expect(readAndroidIdentity().applicationId).toBe('com.acmehub.android');
  });

  it('runs `android doctor` without a keystore and reports what is missing', async () => {
    const home = mkdtempSync(join(tmpdir(), 'android-doctor-'));
    const repo = join(home, 'repo');
    mkdirSync(join(repo, 'apps', 'android'), { recursive: true });
    writeFileSync(join(repo, 'apps', 'android', 'version.properties'), 'versionName=0.1.0\nversionCode=1\n');
    let stderr = '';
    const root = program();
    createAndroidCommand(
      {},
      {
        home,
        cwd: repo,
        env: { PATH: '' },
        stdout: { write: () => true },
        stderr: { write: (chunk: string) => ((stderr += chunk), true) },
        exec: async () => ({ code: 1, stdout: '', stderr: 'not found' }),
      },
    )(root);
    await expect(root.parseAsync(['node', 'appctl', 'android', 'doctor'])).rejects.toThrow(/At least one Android check failed/);
    expect(stderr).toMatch(/keystore/i);
    expect(stderr).toContain('appctl android keystore init');
  });
});

describe('androidDeployStep', () => {
  it('is an update step after verify that skips unless opted in', () => {
    const step = androidDeployStep();
    expect(step).toMatchObject({ pipeline: 'update', id: 'android-release', after: 'verify' });
    expect(deployAndroidEnvVar()).toBe('APPCTL_DEPLOY_ANDROID');
    const previous = process.env[deployAndroidEnvVar()];
    delete process.env[deployAndroidEnvVar()];
    try {
      expect(step.step.skip?.({} as never)).toMatch(/APPCTL_DEPLOY_ANDROID=1/);
      process.env[deployAndroidEnvVar()] = '1';
      expect(step.step.skip?.({} as never)).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env[deployAndroidEnvVar()];
      else process.env[deployAndroidEnvVar()] = previous;
    }
  });

  it('never fails the deploy: a deployment without a domain logs a skip with the fix', async () => {
    const deps = { findRepoRoot: () => undefined } as unknown as AndroidStepDeps;
    const lines: string[] = [];
    const registration = createAndroidDeployStep({ pipeline: 'install' }, deps);
    await registration.step.run({ deployRoot: mkdtempSync(join(tmpdir(), 'deploy-')), log: (line: string) => lines.push(line) } as never);
    expect(lines.join('\n')).toMatch(/Android APK {2}skipped: the deployment has no public domain/);
  });
});

describe('androidTuiScreen', () => {
  it('registers a lazily loaded Android screen', async () => {
    expect(androidTuiScreen).toMatchObject({ route: 'android', label: 'Android app' });
    expect(typeof (await androidTuiScreen.load!())).toBe('function');
  });
});

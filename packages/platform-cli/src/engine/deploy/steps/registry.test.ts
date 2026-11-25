import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { CommandResult, RunCommandOptions } from '../executor.js';
import { buildInstallSteps } from '../install.js';
import { openJournal } from '../journal.js';
import { buildUpdateSteps } from '../update.js';

import { appStepContext } from './app-step-context.js';
import { runPipeline, type StepContext } from './pipeline.js';
import { planDeploySteps } from './plan.js';
import {
  INSTALL_STEP_IDS,
  UPDATE_STEP_IDS,
  registerDeployStep,
  resetDeployStepRegistryForTests,
  withRegisteredSteps,
  type DeployStepContext,
} from './registry.js';

// =============================================================================
// The deploy step registry  (PP-8.9, #715)
// =============================================================================

afterEach(() => resetDeployStepRegistryForTests());

const noop = { title: 'Noop', run: async (): Promise<void> => undefined };

describe('the built-in step ids (a stable surface)', () => {
  it('are exactly what the install and update pipelines run, in order', () => {
    expect(buildInstallSteps().map((step) => step.id)).toEqual([...INSTALL_STEP_IDS]);
    expect(buildUpdateSteps().map((step) => step.id)).toEqual([...UPDATE_STEP_IDS]);
  });

  it('are the plan when nothing is registered', () => {
    expect(planDeploySteps('install').map((step) => step.id)).toEqual([...INSTALL_STEP_IDS]);
    expect(planDeploySteps('update').every((step) => step.source === 'builtin')).toBe(true);
  });
});

describe('registerDeployStep', () => {
  it('inserts a step right after the step it names, in the dry-run plan', () => {
    registerDeployStep({ pipeline: 'install', id: 'announce', after: 'verify', step: { ...noop, title: 'Announce' } });
    const plan = planDeploySteps('install');
    const at = plan.findIndex((step) => step.id === 'verify');
    expect(plan[at + 1]).toEqual({ id: 'announce', title: 'Announce', source: 'app' });
    expect(plan).toHaveLength(INSTALL_STEP_IDS.length + 1);
    // The other pipeline is untouched.
    expect(planDeploySteps('update').map((step) => step.id)).toEqual([...UPDATE_STEP_IDS]);
  });

  it('keeps registration order for two steps after the same target, and allows after an app step', () => {
    registerDeployStep({ pipeline: 'update', id: 'first', after: 'migrate', step: noop });
    registerDeployStep({ pipeline: 'update', id: 'second', after: 'migrate', step: noop });
    registerDeployStep({ pipeline: 'update', id: 'third', after: 'restart', step: noop });
    const ids = planDeploySteps('update').map((step) => step.id);
    expect(ids.slice(ids.indexOf('migrate'), ids.indexOf('migrate') + 3)).toEqual(['migrate', 'first', 'second']);
    expect(ids[ids.indexOf('restart') + 1]).toBe('third');
  });

  it('refuses an unknown pipeline, a malformed or taken id, and an unknown after', () => {
    expect(() => registerDeployStep({ pipeline: 'rollout' as 'install', id: 'x', after: 'verify', step: noop })).toThrow(/unknown pipeline/);
    expect(() => registerDeployStep({ pipeline: 'install', id: 'Bad Id', after: 'verify', step: noop })).toThrow(/invalid/);
    expect(() => registerDeployStep({ pipeline: 'install', id: 'build', after: 'verify', step: noop })).toThrow(/already a step/);
    expect(() => registerDeployStep({ pipeline: 'install', id: 'x', after: 'fetch', step: noop })).toThrow(
      /"fetch", which is not a step of the install pipeline/,
    );
  });
});

describe('an app step at run time', () => {
  function harness() {
    const deployRoot = mkdtempSync(join(tmpdir(), 'appctl-app-step-'));
    const journal = openJournal({ deployRoot, command: 'install' });
    journal.addSecrets([{ key: 'JWT_SECRET', value: 'hunter2-secret' }]);
    const logs: string[] = [];
    const progress: string[] = [];
    const calls: { argv: readonly string[]; options: RunCommandOptions }[] = [];
    const runCommand = async (argv: readonly string[], options: RunCommandOptions): Promise<CommandResult> => {
      calls.push({ argv, options });
      options.onLine?.('built hunter2-secret', 'stdout');
      return { argv, cwd: options.cwd, exitCode: 0, stdout: 'ok', stderr: '', durationMs: 1, timedOut: false } as CommandResult;
    };
    const context: StepContext & { options: { deployRoot: string }; runCommand: typeof runCommand; commitSha: string } = {
      journal,
      hooks: { onLog: (line) => logs.push(line), onProgress: (message) => progress.push(message) },
      completed: new Set(),
      options: { deployRoot },
      runCommand,
      commitSha: 'abc123',
    };
    return { deployRoot, context, logs, progress, calls };
  }

  it('runs in pipeline order, reports through DeployHooks, and runs commands through the journal', async () => {
    const h = harness();
    let seen: DeployStepContext | undefined;
    const order: string[] = [];
    registerDeployStep({
      pipeline: 'install',
      id: 'announce',
      after: 'preflight',
      step: {
        title: 'Announce',
        run: async (context) => {
          seen = context;
          order.push('announce');
          context.log('announcing hunter2-secret');
          context.progress('half way');
          await context.exec(['echo', 'hi']);
        },
      },
    });
    // Stand-ins for the built-ins: the insertion and the adaptation are what
    // is under test, not the real install steps.
    const steps = withRegisteredSteps(
      'install',
      [
        { id: 'preflight', title: 'Preflight', run: async () => void order.push('preflight') },
        { id: 'checkout', title: 'Checkout', run: async () => void order.push('checkout') },
      ],
      (context: typeof h.context) => appStepContext('install', context),
    );

    const result = await runPipeline(steps, h.context);

    expect(result.failed).toBeUndefined();
    expect(order).toEqual(['preflight', 'announce', 'checkout']);
    expect(result.completed).toEqual(['preflight', 'announce', 'checkout']);
    expect(seen?.pipeline).toBe('install');
    expect(seen?.commitSha).toBe('abc123');
    expect(seen?.checkoutPath).toBe(join(h.deployRoot, 'repo'));
    // Redacted on every path: the log line, and the command's output line.
    expect(h.logs).toContain('announcing ***REDACTED:JWT_SECRET***');
    expect(h.logs.join('\n')).not.toContain('hunter2-secret');
    expect(h.progress).toEqual(['half way']);
    expect(h.calls[0]?.argv).toEqual(['echo', 'hi']);
    expect(h.calls[0]?.options.cwd).toBe(join(h.deployRoot, 'repo'));
    expect(h.calls[0]?.options.redact).toBe(h.context.journal.redact);
  });

  it('fails the pipeline when it throws, and a skip reason skips it', async () => {
    const h = harness();
    registerDeployStep({ pipeline: 'install', id: 'boom', after: 'preflight', step: { title: 'Boom', run: async () => { throw new Error('no'); } } });
    registerDeployStep({ pipeline: 'install', id: 'quiet', after: 'preflight', step: { title: 'Quiet', skip: () => 'not today', run: async () => undefined } });
    const steps = withRegisteredSteps(
      'install',
      [{ id: 'preflight', title: 'Preflight', run: async () => undefined }],
      (context: typeof h.context) => appStepContext('install', context),
    );
    const result = await runPipeline(steps, h.context);
    expect(result.failed).toMatchObject({ id: 'boom', outcome: 'failed', detail: 'no' });
    expect(result.steps.map((step) => step.id)).toEqual(['preflight', 'boom']);
  });
});

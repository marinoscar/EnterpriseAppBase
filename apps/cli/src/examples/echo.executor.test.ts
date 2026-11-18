import { createCli } from '@marinoscar/platform-cli';
import { defaultExecutorRegistry } from '@marinoscar/platform-cli/node';
import { checkExecutorCredentialHygiene, resetCliForTests } from '@marinoscar/platform-cli/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { APP_CLI_OPTIONS } from '../app.js';

import { EchoExecutor } from './echo.executor.js';

// The registerNodeExecutor example (#715): registered, its type is in
// ExecutorRegistry.types(), so the worker advertises and claims it.

beforeEach(() => resetCliForTests());
afterEach(() => resetCliForTests());

describe('EchoExecutor', () => {
  it('is not run by the shipped worker', () => {
    createCli(APP_CLI_OPTIONS);
    expect(defaultExecutorRegistry().types()).toEqual(['db.backup.run', 'example.checksum']);
  });

  it('is in ExecutorRegistry.types() once passed in nodeExecutors', () => {
    createCli({ ...APP_CLI_OPTIONS, nodeExecutors: [new EchoExecutor()] });
    expect(defaultExecutorRegistry().types()).toEqual(['app.echo', 'db.backup.run', 'example.checksum']);
  });

  it('never persists or logs a job-scoped credential (CLAUDE.md queue rule 3)', async () => {
    // The check points the worker's state directory (an identity-prefixed
    // variable) at a scratch directory, so the CLI is built first.
    createCli(APP_CLI_OPTIONS);
    const report = await checkExecutorCredentialHygiene(new EchoExecutor(), { params: { hello: 'world' } });
    expect(report.outcome).toBe('ok');
    expect(report.findings).toEqual([]);
  });

  it('a duplicate type throws at createCli', () => {
    expect(() => createCli({ ...APP_CLI_OPTIONS, nodeExecutors: [new EchoExecutor(), new EchoExecutor()] })).toThrow(/already registered/);
  });
});

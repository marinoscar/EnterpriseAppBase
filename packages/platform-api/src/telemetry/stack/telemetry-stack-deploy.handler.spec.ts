import { TELEMETRY_RETENTION_TYPE } from '../handlers/telemetry-retention.handler';
import type { TelemetryJobRecord as Job } from '../ports';
import {
  STACK_DEPLOY_OUTPUT_MAX_BYTES,
  TELEMETRY_STACK_DEPLOY_TYPE,
  TelemetryStackDeployHandler,
  capOutput,
} from './telemetry-stack-deploy.handler';

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    type: TELEMETRY_STACK_DEPLOY_TYPE,
    payload: { requestedByUserId: 'admin-1' },
    ...overrides,
  } as Job;
}

function setup(upResult: unknown) {
  const agent = { telemetryUp: jest.fn().mockResolvedValue(upResult) };
  const jobs = {
    registerHandler: jest.fn(),
    updatePayload: jest.fn().mockResolvedValue(undefined),
    enqueueHousekeepingJob: jest.fn().mockResolvedValue(undefined),
  };
  const connection = { refreshSafely: jest.fn().mockResolvedValue(true) };
  const settings = { refreshGate: jest.fn().mockResolvedValue(true) };

  const handler = new TelemetryStackDeployHandler(agent as never, jobs as never, connection as never, settings as never);

  return { handler, agent, jobs, connection, settings };
}

describe('TelemetryStackDeployHandler', () => {
  it('has the permanent type string and self-registers', () => {
    const { handler, jobs } = setup({ ok: true, exitCode: 0, output: '' });

    handler.onModuleInit();

    expect(handler.type).toBe('telemetry.stack.deploy');
    expect(jobs.registerHandler).toHaveBeenCalledWith(handler);
  });

  it('declares a 15-minute, single-attempt profile', () => {
    const { handler } = setup({ ok: true, exitCode: 0, output: '' });

    expect(handler.profile).toEqual({ maxRuntimeMs: 15 * 60 * 1000, maxAttempts: 1 });
  });

  it('is SERVER-ONLY: no node result members and no secret broker', () => {
    const { handler } = setup({ ok: true, exitCode: 0, output: '' });
    const members = handler as unknown as Record<string, unknown>;

    expect(members.nodeResultSchema).toBeUndefined();
    expect(members.persistNodeResult).toBeUndefined();
    expect(members.nodeSecretBroker).toBeUndefined();
  });

  it('records the result on the job payload and nudges telemetry after a successful deploy', async () => {
    const { handler, jobs, connection, settings } = setup({ ok: true, exitCode: 0, output: 'Started greptimedb' });

    await handler.process(job());

    expect(jobs.updatePayload).toHaveBeenCalledWith('job-1', {
      requestedByUserId: 'admin-1',
      result: { ok: true, exitCode: 0, output: 'Started greptimedb' },
    });
    expect(connection.refreshSafely).toHaveBeenCalled();
    expect(settings.refreshGate).toHaveBeenCalled();
    expect(jobs.enqueueHousekeepingJob).toHaveBeenCalledWith(expect.objectContaining({ type: TELEMETRY_RETENTION_TYPE }));
  });

  it('records the output and throws when the agent reports a failure', async () => {
    const { handler, jobs, connection } = setup({
      ok: false,
      error: 'failed',
      message: 'stack-agent could not start the telemetry services (HTTP 500, exit code 1)',
      exitCode: 1,
      output: 'Error: pull access denied',
    });

    await expect(handler.process(job())).rejects.toThrow(/\(failed\).*exit code 1/);

    expect(jobs.updatePayload).toHaveBeenCalledWith('job-1', {
      requestedByUserId: 'admin-1',
      result: { ok: false, exitCode: 1, output: 'Error: pull access denied' },
    });
    expect(connection.refreshSafely).not.toHaveBeenCalled();
  });

  it.each(['busy', 'unreachable', 'unauthorized', 'not_configured'])(
    'throws without a stored result when the agent is %s',
    async (error) => {
      const { handler, jobs } = setup({ ok: false, error, message: `agent ${error}` });

      await expect(handler.process(job())).rejects.toThrow(`(${error})`);
      expect(jobs.updatePayload).not.toHaveBeenCalled();
    },
  );

  it('still succeeds when recording the result fails', async () => {
    const { handler, jobs } = setup({ ok: true, exitCode: 0, output: '' });
    jobs.updatePayload.mockRejectedValue(new Error('row purged'));

    await expect(handler.process(job())).resolves.toBeUndefined();
  });

  it('caps a long output to 4 KB before storing it', async () => {
    const { handler, jobs } = setup({ ok: true, exitCode: 0, output: 'x'.repeat(10_000) + 'END' });

    await handler.process(job());

    const stored = jobs.updatePayload.mock.calls[0][1].result.output as string;
    expect(Buffer.byteLength(stored, 'utf8')).toBeLessThanOrEqual(STACK_DEPLOY_OUTPUT_MAX_BYTES);
    expect(stored.endsWith('END')).toBe(true);
  });
});

describe('capOutput', () => {
  it('returns a short output unchanged', () => {
    expect(capOutput('hello')).toBe('hello');
  });

  it('keeps the tail with a truncation marker, within the byte budget', () => {
    const capped = capOutput('a'.repeat(100) + 'tail', 32);

    expect(capped.startsWith('…(truncated)\n')).toBe(true);
    expect(capped.endsWith('tail')).toBe(true);
    expect(Buffer.byteLength(capped, 'utf8')).toBeLessThanOrEqual(32);
  });

  it('never splits a multi-byte character', () => {
    const capped = capOutput('é'.repeat(100), 33);

    expect(capped).not.toContain('�');
    expect(Buffer.byteLength(capped, 'utf8')).toBeLessThanOrEqual(33);
  });
});

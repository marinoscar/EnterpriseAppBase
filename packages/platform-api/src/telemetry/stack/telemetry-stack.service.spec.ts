import { ConflictException } from '@nestjs/common';

import { TELEMETRY_STACK_DEPLOY_TYPE } from './telemetry-stack-deploy.handler';
import { TELEMETRY_STACK_DEPLOY_AUDIT_ACTION, TelemetryStackService, toDeploy } from './telemetry-stack.service';

function setup(options: { configured?: boolean; status?: unknown; latest?: unknown; enqueued?: unknown } = {}) {
  const agent = {
    isConfigured: jest.fn().mockReturnValue(options.configured ?? true),
    telemetryStatus: jest.fn().mockResolvedValue(options.status ?? { ok: true, services: [] }),
  };
  const jobs = {
    enqueue: jest.fn().mockResolvedValue(options.enqueued ?? { id: 'job-new', status: 'pending' }),
    findLatest: jest.fn().mockResolvedValue(options.latest ?? null),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };

  const service = new TelemetryStackService(agent as never, jobs as never, audit as never);

  return { service, agent, jobs, audit };
}

const CREATED = new Date('2026-09-27T10:00:00.000Z');
const FINISHED = new Date('2026-09-27T10:03:00.000Z');

describe('TelemetryStackService', () => {
  describe('getStatus', () => {
    it('reports an available agent with its services and no deploy', async () => {
      const services = [
        { name: 'greptimedb', state: 'running', health: 'healthy' },
        { name: 'otel-collector', state: 'running', health: null },
      ];
      const { service, jobs } = setup({ status: { ok: true, services } });

      await expect(service.getStatus()).resolves.toEqual({ agent: 'available', agentError: null, services, deploy: null });
      expect(jobs.findLatest).toHaveBeenCalledWith(TELEMETRY_STACK_DEPLOY_TYPE);
    });

    it.each([
      ['not_configured', 'not_configured', null],
      ['unauthorized', 'unauthorized', 'x'],
      ['unreachable', 'unavailable', 'x'],
      ['failed', 'unavailable', 'x'],
    ])('maps a client %s to agent %s with no services and agentError %s', async (error, agent, agentError) => {
      const { service } = setup({ status: { ok: false, error, message: 'x' } });

      await expect(service.getStatus()).resolves.toMatchObject({ agent, agentError, services: [] });
    });

    it("carries the client's reason when the agent is unreachable", async () => {
      const message = 'stack-agent at http://stack-agent:8080 is unreachable: no answer within 5 s';
      const { service } = setup({ status: { ok: false, error: 'unreachable', message } });

      await expect(service.getStatus()).resolves.toMatchObject({ agent: 'unavailable', agentError: message });
    });

    it('describes the most recent deploy job', async () => {
      const { service } = setup({
        latest: {
          id: 'job-9',
          status: 'failed',
          createdAt: CREATED,
          finishedAt: FINISHED,
          lastError: 'Deploying the telemetry services failed (failed): …',
          payload: { requestedByUserId: 'u', result: { ok: false, exitCode: 1, output: 'denied' } },
        },
      });

      const status = await service.getStatus();

      expect(status.deploy).toEqual({
        jobId: 'job-9',
        status: 'failed',
        createdAt: '2026-09-27T10:00:00.000Z',
        finishedAt: '2026-09-27T10:03:00.000Z',
        error: 'Deploying the telemetry services failed (failed): …',
        output: 'denied',
      });
    });
  });

  describe('toDeploy', () => {
    it('has null output before the agent answered and hides a succeeded job\'s stale lastError', () => {
      expect(
        toDeploy({ id: 'j', status: 'running', createdAt: CREATED, finishedAt: null, lastError: null, payload: {} }),
      ).toMatchObject({ output: null, finishedAt: null, error: null });

      expect(
        toDeploy({ id: 'j', status: 'succeeded', createdAt: CREATED, finishedAt: FINISHED, lastError: 'old', payload: null }),
      ).toMatchObject({ error: null, output: null });
    });
  });

  describe('deploy', () => {
    it('refuses with 409 when no stack agent is configured, queueing nothing', async () => {
      const { service, jobs, audit } = setup({ configured: false });

      const error = await service.deploy('admin-1').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        details: { reason: 'STACK_AGENT_NOT_CONFIGURED' },
      });
      expect(jobs.enqueue).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('enqueues a global (deduplicated) deploy job and audits it', async () => {
      const { service, jobs, audit } = setup();

      await expect(service.deploy('admin-1')).resolves.toEqual({ jobId: 'job-new' });

      const input = jobs.enqueue.mock.calls[0][0];
      expect(input).toMatchObject({ type: TELEMETRY_STACK_DEPLOY_TYPE, payload: { requestedByUserId: 'admin-1' } });
      // No subject and no skipDedup: the dedup key is constant for the type.
      expect(input.subjectType).toBeUndefined();
      expect(input.subjectId).toBeUndefined();
      expect(input.skipDedup).toBeUndefined();

      expect(audit.record).toHaveBeenCalledWith({
        actorUserId: 'admin-1',
        action: TELEMETRY_STACK_DEPLOY_AUDIT_ACTION,
        targetType: 'job',
        targetId: 'job-new',
        meta: { type: TELEMETRY_STACK_DEPLOY_TYPE, status: 'pending' },
      });
    });

    it('is idempotent: returns the job already in flight', async () => {
      const { service } = setup({ enqueued: { id: 'job-running', status: 'running' } });

      await expect(service.deploy('admin-2')).resolves.toEqual({ jobId: 'job-running' });
    });
  });
});

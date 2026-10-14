import { TELEMETRY_RETENTION_TYPE } from '../handlers/telemetry-retention.handler';
import { TelemetryRetentionTask } from './telemetry-retention.task';

// The housekeeping semantics (one global low-priority job, skip while one is
// pending or running, never throw) belong to the TELEMETRY_JOBS port's
// `enqueueHousekeepingJob`; the app's adapter proves them
// (apps/api/src/platform/telemetry/telemetry-jobs.adapter.spec.ts).
describe('TelemetryRetentionTask', () => {
  let enqueueHousekeepingJob: jest.Mock;
  let task: TelemetryRetentionTask;

  beforeEach(() => {
    enqueueHousekeepingJob = jest.fn().mockResolvedValue(undefined);
    task = new TelemetryRetentionTask({ enqueueHousekeepingJob } as never);
  });

  it('enqueues one telemetry.retention.apply housekeeping job, on its own logger', async () => {
    await task.handleCron();

    expect(enqueueHousekeepingJob).toHaveBeenCalledTimes(1);
    expect(enqueueHousekeepingJob).toHaveBeenCalledWith({
      type: TELEMETRY_RETENTION_TYPE,
      what: 'telemetry retention',
      logger: expect.objectContaining({ log: expect.any(Function) }),
    });
  });
});

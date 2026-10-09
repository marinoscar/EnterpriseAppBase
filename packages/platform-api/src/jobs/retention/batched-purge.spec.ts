import {
  RETENTION_PURGE_BATCH_SIZE,
  RETENTION_PURGE_MAX_BATCHES,
  purgeInBatches,
  retentionCutoff,
  runRetentionPolicyPurge,
} from './batched-purge';

const DAY_MS = 24 * 60 * 60 * 1000;
const ids = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => `${prefix}-${i}`);

describe('purgeInBatches', () => {
  let deleteIds: jest.Mock;

  beforeEach(() => {
    deleteIds = jest.fn(async (batch: string[]) => batch.length);
  });

  it('ships the bounds the story fixes: 5000 ids a batch, 1000 batches a run', () => {
    expect(RETENTION_PURGE_BATCH_SIZE).toBe(5000);
    expect(RETENTION_PURGE_MAX_BATCHES).toBe(1000);
  });

  it('asks for the default batch size and ends the loop on a short batch', async () => {
    const selectIds = jest
      .fn()
      .mockResolvedValueOnce(ids(RETENTION_PURGE_BATCH_SIZE, 'a'))
      .mockResolvedValueOnce(ids(3, 'b'));

    const result = await purgeInBatches({ selectIds, deleteIds });

    expect(selectIds).toHaveBeenCalledTimes(2);
    expect(selectIds).toHaveBeenCalledWith(RETENTION_PURGE_BATCH_SIZE);
    expect(result).toEqual({ deleted: RETENTION_PURGE_BATCH_SIZE + 3, batches: 2, hitSafetyStop: false });
  });

  it('deletes exactly the ids each read returned', async () => {
    const selectIds = jest.fn().mockResolvedValueOnce(['x', 'y']).mockResolvedValueOnce([]);

    await purgeInBatches({ selectIds, deleteIds, batchSize: 2 });

    expect(deleteIds).toHaveBeenCalledTimes(1);
    expect(deleteIds).toHaveBeenCalledWith(['x', 'y']);
  });

  it('is zero batches when nothing is older than the cutoff', async () => {
    const selectIds = jest.fn().mockResolvedValueOnce([]);

    await expect(purgeInBatches({ selectIds, deleteIds })).resolves.toEqual({
      deleted: 0,
      batches: 0,
      hitSafetyStop: false,
    });
    expect(deleteIds).not.toHaveBeenCalled();
  });

  it('counts what the delete reported, not what was read', async () => {
    const selectIds = jest.fn().mockResolvedValueOnce(['x', 'y', 'z']);
    deleteIds.mockResolvedValueOnce(2); // one row went away concurrently

    const result = await purgeInBatches({ selectIds, deleteIds, batchSize: 10 });

    expect(result.deleted).toBe(2);
  });

  it('stops at the safety limit, warns, and reports it', async () => {
    const selectIds = jest.fn(async (take: number) => ids(take, 'full'));
    const warn = jest.fn();

    const result = await purgeInBatches({
      selectIds,
      deleteIds,
      batchSize: 2,
      maxBatches: 3,
      logger: { warn },
      what: 'test purge',
    });

    expect(selectIds).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ deleted: 6, batches: 3, hitSafetyStop: true });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/^Test purge stopped at its 3-batch safety limit after deleting 6 row\(s\)/);
  });

  it('does not warn when the last allowed batch came back short', async () => {
    const selectIds = jest.fn().mockResolvedValueOnce(['a', 'b']).mockResolvedValueOnce(['c']);
    const warn = jest.fn();

    const result = await purgeInBatches({ selectIds, deleteIds, batchSize: 2, maxBatches: 2, logger: { warn } });

    expect(result.hitSafetyStop).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('lets a database error escape so the queue retries', async () => {
    const selectIds = jest.fn().mockRejectedValueOnce(new Error('connection reset'));

    await expect(purgeInBatches({ selectIds, deleteIds })).rejects.toThrow('connection reset');
  });

  it.each([0, -1, 1.5])('refuses a nonsensical batchSize or maxBatches (%p)', async (bad) => {
    const selectIds = jest.fn();

    await expect(purgeInBatches({ selectIds, deleteIds, batchSize: bad })).rejects.toThrow(RangeError);
    await expect(purgeInBatches({ selectIds, deleteIds, maxBatches: bad })).rejects.toThrow(RangeError);
    expect(selectIds).not.toHaveBeenCalled();
  });
});

describe('retentionCutoff', () => {
  it('is now minus the given days', () => {
    const now = Date.parse('2026-10-06T01:00:00.000Z');

    expect(retentionCutoff(90, now)).toEqual(new Date(now - 90 * DAY_MS));
    expect(retentionCutoff(1, now).toISOString()).toBe('2026-10-05T01:00:00.000Z');
  });
});

describe('runRetentionPolicyPurge', () => {
  const job = { id: 'job-1' };
  let log: jest.Mock;
  let warn: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-10-06T01:00:00.000Z') });
    log = jest.fn();
    warn = jest.fn();
  });

  afterEach(() => jest.useRealTimers());

  it('is a logged no-op while the policy is disabled', async () => {
    const selectIds = jest.fn();
    const deleteIds = jest.fn();

    const result = await runRetentionPolicyPurge({
      job,
      logger: { log, warn },
      policy: { enabled: false, days: 30 },
      setting: 'retention.test',
      what: 'test purge',
      rows: 'row(s)',
      selectIds,
      deleteIds,
    });

    expect(result).toBeNull();
    expect(selectIds).not.toHaveBeenCalled();
    expect(deleteIds).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('Test purge is disabled (retention.test.enabled); job job-1 is a no-op');
  });

  it('passes now - days as the cutoff and logs one summary line', async () => {
    const selectIds = jest.fn().mockResolvedValueOnce(['a']);
    const deleteIds = jest.fn().mockResolvedValueOnce(1);

    const result = await runRetentionPolicyPurge({
      job,
      logger: { log, warn },
      policy: { enabled: true, days: 30 },
      setting: 'retention.test',
      what: 'test purge',
      rows: 'row(s)',
      selectIds,
      deleteIds,
    });

    const cutoff = new Date(Date.now() - 30 * DAY_MS);
    expect(selectIds).toHaveBeenCalledWith(cutoff, RETENTION_PURGE_BATCH_SIZE);
    expect(result).toEqual({ deleted: 1, batches: 1, hitSafetyStop: false });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      `Test purge removed 1 row(s) created before ${cutoff.toISOString()} ` +
        '(retention 30 day(s)) in 1 batch(es) (job job-1)',
    );
  });
});

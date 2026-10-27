// The in-memory queue keeps the real dedup rule, claim order, retry budget and delete decision (PP-14.26).

import { ACTIVE_DEDUP_INDEX_NAME, isActiveDedupConflict } from '../../../src/jobs';
import type { Job, JobHandler } from '../../../src/jobs';
import { createFakeJobQueue } from '../../../src/jobs/testing';

const handler = (type: string, process: (job: Job) => Promise<void> = async () => undefined, extra: Partial<JobHandler> = {}): JobHandler => ({
  type,
  process,
  ...extra,
});

describe('createFakeJobQueue', () => {
  it('collapses the same work onto the job in flight and returns the first caller’s row', async () => {
    const queue = createFakeJobQueue();
    const first = await queue.enqueue({ type: 'x.run', reason: 'upload', subjectType: 'thing', subjectId: '1', payload: { a: 1 }, priority: 5 });
    const second = await queue.enqueue({ type: 'x.run', reason: 'rerun', subjectType: 'thing', subjectId: '1', payload: { a: 2 }, priority: 0 });

    expect(second.id).toBe(first.id);
    expect(second).toMatchObject({ reason: 'upload', priority: 5, payload: { a: 1 }, dedupKey: 'x.run:thing:1' });
    expect(queue.jobs()).toHaveLength(1);
  });

  it('lets skipDedup rows coexist, and different subjects never collapse', async () => {
    const queue = createFakeJobQueue();
    await queue.enqueue({ type: 'x.run', reason: 'rerun', skipDedup: true });
    await queue.enqueue({ type: 'x.run', reason: 'rerun', skipDedup: true });
    await queue.enqueue({ type: 'x.run', reason: 'rerun', subjectType: 't', subjectId: 'a' });
    await queue.enqueue({ type: 'x.run', reason: 'rerun', subjectType: 't', subjectId: 'b' });

    expect(queue.jobs()).toHaveLength(4);
    expect(queue.jobs().map((job) => job.dedupKey)).toEqual([null, null, 'x.run:t:a', 'x.run:t:b']);
  });

  it('frees the key once the job settles', async () => {
    const queue = createFakeJobQueue();
    queue.register(handler('x.run'));
    const first = await queue.enqueue({ type: 'x.run', reason: 'rerun', subjectType: 't', subjectId: 'a' });
    await queue.drain();
    const again = await queue.enqueue({ type: 'x.run', reason: 'rerun', subjectType: 't', subjectId: 'a' });

    expect(queue.get(first.id)?.status).toBe('succeeded');
    expect(again.id).not.toBe(first.id);
  });

  it('enqueueWithin throws the dedup conflict the real one propagates, which isActiveDedupConflict recognises', async () => {
    const queue = createFakeJobQueue();
    await queue.enqueueWithin({}, { type: 'x.run', reason: 'rerun', subjectType: 't', subjectId: 'a' });
    const error = await queue.enqueueWithin({}, { type: 'x.run', reason: 'rerun', subjectType: 't', subjectId: 'a' }).catch((caught) => caught);

    expect(isActiveDedupConflict(error)).toBe(true);
    expect(JSON.stringify((error as { meta: unknown }).meta)).toContain(ACTIVE_DEDUP_INDEX_NAME);
  });

  it('takes the organization from the input, a null included, else the ambient scope', async () => {
    const queue = createFakeJobQueue({ ambientOrgId: 'org-ambient' });
    const ambient = await queue.enqueue({ type: 'x.run', reason: 'rerun', skipDedup: true });
    const explicit = await queue.enqueue({ type: 'x.run', reason: 'rerun', skipDedup: true, orgId: 'org-1' });
    const system = await queue.enqueue({ type: 'x.run', reason: 'rerun', skipDedup: true, orgId: null });

    expect([ambient.orgId, explicit.orgId, system.orgId]).toEqual(['org-ambient', 'org-1', null]);
  });

  it('claims the lowest priority number first, then the oldest, and leaves a future job alone', async () => {
    let clock = 1_000;
    const queue = createFakeJobQueue({ now: () => new Date(clock++) });
    const order: string[] = [];
    queue.register(handler('x.run', async (job) => void order.push(String((job.payload as { n: number }).n))));
    await queue.enqueue({ type: 'x.run', reason: 'rerun', skipDedup: true, payload: { n: 1 }, priority: 5 });
    await queue.enqueue({ type: 'x.run', reason: 'rerun', skipDedup: true, payload: { n: 2 }, priority: -1 });
    await queue.enqueue({ type: 'x.run', reason: 'rerun', skipDedup: true, payload: { n: 3 }, priority: 5 });
    await queue.enqueue({ type: 'x.run', reason: 'rerun', skipDedup: true, payload: { n: 4 }, scheduledFor: new Date(10_000_000) });

    await queue.drain();

    expect(order).toEqual(['2', '1', '3']);
    expect(queue.jobs({ status: 'pending' }).map((job) => (job.payload as { n: number }).n)).toEqual([4]);
  });

  it('charges attempts at claim time and retries until the type’s profile budget is spent', async () => {
    const queue = createFakeJobQueue();
    let calls = 0;
    queue.register(handler('x.flaky', async () => {
      calls += 1;
      throw new Error(`fail ${calls}`);
    }, { profile: { maxRuntimeMs: 1000, maxAttempts: 2 } }));
    const job = await queue.enqueue({ type: 'x.flaky', reason: 'rerun' });

    const runs = await queue.drain();

    expect(runs.map((run) => run.outcome)).toEqual(['retry', 'failed']);
    expect(queue.get(job.id)).toMatchObject({ status: 'failed', attempts: 2, lastError: 'fail 2' });
    expect(calls).toBe(2);
  });

  it('uses the default budget of three for a type with no profile, and lets the queue override it', async () => {
    const make = (options = {}) => {
      const queue = createFakeJobQueue(options);
      queue.register(handler('x.flaky', async () => Promise.reject(new Error('no'))));
      return queue;
    };
    const standard = make();
    await standard.enqueue({ type: 'x.flaky', reason: 'rerun' });
    const tight = make({ defaultMaxAttempts: 1 });
    await tight.enqueue({ type: 'x.flaky', reason: 'rerun' });

    expect((await standard.drain()).length).toBe(3);
    expect((await tight.drain()).length).toBe(1);
  });

  it('fails a job whose type has no handler, naming the type', async () => {
    const queue = createFakeJobQueue();
    const job = await queue.enqueue({ type: 'x.orphan', reason: 'rerun' });

    await queue.drain();

    expect(queue.get(job.id)).toMatchObject({ status: 'failed', lastError: 'No handler is registered for job type "x.orphan"' });
  });

  it('stops draining at max, so a handler that never settles cannot loop the test forever', async () => {
    const queue = createFakeJobQueue({ defaultMaxAttempts: 1_000 });
    queue.register(handler('x.flaky', async () => Promise.reject(new Error('no'))));
    await queue.enqueue({ type: 'x.flaky', reason: 'rerun' });

    expect(await queue.drain(5)).toHaveLength(5);
  });

  it('records the handler’s label in the real registry', async () => {
    const queue = createFakeJobQueue();
    queue.register(handler('x.labelled', undefined, { label: 'A labelled thing' }));

    expect(queue.registry.get('x.labelled')?.label).toBe('A labelled thing');
  });

  it('decides a delete the way the admin service does: not while running, asking canDelete, refusing on a throw', async () => {
    const queue = createFakeJobQueue();
    queue.register(handler('x.keep', undefined, { canDelete: async (job) => (job.payload as { keep?: boolean }).keep ? 'In use by report 7' : null }));
    queue.register(handler('x.broken', undefined, { canDelete: async () => Promise.reject(new Error('db down')) }));
    const kept = await queue.enqueue({ type: 'x.keep', reason: 'rerun', skipDedup: true, payload: { keep: true } });
    const free = await queue.enqueue({ type: 'x.keep', reason: 'rerun', skipDedup: true, payload: { keep: false } });
    const broken = await queue.enqueue({ type: 'x.broken', reason: 'rerun', skipDedup: true });
    queue.get(free.id)!.status = 'running';

    expect(await queue.deleteJob(free.id)).toEqual({ deleted: false, reason: 'running' });
    queue.get(free.id)!.status = 'succeeded';
    expect(await queue.deleteJob(kept.id)).toEqual({ deleted: false, reason: 'In use by report 7' });
    expect(await queue.deleteJob(broken.id)).toEqual({ deleted: false, reason: 'owner_check_failed' });
    expect(await queue.deleteJob(free.id)).toEqual({ deleted: true, reason: null });
    expect(await queue.deleteJob('nope')).toEqual({ deleted: false, reason: 'not_found' });
    expect(queue.jobs()).toHaveLength(2);
  });

  it('hands a service the JobsService surface it calls', async () => {
    const queue = createFakeJobQueue();
    const service = queue.asJobsService();

    await service.enqueue({ type: 'x.run', reason: 'rerun' });
    await service.recordProvider('id', null, null);

    expect(queue.jobs()).toHaveLength(1);
  });
});

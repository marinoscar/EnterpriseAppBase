// The sharing.grants.prune job (issue #729): retention and dangling grants in
// chunks of system transactions, server-only, registered with the app's
// queue; its cron only enqueues. And the shared_with_you templates. The real
// database version is apps/api/test/sharing/grants-prune.db.spec.ts.

import {
  GRANTS_PRUNE_CHUNK,
  GRANTS_PRUNE_JOB_TYPE,
  GrantsPruneHandler,
  GrantsPruneTask,
  SHARED_WITH_YOU_EVENT,
  renderSharedWithYouEmail,
  resolveSharingModuleOptions,
  sharedWithYouBrowserTemplate,
} from '../../src/sharing/index';
import { ALICE, fakeData, fakeTx, testHost } from './fakes';
import { DOC_A, DOC_B, byUser, docType, withTypes } from './grants-fakes';

const NOW = Date.parse('2026-06-01T00:00:00Z');
const ids = (n: number, prefix = 'r') => Array.from({ length: n }, (_, i) => `${prefix}-${String(i).padStart(4, '0')}`);

function build(retentionDays = 90) {
  const tx = fakeTx();
  const data = fakeData(tx);
  const jobs = { registerHandler: jest.fn(), enqueueHousekeepingJob: jest.fn().mockResolvedValue(undefined) };
  const handler = new GrantsPruneHandler(data, resolveSharingModuleOptions({ host: testHost, grants: { retentionDays } }), jobs, () => NOW);
  return { tx, data, jobs, handler };
}

describe('GrantsPruneHandler', () => {
  it('is the permanent, server-only sharing.grants.prune type and registers with the queue', () => {
    const { handler, jobs } = build();
    expect(handler.type).toBe('sharing.grants.prune');
    expect(GRANTS_PRUNE_JOB_TYPE).toBe('sharing.grants.prune');
    expect('nodeResultSchema' in handler).toBe(false);
    expect('persistNodeResult' in handler).toBe(false);
    handler.onModuleInit();
    expect(jobs.registerHandler).toHaveBeenCalledWith(handler);
  });

  it('deletes grants revoked or expired before the retention cut-off, chunk by chunk, as system work', async () => {
    const { tx, data, handler } = build(30);
    const first = ids(GRANTS_PRUNE_CHUNK).map((id) => ({ id }));
    tx.grant.findMany.mockResolvedValueOnce(first).mockResolvedValueOnce([{ id: 'last' }]);
    tx.grant.deleteMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) => ({ count: where.id.in.length }));
    await withTypes([], async () => {
      const summary = await handler.prune();
      expect(summary).toEqual({ expiredOrRevoked: GRANTS_PRUNE_CHUNK + 1, dangling: {}, chunks: 2 });
    });
    const cutoff = new Date(NOW - 30 * 86_400_000);
    expect(tx.grant.findMany.mock.calls[0]![0]).toEqual({
      where: { OR: [{ revokedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }] },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: GRANTS_PRUNE_CHUNK,
    });
    expect(data.systemReasons.every((reason) => reason === 'retention')).toBe(true);
  });

  it("deletes the grants of records that no longer exist, walking each type's ids by keyset", async () => {
    const { tx, handler } = build();
    const page1 = ids(GRANTS_PRUNE_CHUNK, 'a');
    const def = docType(new Map(page1.filter((_, i) => i % 2 === 0).map((id) => [id, byUser(ALICE)])));
    tx.grant.groupBy.mockResolvedValueOnce(page1.map((resourceId) => ({ resourceId }))).mockResolvedValueOnce([{ resourceId: DOC_A }]);
    tx.grant.deleteMany.mockImplementation(async ({ where }: { where: { resourceId?: { in: string[] } } }) => ({ count: where.resourceId?.in.length ?? 0 }));
    await withTypes([def], async () => {
      const summary = await handler.prune();
      expect(summary.dangling).toEqual({ test_doc: GRANTS_PRUNE_CHUNK / 2 + 1 });
    });
    expect(tx.grant.groupBy.mock.calls[1]![0]).toMatchObject({ by: ['resourceId'], where: { resourceType: 'test_doc', resourceId: { gt: page1[page1.length - 1] } } });
    expect(def.loadOwners).toHaveBeenCalledTimes(2);
    const deleted = tx.grant.deleteMany.mock.calls.map((c) => c[0].where.resourceId.in).flat();
    expect(deleted).toContain(DOC_A);
    expect(deleted).not.toContain(page1[0]);
  });

  it('leaves alone a record that exists, and does nothing when there is nothing due', async () => {
    const { tx, handler } = build();
    tx.grant.groupBy.mockResolvedValueOnce([{ resourceId: DOC_B }]);
    await withTypes([docType(new Map([[DOC_B, byUser(ALICE)]]))], async () => {
      expect(await handler.prune()).toEqual({ expiredOrRevoked: 0, dangling: {}, chunks: 1 });
    });
    expect(tx.grant.deleteMany).not.toHaveBeenCalled();
  });
});

describe('GrantsPruneTask', () => {
  it('only enqueues one global housekeeping job', async () => {
    const jobs = { registerHandler: jest.fn(), enqueueHousekeepingJob: jest.fn().mockResolvedValue(undefined) };
    await new GrantsPruneTask(jobs).handleCron();
    expect(jobs.enqueueHousekeepingJob).toHaveBeenCalledWith({ type: 'sharing.grants.prune', what: 'grants prune', logger: expect.anything() });
  });

  it('does nothing without a jobs port', async () => {
    await expect(new GrantsPruneTask().handleCron()).resolves.toBeUndefined();
  });
});

describe('the sharing.shared_with_you templates', () => {
  it('declares the event on email and browser, on by default', () => {
    expect(SHARED_WITH_YOU_EVENT).toMatchObject({ key: 'sharing.shared_with_you', channels: ['email', 'browser'], defaultEnabled: true });
  });

  it('renders a generic row without describe(), and links only root-relative paths', () => {
    expect(sharedWithYouBrowserTemplate({ resourceType: 'doc', resourceId: DOC_A, role: 'editor' })).toEqual({
      title: 'Something was shared with you',
      body: 'An item was shared with you as an editor.',
      link: '/shared',
    });
    expect(sharedWithYouBrowserTemplate({ resourceType: 'doc', resourceId: DOC_A, role: 'viewer', previousRole: 'editor', title: 'Q3', path: '//evil.example' })).toEqual({
      title: 'Your access changed',
      body: '"Q3": you are now a viewer.',
      link: '/shared',
    });
  });

  it('escapes the title through the kit and keeps it out of the subject', () => {
    const interpolated: unknown[] = [];
    const kit = {
      appName: 'App',
      html: (strings: TemplateStringsArray, ...values: unknown[]) => {
        interpolated.push(...values);
        return { strings: [...strings], values };
      },
      empty: {},
      renderLayout: jest.fn(() => '<html/>'),
      plainText: jest.fn(() => 'text'),
      headers: { 'Auto-Submitted': 'auto-generated' },
    };
    const email = renderSharedWithYouEmail({ resourceType: 'doc', resourceId: DOC_A, role: 'viewer', title: '<b>Q3</b>', sharedBy: 'Ana', openUrl: 'https://app/x' }, kit);
    expect(email.subject).toBe('An item was shared with you on App');
    expect(interpolated).toContain('<b>Q3</b>');
    expect(kit.renderLayout).toHaveBeenCalledWith(expect.objectContaining({ ctaLabel: 'Open', ctaUrl: 'https://app/x' }));
    expect(email.headers).toEqual({ 'Auto-Submitted': 'auto-generated' });
  });
});

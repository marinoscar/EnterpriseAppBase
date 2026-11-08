// =============================================================================
// Real-Postgres test: STATE and COUNTED inbox rows (issue #1077)
// =============================================================================
//
// A mocked client cannot prove the two things the volume guard rests on: that
// the advisory lock serializes concurrent writers, and that the partial unique
// index `notifications_live_dedup_uniq_idx` holds when the lock is bypassed.
// Both are proven here against a migrated database.
//
// THIS IS A `*.db.spec.ts` FILE — skipped with a warning when no Postgres is
// reachable; see `test/jobs/db-test-support.ts`.
// =============================================================================

import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';

import type { Job } from '@marinoscar/platform-api/jobs';
import type { SystemSettingsService } from '@marinoscar/platform-api/settings';

import { NotificationInboxPurgeHandler, NotificationInboxWriter, countedDedupKey, stateDedupKey } from './support/notifications';
import { createDbClient, resolveDbSuite } from '../jobs/db-test-support';

const { describeWithDb } = resolveDbSuite('notification-inbox.db.spec');

const EVENT = 'spec1077.db_event';
const render = (data: Record<string, unknown>) => ({ title: `${String(data['count'])} items`, body: 'b', link: null });

describeWithDb('STATE and COUNTED inbox rows (real Postgres)', () => {
  let client: PrismaClient;
  let writer: NotificationInboxWriter;
  let userId: string;

  const live = (dedupKey: string) => client.notification.findMany({ where: { userId, dedupKey, dismissedAt: null } });
  const all = () => client.notification.findMany({ where: { userId, eventKey: EVENT }, orderBy: { createdAt: 'asc' } });

  beforeAll(async () => {
    client = createDbClient();
    writer = new NotificationInboxWriter(client as never);
    userId = (await client.user.create({ data: { email: `inbox-${randomUUID().slice(0, 8)}@example.com` }, select: { id: true } })).id;
  });

  afterAll(async () => {
    await client.notification.deleteMany({ where: { userId } });
    await client.user.delete({ where: { id: userId } });
    await client.$disconnect();
  });

  afterEach(async () => {
    await client.notification.deleteMany({ where: { userId } });
  });

  const counted = (over: Record<string, unknown> = {}) => ({
    kind: 'counted' as const,
    dedupKey: countedDedupKey(EVENT, null, undefined),
    scopeId: null,
    windowMs: null,
    increment: 1,
    ...over,
  });
  const state = (count: number, scopeId: string | null = null) => ({
    kind: 'state' as const,
    dedupKey: stateDedupKey(EVENT, scopeId),
    scopeId,
    count,
    reunreadWhen: 'count-increased' as const,
  });

  it('100 concurrent COUNTED writes leave one row with count 100', async () => {
    await Promise.all(Array.from({ length: 100 }, () => writer.upsertCounted(userId, EVENT, counted(), {}, render)));

    const rows = await all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.data).toMatchObject({ count: 100 });
    expect(rows[0]!.title).toBe('100 items');
  });

  it('concurrent STATE writes leave one live row holding the last count written under the lock', async () => {
    await Promise.all(Array.from({ length: 30 }, (_v, i) => writer.upsertState(userId, EVENT, state(i + 1), {}, render)));
    expect(await live(stateDedupKey(EVENT, null))).toHaveLength(1);
  });

  it('the database refuses a second live row for one key, but allows it once the first is dismissed or retired', async () => {
    const dedupKey = 'raw:key';
    const base = { userId, eventKey: EVENT, title: 't', body: 'b', dedupKey };
    const first = await client.notification.create({ data: base });

    await expect(client.notification.create({ data: base })).rejects.toMatchObject({ code: 'P2002' });

    await client.notification.update({ where: { id: first.id }, data: { dismissedAt: new Date() } });
    await expect(client.notification.create({ data: base })).resolves.toBeDefined();
  });

  it('plain rows carry no dedup key and never collide', async () => {
    const base = { userId, eventKey: EVENT, title: 't', body: 'b' };
    await client.notification.create({ data: base });
    await expect(client.notification.create({ data: base })).resolves.toBeDefined();
  });

  it('drains a STATE row to dismissed, then starts a fresh one', async () => {
    const first = await writer.upsertState(userId, EVENT, state(4), {}, render);
    expect(await writer.dismissLive(userId, stateDedupKey(EVENT, null))).toBe(true);

    const dismissed = await client.notification.findUniqueOrThrow({ where: { id: first.id } });
    expect(dismissed.dismissedAt).not.toBeNull();
    expect(dismissed.readAt).not.toBeNull();

    const next = await writer.upsertState(userId, EVENT, state(2), {}, render);
    expect(next.id).not.toBe(first.id);
  });

  it('keeps one live STATE row per scope', async () => {
    const a = randomUUID();
    const b = randomUUID();
    await writer.upsertState(userId, EVENT, state(1, a), {}, render);
    await writer.upsertState(userId, EVENT, state(2, b), {}, render);
    await writer.upsertState(userId, EVENT, state(3, a), {}, render);

    const rows = await all();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.scopeId === a)!.data).toMatchObject({ count: 3 });
  });

  it('re-unreads a read STATE row only past countAtRead', async () => {
    const first = await writer.upsertState(userId, EVENT, state(5), {}, render);
    // What the store's markRead writes.
    await client.$executeRaw`UPDATE notifications SET read_at = now(), data = jsonb_set(data, '{countAtRead}', data -> 'count') WHERE id = ${first.id}::uuid`;

    await writer.upsertState(userId, EVENT, state(5), {}, render);
    expect((await client.notification.findUniqueOrThrow({ where: { id: first.id } })).readAt).not.toBeNull();

    await writer.upsertState(userId, EVENT, state(6), {}, render);
    const after = await client.notification.findUniqueOrThrow({ where: { id: first.id } });
    expect(after.readAt).toBeNull();
    expect(after.data).toMatchObject({ count: 6, countAtRead: 5 });
  });

  it('retires a COUNTED row past its window and starts a new one', async () => {
    const first = await writer.upsertCounted(userId, EVENT, counted({ windowMs: 60_000 }), {}, render);
    await client.$executeRaw`UPDATE notifications SET updated_at = now() - interval '2 minutes' WHERE id = ${first.id}::uuid`;

    const second = await writer.upsertCounted(userId, EVENT, counted({ windowMs: 60_000 }), {}, render);
    expect(second.id).not.toBe(first.id);
    expect(second.count).toBe(1);

    const retired = await client.notification.findUniqueOrThrow({ where: { id: first.id } });
    expect(retired.dedupKey).toBe(`retired:${first.id}`);
    expect(retired.dismissedAt).toBeNull();
    expect(await all()).toHaveLength(2);
  });

  it('retention: a plain row ages out by creation, a folded row only once read or dismissed', async () => {
    const old = new Date(Date.now() - 400 * 86_400_000);
    const row = (extra: Record<string, unknown>) =>
      client.notification.create({ data: { userId, eventKey: EVENT, title: 't', body: 'b', createdAt: old, ...extra }, select: { id: true } });

    const plainUnread = await row({});
    const foldedUnread = await row({ dedupKey: 'k:unread', data: { count: 2 } });
    const foldedRead = await row({ dedupKey: 'k:read', data: { count: 2 }, readAt: old });
    const foldedDismissed = await row({ dedupKey: 'k:dismissed', data: { count: 2 }, dismissedAt: old });
    const foldedRetiredUnread = await row({ dedupKey: 'retired:x', data: { count: 2 } });

    const handler = new NotificationInboxPurgeHandler(
      { register: () => undefined } as never,
      client as never,
      { getRetentionPolicy: async () => ({ notifications: { enabled: true, days: 30 } }) } as unknown as SystemSettingsService,
      { register: () => undefined } as never,
    );
    await handler.process({ id: 'job-1077' } as Job);

    const survivors = new Set((await client.notification.findMany({ where: { userId }, select: { id: true } })).map((r) => r.id));
    expect(survivors.has(plainUnread.id)).toBe(false);
    expect(survivors.has(foldedRead.id)).toBe(false);
    expect(survivors.has(foldedDismissed.id)).toBe(false);
    expect(survivors.has(foldedUnread.id)).toBe(true);
    expect(survivors.has(foldedRetiredUnread.id)).toBe(true);
  });
});

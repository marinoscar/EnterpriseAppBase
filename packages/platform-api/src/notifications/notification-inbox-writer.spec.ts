import { NotificationInboxWriter, countedDedupKey, stateDedupKey } from './notification-inbox-writer';
import type { NotificationRow, NotificationsPrisma } from './data/notifications-db';
import type { InboxWrite } from './notification.types';

// STATE and COUNTED inbox writes (issue #1077) against an in-memory fake of the
// slice's client: a Map of rows keyed by id, a recorded `$executeRaw` log, and
// a `$transaction` that serializes callers the way the advisory lock does.
// What the fake cannot prove (the lock, the partial unique index) is proven
// against Postgres in apps/api/test/notifications/notification-inbox.db.spec.ts.

const USER = '11111111-1111-4111-8111-111111111111';
const EVENT = 'review.queue_pending';

const state = (count: number, over: Partial<Extract<InboxWrite, { kind: 'state' }>> = {}): Extract<InboxWrite, { kind: 'state' }> => ({
  kind: 'state',
  dedupKey: stateDedupKey(EVENT, null),
  scopeId: null,
  count,
  reunreadWhen: 'count-increased',
  ...over,
});

const counted = (over: Partial<Extract<InboxWrite, { kind: 'counted' }>> = {}): Extract<InboxWrite, { kind: 'counted' }> => ({
  kind: 'counted',
  dedupKey: countedDedupKey(EVENT, null, undefined),
  scopeId: null,
  windowMs: null,
  increment: 1,
  ...over,
});

const render = (data: Record<string, unknown>) => ({ title: `${String(data['count'])} items`, body: 'b', link: null });

function fakePrisma(options: { failFirstCreateWithUnique?: boolean } = {}) {
  const rows = new Map<string, NotificationRow>();
  const raw: string[] = [];
  let seq = 0;
  let queue: Promise<unknown> = Promise.resolve();
  let uniqueFailuresLeft = options.failFirstCreateWithUnique ? 1 : 0;

  const live = (where: { userId: string; dedupKey: string }) =>
    [...rows.values()].find((r) => r.userId === where.userId && r.dedupKey === where.dedupKey && r.dismissedAt === null) ?? null;

  const tx = {
    notification: {
      findFirst: async ({ where }: { where: { userId: string; dedupKey: string } }) => live(where),
      create: async ({ data }: { data: Partial<NotificationRow> }) => {
        if (uniqueFailuresLeft > 0) {
          uniqueFailuresLeft -= 1;
          // The loser of a race: the winner's row appears, the insert violates the index.
          rows.set('winner', {
            id: 'winner', userId: data.userId!, eventKey: EVENT, title: 't', body: 'b', link: null, readAt: null,
            createdAt: new Date(), updatedAt: new Date(), data: { count: 1 }, scopeId: null, dismissedAt: null, dedupKey: data.dedupKey!,
          });
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        }
        const id = `row-${++seq}`;
        const row = { readAt: null, dismissedAt: null, link: null, scopeId: null, createdAt: new Date(), updatedAt: new Date(), ...data, id } as NotificationRow;
        rows.set(id, row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<NotificationRow> }) => {
        const row = { ...rows.get(where.id)!, ...data, updatedAt: new Date() };
        rows.set(where.id, row);
        return row;
      },
    },
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?').replace(/\s+/g, ' ').trim();
      raw.push(sql);
      if (sql.startsWith('UPDATE notifications SET dedup_key')) {
        const row = rows.get(String(values[1]))!;
        rows.set(row.id, { ...row, dedupKey: String(values[0]) });
        return 1;
      }
      if (sql.startsWith('UPDATE notifications SET dismissed_at')) {
        const row = live({ userId: String(values[0]), dedupKey: String(values[1]) });
        if (!row) return 0;
        rows.set(row.id, { ...row, dismissedAt: new Date(), readAt: row.readAt ?? new Date() });
        return 1;
      }
      return 0;
    },
  };

  const prisma = {
    ...tx,
    $transaction: <T>(fn: (t: typeof tx) => Promise<T>) => {
      const run = queue.then(() => fn(tx));
      queue = run.catch(() => undefined);
      return run;
    },
  } as unknown as NotificationsPrisma;

  return { prisma, rows, raw };
}

describe('dedup keys', () => {
  it('a state key is per event and scope', () => {
    expect(stateDedupKey(EVENT, null)).not.toBe(stateDedupKey(EVENT, 'a'));
    expect(stateDedupKey(EVENT, 'a')).toBe(stateDedupKey(EVENT, 'a'));
  });

  it('a counted key ignores match key order and separates different matches', () => {
    expect(countedDedupKey(EVENT, null, { a: 1, b: 'x' })).toBe(countedDedupKey(EVENT, null, { b: 'x', a: 1 }));
    expect(countedDedupKey(EVENT, null, { a: 1 })).not.toBe(countedDedupKey(EVENT, null, { a: 2 }));
    expect(countedDedupKey(EVENT, null, undefined)).not.toBe(stateDedupKey(EVENT, null));
  });

  it('hashes a key over the cap', () => {
    const key = countedDedupKey(EVENT, null, { v: 'x'.repeat(500) });
    expect(key.length).toBeLessThanOrEqual(200);
    expect(key).toBe(countedDedupKey(EVENT, null, { v: 'x'.repeat(500) }));
  });
});

describe('NotificationInboxWriter.upsertState', () => {
  it('creates one row, then refreshes it in place', async () => {
    const { prisma, rows } = fakePrisma();
    const writer = new NotificationInboxWriter(prisma);

    const first = await writer.upsertState(USER, EVENT, state(5), {}, render);
    const second = await writer.upsertState(USER, EVENT, state(9), {}, render);

    expect(first.reason).toBe('created');
    expect(rows.size).toBe(1);
    expect(second.id).toBe(first.id);
    expect(rows.get(first.id)!.title).toBe('9 items');
    expect(rows.get(first.id)!.data).toEqual({ count: 9 });
  });

  it('takes the advisory lock before reading', async () => {
    const { prisma, raw } = fakePrisma();
    await new NotificationInboxWriter(prisma).upsertState(USER, EVENT, state(1), {}, render);
    expect(raw[0]).toContain('pg_advisory_xact_lock(hashtext(');
  });

  it('keeps one row per scope', async () => {
    const { prisma, rows } = fakePrisma();
    const writer = new NotificationInboxWriter(prisma);
    await writer.upsertState(USER, EVENT, state(1, { dedupKey: stateDedupKey(EVENT, 'a'), scopeId: 'a' }), {}, render);
    await writer.upsertState(USER, EVENT, state(1, { dedupKey: stateDedupKey(EVENT, 'b'), scopeId: 'b' }), {}, render);
    expect(rows.size).toBe(2);
  });

  describe('re-unread rule', () => {
    const seed = async (countAtRead: number | undefined, count = 5) => {
      const fake = fakePrisma();
      const writer = new NotificationInboxWriter(fake.prisma);
      const first = await writer.upsertState(USER, EVENT, state(count), {}, render);
      const row = fake.rows.get(first.id)!;
      fake.rows.set(first.id, {
        ...row,
        readAt: new Date(),
        data: { count, ...(countAtRead === undefined ? {} : { countAtRead }) },
      });
      return { ...fake, writer, id: first.id };
    };

    it('re-marks a read row unread only when the count grew past countAtRead', async () => {
      const { writer, rows, id } = await seed(5);
      const out = await writer.upsertState(USER, EVENT, state(6), {}, render);
      expect(out.reason).toBe('reunread');
      expect(out.quiet).toBe(false);
      expect(rows.get(id)!.readAt).toBeNull();
    });

    it('carries countAtRead forward through a refresh', async () => {
      const { writer, rows, id } = await seed(5);
      await writer.upsertState(USER, EVENT, state(6), {}, render);
      expect((rows.get(id)!.data as Record<string, unknown>)['countAtRead']).toBe(5);
    });

    it.each([
      ['an equal count', 5, 5],
      ['a decrease', 5, 3],
    ])('leaves a read row read on %s', async (_label, countAtRead, next) => {
      const { writer, rows, id } = await seed(countAtRead);
      const out = await writer.upsertState(USER, EVENT, state(next), {}, render);
      expect(rows.get(id)!.readAt).not.toBeNull();
      expect(out.quiet).toBe(true);
    });

    it('never re-unreads a read row with no countAtRead', async () => {
      const { writer, rows, id } = await seed(undefined);
      await writer.upsertState(USER, EVENT, state(50), {}, render);
      expect(rows.get(id)!.readAt).not.toBeNull();
    });

    it('never re-unreads when reunreadWhen is never', async () => {
      const { writer, rows, id } = await seed(5);
      await writer.upsertState(USER, EVENT, state(50, { reunreadWhen: 'never' }), {}, render);
      expect(rows.get(id)!.readAt).not.toBeNull();
    });
  });

  it('an unread row that grew is news (incremented), an unchanged one is quiet', async () => {
    const { prisma } = fakePrisma();
    const writer = new NotificationInboxWriter(prisma);
    await writer.upsertState(USER, EVENT, state(5), {}, render);
    expect((await writer.upsertState(USER, EVENT, state(7), {}, render)).quiet).toBe(false);
    expect((await writer.upsertState(USER, EVENT, state(7), {}, render)).quiet).toBe(true);
  });

  it('folds into the winner after a unique violation', async () => {
    const { prisma, rows } = fakePrisma({ failFirstCreateWithUnique: true });
    const out = await new NotificationInboxWriter(prisma).upsertState(USER, EVENT, state(4), {}, render);
    expect(out.id).toBe('winner');
    expect(rows.size).toBe(1);
  });

  it('writes nothing when the template throws', async () => {
    const { prisma, rows } = fakePrisma();
    await expect(
      new NotificationInboxWriter(prisma).upsertState(USER, EVENT, state(1), {}, () => {
        throw new Error('bad template');
      }),
    ).rejects.toThrow('bad template');
    expect(rows.size).toBe(0);
  });
});

describe('NotificationInboxWriter.dismissLive', () => {
  it('dismisses the live row (implying read) and reports whether it did', async () => {
    const { prisma, rows } = fakePrisma();
    const writer = new NotificationInboxWriter(prisma);
    const created = await writer.upsertState(USER, EVENT, state(3), {}, render);

    expect(await writer.dismissLive(USER, stateDedupKey(EVENT, null))).toBe(true);
    const row = rows.get(created.id)!;
    expect(row.dismissedAt).not.toBeNull();
    expect(row.readAt).not.toBeNull();
    expect(await writer.dismissLive(USER, stateDedupKey(EVENT, null))).toBe(false);
  });

  it('a later positive count starts a fresh row', async () => {
    const { prisma, rows } = fakePrisma();
    const writer = new NotificationInboxWriter(prisma);
    await writer.upsertState(USER, EVENT, state(3), {}, render);
    await writer.dismissLive(USER, stateDedupKey(EVENT, null));
    const again = await writer.upsertState(USER, EVENT, state(2), {}, render);
    expect(again.reason).toBe('created');
    expect(rows.size).toBe(2);
  });
});

describe('NotificationInboxWriter.upsertCounted', () => {
  it('folds occurrences into one row whose count grows', async () => {
    const { prisma, rows } = fakePrisma();
    const writer = new NotificationInboxWriter(prisma);
    await Promise.all(Array.from({ length: 100 }, () => writer.upsertCounted(USER, EVENT, counted(), { who: 'u' }, render)));
    expect(rows.size).toBe(1);
    expect([...rows.values()][0]!.data).toEqual({ who: 'u', count: 100 });
    expect([...rows.values()][0]!.title).toBe('100 items');
  });

  it('adds the increment', async () => {
    const { prisma, rows } = fakePrisma();
    const writer = new NotificationInboxWriter(prisma);
    await writer.upsertCounted(USER, EVENT, counted({ increment: 3 }), {}, render);
    await writer.upsertCounted(USER, EVENT, counted({ increment: 4 }), {}, render);
    expect((rows.values().next().value as NotificationRow).data).toEqual({ count: 7 });
  });

  it('clears readAt on increment and reports reunread', async () => {
    const { prisma, rows } = fakePrisma();
    const writer = new NotificationInboxWriter(prisma);
    const first = await writer.upsertCounted(USER, EVENT, counted(), {}, render);
    rows.set(first.id, { ...rows.get(first.id)!, readAt: new Date() });
    const out = await writer.upsertCounted(USER, EVENT, counted(), {}, render);
    expect(out.reason).toBe('reunread');
    expect(rows.get(first.id)!.readAt).toBeNull();
    expect((await writer.upsertCounted(USER, EVENT, counted(), {}, render)).reason).toBe('incremented');
  });

  it('starts a new row once the window has closed, retiring the old one', async () => {
    const { prisma, rows } = fakePrisma();
    const writer = new NotificationInboxWriter(prisma);
    const t0 = new Date('2026-01-01T00:00:00Z');
    const first = await writer.upsertCounted(USER, EVENT, counted({ windowMs: 60_000 }), {}, render, t0);
    rows.set(first.id, { ...rows.get(first.id)!, updatedAt: t0 });

    const inside = await writer.upsertCounted(USER, EVENT, counted({ windowMs: 60_000 }), {}, render, new Date(t0.getTime() + 30_000));
    expect(inside.id).toBe(first.id);
    rows.set(first.id, { ...rows.get(first.id)!, updatedAt: new Date(t0.getTime() + 30_000) });

    // The window is anchored on the last update, so a steady stream keeps extending it.
    const stillInside = await writer.upsertCounted(USER, EVENT, counted({ windowMs: 60_000 }), {}, render, new Date(t0.getTime() + 85_000));
    expect(stillInside.id).toBe(first.id);
    rows.set(first.id, { ...rows.get(first.id)!, updatedAt: new Date(t0.getTime() + 85_000) });

    const after = await writer.upsertCounted(USER, EVENT, counted({ windowMs: 60_000 }), {}, render, new Date(t0.getTime() + 200_000));
    expect(after.id).not.toBe(first.id);
    expect(after.count).toBe(1);
    expect(rows.get(first.id)!.dedupKey).toBe(`retired:${first.id}`);
    expect(rows.get(first.id)!.dismissedAt).toBeNull();
  });

  it('keeps separate rows for different match objects', async () => {
    const { prisma, rows } = fakePrisma();
    const writer = new NotificationInboxWriter(prisma);
    await writer.upsertCounted(USER, EVENT, counted({ dedupKey: countedDedupKey(EVENT, null, { t: 'a' }) }), {}, render);
    await writer.upsertCounted(USER, EVENT, counted({ dedupKey: countedDedupKey(EVENT, null, { t: 'b' }) }), {}, render);
    expect(rows.size).toBe(2);
  });
});

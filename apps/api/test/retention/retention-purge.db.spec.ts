// =============================================================================
// Real-Postgres test: the four retention purges (#681, PP-1.10)
// =============================================================================
//
// A mocked Prisma proves which `where` a handler builds; only a real server
// proves which rows that `where` actually removes. Rows are seeded on both
// sides of the cutoff in all four tables — including `queued` deliveries and
// `pending`/`running` AI runs older than the cutoff, which must survive — then
// each handler runs and the survivors are asserted.
//
// Fixtures are scoped to ids and markers unique to this run, and assertions
// only look at those, so the suite neither depends on nor is confused by other
// data. (The purges themselves are global by design and may also delete other
// old rows in the test database; that is the behaviour under test.)
//
// THIS IS A `*.db.spec.ts` FILE — skipped with a warning when no Postgres is
// reachable; see `test/jobs/db-test-support.ts`.
// =============================================================================

import { randomUUID } from 'node:crypto';

import type { Job, PrismaClient } from '@prisma/client';

import { AiRunsPurgeHandler } from '../../src/ai/runtime/ai-runs-purge.handler';
import { AuditEventsPurgeHandler } from '../../src/common/retention/audit-events-purge.handler';
import { purgeInBatches, retentionCutoff } from '../../src/common/retention/batched-purge';
import type { SystemRetentionValue } from '../../src/common/schemas/settings.schema';
import { NotificationDeliveriesPurgeHandler } from '../../src/notifications/retention/notification-deliveries-purge.handler';
import { NotificationInboxPurgeHandler } from '../../src/notifications/retention/notification-inbox-purge.handler';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { SystemSettingsService } from '@marinoscar/platform-api/settings';
import { createDbClient, createDbServices, defaultOrgId, resolveDbSuite } from '../jobs/db-test-support';

const { describeWithDb } = resolveDbSuite('retention-purge.db.spec');

const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS = 30;
const JOB = { id: 'job-retention-db-spec' } as Job;

/** A day either side of the cutoff, so the test cannot race the clock. */
const OLD = () => new Date(Date.now() - (DAYS + 1) * DAY_MS);
const NEW = () => new Date(Date.now() - (DAYS - 1) * DAY_MS);

describeWithDb('retention purges (real Postgres)', () => {
  let client: PrismaClient;
  let user: { id: string };
  let services: ReturnType<typeof createDbServices>;
  let orgId: string;
  const marker = `retention-${randomUUID().slice(0, 8)}`;
  let policy: SystemRetentionValue;

  const settings = {
    getRetentionPolicy: async () => structuredClone(policy),
  } as unknown as SystemSettingsService;
  const registry = { register: () => undefined } as never;

  const allEnabled = (): SystemRetentionValue => ({
    notifications: { enabled: true, days: DAYS },
    notificationDeliveries: { enabled: true, days: DAYS },
    auditEvents: { enabled: true, days: DAYS },
    aiRuns: { enabled: true, days: DAYS },
  });

  beforeAll(async () => {
    client = createDbClient();
    services = createDbServices();
    orgId = await defaultOrgId(client);
    user = await client.user.create({
      data: { email: `${marker}@example.com` },
      select: { id: true },
    });
  });

  afterAll(async () => {
    await client.notification.deleteMany({ where: { eventKey: marker } });
    await client.notificationDelivery.deleteMany({ where: { eventKey: marker } });
    await client.auditEvent.deleteMany({ where: { action: marker } });
    await client.aiRun.deleteMany({ where: { provider: marker } });
    await client.user.deleteMany({ where: { id: user.id } });
    await services.close();
    await client.$disconnect();
  });

  beforeEach(() => {
    policy = allEnabled();
  });

  const prisma = () => client as unknown as PrismaService;

  describe('notifications.inbox.purge', () => {
    it('deletes inbox rows older than the cutoff, read or unread, and keeps newer ones', async () => {
      const base = { userId: user.id, eventKey: marker, title: 't', body: 'b' };
      const oldUnread = await client.notification.create({ data: { ...base, createdAt: OLD() } });
      const oldRead = await client.notification.create({
        data: { ...base, createdAt: OLD(), readAt: OLD() },
      });
      const recent = await client.notification.create({ data: { ...base, createdAt: NEW() } });

      await new NotificationInboxPurgeHandler(registry, prisma(), settings).process(JOB);

      const left = await client.notification.findMany({ where: { eventKey: marker }, select: { id: true } });
      expect(left.map((row) => row.id)).toEqual([recent.id]);
      expect(left.map((row) => row.id)).not.toContain(oldUnread.id);
      expect(left.map((row) => row.id)).not.toContain(oldRead.id);
    });

    it('deletes nothing while the policy is disabled', async () => {
      const old = await client.notification.create({
        data: { userId: user.id, eventKey: marker, title: 't', body: 'b', createdAt: OLD() },
      });
      policy.notifications.enabled = false;

      await new NotificationInboxPurgeHandler(registry, prisma(), settings).process(JOB);

      await expect(client.notification.findUnique({ where: { id: old.id } })).resolves.not.toBeNull();
      await client.notification.delete({ where: { id: old.id } });
    });
  });

  describe('notifications.deliveries.purge', () => {
    it('deletes settled deliveries older than the cutoff and never a queued one', async () => {
      const base = { eventKey: marker, userId: user.id, recipient: 'r@example.com', channel: 'email' };
      const rows = await Promise.all(
        [
          ['oldSent', 'sent', OLD()],
          ['oldFailed', 'failed', OLD()],
          ['oldQueued', 'queued', OLD()],
          ['newSent', 'sent', NEW()],
          ['newQueued', 'queued', NEW()],
        ].map(async ([name, status, createdAt]) => {
          const row = await client.notificationDelivery.create({
            data: { ...base, status: status as 'sent' | 'failed' | 'queued', createdAt: createdAt as Date },
          });

          return [name as string, row.id] as const;
        }),
      );
      const id = Object.fromEntries(rows);

      await new NotificationDeliveriesPurgeHandler(registry, prisma(), settings).process(JOB);

      const left = await client.notificationDelivery.findMany({
        where: { eventKey: marker },
        select: { id: true },
      });
      expect(left.map((row) => row.id).sort()).toEqual([id.oldQueued, id.newSent, id.newQueued].sort());
    });
  });

  describe('audit.events.purge', () => {
    it('deletes audit events older than the cutoff and keeps newer ones', async () => {
      const base = { action: marker, targetType: 'retention-test', targetId: marker };
      await client.auditEvent.create({ data: { ...base, createdAt: OLD() } });
      const recent = await client.auditEvent.create({ data: { ...base, createdAt: NEW() } });

      await new AuditEventsPurgeHandler(registry, prisma(), settings).process(JOB);

      const left = await client.auditEvent.findMany({ where: { action: marker }, select: { id: true } });
      expect(left.map((row) => row.id)).toEqual([recent.id]);
    });

    it('deletes nothing under the shipped default (audit retention off)', async () => {
      const old = await client.auditEvent.create({
        data: { action: marker, targetType: 'retention-test', targetId: marker, createdAt: OLD() },
      });
      policy.auditEvents = { enabled: false, days: 365 };

      await new AuditEventsPurgeHandler(registry, prisma(), settings).process(JOB);

      await expect(client.auditEvent.findUnique({ where: { id: old.id } })).resolves.not.toBeNull();
      await client.auditEvent.delete({ where: { id: old.id } });
    });
  });

  describe('ai.runs.purge', () => {
    it('deletes terminal runs older than the cutoff and never a pending or running one', async () => {
      const base = { orgId, userId: user.id, provider: marker, modelId: 'm', request: { input: 'secret prompt' } };
      const rows = await Promise.all(
        [
          ['oldSucceeded', 'succeeded', OLD()],
          ['oldFailed', 'failed', OLD()],
          ['oldCancelled', 'cancelled', OLD()],
          ['oldPending', 'pending', OLD()],
          ['oldRunning', 'running', OLD()],
          ['newSucceeded', 'succeeded', NEW()],
        ].map(async ([name, status, createdAt]) => {
          const row = await client.aiRun.create({
            data: { ...base, status: status as string, createdAt: createdAt as Date },
          });

          return [name as string, row.id] as const;
        }),
      );
      const id = Object.fromEntries(rows);

      await new AiRunsPurgeHandler(registry, services.system, settings).process(JOB);

      const left = await client.aiRun.findMany({ where: { provider: marker }, select: { id: true } });
      expect(left.map((row) => row.id).sort()).toEqual(
        [id.oldPending, id.oldRunning, id.newSucceeded].sort(),
      );
    });
  });

  describe('batching against a real table', () => {
    it('reads oldest first, stops at the safety limit, and the next run continues', async () => {
      const base = { action: `${marker}-batch`, targetType: 'retention-test', targetId: marker };
      const created: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        // Strictly increasing ages: oldest first means this insertion order.
        const row = await client.auditEvent.create({
          data: { ...base, createdAt: new Date(Date.now() - (DAYS + 10 - i) * DAY_MS) },
        });
        created.push(row.id);
      }

      const cutoff = retentionCutoff(DAYS);
      const deletedOrder: string[] = [];
      const run = () =>
        purgeInBatches({
          selectIds: async (take) =>
            (
              await client.auditEvent.findMany({
                where: { action: base.action, createdAt: { lt: cutoff } },
                select: { id: true },
                orderBy: { createdAt: 'asc' },
                take,
              })
            ).map((row) => row.id),
          deleteIds: async (ids) => {
            deletedOrder.push(...ids);

            return (await client.auditEvent.deleteMany({ where: { id: { in: ids } } })).count;
          },
          batchSize: 2,
          maxBatches: 1,
        });

      await expect(run()).resolves.toEqual({ deleted: 2, batches: 1, hitSafetyStop: true });
      expect(deletedOrder).toEqual(created.slice(0, 2));

      await expect(run()).resolves.toEqual({ deleted: 2, batches: 1, hitSafetyStop: true });
      await expect(run()).resolves.toEqual({ deleted: 1, batches: 1, hitSafetyStop: false });
      expect(deletedOrder).toEqual(created);
      await expect(client.auditEvent.count({ where: { action: base.action } })).resolves.toBe(0);
    });
  });
});

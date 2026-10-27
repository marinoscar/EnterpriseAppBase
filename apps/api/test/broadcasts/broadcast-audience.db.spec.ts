// =============================================================================
// Org-targeted broadcast audience against real Postgres (issue #738)
// =============================================================================
//
// Two organizations. A broadcast with `targetOrgId` reaches exactly the ACTIVE
// users holding an ACTIVE membership of that organization, across more than
// one chunk (`BROADCAST_CHUNK_SIZE`); one without it reaches every active user,
// as before. The start handler's frozen count and the chunks' keyset paging
// use the same `audienceWhere(cutoff, targetOrgId)`, so `recipientsTargeted`
// equals what was dispatched.
// =============================================================================

import type { ConfigService } from '@nestjs/config';
import type { Job, PrismaClient } from '@prisma/client';
import { JobHandlerRegistry, JobsService, ProviderThrottleService } from '@marinoscar/platform-api/jobs';

import {
  BROADCAST_CHUNK_SIZE,
  BROADCAST_CHUNK_TYPE,
  BROADCAST_START_TYPE,
  BROADCAST_SUBJECT_TYPE,
  BroadcastChunkHandler,
  BroadcastStartHandler,
  type NotificationsService,
  type NotifyOptions,
} from '../notifications/support/notifications';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { createDbClient, resolveDbSuite } from '../jobs/db-test-support';

const { describeWithDb } = resolveDbSuite('broadcast-audience.db.spec');

const PREFIX = `test.broadcast-audience.${process.pid}.`;
let counter = 0;
const nextEmail = (label: string) => `${PREFIX}${label}-${(counter += 1)}@example.test`;

describeWithDb('Org-targeted broadcast audience (real Postgres, #738)', () => {
  let client: PrismaClient;
  let jobs: JobsService;
  let viewerRoleId: string;
  let orgA: string;
  let orgB: string;
  const broadcastIds: string[] = [];
  const dispatched: Array<{ userId: string; options?: NotifyOptions }> = [];

  const notifications = {
    notify: jest.fn(),
    notifyNow: jest.fn(async (_eventKey: string, userId: string, _data: unknown, options?: NotifyOptions) => {
      dispatched.push({ userId, options });
      return { rateLimited: false, retryAfterMs: null };
    }),
  } as unknown as NotificationsService;

  function handlers() {
    const prisma = client as unknown as PrismaService;
    const registry = { register: jest.fn() } as unknown as JobHandlerRegistry;
    return {
      start: new BroadcastStartHandler(prisma, jobs, registry),
      chunk: new BroadcastChunkHandler(
        prisma,
        notifications,
        jobs,
        { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService,
        registry,
        { registerProviderKey: jest.fn() } as unknown as ProviderThrottleService,
      ),
    };
  }

  async function members(orgId: string | null, count: number, label: string, opts: { isActive?: boolean; status?: 'active' | 'suspended' } = {}) {
    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const user = await client.user.create({ data: { email: nextEmail(label), isActive: opts.isActive ?? true }, select: { id: true } });
      if (orgId) {
        await client.membership.create({ data: { orgId, userId: user.id, roleId: viewerRoleId, status: opts.status ?? 'active' } });
      }
      ids.push(user.id);
    }
    return ids;
  }

  async function send(targetOrgId: string | null): Promise<{ targeted: number | null; recipients: string[]; orgIds: Array<string | undefined> }> {
    dispatched.length = 0;
    const broadcast = await client.notificationBroadcast.create({
      data: {
        title: 'Hello',
        body: 'World',
        eventKey: 'admin.broadcast',
        channels: ['browser'],
        status: 'scheduled',
        ...(targetOrgId ? { targetOrgId } : {}),
      },
    });
    broadcastIds.push(broadcast.id);
    const { start, chunk } = handlers();
    await start.process({ id: `start-${broadcast.id}`, type: BROADCAST_START_TYPE, subjectType: BROADCAST_SUBJECT_TYPE, subjectId: broadcast.id } as Job);
    for (let guard = 0; guard < 20; guard += 1) {
      const job = await client.job.findFirst({
        where: { type: BROADCAST_CHUNK_TYPE, subjectId: broadcast.id, status: 'pending' },
        orderBy: { createdAt: 'asc' },
      });
      if (!job) break;
      await chunk.process(job);
      await client.job.update({ where: { id: job.id }, data: { status: 'succeeded' } });
    }
    const row = await client.notificationBroadcast.findUniqueOrThrow({ where: { id: broadcast.id } });
    return {
      targeted: row.recipientsTargeted,
      recipients: dispatched.map((call) => call.userId),
      orgIds: dispatched.map((call) => call.options?.orgId ?? undefined),
    };
  }

  let aActive: string[];
  let aSuspended: string[];
  let aInactive: string[];
  let bActive: string[];
  let noMembership: string[];

  beforeAll(async () => {
    client = createDbClient();
    await client.$connect();
    jobs = new JobsService(client as unknown as PrismaService);
    viewerRoleId = (await client.role.findUniqueOrThrow({ where: { name: 'viewer' } })).id;
    orgA = (await client.organization.create({ data: { name: `${PREFIX}a`, slug: `bc-aud-a-${process.pid}-${Date.now()}` } })).id;
    orgB = (await client.organization.create({ data: { name: `${PREFIX}b`, slug: `bc-aud-b-${process.pid}-${Date.now()}` } })).id;

    // More active members of A than one chunk holds, so the fan-out pages.
    aActive = await members(orgA, BROADCAST_CHUNK_SIZE + 5, 'a');
    aSuspended = await members(orgA, 2, 'a-suspended', { status: 'suspended' });
    aInactive = await members(orgA, 2, 'a-inactive', { isActive: false });
    bActive = await members(orgB, 3, 'b');
    noMembership = await members(null, 2, 'none');
  }, 120_000);

  afterAll(async () => {
    await client.job.deleteMany({ where: { subjectId: { in: broadcastIds } } }).catch(() => undefined);
    await client.notificationBroadcast.deleteMany({ where: { id: { in: broadcastIds } } }).catch(() => undefined);
    await client.user.deleteMany({ where: { email: { startsWith: PREFIX } } }).catch(() => undefined);
    await client.organization.deleteMany({ where: { id: { in: [orgA, orgB].filter(Boolean) } } }).catch(() => undefined);
    await client.$disconnect();
  });

  it("reaches exactly organization A's active members, across chunks, under A's policy", async () => {
    const result = await send(orgA);

    expect(new Set(result.recipients)).toEqual(new Set(aActive));
    expect(result.recipients).toHaveLength(aActive.length);
    expect(result.targeted).toBe(aActive.length);
    for (const excluded of [...aSuspended, ...aInactive, ...bActive, ...noMembership]) {
      expect(result.recipients).not.toContain(excluded);
    }
    expect(new Set(result.orgIds)).toEqual(new Set([orgA]));
  }, 120_000);

  it('reaches every active user without a target, as before', async () => {
    const result = await send(null);
    const reached = new Set(result.recipients);

    for (const included of [...aActive, ...aSuspended, ...bActive, ...noMembership]) expect(reached.has(included)).toBe(true);
    for (const excluded of aInactive) expect(reached.has(excluded)).toBe(false);
    expect(result.targeted).toBe(result.recipients.length);
    // A system broadcast leaves each recipient's own organization in charge.
    expect(result.orgIds.every((orgId) => orgId === undefined)).toBe(true);
  }, 120_000);

  it('deletes an organization\'s broadcasts with it (ON DELETE CASCADE)', async () => {
    const org = await client.organization.create({ data: { name: `${PREFIX}c`, slug: `bc-aud-c-${process.pid}-${Date.now()}` } });
    const broadcast = await client.notificationBroadcast.create({
      data: { title: 't', body: 'b', eventKey: 'admin.broadcast', channels: ['browser'], status: 'scheduled', targetOrgId: org.id },
    });
    await client.organization.delete({ where: { id: org.id } });
    await expect(client.notificationBroadcast.findUnique({ where: { id: broadcast.id } })).resolves.toBeNull();
  });
});

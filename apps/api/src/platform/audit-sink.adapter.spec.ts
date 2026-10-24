import { PrismaAuditSink } from './audit-sink.adapter';
import type { PrismaService } from '../prisma/prisma.service';

describe('PrismaAuditSink (AUDIT_SINK adapter)', () => {
  function setup() {
    const create = jest.fn().mockResolvedValue({ id: 'evt-1' });
    const prisma = { auditEvent: { create } } as unknown as PrismaService;
    return { sink: new PrismaAuditSink(prisma), create };
  }

  it('writes the same audit_events columns the app writes', async () => {
    const { sink, create } = setup();

    await sink.record({
      action: 'settings.updated',
      actorUserId: 'user-1',
      targetType: 'system_settings',
      targetId: 'row-1',
      meta: { namespace: 'jobs', changed: 2, dryRun: false, note: null },
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        actorUserId: 'user-1',
        action: 'settings.updated',
        targetType: 'system_settings',
        targetId: 'row-1',
        meta: { namespace: 'jobs', changed: 2, dryRun: false, note: null },
      },
    });
  });

  it('records a system event (no actor) and omits meta when none is given', async () => {
    const { sink, create } = setup();

    await sink.record({ action: 'jobs.purged', actorUserId: null, targetType: 'jobs', targetId: '*' });

    expect(create).toHaveBeenCalledWith({
      data: { actorUserId: null, action: 'jobs.purged', targetType: 'jobs', targetId: '*' },
    });
  });

  it('propagates a failed write', async () => {
    const { sink, create } = setup();
    create.mockRejectedValueOnce(new Error('connection lost'));

    await expect(
      sink.record({ action: 'a.b', actorUserId: null, targetType: 't', targetId: '1' }),
    ).rejects.toThrow('connection lost');
  });
});

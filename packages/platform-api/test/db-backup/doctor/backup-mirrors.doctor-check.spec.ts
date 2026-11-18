import { DoctorCheckRegistry } from '../../../src/doctor/index';
import type { DbBackupPrisma as PrismaService } from '../../../src/db-backup/data/db-backup-db';
import type { BackupTarget } from '../../../src/db-backup/backup-target';
import { MIRROR_AUDIT_COMPLETED, MIRROR_AUDIT_FAILED } from '../../../src/db-backup/db-backup.constants';
import {
  BackupMirrorsDoctorCheck,
  decideBackupMirrors,
  type MirrorFact,
} from '../../../src/db-backup/doctor/backup-mirrors.doctor-check';

const at = new Date('2026-09-30T02:10:00Z');
const fact = (targetId: string, status: MirrorFact['status'], error: string | null = null): MirrorFact => ({
  targetId,
  status,
  at: status === null ? null : at,
  error,
});

describe('backup.mirrors', () => {
  describe('decideBackupMirrors', () => {
    it('passes when no mirror is configured', () => {
      expect(decideBackupMirrors([])).toMatchObject({ status: 'pass', data: { mirrors: 0 } });
    });

    it('passes when every mirror\'s latest copy landed', () => {
      expect(decideBackupMirrors([fact('local-dir', 'ok'), fact('cold', 'ok')])).toMatchObject({
        status: 'pass',
        data: { mirrors: 2, failing: 0 },
      });
    });

    it('warns, never fails, when a mirror\'s latest copy failed, naming it and carrying a bounded error', () => {
      const outcome = decideBackupMirrors([fact('local-dir', 'ok'), fact('cold', 'failed', 'x'.repeat(500))]);

      expect(outcome.status).toBe('warn');
      expect(outcome.detail).toContain('"cold"');
      expect(outcome.detail).not.toContain('"local-dir"');
      expect(outcome.detail).toContain('primary backup is fine');
      expect(outcome.remedy).toEqual(expect.stringMatching(/\S{10,}/));
      expect(outcome.error).toHaveLength(300);
      expect(outcome.data).toMatchObject({ failing: 1 });
    });

    it('warns when a configured mirror has never received a copy', () => {
      const outcome = decideBackupMirrors([fact('cold', null)]);

      expect(outcome.status).toBe('warn');
      expect(outcome.detail).toContain('No copy to "cold"');
      expect(outcome.data).toMatchObject({ awaitingFirstCopy: 1 });
    });
  });

  describe('the check', () => {
    const target = (id: string): BackupTarget => ({ id }) as unknown as BackupTarget;
    const prismaReturning = (rows: unknown[]) => {
      const findMany = jest.fn(async (..._args: unknown[]) => rows);
      return { prisma: { auditEvent: { findMany } } as unknown as PrismaService, findMany };
    };
    const row = (action: string, targetId: string, error?: string) => ({
      action,
      createdAt: at,
      meta: { targetId, status: action === MIRROR_AUDIT_FAILED ? 'failed' : 'ok', ...(error ? { error } : {}) },
    });

    it('registers itself under backup / backup.mirrors, after the database', () => {
      const registry = new DoctorCheckRegistry();
      const check = new BackupMirrorsDoctorCheck(registry, prismaReturning([]).prisma, [target('local-dir')]);

      check.onModuleInit();

      expect(registry.get('backup.mirrors')).toBe(check);
      expect(check.category).toBe('backup');
      expect(check.dependsOn).toEqual(['db.connection']);
    });

    it('reads nothing when no mirror is configured', async () => {
      const { prisma, findMany } = prismaReturning([]);
      const check = new BackupMirrorsDoctorCheck(new DoctorCheckRegistry(), prisma);

      await expect(check.run()).resolves.toMatchObject({ status: 'pass', detail: 'No mirror targets are configured' });
      expect(findMany).not.toHaveBeenCalled();
    });

    it('judges each configured mirror by its latest recorded audit row', async () => {
      // Newest first, as the query orders them: the first row seen per target is its latest.
      const { prisma } = prismaReturning([
        row(MIRROR_AUDIT_COMPLETED, 'local-dir'),
        row(MIRROR_AUDIT_FAILED, 'cold', 'cold store unreachable'),
        // An older success for `cold` is superseded by the newer failure above.
        row(MIRROR_AUDIT_COMPLETED, 'cold'),
        // A mirror that is no longer configured is ignored.
        row(MIRROR_AUDIT_FAILED, 'retired', 'gone'),
      ]);
      const check = new BackupMirrorsDoctorCheck(new DoctorCheckRegistry(), prisma, [target('local-dir'), target('cold')]);

      const outcome = await check.run();

      expect(outcome.status).toBe('warn');
      expect(outcome.detail).toContain('"cold"');
      expect(outcome.detail).not.toContain('retired');
      expect(outcome.error).toBe('cold store unreachable');
    });

    it('is read-only: one bounded findMany over the mirror actions, no write', async () => {
      const { prisma, findMany } = prismaReturning([]);
      const check = new BackupMirrorsDoctorCheck(new DoctorCheckRegistry(), prisma, [target('cold')]);

      await check.run();

      expect(findMany).toHaveBeenCalledTimes(1);
      expect(findMany.mock.calls[0][0]).toEqual({
        where: { action: { in: [MIRROR_AUDIT_COMPLETED, MIRROR_AUDIT_FAILED] } },
        orderBy: { createdAt: 'desc' },
        take: 500,
        select: { action: true, createdAt: true, meta: true },
      });
      // Nothing but the one read exists on the client it was given.
      expect(Object.keys((prisma as unknown as { auditEvent: object }).auditEvent)).toEqual(['findMany']);
    });

    it('ignores a row whose meta has no target id', async () => {
      const { prisma } = prismaReturning([{ action: MIRROR_AUDIT_FAILED, createdAt: at, meta: null }]);
      const check = new BackupMirrorsDoctorCheck(new DoctorCheckRegistry(), prisma, [target('cold')]);

      await expect(check.run()).resolves.toMatchObject({ status: 'warn', detail: expect.stringContaining('No copy to "cold"') });
    });
  });
});

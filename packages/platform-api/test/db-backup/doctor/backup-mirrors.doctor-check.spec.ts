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
      const $queryRaw = jest.fn(async (..._args: unknown[]) => rows);
      return { prisma: { $queryRaw } as unknown as PrismaService, $queryRaw };
    };

    it('registers itself under backup / backup.mirrors, after the database', () => {
      const registry = new DoctorCheckRegistry();
      const check = new BackupMirrorsDoctorCheck(registry, prismaReturning([]).prisma, [target('local-dir')]);

      check.onModuleInit();

      expect(registry.get('backup.mirrors')).toBe(check);
      expect(check.category).toBe('backup');
      expect(check.dependsOn).toEqual(['db.connection']);
    });

    it('reads nothing when no mirror is configured', async () => {
      const { prisma, $queryRaw } = prismaReturning([]);
      const check = new BackupMirrorsDoctorCheck(new DoctorCheckRegistry(), prisma);

      await expect(check.run()).resolves.toMatchObject({ status: 'pass', detail: 'No mirror targets are configured' });
      expect($queryRaw).not.toHaveBeenCalled();
    });

    it('judges each configured mirror by its latest recorded audit row', async () => {
      const { prisma } = prismaReturning([
        { target_id: 'local-dir', action: MIRROR_AUDIT_COMPLETED, created_at: at, error: null },
        { target_id: 'cold', action: MIRROR_AUDIT_FAILED, created_at: at, error: 'cold store unreachable' },
        // A mirror that is no longer configured is ignored.
        { target_id: 'retired', action: MIRROR_AUDIT_FAILED, created_at: at, error: 'gone' },
      ]);
      const check = new BackupMirrorsDoctorCheck(new DoctorCheckRegistry(), prisma, [target('local-dir'), target('cold')]);

      const outcome = await check.run();

      expect(outcome.status).toBe('warn');
      expect(outcome.detail).toContain('"cold"');
      expect(outcome.detail).not.toContain('retired');
      expect(outcome.error).toBe('cold store unreachable');
    });

    it('is read-only: one SELECT over audit_events, no write', async () => {
      const { prisma, $queryRaw } = prismaReturning([]);
      const check = new BackupMirrorsDoctorCheck(new DoctorCheckRegistry(), prisma, [target('cold')]);

      await check.run();

      expect($queryRaw).toHaveBeenCalledTimes(1);
      const sql = ($queryRaw.mock.calls[0][0] as TemplateStringsArray).join('?');
      expect(sql).toMatch(/^\s*SELECT/i);
      expect(sql).toContain('audit_events');
      expect(sql).not.toMatch(/INSERT|UPDATE|DELETE|DROP|ALTER/i);
      expect(Object.keys(prisma)).toEqual(['$queryRaw']);
    });
  });
});

import { DoctorCheckRegistry } from '@marinoscar/platform-api/doctor';
import type { SystemSettingsService } from '../../../settings/system-settings/system-settings.service';
import type { DeploymentModeService } from '../deployment-mode.service';
import { DeploymentModeDoctorCheck, decideDeploymentMode } from './deployment-mode.doctor-check';

describe('decideDeploymentMode (#685)', () => {
  it('passes for self-hosted, whatever the backup policy says', () => {
    for (const backupsEnabled of [true, false, null]) {
      const outcome = decideDeploymentMode('self-hosted', { backupsEnabled });

      expect(outcome.status).toBe('pass');
      expect(outcome.detail).toBe('Self-hosted: in-app backup and restore available');
      expect(outcome.data).toMatchObject({ mode: 'self-hosted', inAppRestore: true });
    }
  });

  it('passes for saas with in-app backups on, and says restore is off', () => {
    const outcome = decideDeploymentMode('saas', { backupsEnabled: true });

    expect(outcome).toEqual({
      status: 'pass',
      detail: 'SaaS: in-app restore disabled; rely on provider PITR',
      data: { mode: 'saas', inAppRestore: false, inAppBackups: true },
    });
  });

  it('warns for saas with in-app backups off, with a real remedy', () => {
    const outcome = decideDeploymentMode('saas', { backupsEnabled: false });

    expect(outcome.status).toBe('warn');
    expect(outcome.detail).toBe(
      'No in-app backups in SaaS mode; confirm provider backups/PITR are configured'
    );
    expect(outcome.remedy).toMatch(/point-in-time recovery/);
    expect(outcome.remedy).toContain('/admin/settings/db-backup');
    expect(outcome.data).toMatchObject({ inAppRestore: false, inAppBackups: false });
  });

  it('warns, never fails, for saas when the policy could not be read', () => {
    const outcome = decideDeploymentMode('saas', { backupsEnabled: null });

    expect(outcome.status).toBe('warn');
    expect(outcome.remedy).toBeDefined();
  });

  it('never returns fail', () => {
    for (const mode of ['self-hosted', 'saas'] as const) {
      for (const backupsEnabled of [true, false, null]) {
        expect(decideDeploymentMode(mode, { backupsEnabled }).status).not.toBe('fail');
      }
    }
  });
});

describe('DeploymentModeDoctorCheck (#685)', () => {
  function makeCheck(mode: 'self-hosted' | 'saas', policy: () => Promise<{ enabled: boolean }>) {
    const registry = new DoctorCheckRegistry();
    const getDatabaseBackupPolicy = jest.fn(policy);
    const check = new DeploymentModeDoctorCheck(
      registry,
      { mode } as DeploymentModeService,
      { getDatabaseBackupPolicy } as unknown as SystemSettingsService
    );
    check.onModuleInit();
    return { registry, check, getDatabaseBackupPolicy };
  }

  it('registers itself as core.deployment-mode in the core category', () => {
    const { registry, check } = makeCheck('self-hosted', async () => ({ enabled: true }));

    expect(check.id).toBe('core.deployment-mode');
    expect(check.category).toBe('core');
    expect(registry.list()).toContain(check);
  });

  it('reads the backup policy and nothing else', async () => {
    const { check, getDatabaseBackupPolicy } = makeCheck('saas', async () => ({ enabled: false }));

    const outcome = await check.run();

    expect(getDatabaseBackupPolicy).toHaveBeenCalledTimes(1);
    expect(outcome.status).toBe('warn');
  });

  it('reports the mode even when the settings read throws', async () => {
    const { check } = makeCheck('self-hosted', async () => {
      throw new Error('database down');
    });

    await expect(check.run()).resolves.toMatchObject({ status: 'pass', data: { inAppBackups: null } });
  });
});

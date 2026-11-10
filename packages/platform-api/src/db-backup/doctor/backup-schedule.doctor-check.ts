import { Inject, Injectable, OnModuleInit } from '@nestjs/common';

import { DoctorCheck, DoctorCheckOutcome } from '../../doctor/index';
import { DoctorCheckRegistry } from '../../doctor/index';
import { PLATFORM_PRISMA } from '../../core/index';
import type { DbBackupPrisma } from '../data/db-backup-db';
import { DatabaseBackupAdminService } from '../db-backup-admin.service';

/** @stability experimental */
export const BACKUP_SETTINGS_PATH = '/admin/settings/db-backup';

/**
 * An enabled schedule whose last success is older than this is overdue.
 *
 * @stability experimental
 */
export const BACKUP_MAX_AGE_HOURS = 48;

/** How much of a run's `lastError` the report carries. */
const MAX_ERROR_LENGTH = 300;

/** @stability experimental */
export interface BackupFacts {
  /** Enabled. */
  enabled: boolean;
  /** Next run at. */
  nextRunAt: string | null;
  /** The most recent run that reached a terminal state. */
  latestTerminal: { status: string; finishedAt: Date | null; lastError: string | null } | null;
  /** When the most recent completed run finished, or null if none ever did. */
  lastSuccessAt: Date | null;
}

/**
 * Pure: judges the schedule and the run history.
 *
 * @stability experimental
 */
export function decideBackupSchedule(facts: BackupFacts, now: Date = new Date()): DoctorCheckOutcome {
  const ageHours =
    facts.lastSuccessAt === null ? null : Math.floor((now.getTime() - facts.lastSuccessAt.getTime()) / 3_600_000);
  const data = {
    enabled: facts.enabled,
    nextRunAt: facts.nextRunAt,
    lastSuccessAt: facts.lastSuccessAt?.toISOString() ?? null,
    lastSuccessAgeHours: ageHours,
  };

  const latest = facts.latestTerminal;

  if (latest && latest.status !== 'completed') {
    return {
      status: 'fail',
      detail: `The latest backup run ${latest.status === 'stale' ? 'went stale' : 'failed'}` +
        (latest.finishedAt ? ` at ${latest.finishedAt.toISOString()}` : ''),
      remedy: `Read the run's error at ${BACKUP_SETTINGS_PATH}, fix the cause (storage, pg_dump version, disk), then run a backup now.`,
      ...(latest.lastError ? { error: latest.lastError.slice(0, MAX_ERROR_LENGTH) } : {}),
      data,
    };
  }

  if (!facts.enabled) {
    return {
      status: 'warn',
      detail: 'Scheduled database backups are off',
      remedy: `Turn on the backup schedule at ${BACKUP_SETTINGS_PATH} (object storage must be configured).`,
      data,
    };
  }

  if (ageHours === null) {
    return {
      status: 'warn',
      detail: 'Backups are scheduled, but none has ever completed',
      remedy: `Run a backup now at ${BACKUP_SETTINGS_PATH} to prove the schedule works.`,
      data,
    };
  }

  if (ageHours > BACKUP_MAX_AGE_HOURS) {
    return {
      status: 'warn',
      detail: `The last successful backup is ${ageHours} h old`,
      remedy: `Check the job worker is running and the schedule at ${BACKUP_SETTINGS_PATH}; run a backup now.`,
      data,
    };
  }

  return {
    status: 'pass',
    detail: `Last backup ${ageHours} h ago` + (facts.nextRunAt ? `; next at ${facts.nextRunAt}` : ''),
    data,
  };
}

/**
 * `backup` / `backup.schedule` — backups are scheduled and recently succeeded.
 *
 * @stability experimental
 */
@Injectable()
export class BackupScheduleDoctorCheck implements DoctorCheck, OnModuleInit {
  readonly id = 'backup.schedule';
  readonly category = 'backup';
  readonly label = 'Database backups';
  readonly settingsPath = BACKUP_SETTINGS_PATH;
  readonly dependsOn = ['db.connection'];

  constructor(
    private readonly registry: DoctorCheckRegistry,
    private readonly backupAdmin: DatabaseBackupAdminService,
    @Inject(PLATFORM_PRISMA) private readonly prisma: DbBackupPrisma,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async run(): Promise<DoctorCheckOutcome> {
    const [config, latestTerminal, lastSuccess] = await Promise.all([
      this.backupAdmin.getConfig(),
      this.prisma.databaseBackupRun.findFirst({
        where: { status: { in: ['completed', 'failed', 'stale'] } },
        orderBy: { createdAt: 'desc' },
        select: { status: true, finishedAt: true, lastError: true },
      }),
      this.prisma.databaseBackupRun.findFirst({
        where: { status: 'completed' },
        orderBy: { createdAt: 'desc' },
        select: { finishedAt: true, createdAt: true },
      }),
    ]);

    return decideBackupSchedule({
      enabled: config.enabled,
      nextRunAt: config.nextRunAt,
      latestTerminal: latestTerminal ?? null,
      lastSuccessAt: lastSuccess ? (lastSuccess.finishedAt ?? lastSuccess.createdAt) : null,
    });
  }
}

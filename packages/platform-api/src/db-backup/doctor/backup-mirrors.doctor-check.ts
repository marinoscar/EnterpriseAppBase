import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';

import { DoctorCheck, DoctorCheckOutcome } from '../../doctor/index';
import { DoctorCheckRegistry } from '../../doctor/index';
import { PLATFORM_PRISMA } from '../../core/index';
import { DB_BACKUP_MIRROR_TARGETS, type BackupTarget } from '../backup-target';
import { MIRROR_AUDIT_COMPLETED, MIRROR_AUDIT_FAILED } from '../db-backup.constants';
import type { DbBackupPrisma } from '../data/db-backup-db';
import { BACKUP_SETTINGS_PATH } from './backup-schedule.doctor-check';

/** How much of a mirror's error the report carries. */
const MAX_ERROR_LENGTH = 300;

/**
 * The most recent result recorded for one mirror target.
 *
 * @stability experimental
 */
export interface MirrorFact {
  /** The mirror target's id. */
  targetId: string;
  /** `ok` or `failed`; `null` when no copy has been recorded for it yet. */
  status: 'ok' | 'failed' | null;
  /** When the result was recorded. */
  at: Date | null;
  /** Why it failed. */
  error: string | null;
}

/**
 * Pure: judges the configured mirrors by their latest recorded result.
 *
 * - `pass`: no mirror is configured, or every mirror's latest copy landed.
 * - `warn`: at least one mirror's latest copy failed (the primary archive is
 *   fine and restorable; the second copy is missing), or has never run.
 *
 * It never reports `fail`: a mirror is a second line of defence, and the
 * `backup.schedule` check owns "the primary backup works".
 *
 * @param facts - one per configured mirror.
 * @returns the outcome.
 *
 * @stability experimental
 */
export function decideBackupMirrors(facts: readonly MirrorFact[]): DoctorCheckOutcome {
  if (facts.length === 0) {
    return { status: 'pass', detail: 'No mirror targets are configured', data: { mirrors: 0 } };
  }

  const failed = facts.filter((fact) => fact.status === 'failed');
  const neverRan = facts.filter((fact) => fact.status === null);
  const data = { mirrors: facts.length, failing: failed.length, awaitingFirstCopy: neverRan.length };

  if (failed.length > 0) {
    const first = failed[0];
    return {
      status: 'warn',
      detail:
        `The latest copy to ${failed.map((fact) => `"${fact.targetId}"`).join(', ')} failed` +
        (first.at ? ` (${first.at.toISOString()})` : '') +
        '; the primary backup is fine, but the second copy is missing',
      remedy:
        `Fix the mirror target (reachability, credentials, free space), then run a backup at ${BACKUP_SETTINGS_PATH}; ` +
        'the next successful backup copies again.',
      ...(first.error ? { error: first.error.slice(0, MAX_ERROR_LENGTH) } : {}),
      data,
    };
  }

  if (neverRan.length > 0) {
    return {
      status: 'warn',
      detail: `No copy to ${neverRan.map((fact) => `"${fact.targetId}"`).join(', ')} has been recorded yet`,
      remedy: `Run a backup at ${BACKUP_SETTINGS_PATH} to prove the mirror works.`,
      data,
    };
  }

  return { status: 'pass', detail: `All ${facts.length} mirror target(s) hold the latest backup`, data };
}

/**
 * `backup` / `backup.mirrors`: every mirror target received the latest
 * backup. Read-only: it reads the `audit_events` rows the runner wrote
 * (`db_backup.mirror.completed` / `.failed`); it never touches a target.
 *
 * @stability experimental
 */
@Injectable()
export class BackupMirrorsDoctorCheck implements DoctorCheck, OnModuleInit {
  readonly id = 'backup.mirrors';
  readonly category = 'backup';
  readonly label = 'Backup mirrors';
  readonly settingsPath = BACKUP_SETTINGS_PATH;
  readonly dependsOn = ['db.connection'];

  private readonly mirrors: readonly BackupTarget[];

  constructor(
    private readonly registry: DoctorCheckRegistry,
    @Inject(PLATFORM_PRISMA) private readonly prisma: DbBackupPrisma,
    @Optional() @Inject(DB_BACKUP_MIRROR_TARGETS) mirrors?: readonly BackupTarget[],
  ) {
    this.mirrors = mirrors ?? [];
  }

  onModuleInit(): void {
    this.registry.register(this);
  }

  async run(): Promise<DoctorCheckOutcome> {
    if (this.mirrors.length === 0) return decideBackupMirrors([]);

    // The latest result per mirror id: one row each, newest first.
    const rows = await this.prisma.$queryRaw<
      Array<{ target_id: string; action: string; created_at: Date; error: string | null }>
    >`
      SELECT DISTINCT ON (meta->>'targetId')
        meta->>'targetId' AS target_id, action, created_at, meta->>'error' AS error
      FROM audit_events
      WHERE action IN (${MIRROR_AUDIT_COMPLETED}, ${MIRROR_AUDIT_FAILED})
      ORDER BY meta->>'targetId', created_at DESC
    `;

    const latest = new Map(rows.map((row) => [row.target_id, row]));

    return decideBackupMirrors(
      this.mirrors.map((mirror) => {
        const row = latest.get(mirror.id);
        return {
          targetId: mirror.id,
          status: row === undefined ? null : row.action === MIRROR_AUDIT_FAILED ? 'failed' : 'ok',
          at: row?.created_at ?? null,
          error: row?.error ?? null,
        };
      }),
    );
  }
}

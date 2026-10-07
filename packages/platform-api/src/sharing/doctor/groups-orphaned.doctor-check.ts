// =============================================================================
// Doctor check `sharing.groups.orphaned` (issue #728, PP-7.1)
// =============================================================================
//
// A group always has an `admin` (the last-admin rule), but a user purge can
// leave one without any member at all when it still owns resources, and a
// direct database edit can leave one without an admin. Such a group can only
// be managed by a `groups:admin` holder of its organization. This check lists
// them so an operator knows.
//
// READ-ONLY (docs/specs/doctor.md): two counting reads on the system client
// (reason `doctor`), because the check looks across organizations. It reports
// group ids only, never a name or an address.
// =============================================================================

import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';

import { DoctorCheckRegistry, type DoctorCheck, type DoctorCheckOutcome } from '../../doctor/index';
import { asSharingTx } from '../data/sharing-tx';
import { SHARING_DATA, type SharingDataPort } from '../ports';

/** How many orphaned group ids the outcome names at most. */
export const ORPHANED_GROUPS_SAMPLE = 10;

/**
 * Decides the outcome from the counts. Pure.
 *
 * @param orphaned - groups with no `admin` member.
 * @param sample - some of their ids.
 * @returns the outcome.
 *
 * @stability experimental
 */
export function decideOrphanedGroups(orphaned: number, sample: readonly string[]): DoctorCheckOutcome {
  if (orphaned === 0) return { status: 'pass', detail: 'Every group has an admin', data: { orphaned: 0 } };
  return {
    status: 'warn',
    detail: `${orphaned} group${orphaned === 1 ? ' has' : 's have'} no admin; only a groups:admin holder of the organization can manage ${orphaned === 1 ? 'it' : 'them'}`,
    remedy:
      'As an organization administrator (groups:admin), open each group and make a member its admin ' +
      '(PATCH /api/groups/{id}/members/{userId}), or delete the group once it owns nothing.',
    data: { orphaned, sample: sample.join(',') },
  };
}

/**
 * `sharing.groups.orphaned`: groups without an `admin` member (warn).
 *
 * @stability experimental
 */
@Injectable()
export class GroupsOrphanedDoctorCheck implements DoctorCheck, OnModuleInit {
  readonly id = 'sharing.groups.orphaned';
  readonly category = 'sharing';
  readonly label = 'Groups without an admin';

  constructor(
    @Inject(SHARING_DATA) private readonly data: SharingDataPort,
    @Optional() private readonly registry?: DoctorCheckRegistry,
  ) {}

  onModuleInit(): void {
    this.registry?.register(this);
  }

  async run(): Promise<DoctorCheckOutcome> {
    const where = { members: { none: { role: 'admin' } } };
    const { orphaned, sample } = await this.data.runAsSystem('doctor', async (raw) => {
      const tx = asSharingTx(raw);
      const count = await tx.group.count({ where });
      const rows = count === 0 ? [] : await tx.group.findMany<{ id: string }>({ where, select: { id: true }, orderBy: { createdAt: 'asc' }, take: ORPHANED_GROUPS_SAMPLE });
      return { orphaned: count, sample: rows.map((row) => row.id) };
    });
    return decideOrphanedGroups(orphaned, sample);
  }
}

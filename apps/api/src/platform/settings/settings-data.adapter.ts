// =============================================================================
// The settings slice's SETTINGS_DATA port, bound to the reference app (#733)
// =============================================================================
//
// `runInOrg` is `PrismaService.runInOrg`: ONE transaction whose first
// statement sets `app.org_id` (and `app.user_id`) transaction-locally, so the
// FORCEd row-level security of `org_settings` confines every query to that
// organization. No system client here: the org layer never reads across
// organizations.
// =============================================================================

import { Injectable } from '@nestjs/common';
import type { SettingsDataPort, SettingsOrgTx } from '@marinoscar/platform-api/settings';

import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SettingsDataAdapter implements SettingsDataPort {
  constructor(private readonly prisma: PrismaService) {}

  runInOrg<R>(scope: { orgId: string; userId?: string }, fn: (tx: SettingsOrgTx) => Promise<R>): Promise<R> {
    return this.prisma.runInOrg(
      scope.orgId,
      (tx) => fn(tx as unknown as SettingsOrgTx),
      scope.userId === undefined ? {} : { userId: scope.userId },
    );
  }
}

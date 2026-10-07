import { Injectable, OnModuleInit } from '@nestjs/common';

import {
  DoctorCheck,
  DoctorCheckOutcome,
  DoctorCheckRegistry,
} from '@marinoscar/platform-api/doctor';
import { TENANCY_MODE_ENV_VAR, type TenancyMode } from '../../common/deployment/tenancy-mode';
import { PrismaService } from '../../prisma/prisma.service';
import { TenancyService } from '../tenancy.service';

/** What the check reads from the database. */
export interface TenancyModeFacts {
  /** Whether the organization flagged `isDefault` exists. */
  defaultOrgExists: boolean;
  /** Every organization, default included. */
  organizations: number;
  /**
   * Active users the mode would not let through as they are:
   * - `single`: without an active membership in the default organization
   *   (they self-heal at their next sign-in);
   * - `multi`: without an active membership in any organization (they are
   *   refused at sign-in with `no_organization`).
   */
  usersWithoutMembership: number;
}

/**
 * Pure: does the database agree with `TENANCY_MODE`?
 *
 * - `fail`: no default organization (the migration backfill and the seed both
 *   create it, so neither ran).
 * - `fail`: single mode with more than one organization. Switching multi back
 *   to single with several orgs is unsupported; the remedy says so.
 * - `warn`: single mode and active users without a default-org membership.
 * - `pass`: otherwise. In multi mode, users with no organization are reported
 *   in the detail and the data, not graded: being refused is the designed
 *   behaviour there.
 */
export function decideTenancyMode(mode: TenancyMode, facts: TenancyModeFacts): DoctorCheckOutcome {
  const data = {
    mode,
    organizations: facts.organizations,
    usersWithoutMembership: facts.usersWithoutMembership,
  };

  if (!facts.defaultOrgExists) {
    return {
      status: 'fail',
      detail: 'No default organization exists',
      remedy:
        'Run the database migrations (npm run prisma:migrate) and the seed (npm run prisma:seed); ' +
        'both create the default organization. Until then no new user can sign up.',
      data,
    };
  }

  if (mode === 'single' && facts.organizations > 1) {
    return {
      status: 'fail',
      detail: `Single-org mode, but ${facts.organizations} organizations exist`,
      remedy:
        `Set ${TENANCY_MODE_ENV_VAR}=multi in the deployment environment and restart the API, or ` +
        'consolidate the organizations into the default one. Running several organizations in ' +
        'single mode is unsupported.',
      data,
    };
  }

  if (mode === 'single' && facts.usersWithoutMembership > 0) {
    return {
      status: 'warn',
      detail: `${facts.usersWithoutMembership} active user(s) are not members of the default organization`,
      remedy:
        'No action is required: each one is joined to the default organization at their next ' +
        'sign-in. If the number keeps growing, check the sign-in logs for membership errors.',
      data,
    };
  }

  if (mode === 'single') {
    return { status: 'pass', detail: 'Single-org: every active user is in the default organization', data };
  }

  return {
    status: 'pass',
    detail:
      facts.usersWithoutMembership > 0
        ? `Multi-org: ${facts.organizations} organization(s); ${facts.usersWithoutMembership} active ` +
          'user(s) belong to none and are refused at sign-in until invited'
        : `Multi-org: ${facts.organizations} organization(s)`,
    data,
  };
}

/** `auth` / `tenancy.mode` — the database matches the deployment's tenancy mode. */
@Injectable()
export class TenancyModeDoctorCheck implements DoctorCheck, OnModuleInit {
  readonly id = 'tenancy.mode';
  readonly category = 'auth';
  readonly label = 'Tenancy mode';
  readonly settingsPath = '/admin/settings/users';
  readonly dependsOn = ['db.connection'];

  constructor(
    private readonly registry: DoctorCheckRegistry,
    private readonly tenancy: TenancyService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  /** Read-only: three counts. */
  async run(): Promise<DoctorCheckOutcome> {
    const mode = this.tenancy.mode();
    const [defaultOrgs, organizations, usersWithoutMembership] = await Promise.all([
      this.prisma.organization.count({ where: { isDefault: true } }),
      this.prisma.organization.count(),
      this.prisma.user.count({
        where: {
          isActive: true,
          memberships: {
            none:
              mode === 'single'
                ? { status: 'active', org: { isDefault: true } }
                : { status: 'active' },
          },
        },
      }),
    ]);

    return decideTenancyMode(mode, {
      defaultOrgExists: Number(defaultOrgs ?? 0) > 0,
      organizations: Number(organizations ?? 0),
      usersWithoutMembership: Number(usersWithoutMembership ?? 0),
    });
  }
}

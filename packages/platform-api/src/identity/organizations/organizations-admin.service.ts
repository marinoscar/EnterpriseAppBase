import { ConflictException, Injectable, Logger, NotFoundException, Inject } from '@nestjs/common';
import { trace } from '@opentelemetry/api';

import { PLATFORM_PRISMA } from '../../core/index';
import type { IdentityPrisma } from '../ports';
import { ORG_ADMIN_ROLE } from '../identity.constants';
import { TenancyService } from './tenancy.service';
import { OrgInvitesService } from './org-invites.service';
import { TENANCY_SINGLE_ORG_REASON, writeAudit } from './org-admin.common';
import type {
  CreateOrganizationDto,
  OrganizationListQueryDto,
  RenameOrganizationDto,
} from './dto/organization.dto';
import { isPrismaErrorCode, type IdentityOrganizationRow, type IdentityQueryArgs } from '../data/identity-db';

/** Audit actions this service writes. */
export const ORGANIZATION_AUDIT = {
  CREATED: 'org:created',
  RENAMED: 'org:renamed',
} as const;

const ORG_WITH_COUNT = {
  _count: { select: { memberships: { where: { status: 'active' } } } },
} as const;

type OrgRow = IdentityOrganizationRow & { _count: { memberships: number } };

/** One organization as the admin API returns it. */
export interface OrganizationView {
  id: string;
  name: string;
  slug: string;
  isDefault: boolean;
  memberCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The deployment's organizations, for a deployment operator (#726, PP-6.7):
 * `/api/admin/organizations`, gated by the SYSTEM permissions
 * `organizations:read` / `organizations:write`.
 *
 * - Creating one is refused in single-org mode (409,
 *   `details.reason: TENANCY_SINGLE_ORG`): that deployment has exactly the
 *   default organization. It writes the organization and a pending
 *   `org_admin` invitation for `firstAdminEmail` in one transaction, then
 *   emails the invitation after the commit.
 * - Renaming changes the name only. The slug is immutable here, and which
 *   organization is the default cannot be changed.
 * - Deleting an organization is out of scope (#743).
 *
 * @internal
 */
@Injectable()
export class OrganizationsAdminService {
  private readonly logger = new Logger(OrganizationsAdminService.name);

  constructor(
    @Inject(PLATFORM_PRISMA) private readonly prisma: IdentityPrisma,
    private readonly tenancy: TenancyService,
    private readonly invites: OrgInvitesService,
  ) {}

  /** Every organization, default first then by name, with its active member count. */
  async list(query: OrganizationListQueryDto) {
    const search = query.search?.trim();
    const where: IdentityQueryArgs = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { slug: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {};
    const [rows, total] = await Promise.all([
      this.prisma.organization.findMany<OrgRow>({
        where,
        include: ORG_WITH_COUNT,
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.organization.count({ where }),
    ]);

    return {
      items: rows.map(toOrganizationView),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  /** Create an organization with a pending `org_admin` invitation for its first administrator. */
  async create(actorUserId: string, dto: CreateOrganizationDto): Promise<OrganizationView> {
    if (this.tenancy.isSingle()) {
      throw new ConflictException({
        message:
          'This deployment runs in single-organization mode (TENANCY_MODE=single); organizations cannot be created.',
        details: { reason: TENANCY_SINGLE_ORG_REASON },
      });
    }

    let created: { orgId: string; pending: Awaited<ReturnType<OrgInvitesService['writeInvite']>> };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const org = await tx.organization.create({
          data: { name: dto.name, slug: dto.slug, createdById: actorUserId },
        });
        await writeAudit(tx, actorUserId, ORGANIZATION_AUDIT.CREATED, 'organization', org.id, {
          name: org.name,
          slug: org.slug,
          firstAdminEmail: dto.firstAdminEmail,
        });
        const pending = await this.invites.writeInvite(tx, {
          orgId: org.id,
          email: dto.firstAdminEmail,
          roleName: ORG_ADMIN_ROLE,
          invitedById: actorUserId,
        });
        return { orgId: org.id, pending };
      });
    } catch (error) {
      if (isPrismaErrorCode(error, 'P2002')) {
        throw new ConflictException({
          message: `An organization with the slug "${dto.slug}" already exists`,
          details: { reason: 'SLUG_TAKEN' },
        });
      }
      throw error;
    }

    trace.getActiveSpan()?.setAttribute('org.id', created.orgId);
    // Committed: the organization, its invitation and the allowlist entry exist.
    await this.invites.dispatchInvitation(created.pending);
    this.logger.log(`Organization ${created.orgId} created by ${actorUserId}`);

    return this.get(created.orgId);
  }

  /** Rename an organization. */
  async rename(actorUserId: string, orgId: string, dto: RenameOrganizationDto): Promise<OrganizationView> {
    trace.getActiveSpan()?.setAttribute('org.id', orgId);

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.organization.findUnique({
        where: { id: orgId },
        select: { id: true, name: true },
      });
      if (!existing) {
        throw new NotFoundException('Organization not found');
      }
      if (existing.name === dto.name) return;
      await tx.organization.update({ where: { id: orgId }, data: { name: dto.name } });
      await writeAudit(tx, actorUserId, ORGANIZATION_AUDIT.RENAMED, 'organization', orgId, {
        previousName: existing.name,
        name: dto.name,
      });
    });

    return this.get(orgId);
  }

  private async get(orgId: string): Promise<OrganizationView> {
    const org = await this.prisma.organization.findUnique<OrgRow>({
      where: { id: orgId },
      include: ORG_WITH_COUNT,
    });
    if (!org) {
      throw new NotFoundException('Organization not found');
    }
    return toOrganizationView(org);
  }
}

function toOrganizationView(row: OrgRow): OrganizationView {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    isDefault: row.isDefault,
    memberCount: row._count?.memberships ?? 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

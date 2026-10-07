import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { trace } from '@opentelemetry/api';
import type { Invite, InviteStatus, Prisma } from '@prisma/client';

import { PLATFORM_PRISMA } from '../../core/index';
import type { IdentityPrisma } from '../ports';
import {
  IDENTITY_METRICS,
  IDENTITY_NOTIFIER,
  NOOP_IDENTITY_METRICS,
  type IdentityMetrics,
  type IdentityNotifier,
  type OrgInvitationNotice,
} from '../ports';
import { DatabaseSeedException } from '../../core/index';
import { DEFAULT_ORG_ROLE } from '../identity.constants';
import { signInUrlFrom, writeAudit } from './org-admin.common';
import type { CreateOrgInviteDto, OrgInviteListQueryDto } from './dto/org-invite.dto';

/** How long an invitation stays claimable; re-inviting renews it. */
export const ORG_INVITE_TTL_DAYS = 14;

/** Audit actions this service writes. */
export const ORG_INVITE_AUDIT = {
  CREATED: 'org:invite_created',
  REVOKED: 'org:invite_revoked',
} as const;

/** The allowlist service's own audit action, reused for the entry an invite adds. */
const ALLOWLIST_ADD_AUDIT = 'allowlist:add';

const INVITE_INCLUDE = {
  role: { select: { name: true } },
  invitedBy: { select: { id: true, email: true } },
  acceptedBy: { select: { id: true, email: true } },
} satisfies Prisma.InviteInclude;

type InviteWithRelations = Prisma.InviteGetPayload<{ include: typeof INVITE_INCLUDE }>;

/** One invitation as the API returns it. */
export interface OrgInviteView {
  id: string;
  email: string;
  role: string;
  status: InviteStatus;
  notes: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  acceptedAt: Date | null;
  invitedBy: { id: string; email: string } | null;
  acceptedBy: { id: string; email: string } | null;
}

/** What {@link OrgInvitesService.writeInvite} needs. */
export interface WriteInviteInput {
  orgId: string;
  email: string;
  roleName: string;
  invitedById: string;
  notes?: string;
}

/** The email to send once the transaction that wrote an invite has committed. */
export interface PendingInvitation {
  invite: Invite;
  payload: OrgInvitationNotice;
}

/**
 * Invitations to the ACTIVE organization (#726, PP-6.7): list, create (or
 * renew) and revoke.
 *
 * - The org id always comes from the caller's principal (the controller
 *   resolves it with `requireActiveOrgId`), never from the request.
 * - Creating an invitation also upserts the `allowed_emails` row, so the
 *   invitee can sign in (the MemoriaHub `CirclesService.createInvite`
 *   precedent), audited as the allowlist service audits its own adds.
 * - The `org.invitation` email goes to the invitee only, through
 *   `notifyAddress`, AFTER the transaction commits and outside it (CLAUDE.md
 *   invariant). No invitation token exists, so none can be logged: the
 *   invitation is claimed by signing in with the invited address
 *   (`OrganizationsService.claimPendingInvites`).
 * - Expired invitations are marked `expired` lazily, when the list is read.
 *
 * @internal
 */
@Injectable()
export class OrgInvitesService {
  private readonly logger = new Logger(OrgInvitesService.name);

  constructor(
    @Inject(PLATFORM_PRISMA) private readonly prisma: IdentityPrisma,
    @Inject(IDENTITY_NOTIFIER) private readonly notifications: IdentityNotifier,
    private readonly config: ConfigService,
    @Optional() @Inject(IDENTITY_METRICS)
    private readonly metrics: IdentityMetrics = NOOP_IDENTITY_METRICS,
  ) {}

  /** The organization's invitations, newest first, after marking lapsed ones `expired`. */
  async list(orgId: string, query: OrgInviteListQueryDto) {
    trace.getActiveSpan()?.setAttribute('org.id', orgId);
    await this.expireLapsed(orgId);

    const where: Prisma.InviteWhereInput = {
      orgId,
      ...(query.status !== 'all' ? { status: query.status } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.invite.findMany({
        where,
        include: INVITE_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.invite.count({ where }),
    ]);

    return {
      items: rows.map((row) => toInviteView(row)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  /**
   * Invite `dto.email` to the organization with `dto.roleName`.
   *
   * Re-inviting an address whose invitation is pending (or revoked, or
   * expired) renews that row: new role, new expiry, status `pending`.
   * Re-inviting an ACCEPTED invitation (`INVITE_ACCEPTED`), or any address
   * that is already a member (`ALREADY_MEMBER`), is a 409: change the
   * member's role instead. An accepted invitation whose member has since been
   * removed is renewed.
   */
  async create(actorUserId: string, orgId: string, dto: CreateOrgInviteDto): Promise<OrgInviteView> {
    trace.getActiveSpan()?.setAttribute('org.id', orgId);

    const pending = await this.prisma.$transaction((tx) =>
      this.writeInvite(tx, {
        orgId,
        email: dto.email,
        roleName: dto.roleName,
        invitedById: actorUserId,
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      }),
    );

    // Committed: the invitation and the allowlist entry are real, so the
    // email can promise a sign-in that works.
    await this.dispatchInvitation(pending);

    const invite = await this.prisma.invite.findUniqueOrThrow({
      where: { id: pending.invite.id },
      include: INVITE_INCLUDE,
    });
    return toInviteView(invite);
  }

  /**
   * Writes (or renews) one invitation and its allowlist entry inside the
   * caller's transaction, with their audit rows. Sends nothing: the caller
   * passes the result to {@link dispatchInvitation} after the commit.
   */
  async writeInvite(tx: Prisma.TransactionClient, input: WriteInviteInput): Promise<PendingInvitation> {
    const { orgId, email, roleName, invitedById } = input;

    const [org, role, inviter] = await Promise.all([
      tx.organization.findUnique({ where: { id: orgId }, select: { id: true, name: true } }),
      tx.role.findUnique({ where: { name: roleName }, select: { id: true, name: true, scope: true } }),
      tx.user.findUnique({
        where: { id: invitedById },
        select: { email: true, displayName: true, providerDisplayName: true },
      }),
    ]);
    if (!org) {
      throw new NotFoundException('Organization not found');
    }
    if (!role || role.scope !== 'org') {
      throw new DatabaseSeedException(`Org role "${roleName}"`, 'npm run prisma:seed');
    }

    const [member, existing] = await Promise.all([
      tx.membership.findFirst({ where: { orgId, user: { email } }, select: { id: true } }),
      tx.invite.findUnique({
        where: { orgId_email: { orgId, email } },
        select: { id: true, status: true },
      }),
    ]);
    if (member && existing?.status === 'accepted') {
      throw new ConflictException({
        message: `The invitation for ${email} was already accepted; change the member's role instead`,
        details: { reason: 'INVITE_ACCEPTED' },
      });
    }
    if (member) {
      throw new ConflictException({
        message: `${email} is already a member of this organization; change their role instead`,
        details: { reason: 'ALREADY_MEMBER' },
      });
    }
    // An accepted invitation whose invitee has since been REMOVED is renewed
    // like any other: otherwise a removed member could never be invited back.

    const expiresAt = new Date(Date.now() + ORG_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
    const fields = {
      status: 'pending' as const,
      roleId: role.id,
      invitedById,
      expiresAt,
      notes: input.notes ?? null,
      acceptedById: null,
      acceptedAt: null,
    };
    const invite = await tx.invite.upsert({
      where: { orgId_email: { orgId, email } },
      update: fields,
      create: { orgId, email, ...fields },
    });

    // The invitee must be able to sign in. An existing entry (claimed or
    // not) already lets them, and is left exactly as it is.
    const allowed = await tx.allowedEmail.findUnique({ where: { email }, select: { id: true } });
    if (!allowed) {
      const entry = await tx.allowedEmail.create({
        data: { email, addedById: invitedById, notes: `Invited to organization ${org.name}` },
      });
      await writeAudit(tx, invitedById, ALLOWLIST_ADD_AUDIT, 'allowed_email', entry.id, {
        email,
        source: 'org_invite',
        orgId,
      });
    }

    await writeAudit(tx, invitedById, ORG_INVITE_AUDIT.CREATED, 'org_invite', invite.id, {
      orgId,
      email,
      role: role.name,
      renewed: existing !== null,
    });

    const invitedBy = inviter?.displayName || inviter?.providerDisplayName || inviter?.email;
    const signInUrl = signInUrlFrom(this.config.get<string>('appUrl'));
    return {
      invite,
      payload: {
        recipientEmail: email,
        orgName: org.name,
        roleName: role.name,
        ...(invitedBy ? { invitedBy } : {}),
        ...(signInUrl ? { signInUrl } : {}),
      },
    };
  }

  /**
   * Sends the `org.invitation` email for an invitation whose transaction has
   * COMMITTED, and counts it. Never inside a transaction; `notifyAddress`
   * never rejects, so a mail outage cannot fail the request. The invite's
   * notes are not in the payload.
   */
  async dispatchInvitation(pending: PendingInvitation): Promise<void> {
    this.metrics.add('orgInvitesCreated');
    this.logger.log(`Organization invitation ${pending.invite.id} written for org ${pending.invite.orgId}`);
    await this.notifications.orgInvitation(pending.payload.recipientEmail, pending.payload);
  }

  /**
   * Revoke a pending invitation of the organization. Revoking a revoked or
   * expired one is a no-op; an accepted one is a 409 (remove the member
   * instead). An id of another organization is a 404, like a missing one.
   */
  async revoke(actorUserId: string, orgId: string, inviteId: string): Promise<void> {
    trace.getActiveSpan()?.setAttribute('org.id', orgId);

    const invite = await this.prisma.invite.findFirst({
      where: { id: inviteId, orgId },
      select: { id: true, status: true, email: true },
    });
    if (!invite) {
      throw new NotFoundException('Invitation not found');
    }
    if (invite.status === 'accepted') {
      throw new ConflictException({
        message: 'An accepted invitation cannot be revoked; remove the member instead',
        details: { reason: 'INVITE_ACCEPTED' },
      });
    }
    if (invite.status !== 'pending') {
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.invite.updateMany({
        where: { id: invite.id, status: 'pending' },
        data: { status: 'revoked' },
      });
      await writeAudit(tx, actorUserId, ORG_INVITE_AUDIT.REVOKED, 'org_invite', invite.id, {
        orgId,
        email: invite.email,
      });
    });
  }

  /** Marks the organization's lapsed pending invitations `expired`. */
  private async expireLapsed(orgId: string): Promise<void> {
    await this.prisma.invite.updateMany({
      where: { orgId, status: 'pending', expiresAt: { lt: new Date() } },
      data: { status: 'expired' },
    });
  }
}

/** The API view of an invitation (`role` falls back to the default org role, as a NULL `role_id` means). */
export function toInviteView(row: InviteWithRelations): OrgInviteView {
  return {
    id: row.id,
    email: row.email,
    role: row.role?.name ?? DEFAULT_ORG_ROLE,
    status: row.status,
    notes: row.notes,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    acceptedAt: row.acceptedAt,
    invitedBy: row.invitedBy ?? null,
    acceptedBy: row.acceptedBy ?? null,
  };
}

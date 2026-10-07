import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Logger,
  Optional, Inject } from '@nestjs/common';
import { PLATFORM_PRISMA } from '../../core/index';
import type { IdentityPrisma } from '../ports';
import { createHash, randomBytes } from 'node:crypto';
import { CreatePatDto } from './dto/create-pat.dto';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { PRINCIPAL_USER_INCLUDE } from '../auth/principal.factory';
import { hasActiveMembership, stampCredential } from '../auth/credential-binding';
import { currentTenancyMode } from '../auth/tenancy-mode';
import { PrincipalCache } from '../auth/principal-cache/principal-cache.service';

/** Audit actions of the PAT lifecycle (#724: `meta.orgId` names the bound org). */
export const PAT_CREATED_AUDIT_ACTION = 'pat:created';
export const PAT_REVOKED_AUDIT_ACTION = 'pat:revoked';

/** Who is creating a PAT, as the credential path that admitted them bound it (#724). */
export interface PatCreationContext {
  /** The caller's active org (already validated by its credential path). */
  activeOrgId?: string | null;
}

/**
 * Exported for the reference app's wiring and tests; not a stable extension point (reach identity through IdentityModule and its documented seams).
 *
 * @internal
 */
@Injectable()
export class PatService {
  private readonly logger = new Logger(PatService.name);

  constructor(
    @Inject(PLATFORM_PRISMA) private readonly prisma: IdentityPrisma,
    // #724: a PAT revoke invalidates the owner's principals. Belt and braces
    // (a PAT is validated against its row on every request, never cached),
    // so a test graph without `PrincipalCacheModule` still works without it.
    @Optional() private readonly principalCache?: PrincipalCache,
  ) {}

  /**
   * Create a new Personal Access Token for a user
   *
   * ORG BINDING (#724): the token acts in ONE organization, for its whole
   * life. `dto.orgId` names it explicitly and must be an ACTIVE membership of
   * the caller (else 400); without it the token is bound to the caller's
   * active org (`context.activeOrgId`, which the caller's own credential path
   * already validated), and failing that to the org a sign-in would pick.
   */
  async createToken(userId: string, dto: CreatePatDto, context: PatCreationContext = {}) {
    const orgId = await this.resolveCreationOrg(userId, dto.orgId, context.activeOrgId);

    // Generate raw token: pat_ + 32 random bytes as hex (64 hex chars)
    const hexPart = randomBytes(32).toString('hex');
    const rawToken = `pat_${hexPart}`;

    // Hash the token for storage
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    // tokenPrefix: "pat_" + first 4 hex chars of hexPart = 8 chars total display prefix
    const tokenPrefix = `pat_${hexPart.slice(0, 4)}`;

    // Compute expiresAt based on durationUnit
    const expiresAt = new Date();
    if (dto.durationUnit === 'minutes') {
      expiresAt.setMinutes(expiresAt.getMinutes() + dto.durationValue);
    } else if (dto.durationUnit === 'days') {
      expiresAt.setDate(expiresAt.getDate() + dto.durationValue);
    } else if (dto.durationUnit === 'months') {
      expiresAt.setMonth(expiresAt.getMonth() + dto.durationValue);
    }

    const pat = await this.prisma.personalAccessToken.create({
      data: {
        userId,
        name: dto.name,
        tokenHash,
        tokenPrefix,
        durationValue: dto.durationValue,
        durationUnit: dto.durationUnit,
        expiresAt,
        orgId,
      },
    });

    // The id, the name and the org: never the token.
    await this.prisma.auditEvent.create({
      data: {
        actorUserId: userId,
        action: PAT_CREATED_AUDIT_ACTION,
        targetType: 'personal_access_token',
        targetId: pat.id,
        meta: { name: dto.name, orgId },
      },
    });

    this.logger.log(`Created PAT "${dto.name}" for user: ${userId} in organization ${orgId}`);

    return {
      token: rawToken,
      id: pat.id,
      name: pat.name,
      tokenPrefix: pat.tokenPrefix,
      expiresAt: pat.expiresAt.toISOString(),
      createdAt: pat.createdAt.toISOString(),
      orgId: pat.orgId ?? orgId,
    };
  }

  /**
   * The org a new PAT is bound to; see {@link createToken}.
   *
   * @throws BadRequestException when the requested (or fallback) org is not an
   *   active membership of the user.
   */
  private async resolveCreationOrg(
    userId: string,
    requested: string | undefined,
    activeOrgId: string | null | undefined,
  ): Promise<string> {
    if (requested === undefined) {
      // The caller's own validated binding: no second lookup.
      if (typeof activeOrgId === 'string') {
        return activeOrgId;
      }
      // A caller bound to no org: a pre-#724 credential on the temporary
      // single-mode compatibility path, which acts in the default org exactly
      // as every credential did before #724. The PAT is bound to it; using
      // the PAT still requires an active membership there.
      if (activeOrgId === undefined && currentTenancyMode() === 'single') {
        const defaultOrgId = await this.fallbackOrgId(userId);
        if (defaultOrgId) {
          return defaultOrgId;
        }
      }
    }

    const orgId = requested ?? (await this.fallbackOrgId(userId));
    if (orgId) {
      const membership = await this.prisma.membership.findUnique({
        where: { orgId_userId: { orgId, userId } },
        select: { status: true },
      });
      if (membership?.status === 'active') {
        return orgId;
      }
    }
    throw new BadRequestException(
      'orgId must be an organization you are an active member of',
    );
  }

  /** The sign-in rule's org (single: the default org; multi: the most recently used active membership). */
  private async fallbackOrgId(userId: string): Promise<string | null> {
    if (currentTenancyMode() === 'single') {
      const org = await this.prisma.organization.findFirst({
        where: { isDefault: true },
        select: { id: true },
      });
      return org?.id ?? null;
    }
    const membership = await this.prisma.membership.findFirst({
      where: { userId, status: 'active' },
      orderBy: [{ lastActiveAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'asc' }],
      select: { orgId: true },
    });
    return membership?.orgId ?? null;
  }

  /**
   * List all PATs for a user (without token hashes), across every
   * organization; each item names the org it is bound to (#724).
   */
  async listTokens(userId: string) {
    const tokens = await this.prisma.personalAccessToken.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        tokenPrefix: true,
        durationValue: true,
        durationUnit: true,
        expiresAt: true,
        lastUsedAt: true,
        createdAt: true,
        revokedAt: true,
        orgId: true,
      },
    });

    return tokens;
  }

  /**
   * Revoke a PAT by ID (ownership-checked)
   */
  async revokeToken(userId: string, tokenId: string): Promise<void> {
    const pat = await this.prisma.personalAccessToken.findFirst({
      where: { id: tokenId, userId },
    });

    if (!pat) {
      throw new NotFoundException('Token not found');
    }

    if (pat.revokedAt !== null) {
      throw new NotFoundException('Token already revoked');
    }

    await this.prisma.personalAccessToken.update({
      where: { id: pat.id },
      data: { revokedAt: new Date() },
    });

    await this.prisma.auditEvent.create({
      data: {
        actorUserId: userId,
        action: PAT_REVOKED_AUDIT_ACTION,
        targetType: 'personal_access_token',
        targetId: pat.id,
        meta: { name: pat.name, orgId: pat.orgId ?? null },
      },
    });

    // #724: after the write committed.
    this.principalCache?.invalidateUser(userId);

    this.logger.log(`Revoked PAT "${pat.name}" (${pat.id}) for user: ${userId}`);
  }

  /**
   * Validate a raw PAT and return the associated user if valid
   */
  async validateToken(rawToken: string): Promise<AuthenticatedUser | null> {
    return (await this.resolveToken(rawToken))?.user ?? null;
  }

  /**
   * Validate a raw PAT and return the associated user AND the token's id, or
   * null when it is unknown, revoked, expired or its owner is inactive. The
   * auth guard uses this so a route can tell which PAT authenticated the
   * request (`@AuthCredential()`).
   *
   * ORG BINDING (#724): a PAT bound to an org is refused once the owner's
   * membership there is no longer ACTIVE (removed or suspended); the user it
   * returns carries that org as its `activeOrgId`. A PAT created before #724
   * has no org: honoured in single mode (the sign-in rule then picks the
   * default org, exactly as before), refused in multi mode.
   */
  async resolveToken(rawToken: string): Promise<{ user: AuthenticatedUser; tokenId: string } | null> {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    const pat = await this.prisma.personalAccessToken.findUnique({
      where: { tokenHash },
      include: {
        // System roles and memberships with their org roles (PP-6.3, #723):
        // the graph every credential path loads (auth/principal.factory.ts).
        user: { include: PRINCIPAL_USER_INCLUDE },
      },
    });

    if (!pat) {
      return null;
    }

    // Check revoked
    if (pat.revokedAt !== null) {
      return null;
    }

    // Check expired
    if (pat.expiresAt <= new Date()) {
      return null;
    }

    // Check user active
    if (!pat.user.isActive) {
      return null;
    }

    // Check the org binding
    const orgId = pat.orgId ?? null;
    if (orgId !== null ? !hasActiveMembership(pat.user, orgId) : currentTenancyMode() !== 'single') {
      return null;
    }

    // Fire-and-forget update of lastUsedAt
    this.prisma.personalAccessToken
      .update({ where: { id: pat.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});

    return {
      user: stampCredential(pat.user as AuthenticatedUser, {
        // `undefined` (a pre-#724 token in single mode): unbound, the
        // principal factory's sign-in rule picks the default org.
        activeOrgId: orgId ?? undefined,
        tokenKind: 'pat',
      }),
      tokenId: pat.id,
    };
  }

  /**
   * Clean up expired and old revoked PATs
   * Returns the count of deleted records
   */
  async cleanupExpiredTokens(): Promise<number> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const result = await this.prisma.personalAccessToken.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date() } },
          {
            revokedAt: { not: null, lt: thirtyDaysAgo },
          },
        ],
      },
    });

    this.logger.log(`Cleaned up ${result.count} expired/revoked PATs`);
    return result.count;
  }
}

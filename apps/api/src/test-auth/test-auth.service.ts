import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TestLoginDto } from './dto/test-login.dto';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { DEFAULT_USER_SETTINGS } from '../common/types/settings.types';
import { PrincipalCache } from '../auth/principal-cache/principal-cache.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { TenancyService } from '../organizations/tenancy.service';
import { AuthLoginDeniedException } from '../auth/auth-error-codes';
import {
  DEFAULT_ORG_ROLE,
  ORG_ADMIN_ROLE,
  ROLES,
} from '../common/constants/roles.constants';
import { PRINCIPAL_USER_INCLUDE, principalFactory } from '../auth/principal.factory';

export interface TestAuthTokenResponse {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    displayName: string | null;
    roles: string[];
  };
}

@Injectable()
export class TestAuthService {
  private readonly logger = new Logger(TestAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    // PP-1.12 (#683): the role swap below must reach the next request.
    private readonly principalCache: PrincipalCache,
    // PP-6.1 (#721): a new test user joins the default organization.
    private readonly organizations: OrganizationsService,
    // PP-6.2 (#722): the same tenancy rules as a Google sign-in.
    private readonly tenancy: TenancyService,
  ) {}

  /**
   * Login as test user - bypass OAuth and allowlist for testing
   *
   * The `role` maps onto the split RBAC (PP-6.3, #723) the way
   * `PUT /api/users/:id/roles` does in single-org mode: `admin` is the system
   * `admin` role plus `org_admin` on the default-org membership;
   * `contributor` and `viewer` are that membership's role with no system role.
   */
  async loginAsTestUser(dto: TestLoginDto): Promise<TestAuthTokenResponse> {
    this.logger.log(`Test login for email: ${dto.email} with role: ${dto.role}`);

    const email = dto.email.toLowerCase();
    const isInitialAdmin = this.isInitialAdminEmail(email);
    let userWasCreated = false;

    const roleName = dto.role || DEFAULT_ORG_ROLE;
    const isAdmin = roleName === ROLES.ADMIN;
    const membershipRoleName = isAdmin ? ORG_ADMIN_ROLE : roleName;

    // Resolve the roles first: a missing row is a seed problem.
    const membershipRole = await this.prisma.role.findUnique({
      where: { name: membershipRoleName },
    });
    const adminRole = isAdmin
      ? await this.prisma.role.findUnique({ where: { name: ROLES.ADMIN } })
      : null;

    if (!membershipRole || (isAdmin && !adminRole)) {
      throw new Error(`Role ${dto.role} not found`);
    }

    // Find or create user
    let user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (!user) {
      // Create new user
      const displayName = dto.displayName || email.split('@')[0];

      // Same shape as `AuthService.createNewUser`: the user and its default
      // org membership are created in one transaction (PP-6.1, #721), when the
      // tenancy mode auto-joins this user (PP-6.2, #722): everyone in single
      // mode, only the initial admin in multi.
      const defaultOrg = this.tenancy.autoJoinsDefaultOrg(isInitialAdmin)
        ? await this.organizations.getDefaultOrg()
        : null;

      user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email,
            displayName,
            isActive: true,
            // Create default user settings
            userSettings: {
              create: {
                value: DEFAULT_USER_SETTINGS as any,
              },
            },
          },
        });
        if (defaultOrg) {
          await this.organizations.ensureMembership(
            tx,
            defaultOrg.id,
            created.id,
            membershipRole.id,
          );
        }
        return created;
      });
      userWasCreated = true;

      this.logger.log(`Created test user: ${email}`);
    }

    const userId = user.id;

    // Tenancy mode (PP-6.2, #722), exactly as `AuthService` applies it to a
    // Google sign-in: test login bypasses OAuth and the allowlist, never the
    // organization rules, so an e2e suite in multi mode sees the real refusal.
    // Before the role swap below, so a refused login changes nothing.
    if (!userWasCreated && this.tenancy.autoJoinsDefaultOrg(isInitialAdmin)) {
      await this.organizations.ensureDefaultOrgMembership(userId, membershipRoleName);
    }
    if (
      this.tenancy.capabilities.requireActiveMembership &&
      (await this.organizations.countActiveMemberships(userId)) === 0
    ) {
      this.logger.warn(
        `Test login denied - user ${userId} has no active organization membership (tenancy mode multi)`,
      );
      throw new AuthLoginDeniedException(
        'no_organization',
        'Your account is not a member of any organization. Ask an organization administrator to invite you.',
      );
    }

    // Replace the system roles and set the default-org membership's role, so
    // the same email can be logged in under a different role back to back. A
    // user with no default-org membership (multi mode) keeps its memberships.
    await this.prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId } });
      if (adminRole) {
        await tx.userRole.create({ data: { userId, roleId: adminRole.id } });
      }
      await tx.membership.updateMany({
        where: { userId, org: { isDefault: true } },
        data: { roleId: membershipRole.id },
      });
    });

    // Principal cache (PP-1.12, #683): after the transaction committed. E2E
    // suites log the same email in under different roles back to back.
    this.principalCache.invalidate({ userId });

    // Reload user with updated roles
    const reloaded = await this.prisma.user.findUnique({
      where: { id: userId },
      include: PRINCIPAL_USER_INCLUDE,
    });

    if (!reloaded) {
      throw new Error('Failed to reload user after role assignment');
    }

    // The active organization (#724), by the same rule as a Google sign-in:
    // single mode, the default org's membership; multi mode, the most
    // recently used active membership.
    const orgId = await this.organizations.signInOrgId(reloaded, this.tenancy.mode());
    if (!orgId) {
      throw new AuthLoginDeniedException(
        'no_organization',
        'Your account is not a member of any organization. Ask an organization administrator to invite you.',
      );
    }

    // System roles plus the current org role (`admin` + `org_admin` for an admin).
    const roles = principalFactory.access({ ...reloaded, activeOrgId: orgId }).roles;

    const payload: JwtPayload = {
      sub: reloaded.id,
      email: reloaded.email,
      roles,
      org: orgId,
    };

    const accessTtlMinutes = this.configService.get<number>(
      'jwt.accessTtlMinutes',
      15,
    );

    const accessToken = this.jwtService.sign(payload);

    // Create refresh token, bound to the same organization
    const refreshToken = await this.createRefreshToken(reloaded.id, orgId);
    await this.organizations.touchMembership(orgId, reloaded.id);

    this.logger.log(`Test login successful for user: ${reloaded.email} with roles: ${roles.join(', ')}`);

    return {
      accessToken,
      expiresIn: accessTtlMinutes * 60, // Convert to seconds
      refreshToken,
      user: {
        id: reloaded.id,
        email: reloaded.email,
        displayName: reloaded.displayName,
        roles,
      },
    };
  }

  /** Same rule as `AuthService.isInitialAdminEmail`. */
  private isInitialAdminEmail(email: string): boolean {
    const initialAdminEmail = this.configService.get<string>('INITIAL_ADMIN_EMAIL');
    return initialAdminEmail ? email === initialAdminEmail.toLowerCase() : false;
  }

  /**
   * Create a new refresh token (copied from AuthService)
   */
  private async createRefreshToken(userId: string, orgId: string): Promise<string> {
    const refreshTtlDays = this.configService.get<number>(
      'jwt.refreshTtlDays',
      14,
    );
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + refreshTtlDays);

    // Generate random token
    const token = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(token);

    // Store hashed token in database
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
        orgId,
      },
    });

    this.logger.debug(`Created refresh token for user: ${userId}`);

    return token;
  }

  /**
   * Hash token for storage
   */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}

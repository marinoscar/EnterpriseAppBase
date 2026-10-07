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
   */
  async loginAsTestUser(dto: TestLoginDto): Promise<TestAuthTokenResponse> {
    this.logger.log(`Test login for email: ${dto.email} with role: ${dto.role}`);

    const email = dto.email.toLowerCase();
    const isInitialAdmin = this.isInitialAdminEmail(email);
    let userWasCreated = false;

    // Find or create user
    let user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        userRoles: {
          include: {
            role: true,
          },
        },
      },
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
          include: {
            userRoles: {
              include: {
                role: true,
              },
            },
          },
        });
        if (defaultOrg) {
          await this.organizations.ensureMembership(tx, defaultOrg.id, created.id);
        }
        return created;
      });
      userWasCreated = true;

      this.logger.log(`Created test user: ${email}`);
    }

    // Tenancy mode (PP-6.2, #722), exactly as `AuthService` applies it to a
    // Google sign-in: test login bypasses OAuth and the allowlist, never the
    // organization rules, so an e2e suite in multi mode sees the real refusal.
    // Before the role swap below, so a refused login changes nothing.
    if (!userWasCreated && this.tenancy.autoJoinsDefaultOrg(isInitialAdmin)) {
      await this.organizations.ensureDefaultOrgMembership(user.id);
    }
    if (
      this.tenancy.capabilities.requireActiveMembership &&
      (await this.organizations.countActiveMemberships(user.id)) === 0
    ) {
      this.logger.warn(
        `Test login denied - user ${user.id} has no active organization membership (tenancy mode multi)`,
      );
      throw new AuthLoginDeniedException(
        'no_organization',
        'Your account is not a member of any organization. Ask an organization administrator to invite you.',
      );
    }

    // Assign specified role (replace existing roles)
    const targetRole = await this.prisma.role.findUnique({
      where: { name: dto.role || 'viewer' },
    });

    if (!targetRole) {
      throw new Error(`Role ${dto.role} not found`);
    }

    // Remove all existing roles and assign the specified role
    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({
        where: { userId: user.id },
      }),
      this.prisma.userRole.create({
        data: {
          userId: user.id,
          roleId: targetRole.id,
        },
      }),
    ]);

    // Principal cache (PP-1.12, #683): after the transaction committed. E2E
    // suites log the same email in under different roles back to back.
    this.principalCache.invalidate({ userId: user.id });

    // Reload user with updated roles
    user = await this.prisma.user.findUnique({
      where: { id: user.id },
      include: {
        userRoles: {
          include: {
            role: true,
          },
        },
      },
    });

    if (!user) {
      throw new Error('Failed to reload user after role assignment');
    }

    // Generate JWT tokens
    const roles = user.userRoles.map((ur) => ur.role.name);

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      roles,
    };

    const accessTtlMinutes = this.configService.get<number>(
      'jwt.accessTtlMinutes',
      15,
    );

    const accessToken = this.jwtService.sign(payload);

    // Create refresh token
    const refreshToken = await this.createRefreshToken(user.id);

    this.logger.log(`Test login successful for user: ${user.email} with roles: ${roles.join(', ')}`);

    return {
      accessToken,
      expiresIn: accessTtlMinutes * 60, // Convert to seconds
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
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
  private async createRefreshToken(userId: string): Promise<string> {
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

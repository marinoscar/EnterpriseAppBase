import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PLATFORM_PRISMA } from '../../core/index';
import type { IdentityPrisma } from '../ports';
import { PrincipalCache } from './principal-cache/principal-cache.service';
import { ORG_ADMIN_ROLE, ROLES } from '../identity.constants';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS, type ResolvedIdentityModuleOptions } from '../identity.options';

@Injectable()
export class AdminBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(AdminBootstrapService.name);

  constructor(
    @Inject(PLATFORM_PRISMA) private readonly prisma: IdentityPrisma,
    private readonly config: ConfigService,
    // PP-1.12 (#683): `assignAdminRole` changes what the user's JWT resolves to.
    private readonly principalCache: PrincipalCache,
    @Optional() @Inject(IDENTITY_OPTIONS)
    private readonly identityOptions: ResolvedIdentityModuleOptions = DEFAULT_IDENTITY_OPTIONS,
  ) {}

  async onModuleInit() {
    // Only run in development or when explicitly enabled
    if (this.config.get('NODE_ENV') === 'production') {
      this.logger.log('Admin bootstrap disabled in production');
      return;
    }

    await this.ensureInitialAdminRole();
  }

  /**
   * Ensures the initial admin email (from env) has admin role assigned
   * when they first log in. This is handled during OAuth callback.
   */
  private async ensureInitialAdminRole() {
    const initialAdminEmail = this.config.get<string>(this.identityOptions.initialAdminEmailEnv);

    if (!initialAdminEmail) {
      this.logger.warn(
        `${this.identityOptions.initialAdminEmailEnv} not set - no admin will be auto-assigned`,
      );
      return;
    }

    this.logger.log(
      `Admin bootstrap configured for: ${initialAdminEmail}`,
    );
  }

  /**
   * Called during OAuth callback to check if user should be granted admin
   */
  async shouldGrantAdminRole(email: string): Promise<boolean> {
    const initialAdminEmail = this.config.get<string>(this.identityOptions.initialAdminEmailEnv);

    if (!initialAdminEmail) {
      return false;
    }

    // Check if any admin already exists
    const adminRole = await this.prisma.role.findUnique({
      where: { name: 'admin' },
      include: {
        userRoles: {
          include: { user: true },
        },
      },
    });

    if (!adminRole) {
      return false;
    }

    const existingAdmins = adminRole.userRoles.filter(
      (ur) => ur.user.isActive,
    );

    // Only grant admin if:
    // 1. Email matches INITIAL_ADMIN_EMAIL
    // 2. No other active admins exist
    if (existingAdmins.length === 0 && email === initialAdminEmail) {
      this.logger.log(`Granting admin role to initial admin: ${email}`);
      return true;
    }

    return false;
  }

  /**
   * Assigns the system admin role to a user, and `org_admin` on their
   * default-organization membership (PP-6.3, #723: an administrator holds
   * both, as the initial administrator does).
   */
  async assignAdminRole(userId: string): Promise<void> {
    const adminRole = await this.prisma.role.findUnique({
      where: { name: ROLES.ADMIN },
    });
    const orgAdminRole = await this.prisma.role.findUnique({
      where: { name: ORG_ADMIN_ROLE },
    });

    if (!adminRole || !orgAdminRole) {
      throw new Error('Admin role not found - run seeds first');
    }

    await this.prisma.membership.updateMany({
      where: { userId, org: { isDefault: true } },
      data: { roleId: orgAdminRole.id },
    });

    await this.prisma.userRole.upsert({
      where: {
        userId_roleId: {
          userId,
          roleId: adminRole.id,
        },
      },
      update: {},
      create: {
        userId,
        roleId: adminRole.id,
      },
    });

    // Principal cache (PP-1.12, #683): the grant reaches the next request.
    this.principalCache.invalidate({ userId });

    this.logger.log(`Admin role assigned to user: ${userId}`);
  }
}

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { PrincipalCache } from '../../auth/principal-cache/principal-cache.service';
import { ORG_ADMIN_ROLE, ROLES } from '../constants/roles.constants';

@Injectable()
export class AdminBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(AdminBootstrapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    // PP-1.12 (#683): `assignAdminRole` changes what the user's JWT resolves to.
    private readonly principalCache: PrincipalCache,
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
    const initialAdminEmail = this.config.get<string>('INITIAL_ADMIN_EMAIL');

    if (!initialAdminEmail) {
      this.logger.warn(
        'INITIAL_ADMIN_EMAIL not set - no admin will be auto-assigned',
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
    const initialAdminEmail = this.config.get<string>('INITIAL_ADMIN_EMAIL');

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

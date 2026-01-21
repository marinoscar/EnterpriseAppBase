import {
  Injectable,
  Logger,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { AdminBootstrapService } from '../common/services/admin-bootstrap.service';
import { DEFAULT_ROLE } from '../common/constants/roles.constants';
import { DEFAULT_USER_SETTINGS } from '../common/types/settings.types';
import { GoogleProfile } from './strategies/google.strategy';
import { JwtPayload } from './strategies/jwt.strategy';
import { RequestUser } from './decorators/current-user.decorator';
import { TokenResponseDto } from './dto/auth-user.dto';
import { AuthProviderDto } from './dto/auth-provider.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly adminBootstrapService: AdminBootstrapService,
  ) {}

  /**
   * Handles Google OAuth login
   * Creates or updates user, links identity, checks admin bootstrap
   */
  async handleGoogleLogin(
    profile: GoogleProfile,
  ): Promise<TokenResponseDto> {
    this.logger.log(`Google login attempt for email: ${profile.email}`);

    // Check if identity already exists
    let identity = await this.prisma.userIdentity.findUnique({
      where: {
        provider_providerSubject: {
          provider: 'google',
          providerSubject: profile.id,
        },
      },
      include: {
        user: {
          include: {
            userRoles: {
              include: {
                role: {
                  include: {
                    rolePermissions: {
                      include: {
                        permission: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    let user = identity?.user || null;

    if (!user) {
      // Check if user exists by email (identity linking case)
      const existingUser = await this.prisma.user.findUnique({
        where: { email: profile.email },
        include: {
          userRoles: {
            include: {
              role: {
                include: {
                  rolePermissions: {
                    include: {
                      permission: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (existingUser) {
        // Link new identity to existing user
        this.logger.log(
          `Linking Google identity to existing user: ${existingUser.email}`,
        );
        await this.prisma.userIdentity.create({
          data: {
            userId: existingUser.id,
            provider: 'google',
            providerSubject: profile.id,
            providerEmail: profile.email,
          },
        });
        user = existingUser;
      } else {
        // Create new user with identity
        this.logger.log(`Creating new user: ${profile.email}`);
        user = await this.createNewUser(profile);
      }
    }

    // Update provider profile information (don't overwrite user overrides)
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        providerDisplayName: profile.displayName,
        providerProfileImageUrl: profile.picture || null,
      },
    });

    // Check if user is disabled
    if (!user.isActive) {
      this.logger.warn(`Login attempt by disabled user: ${user.email}`);
      throw new ForbiddenException('User account is disabled');
    }

    // Generate JWT tokens
    const tokens = await this.generateTokens(user);

    this.logger.log(`Login successful for user: ${user.email}`);
    return tokens;
  }

  /**
   * Creates a new user with default role, settings, and identity
   * Handles admin bootstrap if applicable
   */
  private async createNewUser(profile: GoogleProfile) {
    // Check if this should be the initial admin
    const shouldGrantAdmin =
      await this.adminBootstrapService.shouldGrantAdminRole(profile.email);

    // Get default role
    const defaultRole = await this.prisma.role.findUnique({
      where: { name: DEFAULT_ROLE },
      include: {
        rolePermissions: {
          include: {
            permission: true,
          },
        },
      },
    });

    if (!defaultRole) {
      throw new Error('Default role not found - run seeds first');
    }

    // Create user with identity, role, and settings in transaction
    const user = await this.prisma.$transaction(async (tx) => {
      // Create user
      const newUser = await tx.user.create({
        data: {
          email: profile.email,
          providerDisplayName: profile.displayName,
          providerProfileImageUrl: profile.picture || null,
          isActive: true,
          // Create identity
          identities: {
            create: {
              provider: 'google',
              providerSubject: profile.id,
              providerEmail: profile.email,
            },
          },
          // Assign default role
          userRoles: {
            create: {
              roleId: defaultRole.id,
            },
          },
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
              role: {
                include: {
                  rolePermissions: {
                    include: {
                      permission: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      // Grant admin role if applicable
      if (shouldGrantAdmin) {
        await this.adminBootstrapService.assignAdminRole(newUser.id);

        // Reload user with admin role included
        const userWithAdmin = await tx.user.findUnique({
          where: { id: newUser.id },
          include: {
            userRoles: {
              include: {
                role: {
                  include: {
                    rolePermissions: {
                      include: {
                        permission: true,
                      },
                    },
                  },
                },
              },
            },
          },
        });

        return userWithAdmin!;
      }

      return newUser;
    });

    this.logger.log(`User created successfully: ${user.email}`);
    return user;
  }

  /**
   * Generates JWT access token for authenticated user
   */
  async generateTokens(user: {
    id: string;
    email: string;
    userRoles: Array<{ role: { name: string } }>;
  }): Promise<TokenResponseDto> {
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

    const accessToken = await this.jwtService.signAsync(payload, {
      expiresIn: `${accessTtlMinutes}m`,
    });

    return {
      accessToken,
      expiresIn: accessTtlMinutes * 60, // Convert to seconds
    };
  }

  /**
   * Validates JWT payload and returns user with roles and permissions
   */
  async validateJwtPayload(payload: JwtPayload): Promise<RequestUser | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        userRoles: {
          include: {
            role: {
              include: {
                rolePermissions: {
                  include: {
                    permission: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!user || !user.isActive) {
      return null;
    }

    // Extract roles
    const roles = user.userRoles.map((ur) => ur.role.name);

    // Aggregate permissions from all roles
    const permissionsSet = new Set<string>();
    user.userRoles.forEach((ur) => {
      ur.role.rolePermissions.forEach((rp) => {
        permissionsSet.add(rp.permission.name);
      });
    });
    const permissions = Array.from(permissionsSet);

    return {
      userId: user.id,
      email: user.email,
      roles,
      permissions,
    };
  }

  /**
   * Returns list of enabled OAuth providers
   */
  async getEnabledProviders(): Promise<AuthProviderDto[]> {
    const providers: AuthProviderDto[] = [];

    // Check if Google OAuth is configured
    const googleClientId = this.configService.get<string>('google.clientId');
    const googleClientSecret = this.configService.get<string>(
      'google.clientSecret',
    );

    if (googleClientId && googleClientSecret) {
      providers.push({
        name: 'google',
        enabled: true,
      });
    }

    return providers;
  }

  /**
   * Returns current user details with computed display name and image
   */
  async getCurrentUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        userRoles: {
          include: {
            role: {
              include: {
                rolePermissions: {
                  include: {
                    permission: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Compute display name (override takes precedence)
    const displayName = user.displayName || user.providerDisplayName || null;

    // Compute profile image URL (override takes precedence)
    const profileImageUrl =
      user.profileImageUrl || user.providerProfileImageUrl || null;

    // Extract roles
    const roles = user.userRoles.map((ur) => ({
      name: ur.role.name,
    }));

    // Aggregate permissions
    const permissionsSet = new Set<string>();
    user.userRoles.forEach((ur) => {
      ur.role.rolePermissions.forEach((rp) => {
        permissionsSet.add(rp.permission.name);
      });
    });
    const permissions = Array.from(permissionsSet);

    return {
      id: user.id,
      email: user.email,
      displayName,
      profileImageUrl,
      isActive: user.isActive,
      roles,
      permissions,
    };
  }
}

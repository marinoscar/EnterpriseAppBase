import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import type { CredentialKind } from '@marinoscar/platform-api/core';
import { ConfigService } from '@nestjs/config';
import { trace } from '@opentelemetry/api';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  AppMetricsService,
  fallbackAppMetrics,
} from '../common/otel/app-metrics.service';
import { AdminBootstrapService } from '../common/services/admin-bootstrap.service';
import { AllowlistService } from '../allowlist/allowlist.service';
import { DatabaseSeedException } from '@marinoscar/platform-api/core';
import {
  DEFAULT_ORG_ROLE,
  ORG_ADMIN_ROLE,
  ROLES,
} from '../common/constants/roles.constants';
import { DEFAULT_USER_SETTINGS } from '../common/types/settings.types';
import {
  normalizeProfileSettings,
  resolveProfileImageUrl,
} from '../common/profile-image/profile-image';
import { AuthLoginDeniedException } from './auth-error-codes';
import { GoogleProfile } from './strategies/google.strategy';
import { JwtPayload } from './strategies/jwt.strategy';
import { AuthenticatedUser } from './interfaces/authenticated-user.interface';
import {
  PRINCIPAL_USER_INCLUDE,
  principalFactory,
  selectCurrentMembership,
  type PrincipalMembership,
} from './principal.factory';
import { bindCredential, hasActiveMembership } from './credential-binding';
import { TokenResponseDto } from './dto/auth-user.dto';
import { AuthProviderDto } from './dto/auth-provider.dto';
import { NotificationsService } from '../notifications/notifications.service';
import type { UserWelcomeEmailData } from '../email';
import { PrincipalCache } from './principal-cache/principal-cache.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { TenancyService } from '../organizations/tenancy.service';

export interface FullTokenResponse {
  accessToken: string;
  expiresIn: number;
  refreshToken?: string; // Only returned on initial auth, not refresh
}

/** The audit action `POST /api/auth/switch-org` writes (#724). */
export const ORG_SWITCHED_AUDIT_ACTION = 'auth:org_switched';

/** How long the default organization's id is memoised for the legacy-token path (#724). */
const DEFAULT_ORG_MEMO_MS = 60_000;

/** `/api/auth/me`'s graph: the principal graph plus each membership's org name and slug (#724). */
const CURRENT_USER_INCLUDE = {
  ...PRINCIPAL_USER_INCLUDE,
  memberships: {
    include: {
      org: { select: { id: true, isDefault: true, name: true, slug: true } },
      role: PRINCIPAL_USER_INCLUDE.memberships.include.role,
    },
  },
  userSettings: {
    select: { value: true },
  },
} as const;

/** A loaded user whose memberships the active-org rules can read. */
type MembershipGraph = {
  id: string;
  memberships?: ReadonlyArray<PrincipalMembership> | null;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  /**
   * When this process started. A token issued before #724 carries no `org`
   * claim; it is honoured (single mode only) until one access-token lifetime
   * past this instant, so in-flight tokens survive the deploy (#724).
   */
  private readonly startedAt = Date.now();

  /** The default organization's id, memoised briefly for the legacy-token path. */
  private defaultOrgMemo: { id: string; at: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly adminBootstrapService: AdminBootstrapService,
    private readonly allowlistService: AllowlistService,
    private readonly notifications: NotificationsService,
    // PP-1.12 (#683): JWT principals are read through this short-TTL cache.
    private readonly principalCache: PrincipalCache,
    // PP-6.1 (#721): new users join the default organization.
    private readonly organizations: OrganizationsService,
    // PP-6.2 (#722): TENANCY_MODE decides who joins the default org and who
    // is refused for having no organization.
    private readonly tenancy: TenancyService,
    // #600. Optional: see `fallbackAppMetrics`.
    @Optional()
    private readonly metrics: AppMetricsService = fallbackAppMetrics(),
  ) {}

  /**
   * Handles Google OAuth login
   * Creates or updates user, links identity, checks admin bootstrap
   */
  async handleGoogleLogin(
    profile: GoogleProfile,
  ): Promise<FullTokenResponse> {
    this.logger.log(`Google login attempt for email: ${profile.email}`);

    // Check allowlist before any user lookup/creation
    const email = profile.email.toLowerCase();
    const isAllowed = await this.allowlistService.isEmailAllowed(email);
    const isInitialAdmin = this.isInitialAdminEmail(email);

    if (!isAllowed && !isInitialAdmin) {
      this.logger.warn(`Login denied - email not in allowlist: ${email}`);
      this.metrics.authLogin('allowlist_rejected');
      throw new AuthLoginDeniedException(
        'not_allowlisted',
        'Your email is not authorized to access this application. Please contact an administrator.',
      );
    }

    // Check if identity already exists
    let identity = await this.prisma.userIdentity.findUnique({
      where: {
        provider_providerSubject: {
          provider: 'google',
          providerSubject: profile.id,
        },
      },
      include: {
        // System roles and memberships with their org roles (PP-6.3, #723).
        user: { include: PRINCIPAL_USER_INCLUDE },
      },
    });

    let user = identity?.user || null;

    // Set ONLY on the branch below that actually inserts a user row. This is
    // the fire-once condition for `user.welcome` (#128) — see the trigger at
    // the end of this method for why the notification is raised there and not
    // inside the branch.
    let userWasCreated = false;

    if (!user) {
      // Check if user exists by email (identity linking case)
      const existingUser = await this.prisma.user.findUnique({
        where: { email: profile.email },
        include: PRINCIPAL_USER_INCLUDE,
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
        user = await this.createNewUser(profile, isInitialAdmin);
        userWasCreated = true;

        // Mark email as claimed in allowlist
        await this.allowlistService.markEmailClaimed(email, user.id);
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
    // Principal cache (PP-1.12, #683): the cached row carries these columns.
    this.principalCache.invalidate({ userId: user.id });

    // Check if user is disabled
    if (!user.isActive) {
      this.logger.warn(`Login attempt by disabled user: ${user.email}`);
      this.metrics.authLogin('disabled');
      throw new AuthLoginDeniedException(
        'account_disabled',
        'User account is disabled',
      );
    }

    // Tenancy mode (PP-6.2, #722): self-heal the default-org membership, or
    // refuse a multi-org sign-in that belongs to no organization. After the
    // disabled check, so a deactivated account is told that first and never
    // written to.
    await this.applyTenancyAtSignIn(user.id, {
      isInitialAdmin,
      userWasCreated,
      // A restored membership's org role (PP-6.3, #723): an administrator's
      // is org_admin, everyone else's the default org role.
      orgRoleName: user.userRoles.some((ur) => ur.role.name === ROLES.ADMIN)
        ? ORG_ADMIN_ROLE
        : DEFAULT_ORG_ROLE,
    });

    // The active organization (#724): single mode, the default org; multi
    // mode, the active membership used most recently. Refused when there is
    // none (a suspended default-org member in single mode; multi mode already
    // refused zero memberships above).
    const orgId = await this.chooseSignInOrg(user);
    if (!orgId) {
      this.logger.warn(
        `Login denied - user ${user.id} has no active organization membership to sign in to`,
      );
      this.metrics.authLogin('no_organization');
      throw new AuthLoginDeniedException(
        'no_organization',
        'Your account is not a member of any organization. Ask an organization administrator to invite you.',
      );
    }

    // Generate JWT tokens, bound to that organization
    const tokens = await this.generateFullTokens(user, { orgId });
    await this.organizations.touchMembership(orgId, user.id);

    this.logger.log(`Login successful for user: ${user.email}`);
    this.metrics.authLogin('success');

    // -------------------------------------------------------------------------
    // Trigger: `user.welcome` (#128, epic #109)
    // -------------------------------------------------------------------------
    //
    // FIRES ONCE PER ACCOUNT, and the guarantee is structural rather than a
    // check on some "welcomed" column. `userWasCreated` is set on exactly one
    // branch above: the one reached only when NO identity matched
    // (provider + subject) AND no user matched by email — i.e. the branch that
    // runs `INSERT INTO users`. Every subsequent login resolves an identity and
    // never enters it, and the identity-LINKING case (an existing account
    // adding a second provider) is a different branch that does not set the
    // flag, correctly: that user already has an account and was welcomed when
    // it was made.
    //
    // AND ONLY AFTER THE ROW IS COMMITTED. `createNewUser` wraps its inserts in
    // `prisma.$transaction`, and that promise has resolved — the transaction
    // has committed — before it returns. So by the time this line runs, the
    // user, its identity, its default role and its `user_settings` row are all
    // durable. That matters concretely: the dispatcher reads BOTH `users.email`
    // (for the address) and `user_settings.value` (for preferences) on its own
    // connection, outside any transaction of ours. Raising this inside
    // `createNewUser`'s transaction would have the dispatch race a row it
    // cannot see, and `loadRecipient` would log "user not found" and deliver
    // nothing.
    //
    // RAISED HERE, AT THE END, RATHER THAN IN THE CREATION BRANCH. Between the
    // insert and this point the method can still refuse the login — the
    // `isActive` check, or a failure generating tokens. Welcoming somebody to
    // an application they were just refused entry to is a worse message than
    // no message. The flag carries the fire-once condition down to the point
    // where the login is known to have succeeded.
    //
    // CONTAINED: `notify` never rejects and never joins a transaction, so a
    // mail outage cannot fail the login. It also returns before anything is
    // rendered or sent, so it adds no latency to the OAuth callback.
    if (userWasCreated) {
      const appUrl = this.configService.get<string>('appUrl');
      const payload: UserWelcomeEmailData = {
        recipientEmail: user.email,
        // Optional fields spread in conditionally rather than assigned
        // `undefined` — same convention as the notification channels.
        ...(profile.displayName ? { recipientName: profile.displayName } : {}),
        // System roles plus the default-org role (PP-6.3, #723).
        roles: principalFactory.access(user).roles,
        ...(appUrl ? { appUrl: appUrl.replace(/\/+$/, '') } : {}),
      };

      await this.notifications.notify('user.welcome', user.id, payload);
    }

    return tokens;
  }

  /**
   * Tenancy at sign-in (PP-6.2, #722), by `TENANCY_MODE`:
   *
   * - **single**: every signing-in user is ensured a membership in the default
   *   organization. A new user already got one inside `createNewUser`'s
   *   transaction; a returning user who somehow lacks one gets it here, so the
   *   auto-join is self-healing rather than only applied at creation.
   * - **multi**: nobody is auto-joined except the `INITIAL_ADMIN_EMAIL`
   *   account (so the deployment can be administered), and a user with zero
   *   active memberships is refused with `no_organization`. Invite claiming
   *   (#726) will run before this check.
   *
   * The mode goes on the active (HTTP request) span as `tenancy.mode`; the
   * auth path has no span of its own. Never an org id on a metric label.
   */
  private async applyTenancyAtSignIn(
    userId: string,
    {
      isInitialAdmin,
      userWasCreated,
      orgRoleName,
    }: { isInitialAdmin: boolean; userWasCreated: boolean; orgRoleName: string },
  ): Promise<void> {
    trace.getActiveSpan()?.setAttribute('tenancy.mode', this.tenancy.mode());

    // A user created on this sign-in was joined (or not) by `createNewUser`,
    // under the same rule, inside its transaction: nothing to heal.
    if (!userWasCreated && this.tenancy.autoJoinsDefaultOrg(isInitialAdmin)) {
      const { orgId, created } =
        await this.organizations.ensureDefaultOrgMembership(userId, orgRoleName);
      if (created) {
        // Principal cache (PP-1.12, #683): the restored membership carries an
        // org role (PP-6.3, #723), so the next request must see it.
        this.principalCache.invalidate({ userId });
        this.logger.log(
          `User ${userId} joined default organization ${orgId} at sign-in (self-heal)`,
        );
      }
    }

    if (this.tenancy.capabilities.requireActiveMembership) {
      const active = await this.organizations.countActiveMemberships(userId);
      if (active === 0) {
        // Audit: the user id only, never the email.
        this.logger.warn(
          `Login denied - user ${userId} has no active organization membership (tenancy mode multi)`,
        );
        this.metrics.authLogin('no_organization');
        throw new AuthLoginDeniedException(
          'no_organization',
          'Your account is not a member of any organization. Ask an organization administrator to invite you.',
        );
      }
    }
  }

  /**
   * Creates a new user with identity and settings. Handles admin bootstrap
   * if applicable.
   *
   * Joins the default organization in the same transaction when the tenancy
   * mode says so (always in single mode; only the initial admin in multi).
   *
   * Roles after the RBAC split (PP-6.3, #723): an ordinary sign-up holds NO
   * system role and gets `DEFAULT_ORG_ROLE` (viewer) on its membership. The
   * initial administrator gets the system `admin` role in `user_roles` plus
   * `ORG_ADMIN_ROLE` on the default-org membership.
   */
  private async createNewUser(profile: GoogleProfile, isInitialAdmin: boolean) {
    // Check if this should be the initial admin
    const shouldGrantAdmin =
      await this.adminBootstrapService.shouldGrantAdminRole(profile.email);

    // The membership's org role, with its permissions (the returned principal
    // carries them). Resolved before the transaction: a missing row is a seed
    // problem and must fail before anything is written.
    const membershipRoleName = shouldGrantAdmin ? ORG_ADMIN_ROLE : DEFAULT_ORG_ROLE;
    const membershipRole = await this.prisma.role.findUnique({
      where: { name: membershipRoleName },
      include: {
        rolePermissions: {
          include: {
            permission: true,
          },
        },
      },
    });

    if (!membershipRole) {
      this.logger.error(
        `CRITICAL: Role "${membershipRoleName}" not found in database. ` +
          'Database seeds have not been run. Cannot create new users.',
      );
      throw new DatabaseSeedException(
        `Role "${membershipRoleName}"`,
        'npm run prisma:seed',
      );
    }

    // The default organization a new user joins (PP-6.1, #721), when the
    // tenancy mode auto-joins this user (PP-6.2, #722): everyone in single
    // mode, only the initial admin in multi. Resolved before the transaction
    // like the default role: a missing row is a seed problem and must fail
    // before anything is written.
    const defaultOrg = this.tenancy.autoJoinsDefaultOrg(isInitialAdmin)
      ? await this.organizations.getDefaultOrg()
      : null;

    // Create user with identity, settings and membership in a transaction
    const user = await this.prisma.$transaction(async (tx) => {
      // Create user. No system role: an ordinary member holds only the
      // membership role below.
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
          // Create default user settings
          userSettings: {
            create: {
              value: DEFAULT_USER_SETTINGS as any,
            },
          },
        },
        include: PRINCIPAL_USER_INCLUDE,
      });

      // Join the default organization with its org role, in the same
      // transaction as the user.
      const membership = defaultOrg
        ? await this.organizations.ensureMembership(
            tx,
            defaultOrg.id,
            newUser.id,
            membershipRole.id,
          )
        : null;

      // Grant the system admin role if applicable
      if (shouldGrantAdmin) {
        const adminRole = await tx.role.findUnique({
          where: { name: ROLES.ADMIN },
        });

        if (!adminRole) {
          this.logger.error(
            'CRITICAL: Admin role not found in database. Database seeds have not been run.',
          );
          throw new DatabaseSeedException('Role "admin"', 'npm run prisma:seed');
        }

        await tx.userRole.upsert({
          where: {
            userId_roleId: {
              userId: newUser.id,
              roleId: adminRole.id,
            },
          },
          update: {},
          create: {
            userId: newUser.id,
            roleId: adminRole.id,
          },
        });
        this.logger.log(`Admin role assigned to user: ${newUser.id}`);

        // Reload with the principal graph: the system role and the membership.
        const userWithAdmin = await tx.user.findUnique({
          where: { id: newUser.id },
          include: PRINCIPAL_USER_INCLUDE,
        });

        return userWithAdmin!;
      }

      // The principal graph without a second read: the user was created with
      // no system role, and the membership (if any) was written just above.
      return {
        ...newUser,
        memberships:
          membership && defaultOrg
            ? [
                {
                  ...membership,
                  org: { id: defaultOrg.id, isDefault: defaultOrg.isDefault },
                  role: membershipRole,
                },
              ]
            : [],
      };
    });

    // Principal cache (PP-1.12, #683): after the transaction (which may have
    // upserted the admin role) committed. The user is new, so nothing should
    // be cached for it — belt and braces.
    this.principalCache.invalidate({ userId: user.id });

    if (defaultOrg) {
      this.logger.log(
        `User ${user.id} joined default organization ${defaultOrg.id} as ${membershipRoleName}`,
      );
    }
    this.logger.log(`User created successfully: ${user.email}`);
    return user;
  }

  /**
   * The organization a NEW sign-in (or a credential issued without an
   * explicit org) acts in (#724):
   *
   * - single mode: the default organization, unless the loaded graph shows the
   *   user's default-org membership suspended;
   * - multi mode: the active membership with the latest `lastActiveAt` (ties:
   *   the oldest), read from the graph or, when the graph has none, from the
   *   database.
   *
   * @returns the org id, or `null` when the user has no organization to act in.
   */
  async chooseSignInOrg(user: MembershipGraph): Promise<string | null> {
    if (this.tenancy.isSingle()) {
      const orgId = await this.defaultOrgIdOrNull();
      if (!orgId) return null;
      const membership = user.memberships?.find((candidate) => candidate.orgId === orgId);
      if (membership && membership.status !== 'active') return null;
      return orgId;
    }
    const loaded = selectCurrentMembership(user.memberships ?? undefined, 'multi');
    if (loaded) return loaded.orgId;
    const [latest] = await this.organizations.listActiveMemberships(user.id);
    return latest?.orgId ?? null;
  }

  /** {@link chooseSignInOrg}, or a 401 when there is none. */
  private async requireSignInOrg(user: MembershipGraph): Promise<string> {
    const orgId = await this.chooseSignInOrg(user);
    if (!orgId) {
      throw new UnauthorizedException('No active organization membership');
    }
    return orgId;
  }

  /**
   * The default organization's id, memoised for {@link DEFAULT_ORG_MEMO_MS};
   * `null` when it is missing (a seed problem: fail closed).
   */
  private async defaultOrgIdOrNull(): Promise<string | null> {
    const now = Date.now();
    if (this.defaultOrgMemo && now - this.defaultOrgMemo.at < DEFAULT_ORG_MEMO_MS) {
      return this.defaultOrgMemo.id;
    }
    try {
      const org = await this.organizations.getDefaultOrg();
      this.defaultOrgMemo = { id: org.id, at: now };
      return org.id;
    } catch (error) {
      this.logger.error(`Default organization lookup failed: ${String(error)}`);
      return null;
    }
  }

  /**
   * Generates JWT access token for authenticated user
   *
   * `orgId` is the organization the token acts in (#724); when omitted it is
   * chosen by {@link chooseSignInOrg}.
   */
  async generateTokens(
    user: {
      id: string;
      email: string;
      userRoles: Array<{ role: { name: string } }>;
      memberships?: ReadonlyArray<PrincipalMembership> | null;
    },
    orgId?: string,
  ): Promise<TokenResponseDto> {
    const roles = user.userRoles.map((ur) => ur.role.name);

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      roles,
      org: orgId ?? (await this.requireSignInOrg(user)),
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
   * Generate both access and refresh tokens
   *
   * `deviceCodeId` is set only by the device-authorization flow's session path
   * (issue #518): it stamps the access token with a `did` claim and links the
   * refresh token row to the `device_codes` row, so revoking that device
   * session reaches both credentials. See `validateJwtPayload` and
   * `refreshAccessToken` for where the link is enforced.
   *
   * `orgId` (#724) is the organization both tokens are bound to: the access
   * token's `org` claim and the refresh token row's `orgId`. When omitted it
   * is chosen by {@link chooseSignInOrg}.
   */
  async generateFullTokens(
    user: {
      id: string;
      email: string;
      userRoles: Array<{ role: { name: string } }>;
      memberships?: ReadonlyArray<PrincipalMembership> | null;
    },
    options?: {
      accessTtlMinutes?: number;
      refreshTtlDays?: number;
      deviceCodeId?: string;
      orgId?: string;
    },
  ): Promise<FullTokenResponse> {
    const orgId = options?.orgId ?? (await this.requireSignInOrg(user));
    const accessToken = this.generateAccessToken(user, {
      ttlMinutes: options?.accessTtlMinutes,
      deviceCodeId: options?.deviceCodeId,
      orgId,
    });
    const refreshToken = await this.createRefreshToken(user.id, {
      ttlDays: options?.refreshTtlDays,
      deviceCodeId: options?.deviceCodeId,
      orgId,
    });

    return {
      accessToken: accessToken.token,
      expiresIn: accessToken.expiresIn,
      refreshToken,
    };
  }

  /**
   * Generate access token only
   */
  private generateAccessToken(
    user: {
      id: string;
      email: string;
      userRoles: Array<{ role: { name: string } }>;
    },
    options: {
      ttlMinutes?: number;
      /** Exact lifetime in seconds; wins over `ttlMinutes` (used to cap a device chain). */
      ttlSeconds?: number;
      deviceCodeId?: string;
      /** The active organization (#724): the signed `org` claim. Always set. */
      orgId: string;
    },
  ) {
    const roles = user.userRoles.map((ur) => ur.role.name);

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      roles,
      org: options.orgId,
      // Only a device-issued token carries `did`; an interactive login's
      // payload is `{ sub, email, roles, org }`.
      ...(options.deviceCodeId ? { did: options.deviceCodeId } : {}),
    };

    if (options.ttlSeconds !== undefined) {
      return {
        token: this.jwtService.sign(payload, {
          expiresIn: `${options.ttlSeconds}s`,
        }),
        expiresIn: options.ttlSeconds,
      };
    }

    const accessTtlMinutes =
      options.ttlMinutes ??
      this.configService.get<number>('jwt.accessTtlMinutes', 15);

    return {
      token: this.jwtService.sign(payload, { expiresIn: `${accessTtlMinutes}m` }),
      expiresIn: accessTtlMinutes * 60,
    };
  }

  /**
   * Create a new refresh token
   *
   * `expiresAtCap` bounds the row's expiry from above: a refresh token rotated
   * out of a device-authorization session never outlives that session's
   * `credentialExpiresAt` (issue #518), however long the default TTL is.
   */
  private async createRefreshToken(
    userId: string,
    options: {
      ttlDays?: number;
      deviceCodeId?: string;
      expiresAtCap?: Date;
      /** The organization the session is bound to (#724). Always set. */
      orgId: string;
    },
  ): Promise<string> {
    const refreshTtlDays =
      options.ttlDays ??
      this.configService.get<number>('jwt.refreshTtlDays', 14);
    let expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + refreshTtlDays);

    if (options.expiresAtCap && options.expiresAtCap < expiresAt) {
      expiresAt = new Date(options.expiresAtCap.getTime());
    }

    // Generate random token
    const token = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(token);

    // Store hashed token in database
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
        orgId: options.orgId,
        ...(options.deviceCodeId ? { deviceCodeId: options.deviceCodeId } : {}),
      },
    });

    this.logger.debug(`Created refresh token for user: ${userId}`);

    return token;
  }

  /**
   * Refresh access token using refresh token
   *
   * A refresh token minted by the device-authorization flow carries
   * `deviceCodeId` (issue #518). Its chain stays a DEVICE chain across every
   * rotation: the new row keeps the link, the new access token keeps the `did`
   * claim, and neither may outlive the device session's `credentialExpiresAt`,
   * so rotating cannot launder a device credential into an ordinary 14-day
   * login. A chain whose device session was revoked refuses to rotate.
   *
   * ORG-PRESERVING (#724): the new tokens are bound to the SAME organization
   * as the presented one (`refresh_tokens.org_id`), and rotation fails (401)
   * once that membership is no longer active. A row written before #724 has
   * no org; it is bound to the org {@link chooseSignInOrg} picks.
   */
  async refreshAccessToken(refreshToken: string): Promise<FullTokenResponse> {
    const tokenHash = this.hashToken(refreshToken);

    // Find valid refresh token. The user is loaded with the principal graph
    // (memberships included) so the org membership can be checked.
    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: {
        user: { include: PRINCIPAL_USER_INCLUDE },
        deviceCode: {
          select: {
            id: true,
            userId: true,
            revokedAt: true,
            credentialExpiresAt: true,
            orgId: true,
          },
        },
      },
    });

    if (!storedToken) {
      this.metrics.authRefresh('invalid');
      throw new UnauthorizedException('Invalid refresh token');
    }

    const deviceCode = storedToken.deviceCodeId
      ? storedToken.deviceCode
      : null;

    // Check if revoked
    if (storedToken.revokedAt) {
      // A device whose session the user revoked still holds its last refresh
      // token and will present it; that is the expected aftermath of
      // `DELETE /api/auth/device/sessions/{id}`, not evidence of theft. Treat
      // it as reuse and we would sign the user out of every browser too.
      if (storedToken.deviceCodeId && (!deviceCode || deviceCode.revokedAt)) {
        this.logger.warn(
          `Refresh attempted on revoked device session ${storedToken.deviceCodeId} for user: ${storedToken.userId}`,
        );
        this.metrics.authRefresh('device_revoked');
        throw new UnauthorizedException('Refresh token has been revoked');
      }

      // Potential token reuse attack - revoke all tokens for user
      await this.revokeAllUserTokens(storedToken.userId);
      this.logger.warn(
        `Refresh token reuse detected for user: ${storedToken.userId}`,
      );
      this.metrics.authRefresh('reuse_detected');
      throw new UnauthorizedException('Refresh token has been revoked');
    }

    // Check if expired
    if (storedToken.expiresAt < new Date()) {
      this.metrics.authRefresh('expired');
      throw new UnauthorizedException('Refresh token has expired');
    }

    // Check if user is active
    if (!storedToken.user.isActive) {
      this.metrics.authRefresh('user_inactive');
      throw new UnauthorizedException('User account is deactivated');
    }

    // Device chain: the device session must still be live. A revoked (or
    // expired, or foreign) session kills the presented token too, so the next
    // attempt lands in the revoked branch above instead of here again.
    if (
      storedToken.deviceCodeId &&
      !this.isDeviceSessionLive(deviceCode, storedToken.userId)
    ) {
      await this.prisma.refreshToken.update({
        where: { id: storedToken.id },
        data: { revokedAt: new Date() },
      });
      this.logger.warn(
        `Refresh refused: device session ${storedToken.deviceCodeId} is revoked or expired (user: ${storedToken.userId})`,
      );
      this.metrics.authRefresh('device_revoked');
      throw new UnauthorizedException('Refresh token has been revoked');
    }

    // Org binding (#724): rotate for the same organization, and only while
    // that membership is active. A removed or suspended member's chain dies
    // here, and the presented token with it.
    const orgId =
      storedToken.orgId ??
      deviceCode?.orgId ??
      (await this.chooseSignInOrg(storedToken.user));
    if (!orgId || !hasActiveMembership(storedToken.user, orgId)) {
      await this.prisma.refreshToken.update({
        where: { id: storedToken.id },
        data: { revokedAt: new Date() },
      });
      this.logger.warn(
        `Refresh refused: user ${storedToken.userId} is no longer an active member of organization ${orgId ?? '(none)'}`,
      );
      this.metrics.authRefresh('no_organization');
      throw new UnauthorizedException('Organization membership is no longer active');
    }

    // Rotate token - revoke old one, create new one
    await this.prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revokedAt: new Date() },
    });

    // Generate new tokens
    if (storedToken.deviceCodeId && deviceCode?.credentialExpiresAt) {
      const credentialExpiresAt = deviceCode.credentialExpiresAt;
      const configuredDays = Number(
        this.configService.get<number>('deviceAuth.tokenExpiryDays', 7),
      );
      const deviceAccessTtlSeconds =
        (Number.isFinite(configuredDays) && configuredDays > 0
          ? configuredDays
          : 7) *
        24 *
        60 *
        60;
      const remainingSeconds = Math.floor(
        (credentialExpiresAt.getTime() - Date.now()) / 1000,
      );

      const newRefreshToken = await this.createRefreshToken(
        storedToken.userId,
        {
          deviceCodeId: storedToken.deviceCodeId,
          expiresAtCap: credentialExpiresAt,
          orgId,
        },
      );
      const accessToken = this.generateAccessToken(storedToken.user, {
        ttlSeconds: Math.max(
          1,
          Math.min(deviceAccessTtlSeconds, remainingSeconds),
        ),
        deviceCodeId: storedToken.deviceCodeId,
        orgId,
      });

      this.metrics.authRefresh('success');

      return {
        accessToken: accessToken.token,
        expiresIn: accessToken.expiresIn,
        refreshToken: newRefreshToken,
      };
    }

    const newRefreshToken = await this.createRefreshToken(storedToken.userId, { orgId });
    const accessToken = this.generateAccessToken(storedToken.user, { orgId });
    this.metrics.authRefresh('success');

    return {
      accessToken: accessToken.token,
      expiresIn: accessToken.expiresIn,
      refreshToken: newRefreshToken,
    };
  }

  /**
   * Logout - revoke refresh token
   */
  async logout(userId: string, refreshToken?: string): Promise<void> {
    if (refreshToken) {
      // Revoke specific token
      const tokenHash = this.hashToken(refreshToken);
      await this.prisma.refreshToken.updateMany({
        where: { tokenHash, userId },
        data: { revokedAt: new Date() },
      });
    } else {
      // Revoke all tokens for user
      await this.revokeAllUserTokens(userId);
    }

    this.logger.log(`User logged out: ${userId}`);
  }

  /**
   * Revoke all refresh tokens for a user
   */
  async revokeAllUserTokens(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Clean up expired tokens (run periodically)
   */
  async cleanupExpiredTokens(): Promise<number> {
    const result = await this.prisma.refreshToken.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date() } },
          { revokedAt: { not: null } },
        ],
      },
    });

    this.logger.log(`Cleaned up ${result.count} expired/revoked tokens`);
    return result.count;
  }

  /**
   * Hash token for storage
   */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Validates JWT payload and returns user with roles and permissions
   *
   * A token carrying `did` was issued to a device through the device
   * authorization flow (issue #518). It is honoured only while that device
   * session exists, belongs to the token's subject, is not revoked and has not
   * passed its `credentialExpiresAt` — which is what makes
   * `DELETE /api/auth/device/sessions/{id}` revoke a 7-day access token
   * immediately. A token without `did` is validated exactly as before.
   *
   * PRINCIPAL CACHE (PP-1.12, #683). The user/role/permission join below is
   * read through `PrincipalCache` for at most AUTH_PRINCIPAL_CACHE_TTL_SECONDS.
   * The `did` check above it is NEVER cached: it runs first, on every request.
   * Every write that changes what a principal resolves to calls
   * `principalCache.invalidate` after it commits, so a deactivation or role
   * change still reaches the next request on this replica, and other replicas
   * within event-bus latency. An inactive user may be cached; the `isActive`
   * check still rejects it.
   *
   * ACTIVE ORG (#724). The `org` claim names the organization the token acts
   * in; it is honoured only while it is an ACTIVE membership of `sub`, read
   * from the same (cached) graph, so a removed or suspended member's token
   * stops working within the cache TTL, and at once after `invalidateUser`. A
   * `did` token must also match its device session's `orgId`. A token
   * without `org` is the temporary compatibility path in `legacyTokenOrg`.
   * The returned user carries the binding (`activeOrgId`, `tokenKind`) as
   * non-enumerable properties (`credential-binding.ts`).
   */
  async validateJwtPayload(payload: JwtPayload): Promise<AuthenticatedUser | null> {
    const tokenKind: CredentialKind = payload.did !== undefined ? 'device' : 'session';

    // The active organization (#724). A signed `org` claim is the org; a
    // token without one predates #724 (see `legacyTokenOrg`).
    const orgId =
      payload.org !== undefined
        ? typeof payload.org === 'string' && payload.org.length > 0
          ? payload.org
          : null
        : await this.legacyTokenOrg(tokenKind);
    if (!orgId) {
      return null;
    }

    if (payload.did !== undefined) {
      if (typeof payload.did !== 'string' || payload.did.length === 0) {
        return null;
      }

      const deviceCode = await this.prisma.deviceCode.findUnique({
        where: { id: payload.did },
        select: {
          id: true,
          userId: true,
          revokedAt: true,
          credentialExpiresAt: true,
          orgId: true,
        },
      });

      if (!this.isDeviceSessionLive(deviceCode, payload.sub)) {
        return null;
      }

      // A device session is bound to the org it was approved in (#724): its
      // token may not claim another one.
      if (payload.org !== undefined && deviceCode?.orgId !== payload.org) {
        return null;
      }
    }

    // Keyed by (user, org, credential kind) since #724.
    const key = { userId: payload.sub, orgId, tokenKind };
    let principal = this.principalCache.get(key);

    if (!principal) {
      // Captured BEFORE the read: if an invalidation lands while the query is
      // in flight, `set` refuses to store what may be the pre-change principal.
      const generation = this.principalCache.generation(payload.sub);

      // System roles plus memberships with their org roles (PP-6.3, #723):
      // the shared graph every credential path loads; `PrincipalFactory`
      // derives the effective permissions from it.
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        include: PRINCIPAL_USER_INCLUDE,
      });

      if (!user) {
        return null;
      }

      // The frozen copy when it was stored; the fresh row when the cache is
      // disabled or the generation moved (exactly the behaviour before #683).
      principal = this.principalCache.set(key, user, generation) ?? user;
    }

    if (!principal.isActive) {
      return null;
    }

    // The claim is signed, but membership is the database's to decide: a
    // token for an org the user is no longer an ACTIVE member of is refused
    // (within the cache TTL; at once on this replica after an invalidation).
    // The legacy path keeps the pre-#724 behaviour and checks nothing here.
    if (payload.org !== undefined && !hasActiveMembership(principal, orgId)) {
      return null;
    }

    // The org goes on the request span (ADR 0001: `org.id`), never on a
    // metric label.
    trace.getActiveSpan()?.setAttribute('org.id', orgId);

    return bindCredential(principal, { activeOrgId: orgId, tokenKind });
  }

  /**
   * TEMPORARY COMPATIBILITY PATH (#724), removed in a later release: the org
   * of an access token issued before the `org` claim existed.
   *
   * - single mode: the default organization, for one access-token lifetime
   *   after this process started (`jwt.accessTtlMinutes`, or the device
   *   token lifetime for a `did` token), so tokens in flight across the
   *   deploy keep working; such a token was always for the default org;
   * - multi mode, or after the window: `null`, so the token is refused and
   *   the client refreshes (the refresh issues an org-bound token).
   */
  private async legacyTokenOrg(tokenKind: CredentialKind): Promise<string | null> {
    if (!this.tenancy.isSingle()) {
      return null;
    }
    const lifetimeSeconds =
      tokenKind === 'device'
        ? Number(this.configService.get<number>('deviceAuth.tokenExpiryDays', 7)) * 24 * 60 * 60
        : Number(this.configService.get<number>('jwt.accessTtlMinutes', 15)) * 60;
    const windowMs = Number.isFinite(lifetimeSeconds) && lifetimeSeconds > 0 ? lifetimeSeconds * 1000 : 0;
    if (Date.now() >= this.startedAt + windowMs) {
      return null;
    }
    return this.defaultOrgIdOrNull();
  }

  /**
   * `POST /api/auth/switch-org` (#724): re-issue the session for another
   * organization the caller is an ACTIVE member of.
   *
   * - Only a browser session may switch: a PAT, a device session and a node
   *   credential are bound to one org at issue and are refused (403).
   * - The presented refresh token (the HttpOnly cookie) must be a live,
   *   non-device session token of the caller (else 401). It is revoked and a
   *   new one bound to `orgId` is issued, exactly like a rotation.
   * - `orgId` must be an active membership of the caller (else 404, so an
   *   org id that exists but is not the caller's is indistinguishable from
   *   one that does not). In single mode only the default organization
   *   qualifies, so switching to it is a no-op re-issue.
   * - Writes the `auth:org_switched` audit event and moves the membership's
   *   `lastActiveAt`, which picks the org of the next sign-in.
   */
  async switchOrg(
    caller: { id: string; tokenKind?: CredentialKind; activeOrgId?: string | null },
    orgId: string,
    refreshToken: string | undefined,
  ): Promise<FullTokenResponse> {
    if (caller.tokenKind !== undefined && caller.tokenKind !== 'session') {
      throw new ForbiddenException(
        'This credential is bound to one organization and cannot switch organization',
      );
    }

    if (!refreshToken) {
      throw new UnauthorizedException('No refresh token provided');
    }

    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hashToken(refreshToken) },
      include: { user: { include: PRINCIPAL_USER_INCLUDE } },
    });

    if (
      !storedToken ||
      storedToken.userId !== caller.id ||
      storedToken.revokedAt !== null ||
      storedToken.expiresAt < new Date() ||
      storedToken.deviceCodeId !== null
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (!storedToken.user.isActive) {
      throw new UnauthorizedException('User account is deactivated');
    }

    const defaultOrgId = this.tenancy.isSingle() ? await this.defaultOrgIdOrNull() : null;
    if (
      (this.tenancy.isSingle() && orgId !== defaultOrgId) ||
      !hasActiveMembership(storedToken.user, orgId)
    ) {
      throw new NotFoundException('Organization not found');
    }

    // Revoke the presented token conditionally, so two concurrent switches
    // with the same cookie cannot both mint a session.
    const revoked = await this.prisma.refreshToken.updateMany({
      where: { id: storedToken.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count !== 1) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const newRefreshToken = await this.createRefreshToken(caller.id, { orgId });
    const accessToken = this.generateAccessToken(storedToken.user, { orgId });
    await this.organizations.touchMembership(orgId, caller.id);

    const fromOrgId = storedToken.orgId ?? caller.activeOrgId ?? null;
    await this.prisma.auditEvent.create({
      data: {
        actorUserId: caller.id,
        action: ORG_SWITCHED_AUDIT_ACTION,
        targetType: 'organization',
        targetId: orgId,
        meta: { fromOrgId },
      },
    });

    trace.getActiveSpan()?.setAttribute('org.id', orgId);
    this.logger.log(
      `User ${caller.id} switched organization to ${orgId} (from ${fromOrgId ?? '(none)'})`,
    );

    return {
      accessToken: accessToken.token,
      expiresIn: accessToken.expiresIn,
      refreshToken: newRefreshToken,
    };
  }

  /**
   * Whether a device-authorization session may still back a credential: it
   * exists, belongs to `userId`, is not revoked, and its collected credential
   * has not expired. A row with no `credentialExpiresAt` never issued a
   * session credential through the linked path, so it backs nothing (fail
   * closed).
   */
  private isDeviceSessionLive(
    deviceCode: {
      userId: string | null;
      revokedAt: Date | null;
      credentialExpiresAt: Date | null;
    } | null,
    userId: string,
  ): boolean {
    return (
      !!deviceCode &&
      deviceCode.userId === userId &&
      deviceCode.revokedAt === null &&
      deviceCode.credentialExpiresAt !== null &&
      deviceCode.credentialExpiresAt > new Date()
    );
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
   *
   * `activeOrgId` is the org the request's credential is bound to (#724);
   * roles, permissions and `activeOrg` are computed for it. Omitted, the
   * sign-in rule picks the org.
   */
  async getCurrentUser(userId: string, activeOrgId?: string | null) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: CURRENT_USER_INCLUDE,
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Compute display name (override takes precedence)
    const displayName = user.displayName || user.providerDisplayName || null;

    // Profile image (#367): resolved from `profile.imageSource`. The unused
    // `users.profile_image_url` column is deliberately not consulted. The
    // provider URL and whether an uploaded picture exists are exposed too, so
    // the settings UI can preview each option whichever one is selected — the
    // uploaded one through the authenticated GET /user-settings/profile-image,
    // since the public avatar URL only serves while `upload` is selected.
    const storedProfile = (
      user.userSettings?.value as { profile?: unknown } | null | undefined
    )?.profile;
    const profileImageUrl = resolveProfileImageUrl(user, storedProfile);
    const hasUploadedProfileImage =
      normalizeProfileSettings(storedProfile).imageObjectId !== null;

    // Roles and permissions from `PrincipalFactory` (PP-6.3, #723): system
    // roles plus the current org's membership role. The shape is unchanged
    // (`roles: [{ name }]`); a system administrator now lists `admin` and
    // `org_admin`.
    const access = principalFactory.access(
      activeOrgId !== undefined ? { ...user, activeOrgId } : user,
    );
    const roles = access.roles.map((name) => ({ name }));
    const permissions = access.permissions;

    // The active organization and every organization the user can switch to
    // (#724). `memberships` may be absent on a graph a test builds by hand.
    const memberships = (user.memberships ?? []) as Array<
      PrincipalMembership & { org?: { id: string; name?: string; slug?: string } | null }
    >;
    const activeMembership = access.membership
      ? memberships.find((membership) => membership.orgId === access.membership!.orgId)
      : undefined;

    return {
      id: user.id,
      email: user.email,
      displayName,
      profileImageUrl,
      providerProfileImageUrl: user.providerProfileImageUrl ?? null,
      hasUploadedProfileImage,
      isActive: user.isActive,
      roles,
      permissions,
      // PP-6.2 (#722): so the web can hide organization UI in single mode.
      tenancyMode: this.tenancy.mode(),
      // PP-6.4 (#724): the org this session acts in, and the ones it can switch to.
      activeOrg: activeMembership
        ? {
            id: activeMembership.orgId,
            name: activeMembership.org?.name ?? '',
            slug: activeMembership.org?.slug ?? '',
          }
        : null,
      memberships: memberships
        .filter((membership) => membership.status === 'active')
        .map((membership) => ({
          orgId: membership.orgId,
          name: membership.org?.name ?? '',
          slug: membership.org?.slug ?? '',
          role: membership.role.name,
        })),
    };
  }

  /**
   * Check if email matches the initial admin email
   */
  private isInitialAdminEmail(email: string): boolean {
    const initialAdminEmail = this.configService.get<string>('INITIAL_ADMIN_EMAIL');
    return initialAdminEmail ? email === initialAdminEmail.toLowerCase() : false;
  }
}

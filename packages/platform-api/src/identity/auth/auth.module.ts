import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AllowlistModule } from '../allowlist/allowlist.module';
import { AuthController } from './auth.controller';
import { AuthProviderController } from './auth-provider.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { AdminBootstrapService } from './admin-bootstrap.service';
import { requireJwtSecret } from '../identity.configuration';
import { TokenCleanupTask } from './tasks/token-cleanup.task';
import { TokenCleanupHandler } from './handlers/token-cleanup.handler';
import { AuthProvidersDoctorCheck } from './doctor/auth-providers.doctor-check';
import { AuthProvidersEgressContributor } from './doctor/egress/auth-providers.egress.contributor';
import { InitialAdminDoctorCheck } from './doctor/initial-admin.doctor-check';
import { JwtSecretDoctorCheck } from './doctor/jwt-secret.doctor-check';
import { PrincipalCacheModule } from './principal-cache/principal-cache.module';
import { PrincipalCacheDoctorCheck } from './doctor/principal-cache.doctor-check';

/**
 * Sign-in, sessions and tokens: `AuthController` (`/api/auth/*`), `AuthService`,
 * the JWT strategy, the initial-administrator bootstrap, the nightly
 * `auth.token.cleanup` job with its enqueue-only cron, and the `auth.*` Doctor
 * checks. Mounted by `IdentityModule.forRoot()` with the host-port modules,
 * `PatModule`, `OrganizationsModule` and every registered sign-in provider's
 * strategy; never import it directly.
 *
 * Exports `AuthService`, `AdminBootstrapService` and `JwtModule`.
 *
 * @stability experimental
 */
@Module({
  imports: [
    // Passport configuration
    PassportModule.register({ defaultStrategy: 'jwt' }),

    // JWT configuration. No fallback secret: a missing JWT_SECRET is a boot
    // error (`requireJwtSecret`), never a key published in this package.
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: requireJwtSecret(config),
        signOptions: {
          expiresIn: `${config.get<number>('jwt.accessTtlMinutes', 15)}m`,
        },
      }),
    }),

    // PP-1.12 (#683): `validateJwtPayload` reads principals through it.
    PrincipalCacheModule,

    // Allowlist module for email allowlist checks
    AllowlistModule,

    // The app's host ports (the notifier `handleGoogleLogin` raises
    // `user.welcome` through, the jobs port the nightly token cleanup is
    // queued through), `PatService` (PAT validation in JwtAuthGuard) and
    // `OrganizationsService` (`createNewUser` joins a new user to the default
    // org) come from global modules `IdentityModule.forRoot()` mounts.
  ],
  controllers: [AuthController, AuthProviderController],
  providers: [
    AuthService,
    AdminBootstrapService,
    JwtStrategy,
    TokenCleanupTask,
    TokenCleanupHandler,
    // Doctor checks (#634) — see `DoctorCheckRegistry` in `@marinoscar/platform-api/doctor`.
    JwtSecretDoctorCheck,
    AuthProvidersDoctorCheck,
    InitialAdminDoctorCheck,
    // PP-1.12 (#683): `auth.principal-cache`.
    PrincipalCacheDoctorCheck,
    // Egress inventory (#773): each registered sign-in provider's outbound hosts.
    AuthProvidersEgressContributor,
  ],
  exports: [AuthService, AdminBootstrapService, JwtModule],
})
export class AuthModule {}

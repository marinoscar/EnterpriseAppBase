// =============================================================================
// IdentityModule: the identity slice's one composition entry point (issue #727)
// =============================================================================
//
// `IdentityModule.forRoot(options)` mounts every identity module: sign-in and
// tokens (`AuthModule`, with the allowlist, personal access tokens and
// organizations it depends on), users, the device authorization flow and,
// outside production when asked, the test login. The app binds identity's host
// ports in its own `@Global()` module(s), passed as `options.imports`.
//
// MODULE ORDER IS THE APP'S OLD ORDER, on purpose. Nest discovers modules
// depth-first, and the generated OpenAPI document lists paths in discovery
// order. The host modules are imported inside `AuthModule` right after the
// allowlist, where the app's notification graph used to be reached, so the
// document keeps its path order.
//
// Every identity module is a singleton: `forRoot` is called once per app.
// =============================================================================

import { DynamicModule, Module } from '@nestjs/common';

import { AuthModule } from './auth/auth.module';
import { authProviderRegistry } from './auth/providers/auth-provider.registry';
import './auth/providers/google.provider';
import { DeviceAuthModule } from './device-auth/device-auth.module';
import { IDENTITY_OPTIONS, resolveIdentityModuleOptions, type IdentityModuleOptions } from './identity.options';
import { OrganizationsModule } from './organizations/organizations.module';
import { PatModule } from './pat/pat.module';
import { TestAuthModule } from './testing/test-auth.module';
import { UsersModule } from './users/users.module';

/**
 * The identity slice: authentication (JWT sessions, personal access tokens,
 * worker-node credentials, Google sign-in and any registered provider), the
 * guards and decorators every route uses, users, the allowlist, the device
 * authorization flow, organizations, members, invitations and tenancy, with
 * two server-only cleanup job types and their enqueue-only crons, and the
 * `auth.*` and `tenancy.*` Doctor checks.
 *
 * @stability experimental
 */
@Module({})
export class IdentityModule {
  /**
   * The slice for one app.
   *
   * @param options - see {@link IdentityModuleOptions}.
   * @returns the dynamic module. It provides `IDENTITY_OPTIONS` globally.
   * @throws Error when an option is invalid, or `enableTestAuth` is set in production.
   *
   * @example
   * ```ts
   * IdentityModule.forRoot({
   *   imports: [IdentityHostModule],
   *   enableTestAuth: process.env.NODE_ENV !== 'production',
   * });
   * ```
   *
   * @extensionPoint option
   * @stability experimental
   */
  static forRoot(options: IdentityModuleOptions = {}): DynamicModule {
    const resolved = resolveIdentityModuleOptions(options);

    // Every registered sign-in provider's Passport strategy (Google first).
    // Registered before this call; the registry freezes at bootstrap.
    const strategies = authProviderRegistry.list().map((provider) => provider.strategy);

    // The host-port modules, then the modules AuthModule's own @Module imports
    // (passport, JWT, the principal cache, the allowlist) are followed by.
    const auth: DynamicModule = {
      module: AuthModule,
      imports: [...resolved.imports, PatModule, OrganizationsModule],
      providers: strategies,
    };
    // The very same dynamic module object, so the device flow shares
    // AuthModule's single instance (one AuthService, one JwtModule).
    const deviceAuth: DynamicModule = { module: DeviceAuthModule, imports: [auth] };

    return {
      module: IdentityModule,
      global: true,
      imports: [auth, OrganizationsModule, UsersModule, deviceAuth, ...(resolved.enableTestAuth ? [TestAuthModule] : [])],
      providers: [{ provide: IDENTITY_OPTIONS, useValue: resolved }],
      exports: [IDENTITY_OPTIONS],
    };
  }
}

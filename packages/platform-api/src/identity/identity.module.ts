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
// order. Sign-in (with the allowlist) first, then the host modules (where the
// app's notification graph used to be reached), personal access tokens,
// organizations, users and the device flow, so the document keeps its paths
// in place (the device flow's block moves up, next to the other identity routes).
//
// Every identity module is a singleton: `forRoot` is called once per app.
// =============================================================================

import { DynamicModule, Module, type ModuleMetadata, type Type } from '@nestjs/common';

import { AuthModule } from './auth/auth.module';
import { authProviderRegistry } from './auth/providers/auth-provider.registry';
import './auth/providers/google.provider';
import { DeviceAuthModule } from './device-auth/device-auth.module';
import { IDENTITY_OPTIONS, resolveIdentityModuleOptions, type IdentityModuleOptions } from './identity.options';
import { OrganizationsModule } from './organizations/organizations.module';
import { PatModule } from './pat/pat.module';
import { TestAuthModule } from './testing/test-auth.module';
import { UsersModule } from './users/users.module';

/** A static module class created at run time: its metadata is scanned depth first. */
function staticModule(name: string, metadata: ModuleMetadata): Type<unknown> {
  const holder = { [name]: class {} };
  const cls = holder[name]!;
  Module(metadata)(cls);
  return cls;
}

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

    // Every registered sign-in provider's Passport strategy (Google first),
    // registered before this call; the registry freezes at bootstrap.
    const strategies = authProviderRegistry.list().map((provider) => provider.strategy);

    // Built as STATIC modules, never as a dynamic module's inline `imports`:
    // Nest inserts a dynamic module's inline imports into the container
    // eagerly, ahead of the depth-first scan, which would reorder every module
    // (and the OpenAPI document) after them. Static metadata is scanned depth
    // first, in the order written here.
    const hostImports = staticModule('IdentityHostImportsModule', { imports: [...resolved.imports] });
    const authProviders = staticModule('IdentityAuthProvidersModule', { imports: [AuthModule], providers: strategies });
    const composition = staticModule('IdentityCompositionModule', {
      imports: [
        AuthModule,
        authProviders,
        hostImports,
        PatModule,
        OrganizationsModule,
        UsersModule,
        DeviceAuthModule,
        ...(resolved.enableTestAuth ? [TestAuthModule] : []),
      ],
    });

    return {
      module: IdentityModule,
      global: true,
      imports: [composition],
      providers: [{ provide: IDENTITY_OPTIONS, useValue: resolved }],
      exports: [IDENTITY_OPTIONS],
    };
  }
}

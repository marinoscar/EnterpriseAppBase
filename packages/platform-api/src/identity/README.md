# @marinoscar/platform-api/identity

Who the caller is and what they may do, for a NestJS app on Fastify: Google sign-in and any registered provider, JWT sessions with rotating refresh tokens, personal access tokens, worker-node credentials, the device authorization flow (RFC 8628), the guards and decorators every route uses (`@Auth`, `@Public`, `@CurrentUser`, `@CurrentPrincipal`), users, the email allowlist, organizations, members, invitations and the tenancy mode, two server-only cleanup job types, and the `auth.*` and `tenancy.*` Doctor checks. Extracted from the reference app by issue #727 (PP-6.6). It depends on `core`, `doctor`, `otel-core` and `testing` of this package (`packages/platform-slices.json`), and on `@marinoscar/platform-contract/identity` for its wire shapes. Test seams and the conformance suite are the nested subpath `@marinoscar/platform-api/identity/testing`, catalogued here.

## Purpose and scope

Identity sits under every other slice: "identity owns the user tables, so every other slice may reference a user" (spec, Dependency graph). It therefore imports no other slice of the app: notifications, the job queue, worker nodes, the event bus, metrics, user settings and profile pictures are reached through host ports the app binds (Extension-point catalog).

| Part | Source | What it is |
|---|---|---|
| Sign-in and tokens | `auth/` | `AuthController` (`/api/auth/*`), `AuthService`, the JWT and Google strategies, the sign-in provider registry, the refresh-cookie rotation, `switch-org`, `AdminBootstrapService` (`INITIAL_ADMIN_EMAIL`), the principal cache, the `auth.token.cleanup` job and its enqueue-only cron, the `auth.*` Doctor checks. |
| Route access | `auth/decorators/`, `auth/guards/` | `@Auth({ roles, permissions })`, `@Public()`, `@Roles`, `@Permissions`, `@CurrentUser`, `@CurrentPrincipal`, `@CurrentOrg`, `@AuthCredential`; `JwtAuthGuard` (sessions, `pat_` tokens on every route, `nod_` tokens on `/api/nodes` only), `RolesGuard`, `PermissionsGuard`. |
| Users and allowlist | `users/`, `allowlist/` | `/api/users` and `/api/allowlist`. |
| Personal access tokens | `pat/` | `/api/pat`; `PatModule` is global because `JwtAuthGuard` resolves `pat_` tokens in every module. |
| Device flow | `device-auth/` | `/api/auth/device/*`, the `device-auth.code.cleanup` job and its cron. Design notes: [device-auth/README.md](./device-auth/README.md). |
| Organizations and tenancy | `organizations/` | `/api/org/members`, `/api/org/invites`, `/api/admin/organizations`, `OrganizationsService`, `TenancyService` and `TENANCY_MODE` parsing, `resolveOrgId` / `resolveJobOrgId`, the `tenancy.mode` Doctor check. |
| Test seams | `testing/` (`/identity/testing`) | The test-only login (`TestAuthModule`), `createStubIdentityHost`, the `identity` conformance suite. |

Not here: the email templates and the notification events identity raises (the app's notifications slice; the reference app declares them in `src/identity-extensions/notifications/`), the user settings and profile-picture storage (the settings and storage slices), the `db.rls_role` Doctor check (a database fact, in the app's `HealthModule`), the web pages (`@marinoscar/platform-web`, issue #727 parts 3 and 4) and the CLI login (#715).

## Install and peer dependencies

Ships inside `@marinoscar/platform-api`; import it by its subpath:

```ts
import { Auth, CurrentUser, IdentityModule, Public, type RequestUser } from '@marinoscar/platform-api/identity';
```

Peers this slice needs on top of the package's own: `@nestjs/jwt` (`^11.0.2`), `@nestjs/passport` (`^11.0.5`), `passport` (`^0.7.0`, one instance: strategies register on it) and `@nestjs/event-emitter` (`^3.0.1`, the app registers `EventEmitterModule.forRoot()`). `passport-jwt` and `passport-google-oauth20` are dependencies of the package. The app registers `@fastify/cookie` (the refresh token is an HttpOnly cookie) and `nestjs-zod`'s `ZodValidationPipe`. The slice compiles against the Prisma TYPES of the identity fragment of `@marinoscar/platform-db` (`User`, `RefreshToken`, `Organization`, ...) and receives the app's generated client through core's `PLATFORM_PRISMA`; it never bundles a client.

## Quick start

The reference app's binding ([`identity.config.ts`](../../../../apps/api/src/platform/identity/identity.config.ts)):

```ts
import { IdentityModule } from '@marinoscar/platform-api/identity';

import { IdentityHostModule } from './identity-host.module';

export const identityModule = IdentityModule.forRoot({
  imports: [IdentityHostModule],
  enableTestAuth: process.env.NODE_ENV !== 'production',
});
```

`IdentityHostModule` ([source](../../../../apps/api/src/platform/identity/identity-host.module.ts)) is a `@Global()` module that binds every host port; core's `PLATFORM_PRISMA` is bound once by the app's `platformHostModule`. The configuration keys come from `identityConfiguration()` ([`configuration.ts`](../../../../apps/api/src/config/configuration.ts)). A route then declares its access:

```ts
@Controller('reports')
export class ReportsController {
  @Get()
  @Auth({ permissions: ['reports:read'] })
  list(@CurrentUser() user: RequestUser) {}

  @Get('health')
  @Public()
  health() {}
}
```

There is NO global JWT guard: a route with neither `@Auth(...)` nor `@Public()` is public. The conformance suite fails such a route.

## Configuration

`IdentityModule.forRoot(options)`:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `imports` | `Array<Type \| DynamicModule>` | `[]` | The `@Global()` modules that bind the host ports. Mounted inside the composition where the app's notification graph was reached, so Nest's depth-first scan (and the OpenAPI path order) is the app's old one. |
| `defaultOrgRole` | `string` | `'viewer'` | The org role of every sign-up's default-org membership and of an invitation without a role. Never `admin` (a system role). |
| `initialAdminEmailEnv` | `string` | `'INITIAL_ADMIN_EMAIL'` | The variable (read through `ConfigService`) holding the address that bypasses the allowlist and becomes the first administrator. |
| `enableTestAuth` | `boolean` | `false` | Mounts `POST /api/auth/test/login`. A boot error when `NODE_ENV` is `production`. |

`identityConfiguration(env)` builds the `ConfigService` keys identity reads: `jwt.secret`, `jwt.accessTtlMinutes` (15), `jwt.refreshTtlDays` (14), `auth.principalCacheTtlSeconds` (30), `google.clientId`, `google.clientSecret`, `google.callbackUrl`, `initialAdminEmail`, `deviceAuth.expiryMinutes` (15), `deviceAuth.pollInterval` (5), `deviceAuth.tokenExpiryDays` (7), `deviceAuth.patExpiryDays` (90) and `tenancy.mode` (`single`). Identity also reads the app's `appUrl` and `nodeEnv`.

## Extension-point catalog

Order follows the extension ladder: options (rung 1), registries (rung 2), tokens (rung 3), events (rung 4). Every host port is `experimental` (ports are replaced as the slices behind them are packaged); the guards and decorators are `stable` and are not extension points (Supporting exports).

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `IdentityModule.forRoot` | option | `forRoot(options: IdentityModuleOptions): DynamicModule` | Mount the slice once in the app's root module | experimental | [example](../../../../apps/api/src/platform/identity/identity.config.ts) |
| `identityConfiguration` | option | `identityConfiguration(env?: NodeJS.ProcessEnv): IdentityConfiguration` | Build identity's configuration keys in the app's `ConfigModule` factory | experimental | [example](../../../../apps/api/src/config/configuration.ts) |
| `registerAuthProvider` | registry | `registerAuthProvider({ id, strategy, guard, isEnabled }): void` | Add a sign-in provider next to Google, before `forRoot()` | experimental | [example](../../../../apps/api/test/identity/identity-extension-points.spec.ts) |
| `identityConformanceSuite` | registry | `ConformanceSuite<IdentityConformanceOptions>` | Run identity's invariants in the app through `runPlatformConformance({ suites: { identity } })` | experimental | [example](../../../../apps/api/test/identity/identity-conformance.spec.ts) |
| `IDENTITY_NOTIFIER` | token | `unique symbol` -> `IdentityNotifier` | Bind the four notifications identity raises (`roleChanged`, `userWelcomed`, `allowlistInvitation`, `orgInvitation`) to the app's dispatcher | experimental | [example](../../../../apps/api/src/platform/identity/identity-notifier.adapter.ts) |
| `USER_DEFAULTS` | token | `unique symbol` -> `UserDefaults` | Supply a new user's settings value | experimental | [example](../../../../apps/api/src/platform/identity/identity-user.adapters.ts) |
| `IDENTITY_PROFILE_IMAGES` | token | `unique symbol` -> `IdentityProfileImages` | Resolve a user's picture from their stored profile settings | experimental | [example](../../../../apps/api/src/platform/identity/identity-user.adapters.ts) |
| `IDENTITY_JOBS` | token | `unique symbol` -> `IdentityJobsPort` | Bind the queue: the two cleanup crons enqueue, the two handlers register | experimental | [example](../../../../apps/api/src/platform/identity/identity-jobs.adapter.ts) |
| `IDENTITY_METRICS` | token | `unique symbol` -> `IdentityMetrics` (optional) | Record `app.auth.logins`, `app.auth.refreshes` and the two org counters | experimental | [example](../../../../apps/api/src/platform/identity/identity-host.module.ts) |
| `IDENTITY_NODE_CREDENTIALS` | token | `unique symbol` -> `IdentityNodeCredentials` | Resolve `nod_` worker credentials in `JwtAuthGuard` (bind it globally) | experimental | [example](../../../../apps/api/src/platform/identity/identity-host.module.ts) |
| `IDENTITY_EVENT_BUS` | token | `unique symbol` -> `IdentityEventBus` (optional) | Invalidate the principal cache across replicas | experimental | [example](../../../../apps/api/src/platform/identity/identity-host.module.ts) |
| `IDENTITY_EVENTS` | event | `identity.user.created`, `identity.membership.changed`, `identity.org.switched` on `EventEmitter2` | React after commit: an app side table (a profile row) for a new user, a membership change, an org switch | experimental | [example](../../../../apps/api/src/identity-extensions/identity-user-created.listener.ts) |

Supporting exports (stable unless noted): `Auth`, `AuthOptions`, `Public`, `Roles`, `Permissions`, `CurrentUser`, `CurrentPrincipal`, `CurrentOrg`, `AuthCredential` and their metadata keys (`IS_PUBLIC_KEY`, `ROLES_KEY`, `PERMISSIONS_KEY`, `RBAC_EXTENSION_KEY`); `JwtAuthGuard`, `NODE_ROUTE_PREFIX`, `RolesGuard`, `PermissionsGuard`, `GoogleOAuthGuard`; `AuthenticatedUser`, `RequestUser`, `toRequestUser`; `PrincipalCache` (call `invalidateUser` after a write that changes what a user's token resolves to) and `PrincipalCacheModule`; the sign-in errors (`AUTH_ERROR_CODES`, `AuthLoginDeniedException`, `resolveAuthErrorCode`, `buildAuthErrorRedirectUrl`); tenancy (`TenancyService`, `parseTenancyMode`, `verifyTenancyModeAtStartup`, `currentTenancyMode` (experimental)); org scope (`resolveOrgId`, `resolveJobOrgId`, `MissingOrgScopeError`; experimental); the role and permission declarations (`IDENTITY_ROLES`, `IDENTITY_PERMISSION_DECLARATIONS`, `USERS_PERMISSIONS`, `ALLOWLIST_PERMISSIONS`, `ORGANIZATIONS_PERMISSIONS`, `IDENTITY_ROLE_IDS`, `IDENTITY_PERMISSION_IDS`, `DEFAULT_ORG_ROLE`, `ORG_ADMIN_ROLE`) and the augmentable `IdentityPermissionIds` / `IdentityRoleIds` (experimental); `ORGANIZATIONS_APP_METRICS`; the port interfaces and notices; the event payloads; the job-type strings `AUTH_TOKEN_CLEANUP_TYPE` and `DEVICE_CODE_CLEANUP_TYPE`; `requireJwtSecret`. The services (`AuthService`, `UsersService`, `PatService`, `OrganizationsService`, ...) and the principal-graph internals are exported for the reference app's wiring and tests, tagged `@internal`, with no stability promise.

From `/identity/testing` (experimental): `TestAuthModule`, `TestAuthService`, `TestEnvironmentGuard`, `createStubIdentityHost`, the conformance checks (`discoverControllers`, `discoverIdentityRoutes`, `checkRouteAccess`, `checkPermissionsRegistered`, `checkScopeGrants`, `checkTokenConfinement`, `checkRls`) and their option types.

### Typed permission names

`@Auth({ permissions })` takes `PermissionName`, which is any string until the app widens `IdentityPermissionIds` to its own registry (the reference app: [`roles.constants.ts`](../../../../apps/api/src/common/constants/roles.constants.ts)), after which a typo is a compile error:

```ts
declare module '@marinoscar/platform-api/identity' {
  interface IdentityPermissionIds extends Record<PermissionName, true> {}
  interface IdentityRoleIds extends Record<RoleName, true> {}
}
```

## Data

The identity fragment of `@marinoscar/platform-db` (`schema/identity.prisma`): `User`, `UserIdentity`, `Role`, `Permission`, `RolePermission`, `UserRole`, `AuditEvent`, `RefreshToken`, `PersonalAccessToken`, `AllowedEmail`, `DeviceCode`, `Organization`, `Membership`, `Invite`, and the enums `RoleScope`, `PatDurationUnit`, `DeviceCodeStatus`, `MembershipStatus`, `InviteStatus`. Their migrations are platform history (`0001_initial` onwards; organizations: `0023_add_organizations`, scopes: `0024`); the raw-SQL partial unique index `organizations_default_uniq_idx` keeps exactly one default organization (never an `@@unique`, never a `findFirst` check).

An app may reference `User.id` and `Organization.id` from its own models (a back-relation is an `extend model User` / `extend model Organization` block in the app's fragment). Every other identity model and column is private: read users through the slice, never write identity tables directly. The credential tables (`refresh_tokens`, `personal_access_tokens`, `device_codes`) carry an `org_id` but no row-level security: they are read across organizations at sign-in.

## Permissions and settings

| Permission | Scope | Default grant | Route |
|---|---|---|---|
| `users:read`, `users:write` | system | `admin` | `/api/users` |
| `rbac:manage` | system | `admin` | `PUT /api/users/:id/roles` |
| `allowlist:read`, `allowlist:write` | system | `admin` | `/api/allowlist` |
| `organizations:read`, `organizations:write` | system | `admin` | `/api/admin/organizations` |
| `org_members:read`, `org_members:write` | org | `org_admin` | `/api/org/members` |
| `org_invites:read`, `org_invites:write` | org | `org_admin` | `/api/org/invites` |

Roles: `admin` (system, in `user_roles`) and the org roles `org_admin`, `contributor`, `viewer` (on a membership). A role is granted only permissions of its own scope. The slice declares these as data; the app registers and seeds them (`IDENTITY_PERMISSION_DECLARATIONS`, `IDENTITY_ROLES`). Identity reads no system-settings namespace.

## UI

None in this subpath. The web pages and the headless `AuthProvider` move to `@marinoscar/platform-web/identity` with issue #727 parts 3 and 4; until then the reference app's own pages call these routes.

## Infra

Environment variables (names only; values and defaults: `infra/compose/.env.example`): `JWT_SECRET` (required: no fallback, a boot error when unset), `JWT_ACCESS_TTL_MINUTES`, `JWT_REFRESH_TTL_DAYS`, `AUTH_PRINCIPAL_CACHE_TTL_SECONDS`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, `INITIAL_ADMIN_EMAIL`, `DEVICE_CODE_EXPIRY_MINUTES`, `DEVICE_CODE_POLL_INTERVAL`, `DEVICE_TOKEN_EXPIRY_DAYS`, `DEVICE_PAT_EXPIRY_DAYS`, `TENANCY_MODE`, plus the app's `APP_URL`. Outbound hosts (the Doctor's egress inventory): Google's OAuth endpoints, when Google is configured.

## Observability

- Metrics, through `IDENTITY_METRICS` (names and labels unchanged from the reference app): `app.auth.logins` (`outcome`: `success`, `allowlist_rejected`, `disabled`, `no_organization`; `provider`), `app.auth.refreshes` (`outcome`), `app.org.invites_created`, `app.org.members_removed` (no attributes: an org id on a label is unbounded and a tenant identifier).
- Spans: the org id is set on the active span (`org.id`) by the organization services and `switch-org`, never on a metric.
- Logs: `new Logger(Context)` (`AuthService`, `JwtAuthGuard`, `PrincipalCache`, ...), the same lines as before the move.
- Doctor checks: `auth.jwt-secret`, `auth.providers`, `auth.initial-admin`, `auth.principal-cache`, `tenancy.mode`; the egress contributor lists Google's hosts.

## Security notes

- There is no global JWT guard. Every route declares `@Auth(...)` or `@Public()`; the conformance suite enforces it against the app's whole module graph.
- `JWT_SECRET` has NO fallback: `requireJwtSecret` makes a missing one a boot error, so a package anyone can read never signs tokens with a published key. The `auth.jwt-secret` check still fails a deployment that set the old placeholder `fallback-secret`.
- `JwtAuthGuard` confines `nod_` worker credentials to `/api/nodes` (the raw URL, query string stripped) and accepts a `pat_` token on every authenticated route with its owner's authority (a documented promise of the API). Both rules are conformance checks.
- The refresh token is an HttpOnly, `SameSite=Lax`, `Secure` (production) cookie scoped to `/api/auth`, rotated on use with reuse detection (docs/SECURITY-ARCHITECTURE.md §3).
- An org id enters the auth path from request input only on `POST /api/auth/switch-org`, checked against the caller's memberships; every other request's org comes from the signed token.
- `notify()` (through `IDENTITY_NOTIFIER`) and the domain events run after the triggering write commits, outside any transaction; a throwing listener is caught.
- The test login is mounted only with `enableTestAuth`, refused in production.

## Conformance suite

Importing `@marinoscar/platform-api/identity/testing` registers the `identity` suite with `runPlatformConformance()`. It walks the app's root module (static and dynamic imports) and reads Nest metadata; nothing is a hand-kept list of routes. Each check is also an exported function, proved against a deliberately broken fixture (`test/identity/conformance.spec.ts`).

| # | Check | Where it runs |
|---|---|---|
| 1 | Every controller handler has `@Auth(...)` (or `UseGuards(JwtAuthGuard)`) or `@Public()` | The suite |
| 2 | Every permission a route names is registered with a scope; every role `@Auth({ roles })` names is a registered SYSTEM role | The suite |
| 3 | No seeded grant gives a role a permission of the other scope | The suite |
| 4 | `nod_` tokens are refused outside `/api/nodes` (look-alike prefixes and query strings included) and admitted as node credentials on it; `pat_` tokens are resolved as personal access tokens everywhere, node routes included | The suite (pass `guard` to check an app's own guard) |
| 5 | Every `org` table has row-level security enabled and forced, with one of its listed policies | `checkRls`, from the app's db tier ([`rls-coverage.db.spec.ts`](../../../../apps/api/test/tenancy/rls-coverage.db.spec.ts)), or the suite's `rls` option |

Run it in the app (the reference app's [`identity-conformance.spec.ts`](../../../../apps/api/test/identity/identity-conformance.spec.ts)):

```ts
import { runPlatformConformance } from '@marinoscar/platform-api/testing';
import '@marinoscar/platform-api/identity/testing'; // registers the suite

runPlatformConformance({
  sourceRoots: [API_SOURCE_ROOT],
  suites: {
    identity: {
      rootModule: AppModule,
      permissions: permissionRegistry.list(),
      roles: roleRegistry.list(),
      grants: permissionRegistry.list().flatMap((p) => p.defaultGrants.map((role) => ({ role, permission: p.id }))),
    },
  },
});
```

The principal-cache invalidation scan and the raw-SQL scan of the reference app also read this slice's source (`test/auth/principal-invalidation-sites.spec.ts`, `test/prisma/user-owned-models.spec.ts`).

## Upgrade notes

New in this release (#727). The slice moved from the app with no behaviour change: routes, job types (`auth.token.cleanup`, `device-auth.code.cleanup`), permission strings, audit actions, metric names, log lines and the OpenAPI document (every path and component; per tag the same operation order) are unchanged. For a fork that kept the app copies:

| Old app path (`apps/api/src/`) | Now |
|---|---|
| `auth/`, `users/`, `allowlist/`, `pat/`, `device-auth/`, `organizations/` | `@marinoscar/platform-api/identity` |
| `test-auth/` | `@marinoscar/platform-api/identity/testing` (`IdentityModule.forRoot({ enableTestAuth })`) |
| `common/services/admin-bootstrap.service.ts` | `AdminBootstrapService`, provided by the slice's `AuthModule` (drop it from `CommonModule`) |
| `common/deployment/tenancy-mode.ts` | `parseTenancyMode` and friends from the slice (the reference app keeps a re-export) |
| `*/…notifications.ts` (the four notification events) | stay in the app (`src/identity-extensions/notifications/`), raised through `IDENTITY_NOTIFIER` |
| `organizations/doctor/rls-role.doctor-check.ts` | stays in the app (`health/doctor/`) |

Behaviour changes, deliberate: a missing `JWT_SECRET` now fails the boot (it used to fall back to a published key); `GET /api/auth/providers` reads the provider registry (same output for Google). A route's `@Auth` permissions are typed by the app's augmentation of `IdentityPermissionIds`.

## Troubleshooting

- **`Nest can't resolve dependencies of the JwtAuthGuard (Reflector, PatService, ?)`.** `IDENTITY_NODE_CREDENTIALS` is not bound in a global module. Bind it in the `@Global()` host module passed to `forRoot({ imports })`.
- **`Nest can't resolve dependencies of the AuthService (?, ...)` with `PLATFORM_PRISMA`.** Core's `PlatformHostModule.forRoot({ prisma })` is not imported; or, in a small test graph, provide `PLATFORM_PRISMA` (`createStubIdentityHost` does).
- **`JWT_SECRET is not set` at boot.** Set it in the deployment environment; there is no fallback.
- **The OpenAPI document reordered after upgrading.** Pass the host modules in `forRoot({ imports })`, not as separate imports of the app's root module.
- **A spy on `currentTenancyMode` has no effect.** The slice reads its own module binding; record the mode with `recordTenancyMode('multi')` and restore it.

## Links

- [Platform packages spec](../../../../docs/specs/platform-packages.md): the dependency graph and the extension contract
- [Security architecture](../../../../docs/SECURITY-ARCHITECTURE.md): sessions, credential kinds, the allowlist, tenant isolation
- [Device authorization](../../../../docs/DEVICE-AUTH.md) and [personal access tokens](../../../../docs/personal-access-tokens.md)
- [ADR 0001](../../../../docs/adr/0001-org-aware-principal-and-scope.md): the principal and scope contract
- [`@marinoscar/platform-contract/identity`](../../../platform-contract/src/identity/README.md): the wire shapes
- [Package README](../../README.md)

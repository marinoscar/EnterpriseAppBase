# @marinoscar/platform-api/identity

Who the caller is and what they may do, for a NestJS app on Fastify: Google sign-in and any registered provider, JWT sessions with rotating refresh tokens, personal access tokens, worker-node credentials, the device authorization flow (RFC 8628), the guards and decorators every route uses (`@Auth`, `@Public`, `@CurrentUser`, `@CurrentPrincipal`), users, the email allowlist, organizations, members, invitations and the tenancy mode, two server-only cleanup job types, and the `auth.*` and `tenancy.*` Doctor checks. Extracted from the reference app by issue #727 (PP-6.6). It depends on `core`, `doctor`, `otel-core` and `testing` of this package (`packages/platform-slices.json`), and on `@marinoscar/platform-contract/identity` for its wire shapes. Test seams and the conformance suite are the nested subpath `@marinoscar/platform-api/identity/testing`, catalogued here.

## Purpose and scope

Identity sits under every other slice: "identity owns the user tables, so every other slice may reference a user" (spec, Dependency graph). It therefore imports no other slice of the app: notifications, the job queue, worker nodes, the event bus, metrics, user settings and profile pictures are reached through host ports the app binds (Extension-point catalog).

| Part | Source | What it is |
|---|---|---|
| Sign-in and tokens | `auth/` | `AuthController` (`/api/auth/*`), `AuthProviderController` (`/api/auth/:providerId` for every other registered provider), `AuthService`, the JWT and Google strategies, the sign-in provider registry and sign-in policy, the shared refresh-cookie and redirect helper, the refresh-cookie rotation, `switch-org`, `AdminBootstrapService` (`INITIAL_ADMIN_EMAIL`), the principal cache, the `auth.token.cleanup` job and its enqueue-only cron, the `auth.*` Doctor checks. |
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

Peers this slice needs on top of the package's own: `@nestjs/jwt` (`^11.0.2`), `@nestjs/passport` (`^11.0.5`), `passport` (`^0.7.0`, one instance: strategies register on it) and `@nestjs/event-emitter` (`^3.0.1`, the app registers `EventEmitterModule.forRoot()`). `passport-jwt` and `passport-google-oauth20` are dependencies of the package. The app registers `@fastify/cookie` (the refresh token is an HttpOnly cookie) and `nestjs-zod`'s `ZodValidationPipe`. The slice depends on no generated Prisma client, not even its types (the package is built and tested before any `prisma generate`): it declares the identity fragment's tables of `@marinoscar/platform-db` structurally (`IdentityPrisma`, `IdentityTx`, `IdentityDelegate` and the `Identity*Row` types, in `data/identity-db.ts`) and receives the app's own client through core's `PLATFORM_PRISMA`. Nest injection needs no cast; code that passes the client to a service by hand casts once (the reference app's [`asIdentityPrisma`](../../../../apps/api/src/platform/identity/identity-db.ts)). `test/no-generated-client.spec.ts` keeps `@prisma/client` (other than `/extension`) out of the whole package.

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

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

Order follows the extension ladder: options (rung 1), registries (rung 2), tokens (rung 3), events (rung 4). Every host port is `experimental` (ports are replaced as the slices behind them are packaged); the guards and decorators are `stable` and are not extension points (Supporting exports).

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `IdentityModule.forRoot` | option | `forRoot(options: IdentityModuleOptions): DynamicModule` | Mount the slice once in the app's root module; `signInPolicy: PortBinding<SignInPolicy>` binds the app's sign-in policy | experimental | [example](../../../../apps/api/src/platform/identity/identity.config.ts) |
| `identityConfiguration` | option | `identityConfiguration(env?: NodeJS.ProcessEnv): IdentityConfiguration` | Build identity's configuration keys in the app's `ConfigModule` factory | experimental | [example](../../../../apps/api/src/config/configuration.ts) |
| `registerAuthProvider` | registry | `registerAuthProvider(def: AuthProviderDefinition): void` | Add a sign-in provider (GitHub, Entra, a generic OIDC) next to Google, before `forRoot()`; the slice mounts its routes, lists it, stores its identities and applies the allowlist | experimental | [example](../../../../apps/api/src/platform-extensions/identity/example-oidc.provider.ts) |
| `AuthProviderDefinition` | registry | `{ id, label?, mode?, strategy?+guard? \| createStrategy(ctx), isEnabled(config, ctx), mapProfile?, linkExistingByEmail?, egressHosts?, doctorRemedy? }` | The shape of one provider; `createStrategy` builds the Passport strategy per request from the credential store; `AuthProviderRegistration` is the same type under its old name | experimental | [example](../../../../apps/api/src/platform-extensions/identity/example-oidc.provider.ts) |
| `respondToSignIn` | hook | `respondToSignIn({ reply, appUrl, signIn, logger, label }): Promise<unknown>` | End a sign-in in the browser exactly as Google's callback does: the HttpOnly refresh cookie and the 302 to the web callback, or `error=<code>` (also `setRefreshTokenCookie`, `buildSignInSuccessRedirectUrl`, `REFRESH_TOKEN_COOKIE`, `REFRESH_TOKEN_COOKIE_OPTIONS`) | experimental | [example](../../../../apps/api/test/examples/identity/example-oidc.spec.ts) |
| `IDENTITY_SIGNIN_POLICY` | token | `unique symbol` -> `SignInPolicy` (optional) | The token the binding above provides; inject it to read the policy, never provide it in an app module | experimental | [example](../../../../apps/api/test/examples/identity/example-oidc.policy.spec.ts) |
| `createCookieStateStore` | hook | `createCookieStateStore({ secret, cookieName?, ttlSeconds?, secure? }): { store, verify }` | The `store` option of a `passport-oauth2` strategy, for login-CSRF `state` without a session plugin (a signed, short-lived HttpOnly cookie; no PKCE) | experimental | [example](../../../../apps/api/test/examples/identity/example-oidc.policy.spec.ts) |
| `SignInPolicy` | hook | `beforeLogin(profile: ExternalProfile, ctx: SignInContext): SignInDecision \| Promise<SignInDecision>` | Bind with `IdentityModule.forRoot({ signInPolicy })`: deny a sign-in with a closed reason, or map roles onto a new user; consulted for every provider after the allowlist and before any write | experimental | [example](../../../../apps/api/src/platform-extensions/identity/example-oidc.provider.ts) |
| `IDENTITY_AUTH_CREDENTIALS` | token | `unique symbol` -> `AuthProviderCredentials` (optional) | Bind the credential store a provider reads its secrets from (the app binds `CredentialsService`); unbound, every secret reads as absent | experimental | [example](../../../../apps/api/src/platform/identity/identity-host.module.ts) |
| `describeAuthProviderConformance` | registry | `describeAuthProviderConformance(def, { describe, it, expect, rawProfile, expectedSubject, enabledWith?, host? })` | Prove a provider: `mapProfile`, enablement, strategy, routes, a full login, the allowlist, the verified-address rule and a policy denial | experimental | [example](../../../../apps/api/test/examples/identity/example-oidc.spec.ts) |
| `identityConformanceSuite` | registry | `ConformanceSuite<IdentityConformanceOptions>` | Run identity's invariants in the app through `runPlatformConformance({ suites: { identity } })` | experimental | [example](../../../../apps/api/test/identity/identity-conformance.spec.ts) |
| `IDENTITY_NOTIFIER` | token | `unique symbol` -> `IdentityNotifier` | Bind the four notifications identity raises (`roleChanged`, `userWelcomed`, `allowlistInvitation`, `orgInvitation`) to the app's dispatcher | experimental | [example](../../../../apps/api/src/platform/identity/identity-notifier.adapter.ts) |
| `USER_DEFAULTS` | token | `unique symbol` -> `UserDefaults` | Supply a new user's settings value | experimental | [example](../../../../apps/api/src/platform/identity/identity-user.adapters.ts) |
| `IDENTITY_PROFILE_IMAGES` | token | `unique symbol` -> `IdentityProfileImages` | Resolve a user's picture from their stored profile settings | experimental | [example](../../../../apps/api/src/platform/identity/identity-user.adapters.ts) |
| `IDENTITY_JOBS` | token | `unique symbol` -> `IdentityJobsPort` | Bind the queue: the two cleanup crons enqueue, the two handlers register | experimental | [example](../../../../apps/api/src/platform/identity/identity-jobs.adapter.ts) |
| `IDENTITY_METRICS` | token | `unique symbol` -> `IdentityMetrics` (optional) | Record `app.auth.logins`, `app.auth.refreshes` and the two org counters | experimental | [example](../../../../apps/api/src/platform/identity/identity-host.module.ts) |
| `IDENTITY_NODE_CREDENTIALS` | token | `unique symbol` -> `IdentityNodeCredentials` | Resolve `nod_` worker credentials in `JwtAuthGuard` (bind it globally) | experimental | [example](../../../../apps/api/src/platform/identity/identity-host.module.ts) |
| `IDENTITY_EVENT_BUS` | token | `unique symbol` -> `IdentityEventBus` (optional) | Invalidate the principal cache across replicas | experimental | [example](../../../../apps/api/src/platform/identity/identity-host.module.ts) |
| `IDENTITY_EVENTS` | event | `identity.user.created` (`source` is the provider id), `identity.login.succeeded`, `identity.membership.changed`, `identity.org.switched`, `identity.org.created` on `EventEmitter2` | React after commit: an app side table (a profile row) for a new user, a sign-in (`{ userId, provider, isNewUser }`), a membership change, an org switch, a new organization | experimental | [example](../../../../apps/api/src/identity-extensions/identity-user-created.listener.ts) |
| `registerUserMetadataSchema` | registry | `registerUserMetadataSchema({ namespace, schema, description? }): MetadataNamespace<T>` | Declare a namespaced, zod-validated field group on `users.metadata` (a per-user app setting with no side table and no migration), at import time; returns the typed handle `IdentityMetadataService` takes | experimental | [example](../../../../apps/api/src/app-registrations/identity.ts) |
| `registerOrganizationMetadataSchema` | registry | `registerOrganizationMetadataSchema({ namespace, schema, description? }): MetadataNamespace<T>` | The same for `organizations.metadata` (per-organization app fields) | experimental | [example](../../../../apps/api/test/examples/identity/coach-preferences.spec.ts) |
| `registerCurrentUserExtension` | registry | `registerCurrentUserExtension({ id, resolve(userId, ctx): Promise<object \| null \| undefined>, timeoutMs? }): void` | Add a small JSON field group to `GET /api/auth/me` under `extensions.<id>` (a plan, a team, an unread count); bounded, never a secret, resolved per request and isolated | experimental | [example](../../../../apps/api/src/platform-extensions/identity/team-directory.extensions.ts) |
| `registerUserListExtension` | registry | `registerUserListExtension({ id, resolve(userIds, ctx): Promise<Map<userId, object \| null \| undefined>>, timeoutMs? }): void` | Add a field group to each row of `GET /api/users` under `extensions.<id>`; the resolver is BATCHED (called once with the ids of the page), so a list never costs a query per row | experimental | [example](../../../../apps/api/src/platform-extensions/identity/team-directory.extensions.ts) |
| `assertRoleAssignable` | registry | `assertRoleAssignable(role: string, scope: 'system' \| 'org'): void` | Guard an app route that gives someone a role: throws the 400 `ROLE_NOT_ASSIGNABLE` unless the role is registered, of that scope and not `assignable: false` (`isRoleAssignable` is the predicate, `listRoles(scope?)` the `GET /api/roles` list) | experimental | [example](../../../../apps/api/test/examples/manifest/coach-support.example.spec.ts) |

Supporting exports (stable unless noted): `Auth`, `AuthOptions`, `Public`, `Roles`, `Permissions`, `CurrentUser`, `CurrentPrincipal`, `CurrentOrg`, `AuthCredential` and their metadata keys (`IS_PUBLIC_KEY`, `ROLES_KEY`, `PERMISSIONS_KEY`, `RBAC_EXTENSION_KEY`); `JwtAuthGuard`, `NODE_ROUTE_PREFIX`, `RolesGuard`, `PermissionsGuard`, `GoogleOAuthGuard`, `createPassportProviderGuard` (a Passport guard for a strategy registered by name), `authProviderStrategyName` (the `auth-provider:<id>` name a `createStrategy` provider's strategy is registered under; the ids `jwt` and `session` are reserved), `createCookieStateStore` (below); `ExternalProfile` helpers (`assertExternalProfile`, `externalProfileProblem`, `normalizeExternalProfile`, `googleProfileToExternal`); the policy types (`SignInPolicy`, `SignInDecision`, `SignInContext`); `AuthenticatedUser`, `RequestUser`, `toRequestUser`; `PrincipalCache` (call `invalidateUser` after a write that changes what a user's token resolves to) and `PrincipalCacheModule`; the sign-in errors (`AUTH_ERROR_CODES`, `AuthLoginDeniedException`, `resolveAuthErrorCode`, `buildAuthErrorRedirectUrl`); tenancy (`TenancyService`, `parseTenancyMode`, `verifyTenancyModeAtStartup`, `currentTenancyMode` (experimental)); org scope (`resolveOrgId`, `resolveJobOrgId`, `MissingOrgScopeError`; experimental); the role and permission declarations (`IDENTITY_ROLES`, `IDENTITY_PERMISSION_DECLARATIONS`, `USERS_PERMISSIONS`, `ALLOWLIST_PERMISSIONS`, `ORGANIZATIONS_PERMISSIONS`, `IDENTITY_ROLE_IDS`, `IDENTITY_PERMISSION_IDS`, `DEFAULT_ORG_ROLE`, `ORG_ADMIN_ROLE`) and the augmentable `IdentityPermissionIds` / `IdentityRoleIds` (experimental); `ORGANIZATIONS_APP_METRICS`; the port interfaces and notices; the event payloads; the job-type strings `AUTH_TOKEN_CLEANUP_TYPE` and `DEVICE_CODE_CLEANUP_TYPE`; `requireJwtSecret`. The services (`AuthService`, `UsersService`, `PatService`, `OrganizationsService`, ...) and the principal-graph internals are exported for the reference app's wiring and tests, tagged `@internal`, with no stability promise.

App metadata (experimental): `IdentityMetadataService` (injectable anywhere, `IdentityModule` is global), `MetadataError` and `MetadataErrorCode`, `METADATA_MAX_BYTES`, `userMetadataRegistry` and `organizationMetadataRegistry` (read-only introspection), `METADATA_NAMESPACE_PATTERN`, `METADATA_SECRET_FIELD_NAMES`, `isSecretFieldName`, `findSecretKeys`, `inspectMetadataSchema` and the types `MetadataNamespace`, `MetadataNamespaceDef`, `MetadataSubject` and `MetadataSchemaFindings`.

From `/identity/testing` (experimental): `describeAuthProviderConformance` (and its option types), `TestAuthModule`, `TestAuthService`, `TestEnvironmentGuard`, `createStubIdentityHost`, the conformance checks (`discoverControllers`, `discoverIdentityRoutes`, `checkRouteAccess`, `checkPermissionsRegistered`, `checkScopeGrants`, `checkTokenConfinement`, `checkRls`) and their option types.

### Typed permission names

`@Auth({ permissions })` takes `PermissionName`, which is any string until the app widens `IdentityPermissionIds` to its own registry (the reference app: [`roles.constants.ts`](../../../../apps/api/src/common/constants/roles.constants.ts)), after which a typo is a compile error:

```ts
declare module '@marinoscar/platform-api/identity' {
  interface IdentityPermissionIds extends Record<PermissionName, true> {}
  interface IdentityRoleIds extends Record<RoleName, true> {}
}
```

### Roles and who may assign them

The role vocabulary is open: a role an app or a package registers (`registerPlatformPermissions({ app: { roles } })` or `registerPermissionSet`, see the [manifest README](../manifest/README.md)) is assignable end to end, with no edit to a package. Roles are stored as strings (`roles.name`); nothing in the database or the wire fixes the list.

- **`GET /api/roles?scope=system|org`** lists the roles as `{ id, label, description, scope, assignable }`, platform roles first, then the registration order. `scope=system` needs `users:read`, `scope=org` needs `org_members:read`; without `scope` every scope the caller may read is listed; a scope the caller may not read is a 403. The packaged invite, member and Manage roles dialogs read it (`useRoles` of the web package), so a registered role appears with its `label` and no web edit.
- **What may be assigned** is the registry's word, not the database's. A role declares `label` and `assignable` (default `true`) next to its `id`, `description` and `scope`; neither is seeded. `assertRoleAssignable(role, scope)` is the one check the invite (`POST /api/org/invites`), member (`PATCH /api/org/members/:userId`), user-role (`PUT /api/users/:id/roles`) and test-login routes run. It is **fail closed**: a role nobody registered, a role of the other scope (`admin` on an invitation, an org role as a system role) and a role registered `assignable: false` all answer `400` with the envelope `code: 'ROLE_NOT_ASSIGNABLE'` (a registered domain code, also `details.reason`) and one message, so the answer says nothing about which. The platform's four roles are known even to an app that never ran `registerPlatformPermissions()`.
- **Where it runs.** Before any read or write: a refused invite writes no invitation, no allowlist entry, no audit row and sends nothing; a refused member update takes no lock. A member update that names a non-assignable role is refused even when it equals the member's current role; a status-only change for such a member still works. An invitation whose role stopped being assignable after it was written (unregistered, or marked `assignable: false`) is not claimed at sign-in: it stays pending and grants nothing.
- **`PUT /api/users/:id/roles` and app-managed system roles.** The request replaces the roles it can assign. A system role the user holds that is registered `assignable: false` is left in place (it cannot be named in the request, and the replace does not remove it), and in single-organization mode so is an `assignable: false` org role held on the default-organization membership when the request names no org role (the membership then keeps it instead of falling back to the default org role; naming `admin` still sets `org_admin`).
- **Grants.** A role holds permissions through `role_permissions`, written by the seed from the catalog: the permissions' own `defaultGrants`, plus the app's `grants` for a platform permission ([manifest README](../manifest/README.md)). The principal factory reads those rows for every request, so what the seed wrote is what the guards enforce.
- **Test login.** `POST /api/auth/test/login` takes any registered role id (`role` is a string pattern): an org role becomes the default-organization membership's role, `admin` also gives `org_admin`, and another system role is held in `user_roles` next to the default org role.

The worked example is [`coach-support.roles.ts`](../../../../apps/api/src/platform-extensions/identity/coach-support.roles.ts): an org role `coach`, a system role `support` granted `users:read`, and `service-bot` (`assignable: false`), driven over HTTP by [`coach-support.example.spec.ts`](../../../../apps/api/test/examples/manifest/coach-support.example.spec.ts).

### User extensions

`registerCurrentUserExtension` and `registerUserListExtension` let an app attach facts of its own to the two payloads the web app already reads, with no new route and no package edit. Register at import time (the registries freeze when the application bootstraps), from the app's `app-registrations/identity.ts`:

```ts
registerCurrentUserExtension({ id: 'billing', resolve: async (userId) => ({ plan: await plans.planOf(userId) }) });
registerUserListExtension({
  id: 'billing',
  // ONE call for the whole page: the ids of the users on it, a Map back.
  resolve: async (userIds) => new Map((await plans.forUsers(userIds)).map((p) => [p.userId, { plan: p.name }])),
});
```

The contributions appear as `extensions: { billing: { plan: 'pro' } }`, keyed by the extension id (`USER_EXTENSION_ID_PATTERN`: lower-case, 2 to 48 characters), in `GET /api/auth/me` and in each row of `GET /api/users`. Nothing registered, or nothing contributed for a user: no `extensions` key, and the payload is exactly what it was. The OpenAPI document declares `extensions` as optional on `CurrentUserDto` and on the new `UserListItemDto` (the list rows; `UserResponseDto` of the other user routes is unchanged), and the contract's `currentUserSchema` gains the same optional field.

These are identity data that a browser reads, so the rules are enforced by the slice, not left to the extension:

- **Batched, no N+1.** A list extension is called ONCE per request with every id of the page and answers a `Map` keyed by user id. It cannot answer for a user that is not on the page (such entries are ignored), and it is told the requesting administrator and the organization (`ctx.viewerId`, `ctx.orgId`). A current-user extension is called once per `/auth/me` with the user id.
- **JSON only, bounded.** Plain objects, arrays, strings, finite numbers, booleans and `null`, at most `USER_EXTENSION_LIMITS.maxDepth` (5) levels deep: a class instance, a function, a `bigint`, a `Date`, a cycle or `__proto__` is refused. One extension's JSON is at most 4 KiB on `/auth/me` and 1 KiB per row of the list; all extensions together at most 16 KiB and 4 KiB. Over a bound the contribution is dropped, never truncated.
- **Never secrets.** A key that names one is refused at any depth, in any case: `secret`, `password`, `passphrase`, `token`, `apiKey`, `privateKey`, `signingKey`, `accessKey`, `authorization`, `cookie`, `credential(s)`, `bearer`, `otp`, or a name that ends with one (`clientSecret`, `refreshToken`). A presence flag (`hasToken`) is fine. A string value that is plainly a credential (a JWT, a PEM private key, a `Bearer ...` header, a platform `pat_`, `nod_` or `lnk_` token) is refused too. A secret belongs in the credential store (`CredentialsService`), never in a payload.
- **Isolated.** Each extension runs under its own timeout (default 1.5 s on `/auth/me`, 3 s on the list, at most 10 s; `ctx.signal` aborts when it elapses). A throw, a rejection, a timeout, a refused contribution or an answer that is not a `Map` skips THAT extension (the whole page for a list extension that fails, one row for a refused row) and logs a `warn` with the extension id and the reason, never its data. `/auth/me` and the list never fail because of an extension.
- **Contained.** A timeout abandons a call, it cannot kill it, so an extension with more than `MAX_IN_FLIGHT_PER_USER_EXTENSION` (16) unfinished calls is skipped until some finish; a getter or iterator that throws while the answer is read is caught like any other failure; the check stops walking a payload that holds more values than its byte bound allows, and refuses a huge string without scanning it. The slice's own warnings are not repeated more than once a minute per message, and an error message is cut at 300 characters.
- **Per request, uncached.** The slice caches nothing. Keep `resolve` cheap: it runs on every `/auth/me`, and a slow extension delays every call by up to its `timeoutMs`.
- **Mind the audience.** A user-list contribution reaches every holder of `users:read` (the `support` role included), not only the person it describes; a current-user contribution reaches only that user. Put nothing in a list extension that a support agent should not see.

`checkUserExtensionContribution(value, maxBytes)` is the check the slice applies, exported for an app that wants to test its own resolver; `resolveCurrentUserExtensions` and `resolveUserListExtensions` are the resolution the services call. Web side: `useCurrentUserExtension` and `userExtension` of `@marinoscar/platform-web/identity/headless`, and the `Columns` slot of the Users page ([web README](../../../platform-web/src/identity/README.md#user-extensions-on-the-user-payloads)).

### Adding a sign-in provider

The recipe, end to end (GitHub, Entra, a generic OIDC, a company SSO): [docs/EXTENDING.md, Add a sign-in provider](../../../../docs/EXTENDING.md#add-a-sign-in-provider). The worked example is [`example-oidc`](../../../../apps/api/src/platform-extensions/identity/example-oidc.provider.ts): a fake OIDC provider with no network, registered from [`app-registrations/identity.ts`](../../../../apps/api/src/app-registrations/identity.ts), off until its signing key is stored.

- **Register** a definition with `registerAuthProvider` at import time, before `IdentityModule.forRoot()`. A `redirect` provider (default) gets `GET /api/auth/:id` and `/callback` from the slice (a static route outranks the parameter, so Google keeps its own); a `custom` provider mounts nothing and ends in your controller with `completeExternalLogin` and `respondToSignIn`.
- **Two ways to supply the strategy.** `strategy` + `guard` classes are constructed by Nest at boot (Google). `createStrategy(ctx)` is called on every sign-in request, so a secret an administrator stores or rotates applies to the next sign-in with no restart; read it with `ctx.credentials.getSecret(authCredentialPurpose(id), name)` and bind the store with `IDENTITY_AUTH_CREDENTIALS`. `isEnabled(config, ctx)` may be asynchronous; a throw counts as "not enabled".
- **The profile.** `mapProfile(raw)` returns an `ExternalProfile`. The route overwrites its `provider` with the serving definition's id, so a strategy cannot present itself as another provider. Set `emailVerified: true` only when the provider vouches for the address.
- **What `completeExternalLogin` refuses** (the redirect carries only the closed code): no address or an unverified one (`access_denied`, before any lookup); an address off the allowlist (`not_allowlisted`; `INITIAL_ADMIN_EMAIL` bypasses the allowlist and bootstraps the first administrator, but only for a provider with `linkExistingByEmail`, never for another, and never bypasses the policy); an address that belongs to a user with no identity at this provider (compared case-insensitively), unless the definition set `linkExistingByEmail` (`access_denied`); a `SignInPolicy` denial (its reason); a disabled account; no organization.
- **`linkExistingByEmail` means "trusted to vouch for the address", and is off by default.** It gates linking by address AND the `INITIAL_ADMIN_EMAIL` bootstrap (allowlist bypass and the admin grant). Google keeps both, as it always did. A new provider is never merged into an existing account by address, and can never be made the first administrator, unless its definition says its verified addresses cannot be forged. Entra's `email` claim and a shared OIDC issuer can be set by a tenant administrator: leave it off for them; they are allowlist-only.
- **Pre-hijack with a multi-tenant provider.** An attacker who signs up through a non-trusted provider with an allowlisted or invited address before its owner has signed in owns that account; the owner's later Google sign-in links onto it. Keep allowlist entries specific, restrict the accepted tenants and domains in a `SignInPolicy`, and enable a multi-tenant provider only together with that policy.
- **Login CSRF is yours to prevent.** The slice adds no `state` and no PKCE. `passport-oauth2`'s `state: true` or `pkce: true` WITHOUT a `store` throws "requires session support" on every sign-in here (no session plugin is registered). Pass `store: createCookieStateStore({ secret })` (a signed, short-lived HttpOnly cookie; no PKCE) or a store of your own.
- **The sign-in policy** (`IdentityModule.forRoot({ signInPolicy: { useClass } })`) is consulted for every provider, Google included, after the allowlist and before the first write. `{ allow: true, roles? }` or `{ allow: false, reason }`. `roles` apply only when the sign-in creates the user: at most one `org` role (the new membership's role), any number of `system` roles; an unknown name fails closed. A throwing policy refuses the sign-in as `authentication_failed`.
- **Events.** `identity.user.created` carries `source` = the provider id; `identity.login.succeeded` carries `{ userId, provider, isNewUser }` (no address, no token, no profile).
- **Prove it** with `describeAuthProviderConformance` and a test that boots the real module (the example's `example-oidc.spec.ts` and `example-oidc.policy.spec.ts`).

### App metadata on users and organizations

`users.metadata` and `organizations.metadata` are `JSONB NOT NULL DEFAULT '{}'` documents an app fills with namespaced fields of its own: a per-user or per-organization setting needs no side table and no migration. The recipe, end to end: [docs/EXTENDING.md, Add app metadata to users and organizations](../../../../docs/EXTENDING.md#add-app-metadata-to-users-and-organizations). The worked example is the `preferences.coach` namespace ([`coach-preferences.metadata.ts`](../../../../apps/api/src/platform-extensions/identity/coach-preferences.metadata.ts), registered from [`app-registrations/identity.ts`](../../../../apps/api/src/app-registrations/identity.ts), used by [`CoachPreferencesService`](../../../../apps/api/src/platform-extensions/identity/coach-preferences.service.ts) and proved by [`coach-preferences.spec.ts`](../../../../apps/api/test/examples/identity/coach-preferences.spec.ts) and the real-Postgres [`app-extension.db.spec.ts`](../../../../apps/api/test/examples/db/app-extension.db.spec.ts)).

- **One top-level key per namespace**, registered at import time (the registries freeze at bootstrap): lower-case words joined by `.`, `-` or `_`, at most 63 characters, **permanent once rows hold it** (it is the JSON key). Prefix it with the owner (`preferences.coach`, `acme.billing`) so two packages never collide; a duplicate throws at import.
- **The schema is a closed zod object.** Registration refuses a non-object schema, a property named like a secret (`password`, `apiKey`, `token`, `webhookSecret`, `refreshToken`, ... see `METADATA_SECRET_FIELD_NAMES`), and any open part of the shape (`z.any()`, `z.unknown()`, `z.date()`, a loose object). The same value is validated on **every write and every read**: a stored value that no longer satisfies a changed schema is `STORED_VALUE_INVALID`, never silently handed over typed.
- **Metadata is not a secret store.** It is copied into backups and exports and nothing encrypts it. A write also refuses an object key named like a secret at any depth (this closes what a schema cannot see, the keys of a `z.record`). A secret goes in `user_credentials` or the credential store; a `hasKey` flag may sit in metadata.
- **16 KiB per row**, measured as compact JSON of the whole document (all namespaces); a bigger write is `TOO_LARGE`. The migration adds a CHECK as a backstop (`users_metadata_size_check`, `organizations_metadata_size_check`: an object, at most 32 KiB of `jsonb` text, which carries a space after every colon and comma). Keep large or queried data in a table of its own.
- **Helpers** (`IdentityMetadataService`): `getUserMetadata`, `setUserMetadata`, `updateUserMetadata`, `deleteUserMetadata` and the `Organization` four. A write is a read-modify-write under `SELECT ... FOR UPDATE` in one transaction, so concurrent writers of different namespaces never lose an update; `update*` hands the callback the current value under the lock. Pass the handle `register*MetadataSchema` returned and the value is typed. An id that is not a UUID or has no row is `SUBJECT_NOT_FOUND`.
- **Never exposed by the package.** No platform route returns the document, `/api/auth/me` and the users routes build their response field by field, and the helpers return one namespace, never the whole. An app that wants a namespace over HTTP writes the route (the example's `CoachPreferencesController`) or contributes to the current-user response.
- **Who may write is the caller's decision.** The helpers do not authorise: the route does, with `@Auth(...)` and, for an organization namespace, an org permission. `users` and `organizations` have no row-level security, so the platform client is used as is.

## Data

The identity fragment of `@marinoscar/platform-db` (`schema/identity.prisma`): `User`, `UserIdentity`, `Role`, `Permission`, `RolePermission`, `UserRole`, `AuditEvent`, `RefreshToken`, `PersonalAccessToken`, `AllowedEmail`, `DeviceCode`, `Organization`, `Membership`, `Invite`, and the enums `RoleScope`, `PatDurationUnit`, `DeviceCodeStatus`, `MembershipStatus`, `InviteStatus`. Their migrations are platform history (`0001_initial` onwards; organizations: `0023_add_organizations`, scopes: `0024`); the raw-SQL partial unique index `organizations_default_uniq_idx` keeps exactly one default organization (never an `@@unique`, never a `findFirst` check).

An app may reference `User.id` and `Organization.id` from its own models (a back-relation is an `extend model User` / `extend model Organization` block in the app's fragment), and `Role.id` the same way (`Role` is `@extensible` too; `Permission` is deliberately closed: permissions are strings the registry owns, seeded by name and retired by an expand/contract migration, so a foreign key would block that). `users.metadata` and `organizations.metadata` (migration `0036_add_app_metadata`) are the app's namespaced fields, below. Every other identity model and column is private: read users through the slice, never write identity tables directly. The credential tables (`refresh_tokens`, `personal_access_tokens`, `device_codes`) carry an `org_id` but no row-level security: they are read across organizations at sign-in.

## Permissions and settings

| Permission | Scope | Default grant | Route |
|---|---|---|---|
| `users:read`, `users:write` | system | `admin` | `/api/users` |
| `rbac:manage` | system | `admin` | `PUT /api/users/:id/roles` |
| `allowlist:read`, `allowlist:write` | system | `admin` | `/api/allowlist` |
| `organizations:read`, `organizations:write` | system | `admin` | `/api/admin/organizations` |
| `org_members:read`, `org_members:write` | org | `org_admin` | `/api/org/members` |
| `org_invites:read`, `org_invites:write` | org | `org_admin` | `/api/org/invites` |

`GET /api/roles` declares no permission of its own: it admits a holder of `users:read` or `org_members:read` and narrows the answer to the scope each opens.

Roles: `admin` (system, in `user_roles`) and the org roles `org_admin`, `contributor`, `viewer` (on a membership), plus any role the app or a package registers (see [Roles and who may assign them](#roles-and-who-may-assign-them)). A role is granted only permissions of its own scope. The slice declares these as data; the app registers and seeds them (`IDENTITY_PERMISSION_DECLARATIONS`, `IDENTITY_ROLES`). Identity reads no system-settings namespace.

## UI

None in this subpath. The web pages and the headless `AuthProvider` move to `@marinoscar/platform-web/identity` with issue #727 parts 3 and 4; until then the reference app's own pages call these routes.

## Infra

Environment variables (names only; values and defaults: `infra/compose/.env.example`): `JWT_SECRET` (required: no fallback, a boot error when unset), `JWT_ACCESS_TTL_MINUTES`, `JWT_REFRESH_TTL_DAYS`, `AUTH_PRINCIPAL_CACHE_TTL_SECONDS`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, `INITIAL_ADMIN_EMAIL`, `DEVICE_CODE_EXPIRY_MINUTES`, `DEVICE_CODE_POLL_INTERVAL`, `DEVICE_TOKEN_EXPIRY_DAYS`, `DEVICE_PAT_EXPIRY_DAYS`, `TENANCY_MODE`, plus the app's `APP_URL`. Outbound hosts (the Doctor's egress inventory): Google's OAuth endpoints, when Google is configured, and each other registered provider's `egressHosts`. A provider added by an app keeps its secrets in the credential store (purpose `auth_<id>`), never in an environment variable.

## Observability

- Metrics, through `IDENTITY_METRICS` (names and labels unchanged from the reference app): `app.auth.logins` (`outcome`: `success`, `allowlist_rejected`, `disabled`, `no_organization`; `provider`: Google's calls omit it and the instrument defaults it to `google`; a refusal by the app's sign-in policy or for an unverified provider address is `allowlist_rejected`), `app.auth.refreshes` (`outcome`), `app.org.invites_created`, `app.org.members_removed` (no attributes: an org id on a label is unbounded and a tenant identifier).
- Spans: the org id is set on the active span (`org.id`) by the organization services and `switch-org`, never on a metric.
- Logs: `new Logger(Context)` (`AuthService`, `JwtAuthGuard`, `PrincipalCache`, ...), the same lines as before the move.
- Doctor checks: `auth.jwt-secret`, `auth.providers`, `auth.initial-admin`, `auth.principal-cache`, `tenancy.mode`; `auth.providers` lists every registered provider (`provider.<id>`: enabled or not, with its `doctorRemedy` while it is off); the egress contributor lists Google's hosts and each other provider's `egressHosts`.

## Security notes

- There is no global JWT guard. Every route declares `@Auth(...)` or `@Public()`; the conformance suite enforces it against the app's whole module graph.
- `JWT_SECRET` has NO fallback: `requireJwtSecret` makes a missing one a boot error, so a package anyone can read never signs tokens with a published key. The `auth.jwt-secret` check still fails a deployment that set the old placeholder `fallback-secret`.
- `JwtAuthGuard` confines `nod_` worker credentials to `/api/nodes` (the raw URL, query string stripped) and accepts a `pat_` token on every authenticated route with its owner's authority (a documented promise of the API). Both rules are conformance checks.
- The refresh token is an HttpOnly, `SameSite=Lax`, `Secure` (production) cookie scoped to `/api/auth`, rotated on use with reuse detection (docs/SECURITY-ARCHITECTURE.md §3).
- An org id enters the auth path from request input only on `POST /api/auth/switch-org`, checked against the caller's memberships; every other request's org comes from the signed token.
- `notify()` (through `IDENTITY_NOTIFIER`) and the domain events run after the triggering write commits, outside any transaction; a throwing listener is caught.
- The test login is mounted only with `enableTestAuth`, refused in production.
- `users.metadata` and `organizations.metadata` are not secret stores: registration refuses secret-named fields, a write refuses secret-named keys and an oversized document, and no platform route returns the document ([App metadata](#app-metadata-on-users-and-organizations)).
- User extensions are untrusted code's output on an identity payload: JSON-only, size-bounded, secret-named keys and credential-looking values refused, each extension isolated under a timeout and logged by id only. They are display data; no permission check may read them.
- Assignment is fail closed: a role is assignable only if the registry says so, in the scope the route assigns (`ROLE_NOT_ASSIGNABLE`, never a hint about why). No route can mint `admin` or an `assignable: false` role, and `app.grants` can neither target a platform role nor cross a scope.

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
| `organizations/doctor/rls-role.doctor-check.ts` | moved to the host slice (`@marinoscar/platform-api/host`, #879) |

Sign-in providers (PP-14.9): `AuthProviderRegistration` is now `AuthProviderDefinition` (the old name stays as an alias); `strategy` and `guard` became optional (one of that pair or `createStrategy` is required) and `isEnabled` may be asynchronous and receives `(config, ctx)` (a registration written as `isEnabled: (config) => ...` is unchanged). `GET /api/auth/providers` adds `mode: 'custom'` for a provider that owns its flow and is otherwise byte-identical. `AuthService.handleGoogleLogin` is a wrapper of `completeExternalLogin`'s shared path with Google's rules; a Google sign-in is unchanged in tokens, cookie attributes, redirects, events and metrics, and gains `identity.login.succeeded`. The callback no longer logs the redirect URL (it carried the access token). `GET /api/auth/{providerId}` and `/callback` are new routes (also reachable during a maintenance window).

Roles (PP-14.15): `roleName` of `POST /api/org/invites` and `PATCH /api/org/members/:userId` is a string pattern in the OpenAPI document (it was an enum of `org_admin`, `contributor`, `viewer`); the API decides, and a role it will not assign is a `400` with `code: 'ROLE_NOT_ASSIGNABLE'` (`admin` used to fail validation with a `400` listing the enum). `ASSIGNABLE_ORG_ROLES` of the contract is a deprecated alias of `BUILTIN_ORG_ROLES`. `PUT /api/users/:id/roles` refuses a role that is not registered, or is `assignable: false` (a role in the database but unknown to the registry used to be accepted). New route: `GET /api/roles`.

User extensions (PP-14.25, additive): `GET /api/auth/me` and the rows of `GET /api/users` gain an optional `extensions` object; the list's rows now reference `UserListItemDto` (the same fields as `UserResponseDto` plus `extensions?`) in the OpenAPI document. With no extension registered nothing changes on the wire.

Behaviour changes, deliberate: a missing `JWT_SECRET` now fails the boot (it used to fall back to a published key); `GET /api/auth/providers` reads the provider registry (same output for Google). A route's `@Auth` permissions are typed by the app's augmentation of `IdentityPermissionIds`.

## Troubleshooting

- **`Nest can't resolve dependencies of the JwtAuthGuard (Reflector, PatService, ?)`.** `IDENTITY_NODE_CREDENTIALS` is not bound in a global module. Bind it in the `@Global()` host module passed to `forRoot({ imports })`.
- **`Nest can't resolve dependencies of the AuthService (?, ...)` with `PLATFORM_PRISMA`.** Core's `PlatformHostModule.forRoot({ prisma })` is not imported; or, in a small test graph, provide `PLATFORM_PRISMA` (`createStubIdentityHost` does).
- **`JWT_SECRET is not set` at boot.** Set it in the deployment environment; there is no fallback.
- **`400 ROLE_NOT_ASSIGNABLE` for a role you registered.** The role is not in `roleRegistry` when the request runs (registered after bootstrap, or in a process that did not import the permission manifest), it is of the other scope, or it is declared `assignable: false`. `GET /api/roles` shows what the process knows.
- **The OpenAPI document reordered after upgrading.** Pass the host modules in `forRoot({ imports })`, not as separate imports of the app's root module.
- **A spy on `currentTenancyMode` has no effect.** The slice reads its own module binding; record the mode with `recordTenancyMode('multi')` and restore it.

## Links

- [Platform packages spec](../../../../docs/specs/platform-packages.md): the dependency graph and the extension contract
- [Security architecture](../../../../docs/SECURITY-ARCHITECTURE.md): sessions, credential kinds, the allowlist, tenant isolation
- [Device authorization](../../../../docs/DEVICE-AUTH.md) and [personal access tokens](../../../../docs/personal-access-tokens.md)
- [ADR 0001](../../../../docs/adr/0001-org-aware-principal-and-scope.md): the principal and scope contract
- [`@marinoscar/platform-contract/identity`](../../../platform-contract/src/identity/README.md): the wire shapes
- [Package README](../../README.md)

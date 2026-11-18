// =============================================================================
// The OAuth server's conformance suite `oauth-server` (PP-15.8, #1186)
// =============================================================================
//
// The OAuth server is security-critical and an app mounts it without reading its
// internals. What an app can break is not the protocol (the platform owns that)
// but its REGISTRATIONS: a scope that names a permission nobody registered, a
// resource whose prefix swallows `/api/auth`, a route guarded by `@Roles` alone
// that an `oat_` token could reach through delegation. This suite is how an app
// proves it did not. Importing `@marinoscar/platform-api/identity/testing`
// registers it with `runPlatformConformance()`:
//
//   runPlatformConformance({ suites: { oauthServer: { rootModule, permissions, secretEgress } } })
//
// It DISCOVERS the app's registered scopes, resources and routes (from the OAuth
// registries and the Nest metadata of every controller reachable from the root
// module) and runs ten checks. Nine need no database: the guards are built over
// stub resolvers, so a failing app fails fast and the suite runs in the unit tier.
// The tenth (`secret-egress`) takes evidence an app collects from a real flow.
//
//   scope-permissions-registered  every scope names only registered permissions
//   resource-scopes-registered    every resource lists known scopes, one a default
//   resource-prefix-exclusive     no shared or nested prefixes; none covers /api/oauth, /api/auth, /api/nodes
//   token-confinement             an `oat_` token is refused on every route outside its resource
//   scope-narrowing               a token lacking the scope that grants a route's permission is refused there
//   session-only-routes           consent decision, grant management, PAT creation, org switch refuse an `oauth` credential
//   no-roles-only-admission        a route guarded by `@Roles` alone refuses an `oauth` credential
//   challenge-on-401              a resource route answers 401 with a WWW-Authenticate whose metadata URL resolves
//   metadata-shape                both discovery documents carry the required fields; no `plain` PKCE; resource = APP_URL + path
//   secret-egress                 no token, code, secret or hash in a grants/clients response, an audit row or a log line
//
// Every check is a pure function of its inputs, exported so a test can hand it a
// deliberately broken registration and prove it fails (the registries refuse a
// bad registration at import time, so the negative tests pass lists, not the
// registries).
// =============================================================================

import { createHash } from 'node:crypto';

import { ForbiddenException, UnauthorizedException, type CanActivate, type DynamicModule, type ExecutionContext, type Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';

import { responseHeadersOf } from '../../core/index';
import { conformanceSuites } from '../../testing/index';
import type { ConformanceCase, ConformanceFinding, ConformanceReport, ConformanceSuite } from '../../testing/index';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from '../auth/decorators/permissions.decorator';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { stampCredential, stampOAuthNarrowing } from '../auth/credential-binding';
import { AuthController } from '../auth/auth.controller';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { isUnderRoutePrefix } from '../auth/route-prefix';
import { DeviceAuthController } from '../device-auth/device-auth.controller';
import { OAuthConsentController, OAuthGrantsController } from '../oauth-server/oauth-consent.controller';
import { InProcessDelegation } from '../oauth-server/in-process-delegation.service';
import { configureOAuthChallengeBase, configuredOAuthChallengeBase } from '../oauth-server/oauth-challenge';
import { buildAuthorizationServerMetadata } from '../oauth-server/oauth-metadata';
import { FORBIDDEN_OAUTH_ROUTE_PREFIXES, oauthResourceRegistry, type OAuthProtectedResourceDefinition } from '../oauth-server/oauth-resource.registry';
import { buildProtectedResourceMetadata } from '../oauth-server/oauth-resource-metadata';
import { OFFLINE_ACCESS_SCOPE, oauthScopeRegistry, type OAuthScopeDefinition } from '../oauth-server/oauth-scope.registry';
import type { OAuthServerSettingsReader } from '../oauth-server/oauth-server-settings.reader';
import { oauthResourceIdentifier, type OAuthTokenResolver, type ResolvedOAuthToken } from '../oauth-server/oauth-token.resolver';
import { PatController } from '../pat/pat.controller';
import type { PatService } from '../pat/pat.service';
import type { IdentityNodeCredentials } from '../ports';
import { checkTokenConfinement, discoverControllers } from './conformance';
import type { IdentityConformanceGuardClass } from './conformance';

declare module '../../testing/index' {
  interface PlatformConformanceSuiteOptions {
    /** The OAuth server's suite: its options, or `false` to opt out. Registered by importing `@marinoscar/platform-api/identity/testing`. */
    oauthServer?: OAuthServerConformanceOptions | false;
  }
}

/** The check ids, in the order the suite reports them. */
export const OAUTH_CONFORMANCE_CHECKS = [
  'scope-permissions-registered',
  'resource-scopes-registered',
  'resource-prefix-exclusive',
  'token-confinement',
  'scope-narrowing',
  'session-only-routes',
  'no-roles-only-admission',
  'challenge-on-401',
  'metadata-shape',
  'secret-egress',
] as const;

/**
 * One of the suite's check ids.
 *
 * @stability experimental
 */
export type OAuthConformanceCheck = (typeof OAUTH_CONFORMANCE_CHECKS)[number];

/** The application root the suite builds URLs on (the real deployment's is irrelevant to the checks). */
const PROBE_APP_URL = 'https://conformance.example.test';

/**
 * The evidence the `secret-egress` check reads: what an app collected while it
 * drove a real flow (consent, token, refresh, grants and clients routes, audit).
 *
 * @stability experimental
 */
export interface OAuthSecretEgressEvidence {
  /** Every secret the flow minted or used: tokens, codes, client secrets, PKCE verifiers. */
  readonly secrets: readonly string[];
  /** Bodies of the responses of the grants and clients routes (a string or a parsed JSON value). */
  readonly responses: readonly unknown[];
  /** Audit rows written during the flow. */
  readonly auditRows: readonly unknown[];
  /** Log lines captured during the flow. */
  readonly logLines: readonly string[];
}

/**
 * The part of a guard class the suite constructs: `JwtAuthGuard`'s constructor.
 *
 * @stability experimental
 */
export type OAuthConformanceJwtGuardClass = new (
  reflector: Reflector,
  pats: PatService,
  nodes: IdentityNodeCredentials,
  oauthResolver?: OAuthTokenResolver,
  oauthSettings?: OAuthServerSettingsReader,
  delegation?: InProcessDelegation,
) => CanActivate;

/**
 * One handler that must refuse an `oauth` credential.
 *
 * @stability experimental
 */
export interface OAuthSessionOnlyHandler {
  /** The controller class. */
  readonly controller: Type<unknown>;
  /** The handler method name. */
  readonly handler: string;
  /** Instance fields the handler needs before it reaches its refusal (a real prototype, no state). */
  readonly deps?: Readonly<Record<string, unknown>>;
}

/**
 * What an app passes as `suites.oauthServer` to `runPlatformConformance()`.
 *
 * @example
 * ```ts
 * runPlatformConformance({
 *   sourceRoots: [API_SOURCE_ROOT],
 *   suites: {
 *     oauthServer: {
 *       rootModule: AppModule,
 *       permissions: permissionRegistry.list().map((permission) => permission.id),
 *       secretEgress: { skip: 'proven against a real database in test/identity/oauth/oauth-conformance.db.spec.ts' },
 *     },
 *   },
 * });
 * ```
 *
 * @stability experimental
 */
export interface OAuthServerConformanceOptions {
  /** The app's root module; the routes the suite probes are those of every controller reachable from it. */
  readonly rootModule: Type<unknown> | DynamicModule;
  /** Every registered permission id (the app's permission registry). */
  readonly permissions: readonly string[];
  /**
   * The `secret-egress` evidence, collected from a real flow (a function, so the
   * flow runs when the case does), or `{ skip: 'why' }`: the check needs a
   * database, so a unit-tier entry skips it with a written reason and a
   * database-tier spec runs it ({@link checkOAuthSecretEgress}).
   */
  readonly secretEgress: (() => Promise<OAuthSecretEgressEvidence>) | { readonly skip: string };
  /** Fewest protected resources the registry must hold (a vacuity guard); 1 by default. Use 0 only for an app that mounts the server with none. */
  readonly minResources?: number;
  /** The global route prefix the app serves under; `api` by default. */
  readonly globalPrefix?: string;
  /** The authentication guard to exercise; the slice's `JwtAuthGuard` by default. */
  readonly guard?: OAuthConformanceJwtGuardClass;
  /** The permissions guard to exercise; the slice's `PermissionsGuard` by default. */
  readonly permissionsGuard?: new (reflector: Reflector) => CanActivate;
  /** The roles guard to exercise; the slice's `RolesGuard` by default. */
  readonly rolesGuard?: new (reflector: Reflector) => CanActivate;
  /** The handlers that must refuse an `oauth` credential; the platform's by default (consent, grants, PAT, device, org switch). */
  readonly sessionOnlyHandlers?: readonly OAuthSessionOnlyHandler[];
  /** The registries to check; the live OAuth registries by default (a test seam). */
  readonly registry?: { readonly scopes: readonly OAuthScopeDefinition[]; readonly resources: readonly OAuthProtectedResourceDefinition[] };
}

// ---- discovery ---------------------------------------------------------------------------

/**
 * One route handler the walk found, with the access it declares.
 *
 * @stability experimental
 */
export interface OAuthRoute {
  /** `Controller#handler`. */
  readonly id: string;
  /** The controller class. */
  readonly controller: Type<unknown>;
  /** The handler name. */
  readonly handler: string;
  /** The request path, with the global prefix and `:param` / `*` segments replaced by `x`. */
  readonly path: string;
  /** Whether it is `@Public()`. */
  readonly isPublic: boolean;
  /** The permissions it requires (all of). */
  readonly permissions: readonly string[];
  /** The permissions it admits one of. */
  readonly anyPermissions: readonly string[];
  /** The system roles it admits. */
  readonly roles: readonly string[];
}

function joinPath(...parts: Array<string | string[] | undefined>): string {
  const segments: string[] = [];
  for (const part of parts) {
    const text = Array.isArray(part) ? (part[0] ?? '') : (part ?? '');
    for (const segment of text.split('/')) if (segment !== '') segments.push(/^[:*]/.test(segment) || segment.includes('*') ? 'x' : segment);
  }
  return `/${segments.join('/')}`;
}

/**
 * Every route handler of `controllers`, with its path and declared access.
 *
 * @param controllers - from `discoverControllers`.
 * @param globalPrefix - the app's global prefix (`api`).
 * @returns one entry per handler.
 *
 * @stability experimental
 */
export function discoverOAuthRoutes(controllers: ReadonlyArray<Type<unknown>>, globalPrefix = 'api'): OAuthRoute[] {
  const routes: OAuthRoute[] = [];
  for (const controller of controllers) {
    const prototype = controller.prototype as Record<string, unknown>;
    const base = Reflect.getMetadata(PATH_METADATA, controller) as string | string[] | undefined;
    const names = new Set<string>();
    for (let proto: object | null = prototype; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
      for (const name of Object.getOwnPropertyNames(proto)) names.add(name);
    }
    for (const name of names) {
      const handler = prototype[name];
      if (name === 'constructor' || typeof handler !== 'function') continue;
      if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
      const own = Reflect.getMetadata(PATH_METADATA, handler) as string | string[] | undefined;
      if (own === undefined) continue;
      const read = (key: string): string[] => [
        ...((Reflect.getMetadata(key, controller) ?? []) as string[]),
        ...((Reflect.getMetadata(key, handler) ?? []) as string[]),
      ];
      routes.push({
        id: `${controller.name}#${name}`,
        controller,
        handler: name,
        path: joinPath(globalPrefix, base, own),
        isPublic: Reflect.getMetadata(IS_PUBLIC_KEY, controller) === true || Reflect.getMetadata(IS_PUBLIC_KEY, handler) === true,
        permissions: read(PERMISSIONS_KEY),
        anyPermissions: read(ANY_PERMISSIONS_KEY),
        roles: read(ROLES_KEY),
      });
    }
  }
  return routes;
}

/** The resource a request path belongs to, by the same prefix rule the guard uses. */
function resourceOfPath(path: string, resources: readonly OAuthProtectedResourceDefinition[]): OAuthProtectedResourceDefinition | undefined {
  return resources.find((resource) => resource.routePrefixes.some((prefix) => isUnderRoutePrefix(path, prefix)));
}

// ---- checks 1 to 3: the registries ---------------------------------------------------------

/**
 * Check `scope-permissions-registered`.
 *
 * @param scopes - the registered scopes.
 * @param permissions - every registered permission id.
 * @returns the violations.
 *
 * @stability experimental
 */
export function checkScopePermissionsRegistered(scopes: readonly OAuthScopeDefinition[], permissions: readonly string[]): ConformanceFinding[] {
  const known = new Set(permissions);
  const out: ConformanceFinding[] = [];
  for (const scope of scopes) {
    for (const permission of scope.permissions) {
      if (!known.has(permission)) {
        out.push({ file: 'scope-permissions-registered', message: `scope "${scope.id}" names the permission "${permission}", which is not registered: register it, or fix the scope.` });
      }
    }
  }
  return out;
}

/**
 * Check `resource-scopes-registered`.
 *
 * @param resources - the registered resources.
 * @param scopes - the registered scopes.
 * @returns the violations.
 *
 * @stability experimental
 */
export function checkResourceScopesRegistered(resources: readonly OAuthProtectedResourceDefinition[], scopes: readonly OAuthScopeDefinition[]): ConformanceFinding[] {
  const byId = new Map(scopes.map((scope) => [scope.id, scope]));
  const out: ConformanceFinding[] = [];
  for (const resource of resources) {
    for (const scopeId of resource.scopes) {
      if (scopeId !== OFFLINE_ACCESS_SCOPE && !byId.has(scopeId)) {
        out.push({ file: 'resource-scopes-registered', message: `resource "${resource.id}" lists the scope "${scopeId}", which is not registered.` });
      }
    }
    if (!resource.scopes.some((scopeId) => byId.get(scopeId)?.default === true)) {
      out.push({ file: 'resource-scopes-registered', message: `resource "${resource.id}" has no default scope: a client that asks for no scope would get nothing. Mark one of its scopes default: true.` });
    }
  }
  return out;
}

/**
 * Check `resource-prefix-exclusive`.
 *
 * @param resources - the registered resources.
 * @returns the violations.
 *
 * @stability experimental
 */
export function checkResourcePrefixExclusive(resources: readonly OAuthProtectedResourceDefinition[]): ConformanceFinding[] {
  const out: ConformanceFinding[] = [];
  const overlaps = (a: string, b: string): boolean => isUnderRoutePrefix(a, b) || isUnderRoutePrefix(b, a);
  for (const [i, resource] of resources.entries()) {
    for (const prefix of resource.routePrefixes) {
      for (const forbidden of FORBIDDEN_OAUTH_ROUTE_PREFIXES) {
        if (overlaps(prefix, forbidden)) {
          out.push({ file: 'resource-prefix-exclusive', message: `resource "${resource.id}": the prefix "${prefix}" covers "${forbidden}", which no resource may claim.` });
        }
      }
    }
    for (const other of resources.slice(i + 1)) {
      for (const a of resource.routePrefixes) {
        for (const b of other.routePrefixes) {
          if (overlaps(a, b)) {
            out.push({ file: 'resource-prefix-exclusive', message: `resources "${resource.id}" ("${a}") and "${other.id}" ("${b}") share or nest a route prefix: an oat_ token's resource would be ambiguous.` });
          }
        }
      }
    }
  }
  return out;
}

// ---- probes --------------------------------------------------------------------------------

interface ProbeRequest {
  headers: { authorization?: string };
  url: string;
  originalUrl: string;
  user?: unknown;
  authCredential?: { kind?: string };
  principal?: unknown;
}

function probeContext(request: ProbeRequest, handler: unknown, controller: Type<unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}), getNext: () => undefined }),
    getHandler: () => handler,
    getClass: () => controller,
  } as unknown as ExecutionContext;
}

/** A user graph holding every permission in `permissions` (an org role) and the system roles `roles`. */
function probeUser(permissions: readonly string[], roles: readonly string[] = []): Record<string, unknown> {
  const grant = (names: readonly string[]) => names.map((name) => ({ permission: { name } }));
  const orgId = '00000000-0000-4000-8000-0000000000aa';
  return {
    id: 'conformance-user',
    email: 'conformance@example.test',
    isActive: true,
    userRoles: roles.map((role) => ({ role: { name: role, rolePermissions: [] } })),
    memberships: [{ orgId, status: 'active', lastActiveAt: null, org: { id: orgId, isDefault: false }, role: { name: 'conformance_member', rolePermissions: grant(permissions) } }],
  };
}

/** An `oauth`-credential user: holds `permissions`, narrowed to those the `scopes` of `resource` grant. */
function oauthUser(resource: OAuthProtectedResourceDefinition, scopes: readonly string[], definitions: readonly OAuthScopeDefinition[], held: readonly string[]): Record<string, unknown> {
  const granting = new Set(definitions.filter((scope) => scopes.includes(scope.id)).flatMap((scope) => scope.permissions));
  const user = stampCredential(probeUser(held) as never, { activeOrgId: '00000000-0000-4000-8000-0000000000aa', tokenKind: 'oauth' });
  stampOAuthNarrowing(user, { permissions: [...granting], info: { clientId: 'conformance-client', grantId: 'conformance-grant', resourceId: resource.id, scopes: [...scopes] } });
  return user as unknown as Record<string, unknown>;
}

/** A guard stack whose OAuth half answers for the probe tokens `oat_<resource id>` and refuses every other. */
function buildProbeGuard(options: OAuthServerConformanceOptions, resources: readonly OAuthProtectedResourceDefinition[], definitions: readonly OAuthScopeDefinition[]) {
  const resolved = (resource: OAuthProtectedResourceDefinition): ResolvedOAuthToken => ({
    user: oauthUser(resource, resource.scopes, definitions, options.permissions) as never,
    tokenId: 'conformance-token',
    grantId: 'conformance-grant',
    clientId: 'conformance-client',
    resource,
    scopes: [...resource.scopes],
  });
  const state = { resolveCalls: 0 };
  const resolver = {
    resolve: async (raw: string) => {
      state.resolveCalls += 1;
      const resource = resources.find((candidate) => raw === `oat_${candidate.id}`);
      return resource ? resolved(resource) : null;
    },
  };
  const settings = { isEnabled: async () => true };
  const pats = { resolveToken: async () => null };
  const nodes: IdentityNodeCredentials = { validateToken: async () => null };
  const GuardClass = options.guard ?? (JwtAuthGuard as unknown as OAuthConformanceJwtGuardClass);
  const guard = new GuardClass(new Reflector(), pats as unknown as PatService, nodes, resolver as unknown as OAuthTokenResolver, settings as unknown as OAuthServerSettingsReader, new InProcessDelegation());
  return { guard, state };
}

type Outcome = { admitted: true } | { admitted: false; error: unknown };

async function tryGuard(guard: CanActivate, context: ExecutionContext): Promise<Outcome> {
  try {
    return (await guard.canActivate(context)) ? { admitted: true } : { admitted: false, error: undefined };
  } catch (error) {
    return { admitted: false, error };
  }
}

const refusedWithForbidden = (outcome: Outcome): boolean => !outcome.admitted && outcome.error instanceof ForbiddenException;

// ---- check 4: token-confinement ------------------------------------------------------------

/**
 * Check `token-confinement`: an `oat_` token minted for one resource is refused
 * (403, and before any lookup) on every discovered route outside that resource,
 * on the paths no resource may claim, and is admitted inside its own resource.
 * Extends {@link checkTokenConfinement} (the `nod_` and `pat_` half), which it also runs.
 *
 * @param options - the suite options.
 * @param routes - the discovered routes.
 * @returns the violations.
 *
 * @stability experimental
 */
export async function checkOAuthTokenConfinement(options: OAuthServerConformanceOptions, routes: readonly OAuthRoute[]): Promise<ConformanceFinding[]> {
  const out: ConformanceFinding[] = await checkTokenConfinement(options.guard as unknown as IdentityConformanceGuardClass | undefined);
  const resources = options.registry?.resources ?? oauthResourceRegistry.list();
  const definitions = options.registry?.scopes ?? oauthScopeRegistry.list();
  const file = 'token-confinement';
  const handler = function oauthConfinementProbe(): void {};
  class ConfinementProbe {}
  const extra = ['/api/users', '/api/auth/me', '/api/nodes/register', '/api/oauth/grants', '/api/pat', '/'];

  for (const resource of resources) {
    const { guard, state } = buildProbeGuard(options, resources, definitions);
    const paths = [...new Set([...routes.map((route) => route.path), ...extra])].filter((path) => resourceOfPath(path, resources)?.id !== resource.id);
    for (const path of paths) {
      state.resolveCalls = 0;
      const request: ProbeRequest = { headers: { authorization: `Bearer oat_${resource.id}` }, url: path, originalUrl: path };
      const outcome = await tryGuard(guard, probeContext(request, handler, ConfinementProbe));
      if (outcome.admitted) out.push({ file, message: `admits an oat_ token of resource "${resource.id}" on ${path}, outside its resource.` });
      else if (!refusedWithForbidden(outcome)) out.push({ file, message: `does not answer 403 to an oat_ token of resource "${resource.id}" on ${path}.` });
      if (state.resolveCalls > 0) out.push({ file, message: `looked the token up (I/O) before refusing it on ${path}: route confinement must precede every lookup.` });
    }
    // The positive control: the same token on its own resource is admitted (the probe is wired).
    const inside = `${resource.routePrefixes[0]}/probe`;
    const request: ProbeRequest = { headers: { authorization: `Bearer oat_${resource.id}` }, url: inside, originalUrl: inside };
    const outcome = await tryGuard(guard, probeContext(request, handler, ConfinementProbe));
    if (!outcome.admitted) out.push({ file, message: `refuses a valid oat_ token of resource "${resource.id}" on its own route ${inside} (${String((outcome.error as Error)?.message)}).` });
    // A query string cannot smuggle a path through.
    for (const prefix of resource.routePrefixes) {
      const smuggled = `/api/users?next=${prefix}`;
      const smuggle: ProbeRequest = { headers: { authorization: `Bearer oat_${resource.id}` }, url: smuggled, originalUrl: smuggled };
      if ((await tryGuard(guard, probeContext(smuggle, handler, ConfinementProbe))).admitted) {
        out.push({ file, message: `admits an oat_ token on a path that only carries "${prefix}" in its query string.` });
      }
    }
  }
  return out;
}

// ---- check 5: scope-narrowing --------------------------------------------------------------

/**
 * Check `scope-narrowing`: for every discovered route under a resource that
 * declares permissions, a token whose scopes do not grant a permission the route
 * needs is refused there (the permission guard decides over the narrowed set).
 *
 * @param options - the suite options.
 * @param routes - the discovered routes.
 * @returns the violations.
 *
 * @stability experimental
 */
export async function checkScopeNarrowing(options: OAuthServerConformanceOptions, routes: readonly OAuthRoute[]): Promise<ConformanceFinding[]> {
  const resources = options.registry?.resources ?? oauthResourceRegistry.list();
  const definitions = options.registry?.scopes ?? oauthScopeRegistry.list();
  const Guard = options.permissionsGuard ?? PermissionsGuard;
  const out: ConformanceFinding[] = [];
  for (const route of routes) {
    const resource = resourceOfPath(route.path, resources);
    if (!resource || route.isPublic) continue;
    const handler = (route.controller.prototype as Record<string, unknown>)[route.handler];
    // Each permission the route needs, one at a time (all-of), or all alternatives together (any-of).
    const cases: Array<{ lacking: readonly string[]; label: string }> = [
      ...route.permissions.map((permission) => ({ lacking: [permission], label: permission })),
      ...(route.anyPermissions.length > 0 ? [{ lacking: route.anyPermissions, label: `any of ${route.anyPermissions.join(', ')}` }] : []),
    ];
    for (const { lacking, label } of cases) {
      const scopes = resource.scopes.filter((id) => !definitions.find((scope) => scope.id === id)?.permissions.some((permission) => lacking.includes(permission)));
      const request: ProbeRequest = {
        headers: {},
        url: route.path,
        originalUrl: route.path,
        user: oauthUser(resource, scopes, definitions, options.permissions),
        authCredential: { kind: 'oauth' },
      };
      const outcome = await tryGuard(new Guard(new Reflector()), probeContext(request, handler, route.controller));
      if (outcome.admitted) {
        out.push({ file: 'scope-narrowing', message: `${route.id} (${route.path}) admits an oat_ token whose scopes (${scopes.join(' ') || 'none'}) do not grant ${label}.` });
      }
    }
  }
  return out;
}

// ---- check 6: session-only-routes ----------------------------------------------------------

/** The platform's handlers that only a browser session may use. */
export function defaultSessionOnlyHandlers(): OAuthSessionOnlyHandler[] {
  const authService = Object.create(AuthService.prototype) as unknown;
  return [
    { controller: OAuthConsentController, handler: 'read' },
    { controller: OAuthConsentController, handler: 'decide' },
    { controller: OAuthGrantsController, handler: 'list' },
    { controller: OAuthGrantsController, handler: 'revoke' },
    { controller: PatController, handler: 'createToken' },
    { controller: PatController, handler: 'revokeToken' },
    { controller: AuthController, handler: 'switchOrg', deps: { authService } },
    { controller: AuthController, handler: 'logoutAll' },
    { controller: DeviceAuthController, handler: 'authorizeDevice' },
    { controller: DeviceAuthController, handler: 'revokeSession' },
  ];
}

/**
 * Check `session-only-routes`: each listed handler is called with an `oauth`
 * credential in every argument position (the principal, the credential, the
 * user) and must answer `403` before it reaches a service.
 *
 * @param handlers - the handlers to probe.
 * @returns the violations.
 *
 * @stability experimental
 */
export async function checkSessionOnlyRoutes(handlers: readonly OAuthSessionOnlyHandler[]): Promise<ConformanceFinding[]> {
  const out: ConformanceFinding[] = [];
  // One object that reads as an `oauth` principal, an `oauth` credential and a user at once.
  const oauth = {
    kind: 'oauth',
    credential: 'oauth',
    tokenId: 't',
    grantId: 'g',
    clientId: 'c',
    resourceId: 'r',
    scopes: ['s'],
    id: 'u',
    userId: 'u',
    roles: [],
    permissions: [],
    cookies: {},
    headers: {},
  };
  for (const { controller, handler, deps } of handlers) {
    const id = `${controller.name}#${handler}`;
    const method = (controller.prototype as Record<string, unknown>)[handler];
    if (typeof method !== 'function') {
      out.push({ file: 'session-only-routes', message: `${id} does not exist.` });
      continue;
    }
    const instance = Object.assign(Object.create(controller.prototype) as object, deps ?? {});
    try {
      await (method as (...args: unknown[]) => unknown).apply(instance, [oauth, oauth, oauth, oauth, oauth]);
      out.push({ file: 'session-only-routes', message: `${id} ran for an oauth credential: it must refuse an oat_ token (refuseOAuthCredential / requireSessionCredential).` });
    } catch (error) {
      if (!(error instanceof ForbiddenException)) {
        out.push({ file: 'session-only-routes', message: `${id} did not refuse an oauth credential with 403 before doing its work (${error instanceof Error ? error.constructor.name : 'unknown'}).` });
      }
    }
  }
  return out;
}

// ---- check 7: no-roles-only-admission ------------------------------------------------------

/**
 * Check `no-roles-only-admission`: a route guarded by `@Roles` and declaring no
 * permission refuses an `oauth` credential even when the user holds the role.
 *
 * @param options - the suite options.
 * @param routes - the discovered routes.
 * @returns the violations.
 *
 * @stability experimental
 */
export async function checkNoRolesOnlyAdmission(options: OAuthServerConformanceOptions, routes: readonly OAuthRoute[]): Promise<ConformanceFinding[]> {
  const Guard = options.rolesGuard ?? RolesGuard;
  const out: ConformanceFinding[] = [];
  for (const route of routes) {
    if (route.roles.length === 0 || route.permissions.length > 0 || route.anyPermissions.length > 0) continue;
    const handler = (route.controller.prototype as Record<string, unknown>)[route.handler];
    const resource = (options.registry?.resources ?? oauthResourceRegistry.list())[0];
    const user = stampCredential(probeUser([], route.roles) as never, { activeOrgId: '00000000-0000-4000-8000-0000000000aa', tokenKind: 'oauth' });
    stampOAuthNarrowing(user, { permissions: [], info: { clientId: 'c', grantId: 'g', resourceId: resource?.id ?? 'r', scopes: [] } });
    const request: ProbeRequest = { headers: {}, url: route.path, originalUrl: route.path, user, authCredential: { kind: 'oauth' } };
    const outcome = await tryGuard(new Guard(new Reflector()), probeContext(request, handler, route.controller));
    if (outcome.admitted) out.push({ file: 'no-roles-only-admission', message: `${route.id} (${route.path}) admits an oauth credential on @Roles alone (${route.roles.join(', ')}): declare a permission a scope can narrow.` });
  }
  return out;
}

// ---- check 8: challenge-on-401 -------------------------------------------------------------

/**
 * Parses a `WWW-Authenticate: Bearer ...` value into its parameters.
 *
 * @param header - the header value.
 * @returns the parameters (quoted-string values unescaped).
 *
 * @stability experimental
 */
export function parseBearerChallenge(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!/^Bearer\s/i.test(header)) return out;
  const pattern = /([a-z_]+)="((?:[^"\\]|\\.)*)"/gi;
  for (let match = pattern.exec(header); match; match = pattern.exec(header)) out[match[1]!] = match[2]!.replace(/\\(.)/g, '$1');
  return out;
}

/**
 * Check `challenge-on-401`: a call to a resource route with no token, and one
 * with an invalid `oat_` token, answers `401` with a `WWW-Authenticate: Bearer`
 * challenge whose `resource_metadata` URL is the resource's well-known document
 * (`<APP_URL>/.well-known/oauth-protected-resource<path>`), which the registry
 * can answer.
 *
 * @param options - the suite options.
 * @param routes - the discovered routes.
 * @returns the violations.
 *
 * @stability experimental
 */
export async function checkChallengeOn401(options: OAuthServerConformanceOptions, routes: readonly OAuthRoute[]): Promise<ConformanceFinding[]> {
  const resources = options.registry?.resources ?? oauthResourceRegistry.list();
  const definitions = options.registry?.scopes ?? oauthScopeRegistry.list();
  const out: ConformanceFinding[] = [];
  const file = 'challenge-on-401';
  const previousBase = configuredOAuthChallengeBase();
  configureOAuthChallengeBase(PROBE_APP_URL);
  // The no-credential path ends in Passport; the suite stands a failing one in for it, for this probe only.
  const passportBase = Object.getPrototypeOf(JwtAuthGuard.prototype) as { canActivate: unknown };
  const originalCanActivate = passportBase.canActivate;
  passportBase.canActivate = () => {
    throw new UnauthorizedException();
  };
  try {
    const handler = function oauthChallengeProbe(): void {};
    class ChallengeProbe {}
    for (const resource of resources) {
      const { guard } = buildProbeGuard(options, resources, definitions);
      const own = routes.find((route) => !route.isPublic && resourceOfPath(route.path, resources)?.id === resource.id);
      const path = own?.path ?? `${resource.routePrefixes[0]}/probe`;
      for (const [label, authorization] of [['no token', undefined], ['an invalid token', 'Bearer oat_invalid']] as const) {
        const request: ProbeRequest = { headers: authorization ? { authorization } : {}, url: path, originalUrl: path };
        const outcome = await tryGuard(guard, probeContext(request, handler, ChallengeProbe));
        if (outcome.admitted || !(outcome.error instanceof UnauthorizedException)) {
          out.push({ file, message: `${path} did not answer 401 for ${label}.` });
          continue;
        }
        const header = responseHeadersOf(outcome.error, request)['WWW-Authenticate'];
        const params = header ? parseBearerChallenge(header) : {};
        if (!header || !/^Bearer\s/i.test(header) || !params.resource_metadata) {
          out.push({ file, message: `${path} answers 401 for ${label} without a "WWW-Authenticate: Bearer resource_metadata=..." challenge.` });
          continue;
        }
        const expected = `${PROBE_APP_URL}/.well-known/oauth-protected-resource${resource.path}`;
        if (params.resource_metadata !== expected) {
          out.push({ file, message: `${path}: the challenge names ${params.resource_metadata}, not the resource's metadata document ${expected}.` });
        }
        if (label === 'an invalid token' && params.error !== 'invalid_token') {
          out.push({ file, message: `${path}: the challenge for an invalid token lacks error="invalid_token".` });
        }
        if (label === 'no token' && params.error !== undefined) {
          out.push({ file, message: `${path}: the challenge for a request with no token must not carry an error (RFC 6750 §3.1).` });
        }
      }
    }
  } finally {
    passportBase.canActivate = originalCanActivate;
    configureOAuthChallengeBase(previousBase);
  }
  return out;
}

// ---- check 9: metadata-shape ---------------------------------------------------------------

/**
 * Check `metadata-shape`.
 *
 * @param input - the application root and the documents.
 * @returns the violations.
 *
 * @stability experimental
 */
export function checkMetadataShape(input: {
  appUrl: string;
  authorizationServer: Record<string, unknown>;
  protectedResources: ReadonlyArray<{ id: string; path: string; document: Record<string, unknown> }>;
}): ConformanceFinding[] {
  const out: ConformanceFinding[] = [];
  const file = 'metadata-shape';
  const as = input.authorizationServer;
  for (const field of ['issuer', 'authorization_endpoint', 'token_endpoint', 'response_types_supported', 'grant_types_supported', 'code_challenge_methods_supported']) {
    if (as[field] === undefined) out.push({ file, message: `the authorization server metadata misses the required field "${field}".` });
  }
  if (as.issuer !== input.appUrl) out.push({ file, message: `the authorization server issuer is ${String(as.issuer)}, not APP_URL (${input.appUrl}).` });
  const methods = Array.isArray(as.code_challenge_methods_supported) ? (as.code_challenge_methods_supported as unknown[]) : [];
  if (methods.includes('plain')) out.push({ file, message: 'the authorization server metadata lists the "plain" PKCE method: only S256 is allowed.' });
  if (!methods.includes('S256')) out.push({ file, message: 'the authorization server metadata does not list the S256 PKCE method.' });
  for (const field of ['authorization_endpoint', 'token_endpoint']) {
    if (typeof as[field] === 'string' && !(as[field] as string).startsWith(`${input.appUrl}/`)) out.push({ file, message: `${field} is not under APP_URL.` });
  }
  for (const { id, path, document } of input.protectedResources) {
    for (const field of ['resource', 'authorization_servers', 'scopes_supported']) {
      if (document[field] === undefined) out.push({ file, message: `the metadata of resource "${id}" misses the required field "${field}".` });
    }
    if (document.resource !== `${input.appUrl}${path}`) {
      out.push({ file, message: `the metadata of resource "${id}" says resource ${String(document.resource)}, not APP_URL + path (${input.appUrl}${path}).` });
    }
    const servers = Array.isArray(document.authorization_servers) ? (document.authorization_servers as unknown[]) : [];
    if (servers.length !== 1 || servers[0] !== input.appUrl) out.push({ file, message: `the metadata of resource "${id}" must name exactly the issuer as its authorization server.` });
  }
  return out;
}

/** Builds the two documents the way the controllers do and checks them. */
function metadataFindings(resources: readonly OAuthProtectedResourceDefinition[]): ConformanceFinding[] {
  return checkMetadataShape({
    appUrl: PROBE_APP_URL,
    authorizationServer: buildAuthorizationServerMetadata({
      issuer: PROBE_APP_URL,
      settings: { dynamicClientRegistration: true, clientIdMetadataDocuments: true },
      hasDynamicClientRegistration: true,
      hasClientIdMetadataDocuments: true,
    }) as unknown as Record<string, unknown>,
    protectedResources: resources.map((resource) => ({
      id: resource.id,
      path: resource.path,
      document: buildProtectedResourceMetadata({ issuer: PROBE_APP_URL, identifier: oauthResourceIdentifier(PROBE_APP_URL, resource)!, resource }) as unknown as Record<string, unknown>,
    })),
  });
}

// ---- check 10: secret-egress ---------------------------------------------------------------

const TOKEN_SHAPE = /\b(?:oat|ort|oac)_[A-Za-z0-9_-]{16,}/;

/**
 * Check `secret-egress`: none of the secrets (nor its SHA-256 hash, nor a string
 * shaped like an `oat_` / `ort_` / `oac_` token) appears in a response of the
 * grants and clients routes, an audit row or a captured log line.
 *
 * @param evidence - what the flow produced.
 * @returns the violations.
 *
 * @stability experimental
 */
export function checkOAuthSecretEgress(evidence: OAuthSecretEgressEvidence): ConformanceFinding[] {
  const out: ConformanceFinding[] = [];
  const secrets = evidence.secrets.filter((secret) => secret.length >= 8);
  const sinks: Array<{ where: string; text: string }> = [
    ...evidence.responses.map((value, index) => ({ where: `response ${index}`, text: typeof value === 'string' ? value : JSON.stringify(value) })),
    ...evidence.auditRows.map((value, index) => ({ where: `audit row ${index}`, text: JSON.stringify(value) })),
    ...evidence.logLines.map((line, index) => ({ where: `log line ${index}`, text: line })),
  ];
  for (const sink of sinks) {
    for (const secret of secrets) {
      const hash = createHash('sha256').update(secret).digest('hex');
      if (sink.text.includes(secret)) out.push({ file: 'secret-egress', message: `${sink.where} carries a secret (${secret.slice(0, 4)}...).` });
      else if (sink.text.includes(hash)) out.push({ file: 'secret-egress', message: `${sink.where} carries the SHA-256 hash of a secret.` });
    }
    if (TOKEN_SHAPE.test(sink.text)) out.push({ file: 'secret-egress', message: `${sink.where} carries a string shaped like an OAuth token or code.` });
  }
  return out;
}

// ---- the suite -----------------------------------------------------------------------------

function findingsFor(report: ConformanceReport, check: OAuthConformanceCheck): ConformanceFinding[] {
  return report.findings.filter((finding) => finding.file === check);
}

/**
 * The `oauth-server` conformance suite. Registered when
 * `@marinoscar/platform-api/identity/testing` is imported.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const oauthServerConformanceSuite: ConformanceSuite<OAuthServerConformanceOptions> = {
  id: 'oauth-server',
  title: 'the OAuth server keeps its invariants',
  description:
    'Every scope names registered permissions, resources have exclusive prefixes and known scopes, an oat_ token is confined to its resource and narrowed by its scopes, session-only and roles-only routes refuse it, a 401 carries the discovery challenge, the metadata documents are well formed and no secret leaves the server.',
  check(_context, options): ConformanceReport {
    const scopes = options.registry?.scopes ?? oauthScopeRegistry.list();
    const resources = options.registry?.resources ?? oauthResourceRegistry.list();
    const controllers = discoverControllers(options.rootModule);
    const routes = discoverOAuthRoutes(controllers, options.globalPrefix ?? 'api');
    const findings: ConformanceFinding[] = [];
    const minResources = options.minResources ?? 1;
    if (resources.length < minResources) {
      findings.push({ file: 'resource-scopes-registered', message: `the registry holds ${resources.length} protected resource(s), fewer than ${minResources}: did the app register its resource before the suite ran?` });
    }
    findings.push(...checkScopePermissionsRegistered(scopes, options.permissions));
    findings.push(...checkResourceScopesRegistered(resources, scopes));
    findings.push(...checkResourcePrefixExclusive(resources));
    findings.push(...metadataFindings(resources));
    return {
      scanned: {
        scopes: scopes.length,
        resources: resources.length,
        controllers: controllers.length,
        routes: routes.length,
        resourceRoutes: routes.filter((route) => resourceOfPath(route.path, resources) !== undefined).length,
      },
      scannedFiles: { routes: routes.map((route) => `${route.id} ${route.path}`) },
      findings,
    };
  },
  cases(options): ConformanceCase[] {
    const routesOf = (): OAuthRoute[] => discoverOAuthRoutes(discoverControllers(options.rootModule), options.globalPrefix ?? 'api');
    const cases: ConformanceCase[] = [
      {
        name: 'scope-permissions-registered: every scope names only registered permissions',
        run: (report, expect) => expect(findingsFor(report, 'scope-permissions-registered')).toEqual([]),
      },
      {
        name: 'resource-scopes-registered: every resource lists registered scopes and has a default scope',
        run: (report, expect) => expect(findingsFor(report, 'resource-scopes-registered')).toEqual([]),
      },
      {
        name: 'resource-prefix-exclusive: no two resources share or nest a prefix, none covers /api/oauth, /api/auth or /api/nodes',
        run: (report, expect) => expect(findingsFor(report, 'resource-prefix-exclusive')).toEqual([]),
      },
      {
        name: 'token-confinement: an oat_ token is refused on every route outside its resource, before any lookup',
        run: async (_report, expect) => expect(await checkOAuthTokenConfinement(options, routesOf())).toEqual([]),
      },
      {
        name: 'scope-narrowing: a token without the scope that grants a route\'s permission is refused there',
        run: async (_report, expect) => expect(await checkScopeNarrowing(options, routesOf())).toEqual([]),
      },
      {
        name: 'session-only-routes: the consent decision, grant management, PAT creation, device approval and org switch refuse an oauth credential',
        run: async (_report, expect) => expect(await checkSessionOnlyRoutes(options.sessionOnlyHandlers ?? defaultSessionOnlyHandlers())).toEqual([]),
      },
      {
        name: 'no-roles-only-admission: a route guarded by @Roles alone refuses an oauth credential',
        run: async (_report, expect) => expect(await checkNoRolesOnlyAdmission(options, routesOf())).toEqual([]),
      },
      {
        name: 'challenge-on-401: a resource route answers 401 with a WWW-Authenticate challenge naming its metadata document',
        run: async (_report, expect) => expect(await checkChallengeOn401(options, routesOf())).toEqual([]),
      },
      {
        name: 'metadata-shape: both discovery documents carry their required fields, list no plain PKCE and resource equals APP_URL + path',
        run: (report, expect) => expect(findingsFor(report, 'metadata-shape')).toEqual([]),
      },
    ];
    const egress = options.secretEgress;
    cases.push(
      'skip' in egress
        ? {
            name: `secret-egress: skipped, ${egress.skip}`,
            run: (_report, expect) => expect(egress.skip.trim().length >= 10).toEqual(true),
          }
        : {
            name: 'secret-egress: no token, code, secret or hash in a grants or clients response, an audit row or a log line',
            run: async (_report, expect) => expect(checkOAuthSecretEgress(await egress())).toEqual([]),
          },
    );
    return cases;
  },
};

if (!conformanceSuites.has(oauthServerConformanceSuite.id)) conformanceSuites.register(oauthServerConformanceSuite);

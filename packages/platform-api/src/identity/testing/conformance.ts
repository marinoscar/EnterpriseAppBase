// =============================================================================
// The identity slice's conformance suite (issue #727, PP-6.6)
// =============================================================================
//
// Identity's invariants, checked against the APP that consumes the package, so
// an app that adopts it keeps being checked (spec: "Conformance suites travel
// with packages"). Importing `@marinoscar/platform-api/identity/testing`
// registers the `identity` suite with `runPlatformConformance()`.
//
//   1. route-access: every controller handler declares its access: `@Auth(...)`
//      (or a direct `UseGuards(JwtAuthGuard)`) or `@Public()`. There is no
//      global JWT guard, so a route with neither is public by accident. Read
//      from Nest metadata, by walking the app's root module.
//   2. permissions-registered: every permission and role a route names is in
//      the app's registry, with a scope.
//   3. scope-grants: no role is granted a permission of the other scope.
//   4. token-confinement: the authentication guard confines a `nod_` worker
//      credential to `/api/nodes` (query strings and look-alike prefixes
//      included) and resolves a `pat_` token as a personal access token, on a
//      node route too, never as a node credential.
//   5. rls (optional, db tier): every `org`-owned table has row-level security
//      enabled and FORCED, with at least one of its listed policies.
//
// Checks 1 to 3 run in the scan (`check`); 4 and 5 are asynchronous and run in
// their own cases.
// =============================================================================

import {
  ForbiddenException,
  type CanActivate,
  type DynamicModule,
  type ExecutionContext,
  type ForwardReference,
  type Type,
} from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';

import { conformanceSuites } from '../../testing/index';
import type { ConformanceCase, ConformanceFinding, ConformanceReport, ConformanceSuite } from '../../testing/index';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';
import { PERMISSIONS_KEY } from '../auth/decorators/permissions.decorator';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard, NODE_ROUTE_PREFIX } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import type { IdentityPermissionScope } from '../identity.permissions';
import type { IdentityNodeCredentials } from '../ports';
import type { PatService } from '../pat/pat.service';

declare module '../../testing/index' {
  interface PlatformConformanceSuiteOptions {
    /** The identity slice's suite: its options, or `false` to opt out. Registered by importing `@marinoscar/platform-api/identity/testing`. */
    identity?: IdentityConformanceOptions | false;
  }
}

/**
 * A registered role or permission, as the suite needs it.
 *
 * @stability experimental
 */
export interface IdentityConformanceAccessEntry {
  /** The role or permission id. */
  readonly id: string;
  /** Its scope. */
  readonly scope: IdentityPermissionScope;
}

/**
 * One table's row-level security, as the database reports it (`pg_class`
 * `relrowsecurity` / `relforcerowsecurity`, `pg_policies`).
 *
 * @stability experimental
 */
export interface IdentityConformanceRlsTable {
  /** The table name. */
  readonly table: string;
  /** `relrowsecurity`. */
  readonly enabled: boolean;
  /** `relforcerowsecurity`. */
  readonly forced: boolean;
  /** The names of its policies. */
  readonly policies: readonly string[];
}

/**
 * The optional db-tier check: the app's `org` tables and the policy names each
 * must carry (the reference app: `RLS_POLICIES` of `@marinoscar/platform-db`).
 *
 * @stability experimental
 */
export interface IdentityConformanceRlsOptions {
  /** Table name to the policy names it must carry (at least one each). */
  readonly policies: Readonly<Record<string, readonly string[]>>;
  /** Reads the live catalogue for those tables. */
  inspect(tables: readonly string[]): Promise<readonly IdentityConformanceRlsTable[]>;
}

/**
 * One role-to-permission grant.
 *
 * @stability experimental
 */
export interface IdentityConformanceGrant {
  /** The role. */
  readonly role: string;
  /** The permission it is granted. */
  readonly permission: string;
}

/**
 * The authentication guard class check 4 exercises.
 *
 * @stability experimental
 */
export interface IdentityConformanceGuardClass {
  /**
   * Builds the guard over stub resolvers.
   *
   * @param reflector - a fresh `Reflector`.
   * @param pats - resolves `pat_conformance` only.
   * @param nodes - resolves `nod_conformance` only.
   */
  new (reflector: Reflector, pats: PatService, nodes: IdentityNodeCredentials): CanActivate;
}

/**
 * What an app passes as `suites.identity` to `runPlatformConformance()`.
 *
 * @example
 * ```ts
 * runPlatformConformance({
 *   sourceRoots: [API_SOURCE_ROOT],
 *   suites: {
 *     identity: {
 *       rootModule: AppModule,
 *       permissions: permissionRegistry.list(),
 *       roles: roleRegistry.list(),
 *       grants: defaultGrantsOf(permissionRegistry.list()),
 *     },
 *   },
 * });
 * ```
 *
 * @stability experimental
 */
export interface IdentityConformanceOptions {
  /** The app's root module; every controller reachable from it is checked. */
  readonly rootModule: Type<unknown> | DynamicModule;
  /** Every registered permission, with its scope. */
  readonly permissions: readonly IdentityConformanceAccessEntry[];
  /** Every registered role, with its scope. */
  readonly roles: readonly IdentityConformanceAccessEntry[];
  /** Every role-to-permission grant the app seeds. */
  readonly grants: ReadonlyArray<IdentityConformanceGrant>;
  /**
   * The authentication guard to exercise for check 4; the slice's
   * `JwtAuthGuard` by default. Constructed as `new guard(reflector, pats, nodes)`.
   */
  readonly guard?: IdentityConformanceGuardClass;
  /** The db-tier row-level security check; skipped when absent. */
  readonly rls?: IdentityConformanceRlsOptions;
  /** Fewest routes the walk must find (a vacuity guard); 1 by default. */
  readonly minRoutes?: number;
}

/**
 * One route the walk found.
 *
 * @stability experimental
 */
export interface IdentityRoute {
  /** `ControllerName#handler`. */
  readonly id: string;
  /** Whether it is `@Public()`. */
  readonly isPublic: boolean;
  /** Whether `JwtAuthGuard` (or a subclass) guards it. */
  readonly authenticated: boolean;
  /** The permissions it requires. */
  readonly permissions: readonly string[];
  /** The roles it admits. */
  readonly roles: readonly string[];
}

type ImportLike = Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference;

function isDynamic(value: unknown): value is DynamicModule {
  return typeof value === 'object' && value !== null && 'module' in value;
}

function isForwardRef(value: unknown): value is ForwardReference {
  return typeof value === 'object' && value !== null && 'forwardRef' in value;
}

/**
 * Every controller class reachable from `root` through module imports (static
 * metadata and dynamic modules), each once.
 *
 * @param root - the app's root module.
 * @returns the controllers, in discovery order.
 *
 * @stability experimental
 */
export function discoverControllers(root: Type<unknown> | DynamicModule): Array<Type<unknown>> {
  const seenModules = new Set<unknown>();
  const controllers: Array<Type<unknown>> = [];
  const visit = (entry: ImportLike | undefined): void => {
    if (!entry || entry instanceof Promise) return;
    const resolved = isForwardRef(entry) ? (entry.forwardRef() as ImportLike) : entry;
    if (seenModules.has(resolved)) return;
    seenModules.add(resolved);
    const moduleClass = isDynamic(resolved) ? resolved.module : (resolved as Type<unknown>);
    const staticImports = (Reflect.getMetadata(MODULE_METADATA.IMPORTS, moduleClass) ?? []) as ImportLike[];
    const staticControllers = (Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, moduleClass) ?? []) as Array<Type<unknown>>;
    const dynamicImports = (isDynamic(resolved) ? resolved.imports ?? [] : []) as ImportLike[];
    const dynamicControllers = isDynamic(resolved) ? resolved.controllers ?? [] : [];
    for (const controller of [...staticControllers, ...dynamicControllers]) {
      if (!controllers.includes(controller)) controllers.push(controller);
    }
    for (const child of [...staticImports, ...dynamicImports]) visit(child);
  };
  visit(root);
  return controllers;
}

function isJwtGuard(guard: unknown): boolean {
  return typeof guard === 'function' && (guard === JwtAuthGuard || guard.prototype instanceof JwtAuthGuard);
}

/**
 * Every route handler of `controllers`, with the access it declares.
 *
 * @param controllers - controller classes, from {@link discoverControllers}.
 * @returns one entry per handler.
 *
 * @stability experimental
 */
export function discoverIdentityRoutes(controllers: ReadonlyArray<Type<unknown>>): IdentityRoute[] {
  const routes: IdentityRoute[] = [];
  for (const controller of controllers) {
    const classGuards = (Reflect.getMetadata(GUARDS_METADATA, controller) ?? []) as unknown[];
    const classPublic = Reflect.getMetadata(IS_PUBLIC_KEY, controller) === true;
    const classPermissions = (Reflect.getMetadata(PERMISSIONS_KEY, controller) ?? []) as string[];
    const classRoles = (Reflect.getMetadata(ROLES_KEY, controller) ?? []) as string[];
    const prototype = controller.prototype as Record<string, unknown>;
    const names = new Set<string>();
    for (let proto: object | null = prototype; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
      for (const name of Object.getOwnPropertyNames(proto)) names.add(name);
    }
    for (const name of names) {
      if (name === 'constructor') continue;
      const handler = (prototype as Record<string, unknown>)[name];
      if (typeof handler !== 'function') continue;
      if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined || Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;
      const guards = [...classGuards, ...((Reflect.getMetadata(GUARDS_METADATA, handler) ?? []) as unknown[])];
      routes.push({
        id: `${controller.name}#${name}`,
        isPublic: classPublic || Reflect.getMetadata(IS_PUBLIC_KEY, handler) === true,
        authenticated: guards.some(isJwtGuard),
        permissions: [...classPermissions, ...((Reflect.getMetadata(PERMISSIONS_KEY, handler) ?? []) as string[])],
        roles: [...classRoles, ...((Reflect.getMetadata(ROLES_KEY, handler) ?? []) as string[])],
      });
    }
  }
  return routes;
}

/**
 * Check 1: every route is `@Public()` or authenticated.
 *
 * @param routes - from {@link discoverIdentityRoutes}.
 * @returns the violations.
 *
 * @stability experimental
 */
export function checkRouteAccess(routes: readonly IdentityRoute[]): ConformanceFinding[] {
  return routes
    .filter((route) => !route.isPublic && !route.authenticated)
    .map((route) => ({
      file: route.id,
      message:
        'declares neither @Auth(...) nor @Public(). There is no global JWT guard, so this route is public by accident: add @Auth() (or @Auth({ permissions })) or, deliberately, @Public().',
    }));
}

/**
 * Check 2: every permission and role a route names is registered.
 *
 * @param routes - from {@link discoverIdentityRoutes}.
 * @param options - the registry.
 * @returns the violations.
 *
 * @stability experimental
 */
export function checkPermissionsRegistered(
  routes: readonly IdentityRoute[],
  options: Pick<IdentityConformanceOptions, 'permissions' | 'roles'>,
): ConformanceFinding[] {
  const permissions = new Map(options.permissions.map((entry) => [entry.id, entry.scope]));
  const roles = new Map(options.roles.map((entry) => [entry.id, entry.scope]));
  const out: ConformanceFinding[] = [];
  for (const route of routes) {
    for (const permission of route.permissions) {
      if (!permissions.has(permission)) {
        out.push({ file: route.id, message: `requires permission "${permission}", which is not registered: declare it (with a scope) in the permission registry.` });
      }
    }
    for (const role of route.roles) {
      if (!roles.has(role)) out.push({ file: route.id, message: `admits role "${role}", which is not registered.` });
      else if (roles.get(role) !== 'system') {
        out.push({ file: route.id, message: `admits role "${role}", an org role: @Auth({ roles }) takes system roles only; gate an org surface with an org permission.` });
      }
    }
  }
  for (const entry of [...options.permissions, ...options.roles]) {
    if (entry.scope !== 'system' && entry.scope !== 'org') {
      out.push({ file: 'registry', message: `"${entry.id}" has no valid scope (${JSON.stringify(entry.scope)}).` });
    }
  }
  return out;
}

/**
 * Check 3: no role is granted a permission of the other scope.
 *
 * @param options - the registry and the grants.
 * @returns the violations.
 *
 * @stability experimental
 */
export function checkScopeGrants(options: Pick<IdentityConformanceOptions, 'permissions' | 'roles' | 'grants'>): ConformanceFinding[] {
  const permissions = new Map(options.permissions.map((entry) => [entry.id, entry.scope]));
  const roles = new Map(options.roles.map((entry) => [entry.id, entry.scope]));
  const out: ConformanceFinding[] = [];
  for (const grant of options.grants) {
    const roleScope = roles.get(grant.role);
    const permissionScope = permissions.get(grant.permission);
    if (roleScope === undefined || permissionScope === undefined) {
      out.push({ file: 'grants', message: `grants "${grant.permission}" to "${grant.role}", and one of them is not registered.` });
    } else if (roleScope !== permissionScope) {
      out.push({
        file: 'grants',
        message: `grants the ${permissionScope} permission "${grant.permission}" to the ${roleScope} role "${grant.role}": a role is granted only permissions of its own scope.`,
      });
    }
  }
  return out;
}

const STUB_USER = { id: 'conformance-user', email: 'conformance@example.test' } as unknown as AuthenticatedUser;

/** A request a guard sees, with the parts identity reads. */
interface ProbeRequest {
  headers: { authorization: string };
  url: string;
  originalUrl: string;
  user?: unknown;
  authCredential?: { kind: string };
}

function probeContext(request: ProbeRequest): ExecutionContext {
  const handler = function conformanceProbe(): void {};
  class ConformanceProbeController {}
  return {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}), getNext: () => undefined }),
    getHandler: () => handler,
    getClass: () => ConformanceProbeController,
  } as unknown as ExecutionContext;
}

/** What one probe of the guard did. */
type ProbeOutcome = { admitted: true; kind: string | undefined } | { admitted: false; forbidden: boolean };

async function probe(guard: CanActivate, authorization: string, url: string): Promise<ProbeOutcome> {
  const request: ProbeRequest = { headers: { authorization }, url, originalUrl: url };
  try {
    const admitted = await guard.canActivate(probeContext(request));
    return admitted ? { admitted: true, kind: request.authCredential?.kind } : { admitted: false, forbidden: false };
  } catch (error) {
    return { admitted: false, forbidden: error instanceof ForbiddenException };
  }
}

/**
 * Check 4: the guard confines `nod_` tokens to node routes and resolves `pat_`
 * tokens as personal access tokens everywhere.
 *
 * @param guardClass - the guard to exercise; `JwtAuthGuard` by default.
 * @returns the violations.
 *
 * @stability experimental
 */
export async function checkTokenConfinement(guardClass: IdentityConformanceOptions['guard'] = JwtAuthGuard): Promise<ConformanceFinding[]> {
  const pats = { resolveToken: async (token: string) => (token === 'pat_conformance' ? { user: STUB_USER, tokenId: 'pat-1' } : null) };
  const nodes: IdentityNodeCredentials = { validateToken: async (token) => (token === 'nod_conformance' ? STUB_USER : null) };
  const guard = new guardClass(new Reflector(), pats as unknown as PatService, nodes);
  const out: ConformanceFinding[] = [];
  const file = 'token-confinement';

  for (const url of ['/api/users', '/api/users?next=/api/nodes', '/api/nodesx', '/api/auth/me', '/api/pat']) {
    const outcome = await probe(guard, 'Bearer nod_conformance', url);
    if (outcome.admitted || !outcome.forbidden) {
      out.push({ file, message: `admits (or does not 403) a nod_ worker credential on ${url}; it is confined to ${NODE_ROUTE_PREFIX}.` });
    }
  }
  for (const url of [NODE_ROUTE_PREFIX, `${NODE_ROUTE_PREFIX}/register`, `${NODE_ROUTE_PREFIX}?page=2`]) {
    const outcome = await probe(guard, 'Bearer nod_conformance', url);
    if (!outcome.admitted || outcome.kind !== 'node') {
      out.push({ file, message: `does not admit a valid nod_ worker credential, as a node credential, on ${url}.` });
    }
  }
  for (const url of ['/api/users', `${NODE_ROUTE_PREFIX}/register`]) {
    const outcome = await probe(guard, 'Bearer pat_conformance', url);
    if (!outcome.admitted || outcome.kind !== 'pat') {
      out.push({ file, message: `does not resolve a pat_ token as a personal access token on ${url} (a PAT is never a node credential).` });
    }
  }
  const unknownNode = await probe(guard, 'Bearer nod_unknown', `${NODE_ROUTE_PREFIX}/register`);
  if (unknownNode.admitted) out.push({ file, message: 'admits an unknown nod_ token on a node route.' });
  const unknownPat = await probe(guard, 'Bearer pat_unknown', '/api/users');
  if (unknownPat.admitted) out.push({ file, message: 'admits an unknown pat_ token.' });
  return out;
}

/**
 * Check 5: every listed `org` table has RLS enabled and forced, with one of its policies.
 *
 * @param rls - the tables, their policies and the catalogue reader.
 * @returns the violations.
 *
 * @stability experimental
 */
export async function checkRls(rls: IdentityConformanceRlsOptions): Promise<ConformanceFinding[]> {
  const tables = Object.keys(rls.policies);
  const live = new Map((await rls.inspect(tables)).map((entry) => [entry.table, entry]));
  const out: ConformanceFinding[] = [];
  for (const table of tables) {
    const entry = live.get(table);
    if (!entry) {
      out.push({ file: table, message: 'is an org table the database does not report.' });
      continue;
    }
    if (!entry.enabled || !entry.forced) out.push({ file: table, message: 'does not have row-level security enabled AND forced.' });
    const expected = rls.policies[table] ?? [];
    if (!expected.some((policy) => entry.policies.includes(policy))) {
      out.push({ file: table, message: `carries none of its listed policies (${expected.join(', ')}).` });
    }
  }
  return out;
}

const FILE_ROUTES = 'routes';

/**
 * The `identity` conformance suite. Registered when
 * `@marinoscar/platform-api/identity/testing` is imported.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const identityConformanceSuite: ConformanceSuite<IdentityConformanceOptions> = {
  id: 'identity',
  title: 'the identity slice keeps its invariants',
  description:
    'Every route declares @Auth or @Public, names only registered permissions and system roles, no role holds a permission of the other scope, worker credentials stay on node routes, and org tables force row-level security.',
  check(_context, options): ConformanceReport {
    const controllers = discoverControllers(options.rootModule);
    const routes = discoverIdentityRoutes(controllers);
    const findings: ConformanceFinding[] = [];
    if (routes.length < (options.minRoutes ?? 1)) {
      findings.push({ file: FILE_ROUTES, message: `the walk found ${routes.length} route(s), fewer than ${options.minRoutes ?? 1}: is rootModule the app's root module?` });
    }
    findings.push(...checkRouteAccess(routes));
    findings.push(...checkPermissionsRegistered(routes, options));
    findings.push(...checkScopeGrants(options));
    return {
      scanned: {
        controllers: controllers.length,
        routes: routes.length,
        publicRoutes: routes.filter((route) => route.isPublic).length,
        grants: options.grants.length,
      },
      scannedFiles: { routes: routes.map((route) => route.id) },
      findings,
    };
  },
  cases(options): ConformanceCase[] {
    const cases: ConformanceCase[] = [
      {
        name: 'route-access: every route declares @Auth(...) or @Public()',
        run: (report, expect) => {
          expect(report.findings.filter((finding) => finding.message.includes('@Auth(...) nor @Public()') || finding.file === FILE_ROUTES)).toEqual([]);
        },
      },
      {
        name: 'permissions-registered: every permission and role a route names is registered, roles are system roles',
        run: (report, expect) => {
          expect(report.findings.filter((finding) => finding.file === 'registry' || /requires permission|admits role/.test(finding.message))).toEqual([]);
        },
      },
      {
        name: 'scope-grants: no role is granted a permission of the other scope',
        run: (report, expect) => {
          expect(report.findings.filter((finding) => finding.file === 'grants')).toEqual([]);
        },
      },
      {
        name: `token-confinement: nod_ credentials stay on ${NODE_ROUTE_PREFIX}, pat_ tokens are personal access tokens everywhere`,
        run: async (_report, expect) => {
          expect(await checkTokenConfinement(options.guard)).toEqual([]);
        },
      },
    ];
    if (options.rls) {
      const rls = options.rls;
      cases.push({
        name: 'rls: every org table forces row-level security with a listed policy',
        run: async (_report, expect) => {
          expect(await checkRls(rls)).toEqual([]);
        },
      });
    }
    return cases;
  },
};

if (!conformanceSuites.has(identityConformanceSuite.id)) conformanceSuites.register(identityConformanceSuite);

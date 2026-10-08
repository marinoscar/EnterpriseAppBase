// =============================================================================
// The route-level checks of the AI kill switch and RBAC matrix suites (#742)
// =============================================================================
//
// Each is the loop the reference app's suites ran inline, lifted unchanged into
// a function of (server, discovered routes), so the package can prove it FAILS
// on a deliberately broken app (`test/ai/testing/ai-route-checks.spec.ts` boots
// a small Nest app with an ungated route, a kill-switched admin route and an
// unenforced permission). The suites call them over the real app.
// =============================================================================

import request from 'supertest';

import { RBAC_EXTENSION_KEY, type RbacExtension } from '../../../identity/index';
import { authHeader, concreteRoutePath, forEachDocumentOperation } from './ai-conformance-fixture';
import type { AiConformanceOpenApiDocument } from './ai-conformance-fixture';

/**
 * One discovered route.
 *
 * @stability experimental
 */
export interface AiRoute {
  /** The OpenAPI path, for example `/api/ai/responses/{id}`. */
  path: string;
  /** The upper-case HTTP method. */
  method: string;
}

/**
 * A discovered route with the permissions its `@Auth()` declares.
 *
 * @stability experimental
 */
export interface AiRbacRoute extends AiRoute {
  /** The permissions from the route's `x-rbac` metadata; empty for an open route. */
  permissions: string[];
}

type Verb = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** Calls `route` with an optional bearer token and an empty body. */
async function call(server: unknown, route: AiRoute, token?: string): Promise<{ status: number; body: any }> {
  const verb = route.method.toLowerCase() as Verb;
  const pending = request(server as never)[verb](concreteRoutePath(route.path));
  const res = await (token === undefined ? pending : pending.set(authHeader(token))).send({});

  return { status: res.status, body: res.body };
}

/**
 * The two route lists of {@link discoverAiRoutes}.
 *
 * @stability experimental
 */
export interface DiscoveredAiRoutes {
  /** The consumer `/api/ai/*` routes. */
  aiRoutes: AiRoute[];
  /** The `/api/admin/ai/*` routes. */
  adminAiRoutes: AiRoute[];
}

/**
 * The consumer (`/api/ai/*`) and admin (`/api/admin/ai/*`) routes of a document.
 *
 * @param document - the booted app's OpenAPI document.
 * @returns the two route lists, in document order.
 *
 * @stability experimental
 */
export function discoverAiRoutes(document: AiConformanceOpenApiDocument): DiscoveredAiRoutes {
  const aiRoutes: AiRoute[] = [];
  const adminAiRoutes: AiRoute[] = [];

  forEachDocumentOperation(document, (_operation, path, method) => {
    if (path.startsWith('/api/admin/ai')) {
      adminAiRoutes.push({ path, method: method.toUpperCase() });
    } else if (path.startsWith('/api/ai')) {
      aiRoutes.push({ path, method: method.toUpperCase() });
    }
  });

  return { aiRoutes, adminAiRoutes };
}

/**
 * Every AI route (consumer and admin) with its declared permissions.
 *
 * @param document - the booted app's OpenAPI document.
 * @returns the routes, in document order.
 *
 * @stability experimental
 */
export function discoverAiRbacRoutes(document: AiConformanceOpenApiDocument): AiRbacRoute[] {
  const routes: AiRbacRoute[] = [];

  forEachDocumentOperation(document, (operation, path, method) => {
    if (!path.startsWith('/api/ai') && !path.startsWith('/api/admin/ai')) return;

    const rbac = operation[RBAC_EXTENSION_KEY] as RbacExtension | undefined;
    routes.push({ path, method: method.toUpperCase(), permissions: rbac?.permissions ?? [] });
  });

  return routes;
}

/**
 * The consumer routes that do NOT answer `403 AI_DISABLED` (with the expected
 * `details.scope`) while AI is off. `GET /api/ai/config` is skipped: it stays
 * reachable, it is how a client learns AI is off.
 *
 * @param server - the app's HTTP server.
 * @param routes - the consumer routes.
 * @param expected - the `details.scope` the switch must name; `token` authenticates the call (none: unauthenticated, which the guard order makes irrelevant).
 * @returns one message per route that is not kill-switched; empty when all are.
 *
 * @stability experimental
 */
export async function findRoutesNotKillSwitched(
  server: unknown,
  routes: readonly AiRoute[],
  expected: { scope: 'system' | 'org'; token?: string; checkCode?: boolean },
): Promise<string[]> {
  const failures: string[] = [];

  for (const route of routes) {
    if (route.path === '/api/ai/config' && route.method === 'GET') continue;

    const res = await call(server, route, expected.token);

    if (
      res.status !== 403 ||
      (expected.checkCode === true && res.body?.code !== 'FORBIDDEN') ||
      res.body?.details?.reason !== 'AI_DISABLED' ||
      // #739: the switch names its scope.
      res.body?.details?.scope !== expected.scope
    ) {
      failures.push(
        expected.checkCode === true
          ? `${route.method} ${route.path}: status=${res.status} code=${res.body?.code} reason=${res.body?.details?.reason} scope=${res.body?.details?.scope}`
          : `${route.method} ${route.path}: status=${res.status} reason=${res.body?.details?.reason} scope=${res.body?.details?.scope}`,
      );
    }
  }

  return failures;
}

/**
 * The admin routes the kill switch blocks. Unauthenticated (no `token`), a
 * route must answer 401: that is the evidence no `AiEnabledGuard` sits in front
 * of it, because that guard would have answered 403 first. With a `token`, the
 * only thing checked is that nothing answers `403 AI_DISABLED`.
 *
 * @param server - the app's HTTP server.
 * @param routes - the admin routes.
 * @param options - the caller's `token`, or none for the unauthenticated check.
 * @returns one message per blocked route; empty when all stay reachable.
 *
 * @stability experimental
 */
export async function findAdminRoutesBlocked(
  server: unknown,
  routes: readonly AiRoute[],
  options: { token?: string } = {},
): Promise<string[]> {
  const failures: string[] = [];

  for (const route of routes) {
    const res = await call(server, route, options.token);
    const blocked = res.status === 403 && res.body?.details?.reason === 'AI_DISABLED';

    if (options.token === undefined) {
      if (blocked) failures.push(`${route.method} ${route.path}: blocked by the kill switch (${res.status})`);
      else if (res.status !== 401) failures.push(`${route.method} ${route.path}: expected 401 (not kill-switched), got ${res.status}`);
    } else if (blocked) {
      failures.push(`${route.method} ${route.path}: blocked by the org kill switch`);
    }
  }

  return failures;
}

/**
 * The routes whose declared permissions differ from the fixed expectation:
 * every `/api/admin/ai/*` route names `ai_config:read` or `ai_config:write`
 * (under `/api/admin/ai/org-*`, `org_ai_config:*`) and nothing else; every
 * `/api/ai/*` route names `ai:use` and nothing else, except `GET /api/ai/config`,
 * which names none.
 *
 * @param routes - the discovered routes with their declared permissions.
 * @returns one message per route; empty when every declaration is as expected.
 *
 * @stability experimental
 */
export function findAiPermissionDeclarationFailures(routes: readonly AiRbacRoute[]): string[] {
  const failures: string[] = [];

  for (const route of routes) {
    if (route.path === '/api/ai/config' && route.method === 'GET') {
      if (route.permissions.length !== 0) {
        failures.push(`${route.method} ${route.path}: expected no permission, got ${JSON.stringify(route.permissions)}`);
      }
      continue;
    }

    if (route.path.startsWith('/api/admin/ai')) {
      const ok =
        route.permissions.length === 1 &&
        (route.permissions[0] === 'ai_config:read' ||
          route.permissions[0] === 'ai_config:write' ||
          // #739: an organization's own AI keys and usage, org scope
          // (`/api/admin/ai/org-keys`, `/api/admin/ai/org-usage`).
          (route.path.startsWith('/api/admin/ai/org-') &&
            (route.permissions[0] === 'org_ai_config:read' || route.permissions[0] === 'org_ai_config:write')));
      if (!ok) {
        failures.push(
          `${route.method} ${route.path}: expected exactly one ai_config:* (or, under /api/admin/ai/org-*, org_ai_config:*) permission, got ${JSON.stringify(route.permissions)}`,
        );
      }
      continue;
    }

    const ok = route.permissions.length === 1 && route.permissions[0] === 'ai:use';
    if (!ok) failures.push(`${route.method} ${route.path}: expected exactly ['ai:use'], got ${JSON.stringify(route.permissions)}`);
  }

  return failures;
}

/**
 * The routes that do not answer 401 to an unauthenticated caller.
 *
 * @param server - the app's HTTP server.
 * @param routes - the routes to call.
 * @returns one message per route; empty when all answer 401.
 *
 * @stability experimental
 */
export async function findRoutesNotAnswering401(server: unknown, routes: readonly AiRoute[]): Promise<string[]> {
  const failures: string[] = [];

  for (const route of routes) {
    const res = await call(server, route);

    if (res.status !== 401) failures.push(`${route.method} ${route.path}: expected 401, got ${res.status}`);
  }

  return failures;
}

/**
 * True when the response is a bare, reason-less permission denial (a business refusal carries `details`).
 *
 * @param res - a response's status and body.
 * @returns whether it is an RBAC denial.
 *
 * @stability experimental
 */
export function isPermissionDenied(res: { status: number; body?: any }): boolean {
  return res.status === 403 && res.body?.details === undefined;
}

/**
 * The routes a role is granted or denied differently from its seeded
 * permissions. A route the role holds must not be a bare 403; one it lacks must
 * be. A refusal that carries `details` is a business reason, not RBAC.
 *
 * @param server - the app's HTTP server.
 * @param routes - the discovered routes with their declared permissions.
 * @param role - the role's name, for messages.
 * @param token - an access token for a user of that role.
 * @param granted - the permissions the role is seeded with.
 * @returns one message per mismatched route; empty when the role is granted exactly its set.
 *
 * @stability experimental
 */
export async function findRoleMismatches(
  server: unknown,
  routes: readonly AiRbacRoute[],
  role: string,
  token: string,
  granted: ReadonlySet<string>,
): Promise<string[]> {
  const failures: string[] = [];

  for (const route of routes) {
    const shouldHold = route.permissions.every((p) => granted.has(p));
    const res = await call(server, route, token);
    const denied = isPermissionDenied(res);

    if (shouldHold && denied) {
      failures.push(`${route.method} ${route.path}: ${role} holds ${JSON.stringify(route.permissions)} but was denied`);
    } else if (!shouldHold && !denied) {
      failures.push(
        `${route.method} ${route.path}: ${role} lacks ${JSON.stringify(route.permissions)} but was not denied (status ${res.status})`,
      );
    }
  }

  return failures;
}

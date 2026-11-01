// =============================================================================
// The decorator-time host port (issue #696, PP-2.7)
// =============================================================================
//
// A packaged controller must authenticate and authorize its caller exactly as
// the app's own controllers do, without importing the app's auth code. Nest
// applies decorators when a class is DEFINED, long before any container
// exists, so access cannot be an injection token: it is a static port, built
// once by the app (`apps/api/src/platform/platform-host.ts`) and handed to each
// slice's `forRoot({ host })`. The slice then creates its controller class
// inside `forRoot` with the host's decorators (the controller-factory recipe,
// README.md next to this folder).
//
// FAIL CLOSED. `definePlatformHost` refuses a host whose access functions are
// missing or do not return decorators, and a gate with no permission at all,
// so a packaged route can never be public by accident.
// =============================================================================

/**
 * How a packaged controller authenticates and authorizes its caller, supplied
 * by the app. Each function returns ONE decorator (usually the app's own
 * `applyDecorators(...)` composite) that a packaged controller applies to a
 * handler or a class.
 *
 * @stability experimental
 */
export interface PlatformAccessPort {
  /**
   * Decorators that authenticate the caller AND require every listed
   * permission. Must never be a no-op.
   *
   * @param permissions - the permission strings, all required; never empty.
   */
  requirePermissions(permissions: readonly string[]): MethodDecorator & ClassDecorator;
  /** Decorators that authenticate the caller with no specific permission. */
  requireAuthenticated(): MethodDecorator & ClassDecorator;
  /**
   * Optional: the app's marker for a DELIBERATELY public route (the reference
   * app binds its `@Public()`), so its route inventory and conformance checks
   * see the route as public on purpose rather than unguarded by accident. A
   * slice applies it only to a route its README documents as public (the
   * sharing slice's link resolution, #730) and authenticates that route by
   * other means. A slice that needs it and finds it absent leaves the route out.
   */
  allowPublic?(): MethodDecorator & ClassDecorator;
}

/**
 * Everything a packaged slice needs from the app at decorator time. Built once
 * with {@link definePlatformHost} and passed to every slice's `forRoot({ host })`.
 *
 * @stability experimental
 */
export interface PlatformHost {
  /** The app's authentication and authorization decorators. */
  readonly access: PlatformAccessPort;
}

/** Hosts already validated and frozen, so passing one twice is free. */
const definedHosts = new WeakSet<object>();

/** A permission string the define-time probe passes; never enforced anywhere. */
const PROBE_PERMISSION = 'platform:probe';

function fail(why: string): never {
  throw new Error(
    `definePlatformHost: ${why}. A platform host must supply working access decorators; ` +
      'without them a packaged route would have no access check, and a platform route is never public.',
  );
}

function assertDecorator(value: unknown, name: string): void {
  if (typeof value !== 'function') fail(`access.${name}() returned ${value === null ? 'null' : typeof value}, not a decorator`);
}

function assertPermissions(permissions: unknown): readonly string[] {
  if (!Array.isArray(permissions) || permissions.length === 0) {
    fail('access.requirePermissions() was called with no permission; use requireAuthenticated() for "any signed-in caller"');
  }
  for (const permission of permissions) {
    if (typeof permission !== 'string' || permission.trim() === '') {
      fail(`access.requirePermissions() was called with an invalid permission ${JSON.stringify(permission)}`);
    }
  }
  return permissions as readonly string[];
}

/**
 * Validates and freezes the app's platform host.
 *
 * Checks that `access.requirePermissions` and `access.requireAuthenticated`
 * (and the optional `access.allowPublic`) are functions and that each returns
 * a decorator (each is called once, with a probe permission, to find out). The returned host wraps them so a later
 * call that returns something else, or `requirePermissions([])`, throws too.
 * Passing an already-defined host returns it unchanged.
 *
 * @param host - the app's access decorators.
 * @returns the frozen, validated host.
 * @throws Error when either access function is missing or returns a non-function.
 *
 * @example
 * ```ts
 * // apps/api/src/platform/platform-host.ts
 * export const platformHost = definePlatformHost({
 *   access: {
 *     requirePermissions: (permissions) => Auth({ permissions: [...permissions] as PermissionName[] }),
 *     requireAuthenticated: () => Auth(),
 *   },
 * });
 * ```
 *
 * @extensionPoint option
 * @stability experimental
 */
export function definePlatformHost(host: PlatformHost): PlatformHost {
  if (host !== null && typeof host === 'object' && definedHosts.has(host)) return host;
  if (host === null || typeof host !== 'object') fail('no host was given');

  const access = (host as { access?: unknown }).access as Partial<PlatformAccessPort> | undefined;
  if (access === null || typeof access !== 'object') fail('`access` is missing');
  if (typeof access.requirePermissions !== 'function') fail('`access.requirePermissions` is missing or not a function');
  if (typeof access.requireAuthenticated !== 'function') fail('`access.requireAuthenticated` is missing or not a function');

  const requirePermissions = access.requirePermissions.bind(access);
  const requireAuthenticated = access.requireAuthenticated.bind(access);

  assertDecorator(requirePermissions([PROBE_PERMISSION]), 'requirePermissions');
  assertDecorator(requireAuthenticated(), 'requireAuthenticated');
  if (access.allowPublic !== undefined && typeof access.allowPublic !== 'function') fail('`access.allowPublic` is not a function');
  const allowPublic = access.allowPublic?.bind(access);
  if (allowPublic) assertDecorator(allowPublic(), 'allowPublic');

  const defined: PlatformHost = Object.freeze({
    access: Object.freeze({
      requirePermissions(permissions: readonly string[]) {
        const decorator = requirePermissions([...assertPermissions(permissions)]);
        assertDecorator(decorator, 'requirePermissions');
        return decorator;
      },
      requireAuthenticated() {
        const decorator = requireAuthenticated();
        assertDecorator(decorator, 'requireAuthenticated');
        return decorator;
      },
      ...(allowPublic
        ? {
            allowPublic() {
              const decorator = allowPublic();
              assertDecorator(decorator, 'allowPublic');
              return decorator;
            },
          }
        : {}),
    }),
  });
  definedHosts.add(defined);
  return defined;
}

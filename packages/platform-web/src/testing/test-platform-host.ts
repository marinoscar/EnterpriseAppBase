// A platform host for PACKAGE tests (issue #696). It answers API calls from a
// table of canned responses and records every request, so a packaged page can
// be tested without the app, its transport or a mock server.

import type { PlatformApiClient, PlatformApiError, PlatformWebHost } from '../core/index.js';

/**
 * One request a test host received.
 *
 * @stability experimental
 */
export interface TestApiRequest {
  /** The HTTP method. */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** The path as the page passed it, query string included. */
  path: string;
  /** The body, for POST, PUT and PATCH. */
  body?: unknown;
  /** The `ifMatch` option of a PATCH. */
  ifMatch?: string;
}

/**
 * A canned answer: a value (resolved as the response data) or a function of
 * the request (which may return a promise, or throw / reject to fail the call,
 * for example with {@link createTestApiError}).
 *
 * @stability experimental
 */
export type TestApiResponse = unknown | ((request: TestApiRequest) => unknown);

/**
 * What {@link createTestPlatformHost} takes.
 *
 * @stability experimental
 */
export interface TestPlatformHostOptions {
  /** The permissions the viewer holds. Default none. */
  permissions?: readonly string[];
  /** The viewer's user id. Default `'test-user'`. */
  userId?: string | null;
  /** Feature switches. Default all off. */
  features?: Readonly<Record<string, boolean>>;
  /**
   * Canned responses, looked up by `"<METHOD> <path with query>"`, then
   * `"<METHOD> <path without query>"`, then `"<path without query>"`. An
   * unmatched request rejects with a 404 {@link PlatformApiError}.
   */
  responses?: Readonly<Record<string, TestApiResponse>>;
  /** The host's relative-time formatter. Default none (the page's fallback). */
  formatRelativeTime?: (iso: string) => string;
}

/**
 * A {@link PlatformWebHost} for tests, plus the requests it received.
 *
 * @stability experimental
 */
export interface TestPlatformHost extends PlatformWebHost {
  /** Every request, oldest first. */
  readonly requests: TestApiRequest[];
}

/**
 * A rejection value shaped like the app adapter's errors.
 *
 * @param status - the HTTP status.
 * @param message - the API's message.
 * @param code - the API's error code.
 * @returns an `Error` that is also a {@link PlatformApiError}.
 *
 * @stability experimental
 */
export function createTestApiError(status: number, message: string, code?: string): Error & PlatformApiError {
  return Object.assign(new Error(message), { name: 'PlatformApiError', status, ...(code === undefined ? {} : { code }) });
}

/**
 * Builds a host for package tests: canned API responses, a viewer with the
 * given permissions and features, and a log of every request.
 *
 * @param options - see {@link TestPlatformHostOptions}.
 * @returns the host; pass it to `PlatformHostProvider`.
 *
 * @example
 * ```tsx
 * const host = createTestPlatformHost({
 *   permissions: ['system_settings:read'],
 *   responses: { 'GET /admin/doctor': report },
 * });
 * render(<PlatformHostProvider host={host}><DoctorPage /></PlatformHostProvider>);
 * ```
 *
 * @stability experimental
 */
export function createTestPlatformHost(options: TestPlatformHostOptions = {}): TestPlatformHost {
  const requests: TestApiRequest[] = [];
  const responses = options.responses ?? {};
  const permissions = new Set(options.permissions ?? []);
  const features = options.features ?? {};

  const call = async <T>(request: TestApiRequest): Promise<T> => {
    requests.push(request);
    const bare = request.path.split('?')[0] ?? request.path;
    const keys = [`${request.method} ${request.path}`, `${request.method} ${bare}`, bare];
    const key = keys.find((k) => Object.prototype.hasOwnProperty.call(responses, k));
    if (key === undefined) {
      throw createTestApiError(404, `No test response for ${request.method} ${request.path}`);
    }
    const response = responses[key];
    return (await (typeof response === 'function' ? (response as (r: TestApiRequest) => unknown)(request) : response)) as T;
  };

  const api: PlatformApiClient = {
    get: (path) => call({ method: 'GET', path }),
    post: (path, body) => call({ method: 'POST', path, body }),
    put: (path, body) => call({ method: 'PUT', path, body }),
    patch: (path, body, patchOptions) =>
      call({ method: 'PATCH', path, body, ...(patchOptions?.ifMatch === undefined ? {} : { ifMatch: patchOptions.ifMatch }) }),
    delete: (path) => call({ method: 'DELETE', path }),
  };

  return {
    api,
    viewer: {
      userId: options.userId === undefined ? 'test-user' : options.userId,
      hasPermission: (permission) => permissions.has(permission),
      isFeatureEnabled: (feature) => features[feature] === true,
    },
    ...(options.formatRelativeTime ? { formatRelativeTime: options.formatRelativeTime } : {}),
    requests,
  };
}

// A platform host for PACKAGE tests (issue #696). It answers API calls from a
// table of canned responses and records every request, so a packaged page can
// be tested without the app, its transport or a mock server.

import type {
  PlatformApiClient,
  PlatformApiError,
  PlatformBlobResponse,
  PlatformRequestOptions,
  PlatformWebHost,
} from '../core/index.js';

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
  /** The `ifMatch` option of a PUT, PATCH or DELETE. */
  ifMatch?: string;
  /** The `headers` option, when the page passed one. */
  headers?: Readonly<Record<string, string>>;
}

/**
 * One frame a canned {@link PlatformApiClient.postSse} answer delivers, in order.
 *
 * @stability experimental
 */
export interface TestSseFrame {
  /** The frame's `event:` name. */
  event: string;
  /** The frame's parsed `data:`. */
  data: unknown;
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
   * unmatched request rejects with a 404 {@link PlatformApiError}. A stream
   * (`postSse`) answers from the same table with an array of
   * {@link TestSseFrame}s, delivered in order.
   */
  responses?: Readonly<Record<string, TestApiResponse>>;
  /** The host's relative-time formatter. Default none (the page's fallback). */
  formatRelativeTime?: (iso: string) => string;
  /** The host's theme setter (the Appearance page). Default none. */
  applyTheme?: (theme: 'light' | 'dark' | 'system') => void;
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
 * @param details - the error envelope's `details` (e.g. `{ reason: 'LAST_GROUP_ADMIN' }`).
 * @returns an `Error` that is also a {@link PlatformApiError}.
 *
 * @stability experimental
 */
export function createTestApiError(
  status: number,
  message: string,
  code?: string,
  details?: unknown,
): Error & PlatformApiError {
  return Object.assign(new Error(message), {
    name: 'PlatformApiError',
    status,
    ...(code === undefined ? {} : { code }),
    ...(details === undefined ? {} : { details }),
  });
}

/**
 * A canned download for {@link PlatformApiClient.getBlob}: a body and response headers.
 *
 * @param body - the file's text.
 * @param headers - response headers, e.g. `{ 'Content-Disposition': 'attachment; filename="x.json"' }`.
 * @returns the blob response.
 *
 * @stability experimental
 */
export function createTestBlobResponse(body: string, headers: Readonly<Record<string, string>> = {}): PlatformBlobResponse {
  const lower = new Map(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
  return {
    blob: new Blob([body], { type: lower.get('content-type') ?? 'application/octet-stream' }),
    headers: { get: (name) => lower.get(name.toLowerCase()) ?? null },
  };
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

  const withIfMatch = (options: PlatformRequestOptions | undefined) => ({
    ...(options?.ifMatch === undefined ? {} : { ifMatch: options.ifMatch }),
    ...withHeaders(options),
  });
  const withHeaders = (options: PlatformRequestOptions | undefined) =>
    options?.headers === undefined ? {} : { headers: options.headers };

  const api: PlatformApiClient = {
    get: (path, getOptions) => call({ method: 'GET', path, ...withHeaders(getOptions) }),
    post: (path, body, postOptions) => call({ method: 'POST', path, body, ...withHeaders(postOptions) }),
    put: (path, body, putOptions) => call({ method: 'PUT', path, body, ...withIfMatch(putOptions) }),
    patch: (path, body, patchOptions) => call({ method: 'PATCH', path, body, ...withIfMatch(patchOptions) }),
    delete: (path, deleteOptions) => call({ method: 'DELETE', path, ...withIfMatch(deleteOptions) }),
    // Downloads answer from the same table (`'GET <path>'`, `'POST <path>'`);
    // the canned value is a `PlatformBlobResponse`, e.g. from `createTestBlobResponse`.
    getBlob: (path) => call({ method: 'GET', path }),
    postBlob: (path, body) => call({ method: 'POST', path, body }),
    // A multipart upload answers from `'POST <path>'`; the request's `body` is the FormData.
    postFormData: (path, body) => call({ method: 'POST', path, body }),
    // A stream answers with an array of frames; anything else delivers none.
    postSse: async (path, body, sseOptions) => {
      const frames = await call<unknown>({ method: 'POST', path, body });
      if (!Array.isArray(frames)) return;
      for (const frame of frames as TestSseFrame[]) {
        if (sseOptions.signal?.aborted) return;
        sseOptions.onFrame(frame.event, frame.data);
      }
    },
  };

  return {
    api,
    viewer: {
      userId: options.userId === undefined ? 'test-user' : options.userId,
      hasPermission: (permission) => permissions.has(permission),
      isFeatureEnabled: (feature) => features[feature] === true,
    },
    ...(options.formatRelativeTime ? { formatRelativeTime: options.formatRelativeTime } : {}),
    ...(options.applyTheme ? { applyTheme: options.applyTheme } : {}),
    requests,
  };
}

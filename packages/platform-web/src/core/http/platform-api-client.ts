// =============================================================================
// PlatformHttpClient -> PlatformApiClient (issue #868)
// =============================================================================
//
// The browser HTTP client (`PlatformHttpClient`) is what the identity slice's
// `AuthProvider` drives; the transport port (`PlatformApiClient`) is what every
// packaged page calls. An app keeps ONE client and hands the pages this
// adapter over it, so the bearer token, the one refresh-and-retry and the
// app's error hook apply to every packaged call. Moved from the reference
// app's `apps/web/src/platform/platformHost.tsx`, behaviour unchanged.
// =============================================================================

import type {
  PlatformApiClient,
  PlatformApiError,
  PlatformBlobResponse,
  PlatformRequestOptions,
  PlatformSseOptions,
} from '../api-client.js';
import { ApiError } from './client.js';
import type { PlatformHttpBlobWithHeaders, PlatformHttpClient, PlatformHttpRequestOptions } from './client.js';

/**
 * What {@link createPlatformApiClient} takes besides the client.
 *
 * @stability experimental
 */
export interface PlatformApiClientOptions {
  /**
   * `PlatformApiClient.postSse`: one POSTed request, one streamed
   * `text/event-stream` answer, with the client's bearer token and refresh.
   * Omit it and the adapter has no `postSse` (a page that needs it reports
   * its absence). The reference app passes its `services/sse.ts` reader.
   * Errors it throws are mapped like every other call's.
   */
  postSse?(path: string, body: unknown, options: PlatformSseOptions): Promise<void>;
}

/**
 * The client's {@link ApiError} as a `PlatformApiError` (a plain `Error` named
 * `PlatformApiError` carrying `status`, `message` and, when present, `code`
 * and `details`); anything else (a network failure, an abort) unchanged.
 *
 * @param error - what a {@link PlatformHttpClient} call rejected with.
 * @returns the mapped error, or `error` itself.
 *
 * @stability experimental
 */
export function toPlatformApiError(error: unknown): unknown {
  if (error instanceof ApiError) {
    const mapped: Error & PlatformApiError = Object.assign(new Error(error.message), {
      name: 'PlatformApiError',
      status: error.status,
      ...(error.code === undefined ? {} : { code: error.code }),
      ...(error.details === undefined ? {} : { details: error.details }),
    });
    return mapped;
  }
  return error;
}

async function mapped<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw toPlatformApiError(error);
  }
}

/**
 * `PlatformRequestOptions` as {@link PlatformHttpClient} request options. Extra
 * `headers` (a link-share token's `x-link-token`, #731) go first, so
 * `If-Match` and the client's own `Authorization` and `Content-Type` win.
 *
 * @param options - the packaged page's request options.
 * @returns the client's request options, or `undefined` when none were given.
 *
 * @stability experimental
 */
export function toHttpRequestOptions(options: PlatformRequestOptions | undefined): PlatformHttpRequestOptions | undefined {
  if (options === undefined) return undefined;
  const headers: Record<string, string> = {
    ...(options.headers ?? {}),
    ...(options.ifMatch === undefined ? {} : { 'If-Match': options.ifMatch }),
  };
  return {
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.jsonBody === undefined ? {} : { body: JSON.stringify(options.jsonBody) }),
    ...(Object.keys(headers).length === 0 ? {} : { headers }),
  };
}

/**
 * Adapt the app's {@link PlatformHttpClient} to the `PlatformApiClient` every
 * packaged page calls: the same token, the same refresh-and-retry, the same
 * `onErrorResponse` hook; `ApiError` mapped by {@link toPlatformApiError};
 * `getBlob` and `postBlob` through the client's `blobWithHeaders` response
 * type. Build it ONCE, at module scope: packaged hooks key on its identity.
 *
 * @param http - the app's one HTTP client.
 * @param options - an optional `postSse` implementation.
 * @returns a frozen `PlatformApiClient`.
 *
 * @example
 * ```ts
 * export const api = new PlatformHttpClient({ baseUrl: '/api', refreshLockName: 'my-app-auth-refresh' });
 * export const platformApi = createPlatformApiClient(api);
 * ```
 *
 * @extensionPoint option
 * @stability experimental
 */
export function createPlatformApiClient(
  http: PlatformHttpClient,
  options: PlatformApiClientOptions = {},
): PlatformApiClient {
  const { postSse } = options;
  const blob = (call: () => Promise<PlatformHttpBlobWithHeaders>): Promise<PlatformBlobResponse> => mapped(call);
  return Object.freeze({
    // No options, no second argument: the call reaches the client exactly as
    // an app's own code makes it.
    get: <T>(path: string, requestOptions?: PlatformRequestOptions) =>
      mapped(() =>
        requestOptions === undefined ? http.get<T>(path) : http.get<T>(path, toHttpRequestOptions(requestOptions)),
      ),
    post: <T>(path: string, body?: unknown, requestOptions?: PlatformRequestOptions) =>
      mapped(() => http.post<T>(path, body, toHttpRequestOptions(requestOptions))),
    put: <T>(path: string, body?: unknown, requestOptions?: PlatformRequestOptions) =>
      mapped(() => http.put<T>(path, body, toHttpRequestOptions(requestOptions))),
    patch: <T>(path: string, body?: unknown, requestOptions?: PlatformRequestOptions) =>
      mapped(() => http.patch<T>(path, body, toHttpRequestOptions(requestOptions))),
    delete: <T>(path: string, requestOptions?: PlatformRequestOptions) =>
      mapped(() => http.delete<T>(path, toHttpRequestOptions(requestOptions))),
    // A file upload: a multipart body, the boundary set by the browser.
    postFormData: <T>(path: string, body: FormData, requestOptions?: PlatformRequestOptions) =>
      mapped(() => http.postFormData<T>(path, body, toHttpRequestOptions(requestOptions))),
    // Downloads: the raw body and the headers, through the same client.
    getBlob: (path: string, requestOptions?: PlatformRequestOptions) =>
      blob(() =>
        http.get<PlatformHttpBlobWithHeaders>(path, {
          ...toHttpRequestOptions(requestOptions),
          responseType: 'blobWithHeaders',
        }),
      ),
    postBlob: (path: string, body?: unknown, requestOptions?: PlatformRequestOptions) =>
      blob(() =>
        http.post<PlatformHttpBlobWithHeaders>(path, body, {
          ...toHttpRequestOptions(requestOptions),
          responseType: 'blobWithHeaders',
        }),
      ),
    postFormData: <T>(path: string, body: FormData, requestOptions?: PlatformRequestOptions) =>
      mapped(() => http.postFormData<T>(path, body, toHttpRequestOptions(requestOptions))),
    ...(postSse === undefined
      ? {}
      : {
          postSse: (path: string, body: unknown, sseOptions: PlatformSseOptions) =>
            mapped(() => postSse(path, body, sseOptions)),
        }),
  });
}

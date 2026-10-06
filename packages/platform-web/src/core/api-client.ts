// The transport port (issue #696, PP-2.7). A packaged page never imports the
// app's fetch wrapper: it calls the app's transport through this interface,
// and the app's adapter (`apps/web/src/platform/platformHost.tsx`) keeps the
// auth header, the token refresh and the maintenance handling where they are.

/**
 * The app's transport. Paths are relative to the API base (`'/admin/doctor'`);
 * auth header, token refresh, maintenance handling stay in the app. Each method
 * resolves to the response's `data` and rejects with a {@link PlatformApiError}
 * when the API answered with an error status.
 *
 * @stability experimental
 */
export interface PlatformApiClient {
  /** `GET path`. */
  get<T>(path: string): Promise<T>;
  /** `POST path` with an optional JSON body. */
  post<T>(path: string, body?: unknown): Promise<T>;
  /** `PUT path` with an optional JSON body. */
  put<T>(path: string, body?: unknown): Promise<T>;
  /** `PATCH path` with an optional JSON body; `ifMatch` becomes the `If-Match` header. */
  patch<T>(path: string, body?: unknown, options?: { ifMatch?: string }): Promise<T>;
  /** `DELETE path`. */
  delete<T>(path: string): Promise<T>;
  /**
   * `GET path` for a file download: the raw body and the response headers
   * (for `Content-Disposition`), never the `{ data }` envelope. Optional: a
   * transport without it cannot serve downloads (the support bundle's
   * `useSupportBundleDownload` reports so instead of failing silently).
   */
  getBlob?(path: string): Promise<PlatformBlobResponse>;
}

/**
 * What {@link PlatformApiClient.getBlob} resolves with.
 *
 * @stability experimental
 */
export interface PlatformBlobResponse {
  /** The response body. */
  blob: Blob;
  /** The response headers (only `get` is needed). */
  headers: { get(name: string): string | null };
}

/**
 * What a packaged page may know about a failed call; the adapter maps the
 * app's error class onto it.
 *
 * @stability experimental
 */
export interface PlatformApiError {
  /** The HTTP status (403, 409, 500, ...). */
  status: number;
  /** The API's message, safe to show. */
  message: string;
  /** The API's machine-readable error code, when it sent one. */
  code?: string;
}

/**
 * Whether `error` is a {@link PlatformApiError}: an object with a numeric
 * `status` and a string `message`. A network failure (no response at all) is
 * not one.
 *
 * @param error - whatever a {@link PlatformApiClient} call rejected with.
 * @returns `true` when the API answered with an error status.
 *
 * @stability experimental
 */
export function isPlatformApiError(error: unknown): error is PlatformApiError {
  if (error === null || typeof error !== 'object') return false;
  const candidate = error as { status?: unknown; message?: unknown; code?: unknown };
  return (
    typeof candidate.status === 'number' &&
    Number.isFinite(candidate.status) &&
    typeof candidate.message === 'string' &&
    (candidate.code === undefined || typeof candidate.code === 'string')
  );
}

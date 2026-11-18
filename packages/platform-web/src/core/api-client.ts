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
  get<T>(path: string, options?: PlatformRequestOptions): Promise<T>;
  /** `POST path` with an optional JSON body. */
  post<T>(path: string, body?: unknown, options?: PlatformRequestOptions): Promise<T>;
  /** `PUT path` with an optional JSON body; `ifMatch` becomes the `If-Match` header. */
  put<T>(path: string, body?: unknown, options?: PlatformRequestOptions): Promise<T>;
  /** `PATCH path` with an optional JSON body; `ifMatch` becomes the `If-Match` header. */
  patch<T>(path: string, body?: unknown, options?: PlatformRequestOptions): Promise<T>;
  /** `DELETE path`; `ifMatch` becomes the `If-Match` header. */
  delete<T>(path: string, options?: PlatformRequestOptions): Promise<T>;
  /**
   * `GET path` for a file download: the raw body and the response headers
   * (for `Content-Disposition`), never the `{ data }` envelope. Optional: a
   * transport without it cannot serve downloads (the support bundle's
   * `useSupportBundleDownload` reports so instead of failing silently).
   */
  getBlob?(path: string, options?: PlatformRequestOptions): Promise<PlatformBlobResponse>;
  /**
   * `POST path` with a JSON body, for a file download (the telemetry export):
   * the raw body and the response headers, never the `{ data }` envelope.
   * Optional, like {@link PlatformApiClient.getBlob}; a page that needs it
   * reports its absence instead of failing silently.
   */
  postBlob?(path: string, body?: unknown, options?: PlatformRequestOptions): Promise<PlatformBlobResponse>;
  /**
   * `POST path` with a JSON body and stream the `text/event-stream` answer,
   * frame by frame (the telemetry assistant). ONE request, never a reconnect;
   * the same authentication as every other call (a real `Authorization`
   * header, one refresh-and-retry on a 401). Resolves when the server ends the
   * stream and quietly on abort; rejects with a {@link PlatformApiError} when
   * the API refused the request before the first byte. Optional: a page that
   * needs it reports its absence.
   */
  postSse?(path: string, body: unknown, options: PlatformSseOptions): Promise<void>;
  /**
   * `POST path` with a `multipart/form-data` body (a file upload): resolves to
   * the response's `data`, rejects with a {@link PlatformApiError}. The
   * transport sets the multipart boundary itself. Optional, like
   * {@link PlatformApiClient.getBlob}; a page that needs it reports its
   * absence.
   */
  postFormData?<T>(path: string, body: FormData, options?: PlatformRequestOptions): Promise<T>;
}

/**
 * Per-request options every {@link PlatformApiClient} method takes. All
 * optional; a transport ignores what it cannot honour.
 *
 * @stability experimental
 */
export interface PlatformRequestOptions {
  /** Aborts the request (a superseded query, an unmount). */
  signal?: AbortSignal;
  /** Sent as the `If-Match` header (optimistic concurrency, `docs/API.md`). */
  ifMatch?: string;
  /**
   * Extra request headers, e.g. a link-share token in `x-link-token` (#731).
   * The transport keeps its own (`Authorization`, `Content-Type`, `If-Match`
   * from {@link PlatformRequestOptions.ifMatch}); a transport that cannot
   * send custom headers ignores them, so a page that needs one says so.
   */
  headers?: Readonly<Record<string, string>>;
  /**
   * A JSON body for a `DELETE` that needs one (a typed confirmation). Ignored
   * by the other methods, which take their body as an argument.
   */
  jsonBody?: unknown;
}

/**
 * What {@link PlatformApiClient.postSse} takes besides the path and body.
 *
 * @stability experimental
 */
export interface PlatformSseOptions {
  /**
   * One parsed frame: its `event:` name and its `data:` parsed as JSON (the
   * raw string when it is not JSON). Comment lines never arrive here.
   */
  onFrame(event: string, data: unknown): void;
  /** Aborting ends the stream; the promise then resolves quietly. */
  signal?: AbortSignal;
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
  headers: {
    /** One header's value (case-insensitive name), or `null`. */
    get(name: string): string | null;
  };
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
  /** The error envelope's `details`, when the API sent any (e.g. `{ reason }`). */
  details?: unknown;
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

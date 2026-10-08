// =============================================================================
// The platform's browser HTTP client (issue #727, PP-6.6)
// =============================================================================
//
// Moved from the reference app's `apps/web/src/services/api.ts`: the access
// token holder, the one-shot 401 -> refresh -> retry, the cross-page refresh
// lock and the "session expired" signal. What stays app-specific is passed in
// as options: where the API lives (`baseUrl`, the app reads it from its build
// environment), the Web Lock name (derived from the app's identity) and a hook
// on every error response (the reference app's maintenance recogniser).
//
// The identity slice's `AuthProvider` drives sessions through this client; the
// app keeps ONE instance and also adapts it to `PlatformApiClient` for the
// packaged pages.
// =============================================================================

/**
 * Per-request options of {@link PlatformHttpClient}: the browser's `RequestInit`
 * plus the client's own switches.
 *
 * @stability experimental
 */
export interface PlatformHttpRequestOptions extends RequestInit {
  /** Send no `Authorization` header and never refresh on a 401 (public routes). */
  skipAuth?: boolean;
  /**
   * How to read a successful body. `'json'` (the default) parses and unwraps
   * the `{ data }` envelope; `'blob'` returns the raw bytes (e.g. an image);
   * `'blobWithHeaders'` returns `{ blob, headers }` for a download whose
   * filename or metadata travel in response headers.
   */
  responseType?: 'json' | 'blob' | 'blobWithHeaders';
}

/**
 * What `responseType: 'blobWithHeaders'` resolves with.
 *
 * @stability experimental
 */
export interface PlatformHttpBlobWithHeaders {
  /** The response body. */
  blob: Blob;
  /** The response headers. */
  headers: Headers;
}

/**
 * Called when the server definitively refused to refresh a live session.
 *
 * @stability experimental
 */
export type SessionExpiredListener = () => void;

/**
 * The error body fields the client reads from a failed response.
 *
 * @stability experimental
 */
export interface PlatformHttpErrorBody {
  /** The API's message. */
  message?: string;
  /** The API's machine-readable error code. */
  code?: string;
  /** The error envelope's `details`. */
  details?: unknown;
}

/**
 * What {@link PlatformHttpClient} takes. Everything app-specific about the
 * transport is here, so the client itself carries no app identity.
 *
 * @example
 * ```ts
 * export const api = new PlatformHttpClient({
 *   baseUrl: import.meta.env.VITE_API_BASE_URL || '/api',
 *   refreshLockName: `${APP_SLUG}-auth-refresh`,
 *   onErrorResponse: (status, body) => noticeMaintenance(status, body),
 * });
 * ```
 *
 * @extensionPoint option
 * @stability experimental
 */
export interface PlatformHttpClientOptions {
  /** Where the API lives, prefixed to every path (`'/api'` same-origin). */
  baseUrl: string;
  /**
   * The Web Lock every page of the app on one origin takes around
   * `POST /auth/refresh`. Name it after the app so two apps on one origin
   * never contend for each other's lock.
   */
  refreshLockName: string;
  /**
   * Called with every error response before the {@link ApiError} is built and
   * thrown (the error is thrown either way). The reference app notices a
   * maintenance window here.
   */
  onErrorResponse?(status: number, body: PlatformHttpErrorBody): void;
}

/**
 * An error status from the API: the message, status, code and details of the
 * error envelope (`docs/API.md`). Satisfies `PlatformApiError`.
 *
 * @stability stable
 */
export class ApiError extends Error {
  /**
   * @param message - the API's message, or `'Request failed'`.
   * @param status - the HTTP status.
   * @param code - the API's machine-readable error code, when it sent one.
   * @param details - the error envelope's `details`, when it sent any.
   */
  constructor(
    message: string,
    /** The HTTP status (403, 409, 500, ...). */
    public status: number,
    /** The API's machine-readable error code, when it sent one. */
    public code?: string,
    /** The error envelope's `details`, when the API sent any. */
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface LockManagerLike {
  request<T>(name: string, options: { mode: 'exclusive' }, callback: () => Promise<T>): Promise<T>;
}

/**
 * The browser transport: holds the access token, sends it as
 * `Authorization: Bearer`, refreshes once on a 401 (the HttpOnly
 * `refresh_token` cookie, rotated on use) and retries, and serialises refreshes
 * across every page of the origin with a Web Lock. Each call resolves to the
 * response's `data` and rejects with an {@link ApiError} on an error status.
 *
 * @stability experimental
 */
export class PlatformHttpClient {
  private accessToken: string | null = null;
  private refreshPromise: Promise<boolean> | null = null;
  private sessionExpiredListeners = new Set<SessionExpiredListener>();

  /**
   * @param options - where the API lives, the refresh lock name and the error hook.
   */
  constructor(private readonly options: PlatformHttpClientOptions) {}

  /**
   * Replace the held access token (`null` signs this page out).
   *
   * @param token - the new access token, or `null`.
   */
  setAccessToken(token: string | null): void {
    this.accessToken = token;
  }

  /**
   * The held access token.
   *
   * @returns the token, or `null` when this page holds none.
   */
  getAccessToken(): string | null {
    return this.accessToken;
  }

  /**
   * Subscribe to "the session is gone": a refresh attempted while this page
   * HELD an access token was answered 401/403 by the server. Never fired for
   * a page that was not signed in (the boot-time probe on the login page or
   * any public page holds no token), nor for a network failure, so a listener
   * can safely send the user to sign in.
   *
   * @param listener - called once per refused refresh.
   * @returns the unsubscribe function.
   */
  onSessionExpired(listener: SessionExpiredListener): () => void {
    this.sessionExpiredListeners.add(listener);
    return () => {
      this.sessionExpiredListeners.delete(listener);
    };
  }

  private async request<T>(endpoint: string, options: PlatformHttpRequestOptions = {}): Promise<T> {
    const { skipAuth = false, responseType = 'json', ...fetchOptions } = options;
    const baseUrl = this.options.baseUrl;

    const headers: HeadersInit = {
      ...fetchOptions.headers,
    };

    // A FormData body must NOT carry a hand-set Content-Type: the browser has
    // to write `multipart/form-data; boundary=...` itself, and a literal
    // `application/json` (or a multipart type with no boundary) makes the
    // server unable to parse the parts.
    const isFormData = typeof FormData !== 'undefined' && fetchOptions.body instanceof FormData;

    // Only set Content-Type for requests with a body (Fastify 5 is strict about this)
    if (fetchOptions.body && !isFormData) {
      (headers as Record<string, string>)['Content-Type'] = 'application/json';
    }

    if (!skipAuth && this.accessToken) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const response = await fetch(`${baseUrl}${endpoint}`, {
      ...fetchOptions,
      headers,
      credentials: 'include', // Include cookies for refresh token
    });

    if (response.status === 401 && !skipAuth) {
      // Try to refresh token (only once, avoid infinite loops)
      const refreshed = await this.refreshToken();
      if (refreshed) {
        // Update authorization header with new token and retry ONCE
        const retryHeaders: HeadersInit = {
          ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
          ...fetchOptions.headers,
          Authorization: `Bearer ${this.accessToken}`,
        };

        const retryResponse = await fetch(`${baseUrl}${endpoint}`, {
          ...fetchOptions,
          headers: retryHeaders,
          credentials: 'include',
        });

        return this.readResponse<T>(retryResponse, responseType);
      }
      throw new ApiError('Unauthorized', 401);
    }

    return this.readResponse<T>(response, responseType);
  }

  /**
   * Turn a settled response into the caller's value, or throw. Shared by the
   * first attempt and the post-refresh retry so both read bodies identically.
   * Error bodies are always JSON, whatever `responseType` the caller asked for.
   */
  private async readResponse<T>(response: Response, responseType: 'json' | 'blob' | 'blobWithHeaders'): Promise<T> {
    if (!response.ok) {
      const error = (await response.json().catch(() => ({}))) as PlatformHttpErrorBody;
      throw this.toError(response.status, error);
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return undefined as T;
    }

    if (responseType === 'blob') {
      return (await response.blob()) as T;
    }

    if (responseType === 'blobWithHeaders') {
      return { blob: await response.blob(), headers: response.headers } as T;
    }

    const data = (await response.json()) as { data?: unknown };
    return (data.data ?? data) as T;
  }

  /**
   * Build the `ApiError` every call site catches, after handing the response
   * to the app's `onErrorResponse` hook (the reference app's maintenance
   * recogniser lives there: every request goes through this one error path,
   * so every caller inherits it). The error is still THROWN: the hook is a
   * side channel, never a replacement for the rejection a caller awaits.
   */
  private toError(status: number, body: PlatformHttpErrorBody): ApiError {
    this.options.onErrorResponse?.(status, body);
    return new ApiError(body.message || 'Request failed', status, body.code, body.details);
  }

  /**
   * Refresh the access token from the HttpOnly refresh cookie. Deduped within
   * this page, serialised across pages (see the class summary).
   *
   * @returns `true` when a new access token is held.
   */
  async refreshToken(): Promise<boolean> {
    // If a refresh is already in progress, wait for it
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    // Start a new refresh. `refreshPromise` dedupes within THIS page; the
    // Web Lock serialises across pages (see `refreshAcrossPages`).
    this.refreshPromise = this.refreshAcrossPages();

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  /**
   * Run the refresh under an exclusive Web Lock shared by every page of this
   * origin.
   *
   * WHY: the `refresh_token` cookie is HttpOnly, rotated on every use, and
   * shared by every page in the browser profile. Two pages refreshing at once
   * would present the SAME cookie twice; the server treats a second
   * presentation of a rotated token as theft and revokes every refresh token
   * the user holds (reuse detection), signing out all of them. Serialised, the
   * page that waited presents the NEWER cookie the first page's rotation left
   * in the shared jar, so there is no reuse.
   *
   * Without `navigator.locks` (older browsers, jsdom) this is the plain
   * in-page refresh.
   */
  private refreshAcrossPages(): Promise<boolean> {
    const locks =
      typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManagerLike }).locks : undefined;
    if (!locks || typeof locks.request !== 'function') {
      return this.doRefreshToken();
    }
    return locks.request(this.options.refreshLockName, { mode: 'exclusive' }, () => this.doRefreshToken());
  }

  private async doRefreshToken(): Promise<boolean> {
    // Whether this page believed it was signed in when the refresh started:
    // only then is a refusal "your session expired" rather than "not signed in".
    const hadSession = this.accessToken !== null;
    try {
      const response = await fetch(`${this.options.baseUrl}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok) {
        this.accessToken = null;
        if (hadSession && (response.status === 401 || response.status === 403)) {
          this.notifySessionExpired();
        }
        return false;
      }

      const responseData = (await response.json()) as { data?: { accessToken?: unknown }; accessToken?: unknown };
      // Unwrap the { data: { accessToken } } structure from the API's envelope
      const tokenData = responseData.data ?? responseData;

      // Validate that we actually got a token
      if (!tokenData.accessToken || typeof tokenData.accessToken !== 'string') {
        this.accessToken = null;
        return false;
      }

      this.accessToken = tokenData.accessToken;
      return true;
    } catch {
      this.accessToken = null;
      return false;
    }
  }

  private notifySessionExpired(): void {
    for (const listener of [...this.sessionExpiredListeners]) {
      try {
        listener();
      } catch (error) {
        console.error('Session-expired listener failed:', error);
      }
    }
  }

  /**
   * `GET endpoint`.
   *
   * @param endpoint - the path relative to `baseUrl`, query string included.
   * @param options - request options.
   * @returns the response's `data`.
   * @throws {@link ApiError} on an error status.
   */
  get<T>(endpoint: string, options?: PlatformHttpRequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  /**
   * GET a binary body (an image, a file) as a `Blob`. Same bearer token,
   * 401, refresh and retry and error handling as every JSON call.
   *
   * @param endpoint - the path relative to `baseUrl`.
   * @param options - request options.
   * @returns the body.
   * @throws {@link ApiError} on an error status.
   */
  getBlob(endpoint: string, options?: PlatformHttpRequestOptions): Promise<Blob> {
    return this.request<Blob>(endpoint, {
      ...options,
      method: 'GET',
      responseType: 'blob',
    });
  }

  /**
   * `POST endpoint` with an optional JSON body.
   *
   * @param endpoint - the path relative to `baseUrl`.
   * @param body - serialised as JSON when present.
   * @param options - request options.
   * @returns the response's `data`.
   * @throws {@link ApiError} on an error status.
   */
  post<T>(endpoint: string, body?: unknown, options?: PlatformHttpRequestOptions): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  /**
   * POST a `multipart/form-data` body. The same bearer token, one-shot
   * 401, refresh and retry and error hook apply; the FormData is sent as-is
   * (never JSON-stringified) and can be re-sent on that retry.
   *
   * @param endpoint - the path relative to `baseUrl`.
   * @param formData - the parts.
   * @param options - request options.
   * @returns the response's `data`.
   * @throws {@link ApiError} on an error status.
   */
  postFormData<T>(endpoint: string, formData: FormData, options?: PlatformHttpRequestOptions): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: formData,
    });
  }

  /**
   * `PUT endpoint` with an optional JSON body.
   *
   * @param endpoint - the path relative to `baseUrl`.
   * @param body - serialised as JSON when present.
   * @param options - request options (`headers: { 'If-Match': ... }` for optimistic concurrency).
   * @returns the response's `data`.
   * @throws {@link ApiError} on an error status.
   */
  put<T>(endpoint: string, body?: unknown, options?: PlatformHttpRequestOptions): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  /**
   * `PATCH endpoint` with an optional JSON body.
   *
   * @param endpoint - the path relative to `baseUrl`.
   * @param body - serialised as JSON when present.
   * @param options - request options.
   * @returns the response's `data`.
   * @throws {@link ApiError} on an error status.
   */
  patch<T>(endpoint: string, body?: unknown, options?: PlatformHttpRequestOptions): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  /**
   * `DELETE endpoint`.
   *
   * @param endpoint - the path relative to `baseUrl`.
   * @param options - request options (a JSON `body` is allowed).
   * @returns the response's `data` (`undefined` for a 204).
   * @throws {@link ApiError} on an error status.
   */
  delete<T>(endpoint: string, options?: PlatformHttpRequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }
}

import { APP_SLUG } from '@app/shared';
import { PlatformHttpClient, type PlatformApiClient, type PlatformRequestOptions } from '@marinoscar/platform-web/core';

/** The one HTTP client: same-origin `/api`, the refresh cookie, one refresh at a time across tabs. */
export const api = new PlatformHttpClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL || '/api',
  refreshLockName: `${APP_SLUG}-auth-refresh`,
});

function headersOf(options?: PlatformRequestOptions): RequestInit | undefined {
  if (!options) return undefined;
  const headers = { ...(options.headers ?? {}), ...(options.ifMatch === undefined ? {} : { 'If-Match': options.ifMatch }) };
  return { ...(options.signal ? { signal: options.signal } : {}), headers };
}

/** The transport packaged pages use (`PlatformWebHost.api`), over the same client. */
export const platformApi: PlatformApiClient = Object.freeze({
  get: <T,>(path: string, options?: PlatformRequestOptions) => api.get<T>(path, headersOf(options)),
  post: <T,>(path: string, body?: unknown, options?: PlatformRequestOptions) => api.post<T>(path, body, headersOf(options)),
  put: <T,>(path: string, body?: unknown, options?: PlatformRequestOptions) => api.put<T>(path, body, headersOf(options)),
  patch: <T,>(path: string, body?: unknown, options?: PlatformRequestOptions) => api.patch<T>(path, body, headersOf(options)),
  delete: <T,>(path: string, options?: PlatformRequestOptions) => api.delete<T>(path, headersOf(options)),
});

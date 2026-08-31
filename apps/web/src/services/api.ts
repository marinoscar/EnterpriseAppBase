const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

interface RequestOptions extends RequestInit {
  skipAuth?: boolean;
}

class ApiService {
  private accessToken: string | null = null;
  private refreshPromise: Promise<boolean> | null = null;

  setAccessToken(token: string | null) {
    this.accessToken = token;
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  private async request<T>(
    endpoint: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const { skipAuth = false, ...fetchOptions } = options;

    const headers: HeadersInit = {
      ...fetchOptions.headers,
    };

    // Only set Content-Type for requests with a body (Fastify 5 is strict about this)
    if (fetchOptions.body) {
      (headers as Record<string, string>)['Content-Type'] = 'application/json';
    }

    if (!skipAuth && this.accessToken) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
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
          'Content-Type': 'application/json',
          ...fetchOptions.headers,
          'Authorization': `Bearer ${this.accessToken}`,
        };

        const retryResponse = await fetch(`${API_BASE_URL}${endpoint}`, {
          ...fetchOptions,
          headers: retryHeaders,
          credentials: 'include',
        });

        if (!retryResponse.ok) {
          const error = await retryResponse.json().catch(() => ({}));
          throw new ApiError(
            error.message || 'Request failed',
            retryResponse.status,
            error.code,
            error.details,
          );
        }

        if (retryResponse.status === 204) {
          return undefined as T;
        }

        const data = await retryResponse.json();
        return data.data ?? data;
      }
      throw new ApiError('Unauthorized', 401);
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new ApiError(
        error.message || 'Request failed',
        response.status,
        error.code,
        error.details,
      );
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return undefined as T;
    }

    const data = await response.json();
    return data.data ?? data;
  }

  async refreshToken(): Promise<boolean> {
    // If a refresh is already in progress, wait for it
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    // Start a new refresh
    this.refreshPromise = this.doRefreshToken();

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async doRefreshToken(): Promise<boolean> {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok) {
        this.accessToken = null;
        return false;
      }

      const responseData = await response.json();
      // Unwrap the { data: { accessToken } } structure from TransformInterceptor
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

  // Generic methods
  get<T>(endpoint: string, options?: RequestOptions) {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  post<T>(endpoint: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  put<T>(endpoint: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  patch<T>(endpoint: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  delete<T>(endpoint: string, options?: RequestOptions) {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const api = new ApiService();

// Import types
import type {
  AllowlistResponse,
  AllowedEmailEntry,
  UsersResponse,
  UserListItem,
  DeviceActivationInfo,
  DeviceAuthorizationResponse,
  PersonalAccessToken,
  PatCreatedResponse,
  PatDurationUnit,
  EmailSettings,
  EmailSettingsInput,
  EmailTestResult,
  NotificationEventDef,
} from '../types';

// Allowlist API
/**
 * Sort keys `GET /api/allowlist` accepts, mirroring
 * `allowlistQuerySchema.sortBy` (`apps/api/src/allowlist/dto/allowlist-query.dto.ts`).
 */
export type AllowlistSortField = 'email' | 'addedAt' | 'claimedAt';

export async function getAllowlist(params?: {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: 'all' | 'pending' | 'claimed';
  sortBy?: AllowlistSortField;
  sortOrder?: 'asc' | 'desc';
}): Promise<AllowlistResponse> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
  if (params?.search) searchParams.set('search', params.search);
  if (params?.status) searchParams.set('status', params.status);
  if (params?.sortBy) searchParams.set('sortBy', params.sortBy);
  if (params?.sortOrder) searchParams.set('sortOrder', params.sortOrder);

  return api.get<AllowlistResponse>(`/allowlist?${searchParams}`);
}

export async function addToAllowlist(
  email: string,
  notes?: string,
): Promise<AllowedEmailEntry> {
  return api.post<AllowedEmailEntry>('/allowlist', { email, notes });
}

export async function removeFromAllowlist(id: string): Promise<void> {
  await api.delete<void>(`/allowlist/${id}`);
}

// Users API
/**
 * Sort keys `GET /api/users` accepts, mirroring `userListQuerySchema.sortBy`
 * (`apps/api/src/users/dto/user-list-query.dto.ts`). Typed rather than
 * `string` so a DataTable column declaring `sortable` against a field the
 * endpoint would reject is a compile error, not a 400 at runtime.
 */
export type UserSortField = 'email' | 'createdAt' | 'updatedAt';

export async function getUsers(params?: {
  page?: number;
  pageSize?: number;
  search?: string;
  role?: string;
  isActive?: boolean;
  sortBy?: UserSortField;
  sortOrder?: 'asc' | 'desc';
}): Promise<UsersResponse> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
  if (params?.search) searchParams.set('search', params.search);
  if (params?.role) searchParams.set('role', params.role);
  if (params?.isActive !== undefined)
    searchParams.set('isActive', String(params.isActive));
  if (params?.sortBy) searchParams.set('sortBy', params.sortBy);
  if (params?.sortOrder) searchParams.set('sortOrder', params.sortOrder);

  return api.get<UsersResponse>(`/users?${searchParams}`);
}

export async function updateUser(
  id: string,
  data: { displayName?: string; isActive?: boolean },
): Promise<UserListItem> {
  return api.patch<UserListItem>(`/users/${id}`, data);
}

export async function updateUserRoles(
  id: string,
  roles: string[],
): Promise<UserListItem> {
  return api.put<UserListItem>(`/users/${id}/roles`, { roles });
}

// Device Activation API
export async function getDeviceActivationInfo(
  userCode: string,
): Promise<DeviceActivationInfo> {
  return api.get<DeviceActivationInfo>(`/auth/device/activate?code=${userCode}`);
}

export async function authorizeDevice(
  userCode: string,
  approve: boolean,
): Promise<DeviceAuthorizationResponse> {
  return api.post<DeviceAuthorizationResponse>('/auth/device/authorize', {
    userCode,
    approve,
  });
}

// Personal Access Tokens API
export async function getPersonalAccessTokens(): Promise<PersonalAccessToken[]> {
  return api.get<PersonalAccessToken[]>('/pat');
}

export async function createPersonalAccessToken(data: {
  name: string;
  durationValue: number;
  durationUnit: PatDurationUnit;
}): Promise<PatCreatedResponse> {
  return api.post<PatCreatedResponse>('/pat', data);
}

export async function revokePersonalAccessToken(id: string): Promise<void> {
  await api.delete<void>(`/pat/${id}`);
}

// Email settings API — issue #124, epic #109.
//
// Three calls, one controller (`system_settings:read` to read,
// `system_settings:write` to save or test), and the ONLY place in the web app
// that names these endpoints. The page and its hook speak in `EmailSettings`
// terms; if the API's routes or field names move, this block plus the types in
// `types/index.ts` are the entire reconciliation surface.
//
// The payloads are FLAT — `sesRegion`, `smtpHost`, `smtpPort` and friends are
// siblings, not members of `ses: {…}` / `smtp: {…}` sub-objects. See the note
// in `types/index.ts`; getting this wrong compiles cleanly and fails only at
// runtime, which is why it is written down in both places.

export async function getEmailSettings(): Promise<EmailSettings> {
  return api.get<EmailSettings>('/email-settings');
}

/**
 * Replace the stored email settings.
 *
 * PUT rather than PATCH because this is one small document edited on one
 * screen: a per-field merge would let a half-saved provider switch (SMTP host
 * written, SES region not) exist as a state nothing in the UI can show. The
 * one field with merge semantics is `smtpPassword`, and those semantics live
 * in the API (blank preserves — see `EmailSettingsInput`), not in a patch
 * document.
 *
 * `expectedVersion` becomes `If-Match`, the same optimistic-concurrency
 * mechanism `useSystemSettings` uses against `/system-settings`, because the
 * API offers it here too and a settings row with a version counter and no
 * caller checking it is a lost-update waiting to happen: two admins on this
 * page, and the second save silently discards the first with nothing on either
 * screen to show it. A mismatch is a 409, which the hook turns into a reload
 * plus a message rather than an overwrite.
 *
 * PASSED THROUGH AS-IS, INCLUDING ZERO. `0` is the API's way of asserting "I
 * believe nothing is stored yet", so the check is `=== undefined` and never a
 * truthiness test — `if (expectedVersion)` would drop the guard on exactly the
 * first save, where two admins configuring a fresh deployment collide.
 */
export async function updateEmailSettings(
  input: EmailSettingsInput,
  expectedVersion?: number,
): Promise<EmailSettings> {
  return api.put<EmailSettings>('/email-settings', input, {
    headers:
      expectedVersion === undefined
        ? undefined
        : { 'If-Match': String(expectedVersion) },
  });
}

/**
 * Send a test message to the CALLER'S OWN address, using the SAVED settings.
 *
 * No recipient parameter, deliberately: a free-text "send to" box on an
 * authenticated admin form is a send-arbitrary-mail endpoint wearing a
 * diagnostic hat (#124's own rejected alternative). The caller's identity is
 * already on the request, so the API resolves the recipient itself.
 *
 * RESOLVES ON FAILURE. A provider that refuses the message still produces a
 * 200 carrying `{ success: false, error }`; only a transport or authorization
 * failure rejects. Callers MUST branch on `result.success`.
 */
export async function sendTestEmail(): Promise<EmailTestResult> {
  return api.post<EmailTestResult>('/email-settings/test');
}

/**
 * The notification event registry — `GET /api/notifications/events` (#124).
 *
 * AUTHENTICATED, NOT ADMIN-GATED. Every signed-in user reads this; it is what
 * `/settings/notifications` renders its matrix against, and that page belongs
 * to every role. A `system_settings:read` reflex here would leave a Viewer with
 * a preferences page and no rows in it.
 *
 * THE WEB APP DOES NOT KEEP A COPY OF THIS LIST, deliberately. `mandatory` is a
 * security flag, and a second declaration of a security flag is a second place
 * for it to be wrong; a duplicated registry would also break epic #109's
 * headline promise that adding a notification costs ONE registry entry. The
 * consequence is that the preferences page renders whatever the server serves,
 * including events added after this build shipped.
 *
 * The response is ORDERED and the order is meaningful — it is the order the
 * preferences UI should render. Do not sort it.
 */
export async function getNotificationEvents(): Promise<NotificationEventDef[]> {
  return api.get<NotificationEventDef[]>('/notifications/events');
}

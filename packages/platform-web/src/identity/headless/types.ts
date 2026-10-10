// The identity slice's browser-side shapes (issue #727, PP-6.6): the signed-in
// user as `GET /api/auth/me` reports it, and what the auth context offers.
// Moved from the reference app's `types/index.ts` and `contexts/AuthContext.tsx`.

import type { TenancyModeValue } from '@marinoscar/platform-contract/identity';

/**
 * A role of the signed-in user (`/api/auth/me` `roles[]`).
 *
 * @stability stable
 */
export interface AuthRole {
  /** The role name, e.g. `admin` or `viewer`. */
  name: string;
}

/**
 * An organization as `/api/auth/me` names it (`activeOrg`).
 *
 * @stability stable
 */
export interface OrgSummary {
  /** The organization's id. */
  id: string;
  /** Its name. */
  name: string;
  /** Its slug. */
  slug: string;
}

/**
 * One of the user's active memberships, as `/api/auth/me` lists them.
 *
 * @stability stable
 */
export interface OrgMembershipSummary {
  /** The organization's id. */
  orgId: string;
  /** Its name. */
  name: string;
  /** Its slug. */
  slug: string;
  /** The org role held there (`org_admin`, `contributor`, `viewer`, or an app role). */
  role: string;
}

/**
 * The signed-in user as the browser reads `GET /api/auth/me`
 * (`currentUserSchema` of `@marinoscar/platform-contract/identity`). The
 * picture and organization fields are optional so a payload from an older
 * server reads as single-org with no picture.
 *
 * @stability stable
 */
export interface AuthUser {
  /** The user's id. */
  id: string;
  /** The user's email address. */
  email: string;
  /** Display name, or `null`. */
  displayName: string | null;
  /**
   * The RESOLVED picture to render, per the user's `profile.imageSource`:
   * `null` for `none`, the provider URL for `provider`, and the same-origin
   * avatar URL for `upload`.
   */
  profileImageUrl: string | null;
  /** The sign-in provider's picture, whatever the chosen source (previews). */
  providerProfileImageUrl?: string | null;
  /** Whether an uploaded picture is stored, whatever the chosen source. */
  hasUploadedProfileImage?: boolean;
  /** The system roles plus the role on the active organization membership. */
  roles: AuthRole[];
  /** The effective permissions in the active organization. */
  permissions: string[];
  /** Whether the account is active. */
  isActive: boolean;
  /** ISO 8601 creation time. */
  createdAt: string;
  /** The deployment's tenancy mode (`TENANCY_MODE`); organization UI exists only in `multi`. */
  tenancyMode?: TenancyModeValue;
  /** The organization this session acts in, or `null`. */
  activeOrg?: OrgSummary | null;
  /** Every organization the user is an ACTIVE member of, i.e. can switch to. */
  memberships?: OrgMembershipSummary[];
}

/**
 * One sign-in provider the API offers (`GET /api/auth/providers`).
 *
 * @stability stable
 */
export interface AuthProviderInfo {
  /** The provider id, e.g. `google`; the login button posts to `/api/auth/<name>`. */
  name: string;
  /** The provider's start URL, when the server sends one. */
  authUrl: string;
  /**
   * `custom` for a provider that owns its sign-in flow: there is no
   * `/api/auth/<name>` redirect route, so `login(name)` calls the `start` of the
   * look registered for the id instead of navigating. Absent for a redirect
   * provider (every provider before this field existed).
   */
  mode?: 'custom';
}

/**
 * What {@link AuthContextValue.login} takes.
 *
 * @stability stable
 */
export interface LoginOptions {
  /**
   * Ask the provider to show its account chooser instead of silently reusing
   * the signed-in account (Google: `prompt=select_account`). Used by the
   * "sign in with a different account" action on the sign-in error screen.
   */
  selectAccount?: boolean;
}

/**
 * Everything the auth context offers: the session, the providers and the
 * actions that change them.
 *
 * @stability stable
 */
export interface AuthContextValue {
  /** The signed-in user, or `null`. */
  user: AuthUser | null;
  /** The boot-time session probe is still in flight. */
  isLoading: boolean;
  /** Someone is signed in. */
  isAuthenticated: boolean;
  /** The sign-in providers the API offers. */
  providers: AuthProviderInfo[];
  /**
   * True once a signed-in session was lost because the server refused to
   * refresh it, until the next sign-in. The login page reads it to explain
   * why the user is there; `RequireAuth` does the redirect.
   */
  sessionExpired: boolean;
  /**
   * Start a sign-in with `provider`: a full-page redirect to `/api/auth/<provider>`,
   * or, for a provider the API lists with `mode: 'custom'`, the `start` function
   * of the look registered for it (`registerAuthProvider` of this entry).
   */
  login: (provider: string, options?: LoginOptions) => void;
  /** Sign out: the app's `onBeforeLogout`, `POST /auth/logout`, then the login page. */
  logout: () => Promise<void>;
  /** Re-read `GET /auth/me`. Rejects when the API refuses. */
  refreshUser: () => Promise<void>;
  /**
   * Hold the access token the sign-in callback received (`null` drops it).
   * The callback page calls it before {@link AuthContextValue.refreshUser}.
   */
  setAccessToken: (token: string | null) => void;
  /** The organization this session acts in, from `/api/auth/me`. */
  activeOrg: OrgSummary | null;
  /** The organizations the user can switch to (active memberships), from `/api/auth/me`. */
  memberships: OrgMembershipSummary[];
  /**
   * Re-issue the session for another organization: calls
   * `POST /api/auth/switch-org` (which rotates the refresh cookie), keeps the
   * new access token and reloads the user, so permissions follow the org.
   * Rejects when the API refuses; the current session is then unchanged.
   */
  switchOrg: (orgId: string) => Promise<void>;
}

/**
 * What {@link AuthProvider} drives sessions through: the access-token holder
 * and the two verbs it needs. `PlatformHttpClient` of
 * `@marinoscar/platform-web/core` satisfies it; keep its identity stable.
 *
 * @stability stable
 */
export interface AuthSessionClient {
  /** `GET path`; `skipAuth` sends no token (the providers list is public). */
  get<T>(path: string, options?: { skipAuth?: boolean }): Promise<T>;
  /** `POST path` with an optional JSON body. */
  post<T>(path: string, body?: unknown): Promise<T>;
  /** Replace the held access token. */
  setAccessToken(token: string | null): void;
  /** Refresh the access token from the refresh cookie; `true` when one is held. */
  refreshToken(): Promise<boolean>;
  /** Subscribe to a refused refresh of a live session; returns the unsubscribe. */
  onSessionExpired(listener: () => void): () => void;
}

// =============================================================================
// The OAuth server's web client (PP-15.7, #1185; docs/specs/oauth-server.md §2.8)
// =============================================================================
//
// The calls the consent page, the "Connected apps" page and the admin
// "OAuth clients" page make, over the app's transport (`PlatformApiClient`), so
// the auth header, the token refresh and the app's error handling stay the
// app's. Every route here is an ordinary platform route (`{ data }` envelope)
// except the metadata document, which is RFC 8414 JSON: the transport returns a
// body without `data` as it is.
//
// The browser decides nothing: the API checks the session, the scopes, the
// organization and every permission. These calls only carry what the person
// chose.
// =============================================================================

import type {
  OAuthClientView,
  OAuthClientWithSecret,
  OAuthConsentRequest,
  OAuthDecisionResponse,
  OAuthGrantView,
} from '@marinoscar/platform-contract/identity';

import type { PlatformApiClient } from '../../core/index.js';
import type { Paginated } from './api.js';

/**
 * The stored `oauthServer` system-settings namespace (docs/specs/oauth-server.md §3),
 * as `GET /api/system-settings` returns it under `oauthServer`.
 *
 * @stability experimental
 */
export interface OAuthServerSettings {
  /** The switch. Off: every OAuth route answers `404`. */
  enabled: boolean;
  /** Access token life, 5 to 1440 minutes. */
  accessTokenTtlMinutes: number;
  /** Refresh token window in days (1 to 365), restarted on each rotation. */
  refreshTokenTtlDays: number;
  /** Cap on a grant's refresh chain in days; `0` means no cap. */
  refreshTokenMaxAgeDays: number;
  /** Issue a refresh token even when `offline_access` was not requested. */
  alwaysIssueRefreshToken: boolean;
  /** Client ID Metadata Documents on. */
  clientIdMetadataDocuments: boolean;
  /** Dynamic client registration on. */
  dynamicClientRegistration: boolean;
  /** Exact lower-case hosts whose clients may connect. */
  allowedClientHosts: string[];
  /** Any host may connect (development and open deployments only). */
  allowAnyClientHost: boolean;
  /** Native clients whose redirect URIs are all loopback may connect. */
  allowLoopbackClients: boolean;
  /** Days after which a never-used dynamically registered client is deleted (1 to 90). */
  dynamicClientUnusedDays: number;
}

/**
 * The bounds the API enforces on the numeric settings (the `oauthServer`
 * settings schema). The page uses them for its inputs; the API is the check.
 *
 * @stability experimental
 */
export const OAUTH_SERVER_SETTING_BOUNDS = Object.freeze({
  accessTokenTtlMinutes: Object.freeze({ min: 5, max: 1440 }),
  refreshTokenTtlDays: Object.freeze({ min: 1, max: 365 }),
  refreshTokenMaxAgeDays: Object.freeze({ min: 0, max: 3650 }),
  dynamicClientUnusedDays: Object.freeze({ min: 1, max: 90 }),
});

/**
 * The fields of the authorization server metadata document the pages read
 * (RFC 8414; the API serves it only while the server is on).
 *
 * @stability experimental
 */
export interface OAuthServerMetadata {
  /** `APP_URL` without a trailing slash. */
  issuer: string;
  /** Other members of the document, unread by the pages. */
  [key: string]: unknown;
}

/**
 * A client host the trust policy turned away, from the `oauth:client.refused`
 * audit rows (docs/specs/oauth-server.md §2.15).
 *
 * @stability experimental
 */
export interface OAuthRefusedHost {
  /** The refused host (lower-case). */
  host: string;
  /** Refusal rows in the window (at most one per host per hour). */
  count: number;
  /** ISO 8601 time of the latest refusal. */
  lastSeenAt: string;
}

/**
 * The `oauthServer` namespace with the system-settings row version (sent back
 * as `If-Match` on a save).
 *
 * @stability experimental
 */
export interface VersionedOAuthServerSettings {
  /** The namespace. */
  settings: OAuthServerSettings;
  /** The system-settings row version. */
  version: number;
}

/**
 * The query of `GET /api/admin/oauth/clients`.
 *
 * @stability experimental
 */
export interface OAuthClientListParams {
  /** 1-based page. */
  page?: number;
  /** Page size (at most 100). */
  pageSize?: number;
  /** Filter by kind. */
  kind?: OAuthClientView['kind'];
  /** Substring of the name or host. */
  search?: string;
}

/**
 * The body of `POST /api/admin/oauth/clients`.
 *
 * @stability experimental
 */
export interface OAuthClientCreateInput {
  /** Display name. */
  name: string;
  /** Redirect URIs: `https:` or loopback `http:`, one shared host. */
  redirectUris: string[];
  /** `none` (public) or a secret-based method (confidential; a secret is returned once). */
  tokenEndpointAuthMethod: OAuthClientView['tokenEndpointAuthMethod'];
}

/**
 * Every OAuth call the packaged pages make. {@link createOAuthServerApi} builds
 * one over the app's transport; a test or an app with its own client implements it.
 *
 * @stability experimental
 */
export interface OAuthServerApi {
  /** `GET /api/oauth/requests/:id`: what the consent page shows (session only). */
  getRequest(id: string): Promise<OAuthConsentRequest>;
  /** `POST /api/oauth/requests/:id/decision` with `approve`, the ticked scopes and the organization. */
  approveRequest(id: string, input: { scopes: string[]; orgId?: string }): Promise<OAuthDecisionResponse>;
  /** `POST /api/oauth/requests/:id/decision` with `deny`. */
  denyRequest(id: string): Promise<OAuthDecisionResponse>;
  /** `GET /api/oauth/grants`: the caller's connected apps. */
  listGrants(): Promise<OAuthGrantView[]>;
  /** `DELETE /api/oauth/grants/:id`: disconnect one. */
  revokeGrant(id: string): Promise<void>;
  /** `GET /api/oauth/.well-known/authorization-server`: rejects with a `404` while the server is off. */
  getServerMetadata(): Promise<OAuthServerMetadata>;
  /** `GET /api/admin/oauth/clients` (`oauth_clients:read`). */
  listClients(params?: OAuthClientListParams): Promise<Paginated<OAuthClientView>>;
  /** `POST /api/admin/oauth/clients` (`oauth_clients:write`): the secret is in the answer once. */
  createClient(input: OAuthClientCreateInput): Promise<OAuthClientWithSecret>;
  /** `PATCH /api/admin/oauth/clients/:id` with `{ disabled }` (`oauth_clients:write`). */
  setClientDisabled(id: string, disabled: boolean): Promise<OAuthClientView>;
  /** `POST /api/admin/oauth/clients/:id/rotate-secret` (`oauth_clients:write`): the new secret, once. */
  rotateClientSecret(id: string): Promise<OAuthClientWithSecret>;
  /** `DELETE /api/admin/oauth/clients/:id` (`oauth_clients:write`). */
  deleteClient(id: string): Promise<void>;
  /**
   * `GET /api/admin/oauth/refused-hosts` (`oauth_clients:read`): the hosts the
   * trust policy refused in the last 30 days. A server without the route
   * answers `404`; the admin page then says the list is not available.
   */
  listRefusedHosts(): Promise<OAuthRefusedHost[]>;
  /** `GET /api/system-settings` (`system_settings:read`), narrowed to the `oauthServer` namespace. */
  getServerSettings(): Promise<VersionedOAuthServerSettings>;
  /**
   * `PATCH /api/system-settings` with `{ oauthServer: patch }` and `If-Match:
   * version` (`system_settings:write`). A `409` means another administrator
   * saved first.
   */
  updateServerSettings(patch: Partial<OAuthServerSettings>, version: number): Promise<VersionedOAuthServerSettings>;
}

/** What `/system-settings` answers, as far as these calls read it. */
interface SystemSettingsDocument {
  oauthServer?: OAuthServerSettings;
  version: number;
}

function narrow(document: SystemSettingsDocument): VersionedOAuthServerSettings {
  if (!document.oauthServer) {
    throw new Error('This server does not report OAuth server settings. Update the API to a version with the OAuth server.');
  }
  return { settings: document.oauthServer, version: document.version };
}

const encode = encodeURIComponent;

/**
 * The OAuth web client over the app's transport.
 *
 * @param api - the app's transport (`usePlatformApi()`, or the app's own client outside the shell).
 * @returns the client.
 *
 * @example
 * ```ts
 * const oauth = createOAuthServerApi(appPlatformApi);
 * const request = await oauth.getRequest(id);
 * ```
 *
 * @stability experimental
 */
export function createOAuthServerApi(api: PlatformApiClient): OAuthServerApi {
  return Object.freeze<OAuthServerApi>({
    getRequest: (id) => api.get<OAuthConsentRequest>(`/oauth/requests/${encode(id)}`),
    approveRequest: (id, input) =>
      api.post<OAuthDecisionResponse>(`/oauth/requests/${encode(id)}/decision`, {
        decision: 'approve',
        scopes: input.scopes,
        ...(input.orgId ? { orgId: input.orgId } : {}),
      }),
    denyRequest: (id) => api.post<OAuthDecisionResponse>(`/oauth/requests/${encode(id)}/decision`, { decision: 'deny' }),
    listGrants: () => api.get<OAuthGrantView[]>('/oauth/grants'),
    async revokeGrant(id) {
      await api.delete<void>(`/oauth/grants/${encode(id)}`);
    },
    getServerMetadata: () => api.get<OAuthServerMetadata>('/oauth/.well-known/authorization-server'),
    listClients(params) {
      const search = new URLSearchParams();
      if (params?.page) search.set('page', String(params.page));
      if (params?.pageSize) search.set('pageSize', String(params.pageSize));
      if (params?.kind) search.set('kind', params.kind);
      if (params?.search) search.set('search', params.search);
      const qs = search.toString();
      return api.get<Paginated<OAuthClientView>>(`/admin/oauth/clients${qs ? `?${qs}` : ''}`);
    },
    createClient: (input) => api.post<OAuthClientWithSecret>('/admin/oauth/clients', input),
    setClientDisabled: (id, disabled) => api.patch<OAuthClientView>(`/admin/oauth/clients/${encode(id)}`, { disabled }),
    rotateClientSecret: (id) => api.post<OAuthClientWithSecret>(`/admin/oauth/clients/${encode(id)}/rotate-secret`),
    async deleteClient(id) {
      await api.delete<void>(`/admin/oauth/clients/${encode(id)}`);
    },
    listRefusedHosts: () => api.get<OAuthRefusedHost[]>('/admin/oauth/refused-hosts'),
    getServerSettings: async () => narrow(await api.get<SystemSettingsDocument>('/system-settings')),
    updateServerSettings: async (patch, version) =>
      narrow(await api.patch<SystemSettingsDocument>('/system-settings', { oauthServer: patch }, { ifMatch: String(version) })),
  });
}

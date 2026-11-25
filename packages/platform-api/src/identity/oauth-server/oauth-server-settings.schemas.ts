// =============================================================================
// The `oauthServer` system settings namespace's schemas (PP-15.3)
// =============================================================================
//
// Zod only: a leaf the settings slice imports to declare the namespace
// (`settings/oauth-server.system-settings.ts`; the settings slice sits ABOVE
// identity, so identity owns the shape and settings owns the registration, as
// `maintenance` is split). The full field list of docs/specs/oauth-server.md §3
// is defined now so PP-15.4 and PP-15.5 only READ it. Code life (60 s),
// pending-request life (10 min), the refresh grace window (10 s) and the CIMD
// fetch limits are constants, not settings.
// =============================================================================

import { z } from 'zod';

/** An exact lower-case host: no scheme, no wildcard, no port, no path. */
const CLIENT_HOST = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;

const host = z.string().regex(CLIENT_HOST, 'an exact lower-case host name (no scheme, port, path or wildcard)');
const hosts = z.array(host).max(200);

/**
 * The stored `oauthServer` namespace (docs/specs/oauth-server.md §3).
 *
 * @stability experimental
 */
export const oauthServerSettingsSchema = z.object({
  /** The switch. Off: every OAuth route is `404` (authorize shows an error page) and `oat_` is `401`. */
  enabled: z.boolean(),
  /** Access token life, 5 to 1440 minutes. */
  accessTokenTtlMinutes: z.number().int().min(5).max(1440),
  /** Refresh token window in days, restarted on each rotation. */
  refreshTokenTtlDays: z.number().int().min(1).max(365),
  /** Cap on a grant's refresh chain in days, from the grant's creation; `0` means no cap. */
  refreshTokenMaxAgeDays: z.number().int().min(0).max(3650),
  /** Issue a refresh token even when `offline_access` was not requested. */
  alwaysIssueRefreshToken: z.boolean(),
  /** Client ID Metadata Documents on. */
  clientIdMetadataDocuments: z.boolean(),
  /** Dynamic client registration on. */
  dynamicClientRegistration: z.boolean(),
  /** Exact lower-case hosts whose clients may connect. */
  allowedClientHosts: hosts,
  /** Development and open deployments only. */
  allowAnyClientHost: z.boolean(),
  /** Native clients whose redirect URIs are all loopback. */
  allowLoopbackClients: z.boolean(),
  /** A dynamically registered client never used to complete an authorization is deleted after this many days. */
  dynamicClientUnusedDays: z.number().int().min(1).max(90),
});

/**
 * The stored `oauthServer` value.
 *
 * @stability experimental
 */
export type OAuthServerSettingsValue = z.infer<typeof oauthServerSettingsSchema>;

/**
 * The service-side PATCH of the `oauthServer` namespace.
 *
 * @stability experimental
 */
export const oauthServerSettingsPatchSchema = oauthServerSettingsSchema.partial();

/**
 * What a fresh deployment stores: the server ships OFF.
 *
 * @stability experimental
 */
export const OAUTH_SERVER_SETTINGS_DEFAULTS: OAuthServerSettingsValue = Object.freeze({
  enabled: false,
  accessTokenTtlMinutes: 60,
  refreshTokenTtlDays: 30,
  refreshTokenMaxAgeDays: 180,
  alwaysIssueRefreshToken: true,
  clientIdMetadataDocuments: true,
  dynamicClientRegistration: true,
  allowedClientHosts: Object.freeze([]) as unknown as string[],
  allowAnyClientHost: false,
  allowLoopbackClients: true,
  dynamicClientUnusedDays: 7,
});

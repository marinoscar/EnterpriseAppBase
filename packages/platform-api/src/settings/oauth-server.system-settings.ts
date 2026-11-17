// =============================================================================
// System settings namespace `oauthServer` (PP-15.3, epic #1178)
// =============================================================================
//
// A declaration file: pure data. The shape is identity's
// (`identity/oauth-server/oauth-server-settings.schemas.ts`); the settings
// slice registers it (`SettingsModule.forRoot()` unless the app's manifest
// already did) and binds the port identity reads it through. Ships OFF.
// =============================================================================

import type { z } from 'zod';

import {
  OAUTH_SERVER_SETTINGS_DEFAULTS,
  oauthServerSettingsPatchSchema,
  oauthServerSettingsSchema,
  type OAuthServerSettingsValue,
} from '../identity/oauth-server/oauth-server-settings.schemas';
import type { SystemSettingsNamespace } from './registry/system-settings-namespace';

type OAuthServerPatch = z.infer<typeof oauthServerSettingsPatchSchema>;

/**
 * The `oauthServer` PATCH merge, field by field: a field the patch names
 * replaces the stored one (an array replaces, never appends), an absent field
 * is kept.
 *
 * @param current - the stored value.
 * @param patch - the PATCH body's `oauthServer` branch, when present.
 * @returns the merged value.
 *
 * @stability experimental
 */
export function mergeOAuthServerSettings(current: OAuthServerSettingsValue, patch?: OAuthServerPatch): OAuthServerSettingsValue {
  return {
    ...current,
    ...Object.fromEntries(Object.entries(patch ?? {}).filter(([, value]) => value !== undefined)),
    allowedClientHosts: [...(patch?.allowedClientHosts ?? current.allowedClientHosts)],
  };
}

/**
 * The `oauthServer` system-settings namespace: the OAuth server's switch,
 * token lifetimes and client trust policy. Inert by default: it ships off.
 *
 * @stability experimental
 */
export const OAUTH_SERVER_SYSTEM_SETTINGS = {
  /** The namespace key (permanent). */
  key: 'oauthServer',
  /** What it holds. */
  description: 'The OAuth server: whether it is on, token lifetimes, refresh policy and which client hosts may connect.',
  /** The stored shape. */
  storedSchema: oauthServerSettingsSchema,
  /** The stored partial. */
  patchSchema: oauthServerSettingsPatchSchema,
  /** The PUT body's branch. */
  putSchema: oauthServerSettingsSchema,
  /** The PATCH body's branch. */
  wirePatchSchema: oauthServerSettingsPatchSchema,
  /** The GET response's branch. */
  responseSchema: oauthServerSettingsSchema,
  /** Inert: the server ships off. */
  defaults: OAUTH_SERVER_SETTINGS_DEFAULTS,
  /** Optional in a PUT body: omitting it keeps the stored value, never resets it. */
  requiredOnPut: false,
  /** The PATCH merge ({@link mergeOAuthServerSettings}). */
  merge: mergeOAuthServerSettings,
} satisfies SystemSettingsNamespace<'oauthServer', OAuthServerSettingsValue, OAuthServerPatch>;

declare module './index' {
  interface SystemSettingsNamespaces {
    /** The OAuth server (PP-15.3, epic #1178). REQUIRED, like every system namespace. */
    oauthServer: OAuthServerSettingsValue;
  }
  interface SystemSettingsNamespaceDeclarations {
    /** The `oauthServer` declaration. */
    oauthServer: typeof OAUTH_SERVER_SYSTEM_SETTINGS;
  }
}

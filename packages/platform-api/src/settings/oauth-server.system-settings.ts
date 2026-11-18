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
import { OAUTH_AUDIT_ACTIONS } from '../identity/oauth-server/oauth-grant.service';
import type { SystemSettingsNamespace } from './registry/system-settings-namespace';
import type { SettingsWriteHook } from './write-hooks';

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

/** The audit target of a settings change: the namespace, a permanent string. */
const SETTINGS_AUDIT_TARGET = 'oauthServer';

/**
 * Records `oauth:settings.update` in the transaction that wrote the settings
 * (an audit row without its change, or a change without its row, is the failure
 * an audit trail exists to prevent). The meta names the fields that changed and,
 * for a scalar field, its old and new value; for the allowed host list, the
 * hosts added and removed. The namespace holds no secret, so nothing is
 * redacted, and nothing outside it is copied.
 *
 * @stability experimental
 */
export const auditOAuthServerSettingsWrite: SettingsWriteHook<OAuthServerSettingsValue> = async (tx, context) => {
  const before = (context.before ?? OAUTH_SERVER_SETTINGS_DEFAULTS) as OAuthServerSettingsValue;
  const after = (context.after ?? OAUTH_SERVER_SETTINGS_DEFAULTS) as OAuthServerSettingsValue;
  const changed: string[] = [];
  const meta: Record<string, string | number | boolean | null> = {};
  for (const field of Object.keys(OAUTH_SERVER_SETTINGS_DEFAULTS) as Array<keyof OAuthServerSettingsValue>) {
    if (field === 'allowedClientHosts') {
      const was = new Set(before.allowedClientHosts);
      const now = new Set(after.allowedClientHosts);
      const added = [...now].filter((host) => !was.has(host));
      const removed = [...was].filter((host) => !now.has(host));
      if (added.length === 0 && removed.length === 0) continue;
      changed.push(field);
      if (added.length > 0) meta.allowedClientHostsAdded = added.join(',');
      if (removed.length > 0) meta.allowedClientHostsRemoved = removed.join(',');
      continue;
    }
    if (before[field] === after[field]) continue;
    changed.push(field);
    meta[`${field}From`] = before[field] as string | number | boolean;
    meta[`${field}To`] = after[field] as string | number | boolean;
  }
  if (changed.length === 0) return;
  await tx.auditEvent.create({
    data: {
      actorUserId: context.userId,
      action: OAUTH_AUDIT_ACTIONS.SETTINGS_UPDATE,
      targetType: 'oauth_settings',
      targetId: SETTINGS_AUDIT_TARGET,
      meta: { fields: changed.join(','), ...meta },
    },
  });
};

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
  /** The `oauth:settings.update` audit row, in the write's transaction ({@link auditOAuthServerSettingsWrite}). */
  onWrite: auditOAuthServerSettingsWrite,
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

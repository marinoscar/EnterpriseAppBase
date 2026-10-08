// The feature-notice registry (issue #745): what `FeatureUnavailableNotice`
// says about a feature that is not set up, and where an administrator fixes
// it. The permission only picks the words; the admin route and the API keep
// their own gates.

/**
 * One feature a notice can be about.
 *
 * @stability experimental
 */
export interface FeatureNoticeDef {
  /** The feature key (`ai`, `storage`, `push`, an app's own). */
  feature: string;
  /** Its name in copy: "{label} isn't enabled yet". */
  label: string;
  /** The exact admin read permission of its settings page; its holders see "Set it up". */
  adminPermission: string;
  /** The admin settings page that turns it on. */
  setupHref: string;
}

/**
 * The built-in notices; the permissions are the exact strings the admin
 * controllers enforce (`ai_config:read`, `storage_config:read`, `push:read`).
 *
 * @stability experimental
 */
export const PLATFORM_FEATURE_NOTICES: readonly FeatureNoticeDef[] = Object.freeze([
  { feature: 'ai', label: 'AI', adminPermission: 'ai_config:read', setupHref: '/admin/settings/ai' },
  { feature: 'storage', label: 'Storage', adminPermission: 'storage_config:read', setupHref: '/admin/settings/storage' },
  { feature: 'push', label: 'Web Push', adminPermission: 'push:read', setupHref: '/admin/settings/push' },
]);

const notices = new Map<string, FeatureNoticeDef>(PLATFORM_FEATURE_NOTICES.map((def) => [def.feature, def]));

/**
 * Registers (or, for an existing key, replaces) a feature notice. Call at
 * module scope.
 *
 * @param def - the notice.
 * @throws Error when a field is blank or `setupHref` is not an app route.
 *
 * @example
 * ```ts
 * registerFeatureNotice({ feature: 'maps', label: 'Maps', adminPermission: 'system_settings:read', setupHref: '/admin/settings/maps' });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerFeatureNotice(def: FeatureNoticeDef): void {
  for (const field of ['feature', 'label', 'adminPermission', 'setupHref'] as const) {
    if (typeof def[field] !== 'string' || def[field].trim() === '') throw new Error(`registerFeatureNotice: ${field} is required`);
  }
  if (!def.setupHref.startsWith('/')) throw new Error('registerFeatureNotice: setupHref must be an app route starting with "/"');
  notices.set(def.feature, Object.freeze({ ...def }));
}

/**
 * The notice for `feature`, or `undefined` when none is registered.
 *
 * @param feature - the feature key.
 * @returns the notice.
 *
 * @stability experimental
 */
export function featureNoticeFor(feature: string): FeatureNoticeDef | undefined {
  return notices.get(feature);
}

/**
 * Every registered notice, in registration order.
 *
 * @returns the notices.
 *
 * @stability experimental
 */
export function registeredFeatureNotices(): FeatureNoticeDef[] {
  return [...notices.values()];
}

// The viewer port (issue #696, PP-2.7): who is looking, as a packaged page may
// see it. The app's adapter derives it from its own auth context.

/**
 * The signed-in viewer, as packaged pages may see it.
 *
 * @stability experimental
 */
export interface PlatformViewer {
  /** The signed-in user's id, or `null` when nobody is signed in. */
  userId: string | null;
  /**
   * The signed-in user's own email address, when the app shares it (issue
   * #737: the email settings page names where its test message goes).
   * Optional; a page treats its absence as unknown.
   */
  email?: string | null;
  /** Whether the viewer holds `permission` (the exact string the API enforces). */
  hasPermission(permission: string): boolean;
  /** Feature switches the app exposes to settings surfaces (e.g. ai, telemetry). */
  isFeatureEnabled(feature: string): boolean;
  /**
   * Re-reads the signed-in user (display name, avatar, roles) from the API.
   * Optional. A page that changes the viewer's own account (the user-data
   * pages after a deletion or a factory reset) calls it when it is present.
   */
  refresh?(): Promise<void>;
}

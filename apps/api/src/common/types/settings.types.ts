import type {
  DataTablesValue,
  NavigationValue,
  NotificationsValue,
} from '../schemas/user-settings-namespaces.schema';
import type { SystemNotificationsValue } from '../schemas/settings.schema';

// =============================================================================
// Settings Type Definitions
// =============================================================================

/**
 * User settings schema - stored in user_settings.value JSONB
 */
export interface UserSettingsValue {
  theme: 'light' | 'dark' | 'system';
  profile: {
    displayName?: string;
    useProviderImage: boolean;
    customImageUrl?: string | null;
  };
  /**
   * Per-table view preferences, keyed by table id.
   *
   * Optional on purpose, and derived from the zod schema so the two can never
   * drift. Absent means "the user has expressed no table preferences yet" —
   * NOT "empty preferences". See user-settings-namespaces.schema.ts.
   */
  dataTables?: DataTablesValue;
  /**
   * Navigation chrome preferences. Absent means "use built-in defaults".
   */
  navigation?: NavigationValue;
  /**
   * Per-channel, per-event notification preferences (#126), channel-outer:
   * `{ email: { 'user.welcome': false } }`.
   *
   * SPARSE AND OPTIONAL AT EVERY LEVEL. Absent namespace, absent channel and
   * absent event key all mean the same thing — "use the event's
   * `defaultEnabled` from the registry" — which is what lets this feature ship
   * with no migration and no backfill, and is why an untouched account is not
   * muted. The dispatcher resolves it; see
   * notifications/notification-preferences.ts.
   */
  notifications?: NotificationsValue;
}

/**
 * System settings schema - stored in system_settings.value JSONB
 */
export interface SystemSettingsValue {
  ui: {
    allowUserThemeOverride: boolean;
  };
  features: {
    [key: string]: boolean;
  };
  /**
   * Deployment-wide browser-notification policy (#225, epic #215).
   *
   * REQUIRED, not optional, and modelled rather than a `features` key — see
   * `systemNotificationsSchema` in schemas/settings.schema.ts for the full
   * argument. Required is what makes a PUT that omits the block a loud 400
   * instead of a silent reset: the value being reset would be an operator's
   * decision to turn a delivery channel OFF, and silently turning it back on is
   * the one failure mode a security-adjacent gate must not have.
   *
   * Derived from the zod schema so the two cannot drift, exactly as the user
   * settings namespaces above are.
   */
  notifications: SystemNotificationsValue;
}

/**
 * Default user settings
 */
// NOTE: `dataTables`, `navigation` and `notifications` are intentionally NOT
// listed here.
// Seeding them would turn "absent" into "explicitly empty", which is exactly
// the failure mode the namespaces are designed to avoid (a frozen column set
// that silently hides every column added later, or a notification preference
// map that freezes a user at the defaults of the day they first saved).
export const DEFAULT_USER_SETTINGS: UserSettingsValue = {
  theme: 'system',
  profile: {
    useProviderImage: true,
  },
};

/**
 * Default system settings
 */
export const DEFAULT_SYSTEM_SETTINGS: SystemSettingsValue = {
  ui: {
    allowUserThemeOverride: true,
  },
  features: {},
  // ON by default, suppressing nothing. The opposite default would mean a fresh
  // deployment ships with a delivery channel silently off and no indication
  // anywhere that it was ever available — an operator opts OUT of browser
  // notifications, never into them.
  notifications: {
    browserEnabled: true,
    disabledEvents: [],
  },
};

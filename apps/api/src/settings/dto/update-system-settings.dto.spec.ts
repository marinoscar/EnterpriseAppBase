import {
  updateSystemSettingsSchema,
  patchSystemSettingsSchema,
} from './update-system-settings.dto';
import { MAX_DISABLED_NOTIFICATION_EVENTS } from '../../common/schemas/settings.schema';

/**
 * The `notifications` block every PUT body must now carry (#225).
 *
 * Spread into the existing `ui` / `features` cases rather than made optional in
 * the schema: a PUT is a full replacement, and letting the block default would
 * mean an old client's PUT silently re-enables a delivery channel an operator
 * turned off. Keeping it here as a constant is what lets each of those cases go
 * on asserting the ONE thing it was written to assert.
 */
const NOTIFICATIONS = {
  browserEnabled: true,
  disabledEvents: [] as string[],
};

describe('UpdateSystemSettingsDto (PUT)', () => {
  describe('ui field', () => {
    it('should accept valid ui settings object', () => {
      const result = updateSystemSettingsSchema.parse({
        ui: {
          allowUserThemeOverride: true,
        },
        features: {},
        notifications: NOTIFICATIONS,
      });

      expect(result.ui.allowUserThemeOverride).toBe(true);
    });

    it('should accept allowUserThemeOverride as false', () => {
      const result = updateSystemSettingsSchema.parse({
        ui: {
          allowUserThemeOverride: false,
        },
        features: {},
        notifications: NOTIFICATIONS,
      });

      expect(result.ui.allowUserThemeOverride).toBe(false);
    });

    it('should reject ui without allowUserThemeOverride', () => {
      expect(() =>
        updateSystemSettingsSchema.parse({
          ui: {},
          features: {},
          notifications: NOTIFICATIONS,
        }),
      ).toThrow();
    });

    it('should reject non-boolean allowUserThemeOverride', () => {
      expect(() =>
        updateSystemSettingsSchema.parse({
          ui: {
            allowUserThemeOverride: 'true',
          },
          features: {},
          notifications: NOTIFICATIONS,
        }),
      ).toThrow();
    });

    it('should require ui field', () => {
      expect(() =>
        updateSystemSettingsSchema.parse({
          features: {},
          notifications: NOTIFICATIONS,
        }),
      ).toThrow();
    });
  });

  describe('features field', () => {
    it('should accept empty features object', () => {
      const result = updateSystemSettingsSchema.parse({
        ui: {
          allowUserThemeOverride: true,
        },
        features: {},
        notifications: NOTIFICATIONS,
      });

      expect(result.features).toEqual({});
    });

    it('should accept features with boolean flags', () => {
      const result = updateSystemSettingsSchema.parse({
        ui: {
          allowUserThemeOverride: true,
        },
        features: {
          enableNotifications: true,
          enableAnalytics: false,
        },
        notifications: NOTIFICATIONS,
      });

      expect(result.features).toEqual({
        enableNotifications: true,
        enableAnalytics: false,
      });
    });

    it('should reject features with non-boolean values', () => {
      expect(() =>
        updateSystemSettingsSchema.parse({
          ui: {
            allowUserThemeOverride: true,
          },
          features: {
            enableNotifications: 'true',
          },
          notifications: NOTIFICATIONS,
        }),
      ).toThrow();
    });

    it('should require features field', () => {
      expect(() =>
        updateSystemSettingsSchema.parse({
          ui: {
            allowUserThemeOverride: true,
          },
          notifications: NOTIFICATIONS,
        }),
      ).toThrow();
    });
  });

  /**
   * Issue #225, epic #215. The block is MODELLED — a real object with a real
   * type — rather than a key in the open `features` record, so it gets real
   * validation, which is what these cases pin.
   */
  describe('notifications field', () => {
    it('accepts the block with browser notifications on and nothing suppressed', () => {
      const result = updateSystemSettingsSchema.parse({
        ui: { allowUserThemeOverride: true },
        features: {},
        notifications: { browserEnabled: true, disabledEvents: [] },
      });

      expect(result.notifications).toEqual({
        browserEnabled: true,
        disabledEvents: [],
      });
    });

    it('accepts a list of event keys to suppress', () => {
      const result = updateSystemSettingsSchema.parse({
        ui: { allowUserThemeOverride: true },
        features: {},
        notifications: {
          browserEnabled: false,
          disabledEvents: ['security.role_changed', 'user.welcome'],
        },
      });

      expect(result.notifications.disabledEvents).toEqual([
        'security.role_changed',
        'user.welcome',
      ]);
    });

    it('is REQUIRED: a body that omits it is rejected rather than defaulted', () => {
      // The whole point of requiring it. A PUT from a client that predates the
      // block would otherwise reset `browserEnabled` to `true` — silently
      // undoing an operator's decision to turn the channel off.
      expect(() =>
        updateSystemSettingsSchema.parse({
          ui: { allowUserThemeOverride: true },
          features: {},
        }),
      ).toThrow();
    });

    it('rejects a non-boolean browserEnabled', () => {
      expect(() =>
        updateSystemSettingsSchema.parse({
          ui: { allowUserThemeOverride: true },
          features: {},
          notifications: { browserEnabled: 'yes', disabledEvents: [] },
        }),
      ).toThrow();
    });

    it('rejects an event key that breaks the <area>.<event> shape', () => {
      // Same syntactic bound the per-user preference keys use — an uppercase
      // segment is not a key the registry can produce.
      expect(() =>
        updateSystemSettingsSchema.parse({
          ui: { allowUserThemeOverride: true },
          features: {},
          notifications: {
            browserEnabled: true,
            disabledEvents: ['Security.Role_Changed'],
          },
        }),
      ).toThrow();
    });

    it('rejects an empty-string event key', () => {
      expect(() =>
        updateSystemSettingsSchema.parse({
          ui: { allowUserThemeOverride: true },
          features: {},
          notifications: { browserEnabled: true, disabledEvents: [''] },
        }),
      ).toThrow();
    });

    it('rejects a non-string entry', () => {
      expect(() =>
        updateSystemSettingsSchema.parse({
          ui: { allowUserThemeOverride: true },
          features: {},
          notifications: { browserEnabled: true, disabledEvents: [42] },
        }),
      ).toThrow();
    });

    it('caps the list, so an unbounded array cannot be written into the row', () => {
      const overCap = Array.from(
        { length: MAX_DISABLED_NOTIFICATION_EVENTS + 1 },
        (_, index) => `area.event_${index}`,
      );

      expect(() =>
        updateSystemSettingsSchema.parse({
          ui: { allowUserThemeOverride: true },
          features: {},
          notifications: { browserEnabled: true, disabledEvents: overCap },
        }),
      ).toThrow();

      expect(() =>
        updateSystemSettingsSchema.parse({
          ui: { allowUserThemeOverride: true },
          features: {},
          notifications: {
            browserEnabled: true,
            disabledEvents: overCap.slice(0, MAX_DISABLED_NOTIFICATION_EVENTS),
          },
        }),
      ).not.toThrow();
    });
  });

  describe('complete settings object', () => {
    it('should accept valid complete settings', () => {
      const result = updateSystemSettingsSchema.parse({
        ui: {
          allowUserThemeOverride: true,
        },
        features: {
          enableNotifications: true,
          enableAdvancedFeatures: false,
        },
        notifications: {
          browserEnabled: false,
          disabledEvents: ['security.role_changed'],
        },
      });

      expect(result).toEqual({
        ui: {
          allowUserThemeOverride: true,
        },
        features: {
          enableNotifications: true,
          enableAdvancedFeatures: false,
        },
        notifications: {
          browserEnabled: false,
          disabledEvents: ['security.role_changed'],
        },
      });
    });
  });
});

describe('PatchSystemSettingsDto (PATCH)', () => {
  describe('ui field', () => {
    it('should make ui field optional', () => {
      const result = patchSystemSettingsSchema.parse({});

      expect(result.ui).toBeUndefined();
    });

    it('should accept ui with allowUserThemeOverride', () => {
      const result = patchSystemSettingsSchema.parse({
        ui: {
          allowUserThemeOverride: false,
        },
      });

      expect(result.ui?.allowUserThemeOverride).toBe(false);
    });

    it('should make allowUserThemeOverride optional in ui', () => {
      const result = patchSystemSettingsSchema.parse({
        ui: {},
      });

      expect(result.ui).toEqual({});
    });
  });

  describe('features field', () => {
    it('should make features field optional', () => {
      const result = patchSystemSettingsSchema.parse({});

      expect(result.features).toBeUndefined();
    });

    it('should accept features with boolean flags', () => {
      const result = patchSystemSettingsSchema.parse({
        features: {
          newFeature: true,
        },
      });

      expect(result.features).toEqual({
        newFeature: true,
      });
    });

    it('should reject features with non-boolean values', () => {
      expect(() =>
        patchSystemSettingsSchema.parse({
          features: {
            newFeature: 'yes',
          },
        }),
      ).toThrow();
    });
  });

  describe('notifications field', () => {
    it('is optional, like every other branch of a PATCH body', () => {
      const result = patchSystemSettingsSchema.parse({});

      expect(result.notifications).toBeUndefined();
    });

    it('accepts the global toggle on its own, leaving the list untouched', () => {
      // This is what the admin page sends when only the switch moved: the
      // service falls back to the stored `disabledEvents` for the absent half.
      const result = patchSystemSettingsSchema.parse({
        notifications: { browserEnabled: false },
      });

      expect(result.notifications).toEqual({ browserEnabled: false });
      expect(result.notifications?.disabledEvents).toBeUndefined();
    });

    it('accepts the list on its own', () => {
      const result = patchSystemSettingsSchema.parse({
        notifications: { disabledEvents: ['security.role_changed'] },
      });

      expect(result.notifications).toEqual({
        disabledEvents: ['security.role_changed'],
      });
    });

    it('accepts an empty list, which is how the last suppression is lifted', () => {
      // `disabledEvents` REPLACES rather than merges, so `[]` is a meaningful
      // body and must not be confused with "absent".
      const result = patchSystemSettingsSchema.parse({
        notifications: { disabledEvents: [] },
      });

      expect(result.notifications?.disabledEvents).toEqual([]);
    });

    it('applies the same event-key validation as the PUT schema', () => {
      expect(() =>
        patchSystemSettingsSchema.parse({
          notifications: { disabledEvents: ['NOT A KEY'] },
        }),
      ).toThrow();
    });

    it('applies the same cap as the PUT schema', () => {
      const overCap = Array.from(
        { length: MAX_DISABLED_NOTIFICATION_EVENTS + 1 },
        (_, index) => `area.event_${index}`,
      );

      expect(() =>
        patchSystemSettingsSchema.parse({
          notifications: { disabledEvents: overCap },
        }),
      ).toThrow();
    });

    it('rejects a non-boolean browserEnabled', () => {
      expect(() =>
        patchSystemSettingsSchema.parse({
          notifications: { browserEnabled: 1 },
        }),
      ).toThrow();
    });
  });

  describe('partial updates', () => {
    it('should accept empty object (all fields optional)', () => {
      const result = patchSystemSettingsSchema.parse({});

      expect(result).toEqual({});
    });

    it('should accept update with only ui field', () => {
      const result = patchSystemSettingsSchema.parse({
        ui: {
          allowUserThemeOverride: true,
        },
      });

      expect(result).toEqual({
        ui: {
          allowUserThemeOverride: true,
        },
      });
    });

    it('should accept update with only features field', () => {
      const result = patchSystemSettingsSchema.parse({
        features: {
          beta: true,
        },
      });

      expect(result).toEqual({
        features: {
          beta: true,
        },
      });
    });

    it('should accept combination of partial fields', () => {
      const result = patchSystemSettingsSchema.parse({
        ui: {
          allowUserThemeOverride: false,
        },
        features: {
          experimental: true,
        },
        notifications: {
          browserEnabled: false,
          disabledEvents: ['security.role_changed'],
        },
      });

      expect(result).toEqual({
        ui: {
          allowUserThemeOverride: false,
        },
        features: {
          experimental: true,
        },
        notifications: {
          browserEnabled: false,
          disabledEvents: ['security.role_changed'],
        },
      });
    });
  });
});

import {
  updateSystemSettingsSchema,
  patchSystemSettingsSchema,
} from './update-system-settings.dto';

describe('UpdateSystemSettingsDto (PUT)', () => {
  describe('ui field', () => {
    it('should accept valid ui settings object', () => {
      const result = updateSystemSettingsSchema.parse({
        ui: {
          allowUserThemeOverride: true,
        },
        security: {
          jwtAccessTtlMinutes: 15,
          refreshTtlDays: 14,
        },
        features: {},
      });

      expect(result.ui.allowUserThemeOverride).toBe(true);
    });

    it('should accept allowUserThemeOverride as false', () => {
      const result = updateSystemSettingsSchema.parse({
        ui: {
          allowUserThemeOverride: false,
        },
        security: {
          jwtAccessTtlMinutes: 15,
          refreshTtlDays: 14,
        },
        features: {},
      });

      expect(result.ui.allowUserThemeOverride).toBe(false);
    });

    it('should reject ui without allowUserThemeOverride', () => {
      expect(() =>
        updateSystemSettingsSchema.parse({
          ui: {},
          security: {
            jwtAccessTtlMinutes: 15,
            refreshTtlDays: 14,
          },
          features: {},
        }),
      ).toThrow();
    });

    it('should reject non-boolean allowUserThemeOverride', () => {
      expect(() =>
        updateSystemSettingsSchema.parse({
          ui: {
            allowUserThemeOverride: 'true',
          },
          security: {
            jwtAccessTtlMinutes: 15,
            refreshTtlDays: 14,
          },
          features: {},
        }),
      ).toThrow();
    });

    it('should require ui field', () => {
      expect(() =>
        updateSystemSettingsSchema.parse({
          security: {
            jwtAccessTtlMinutes: 15,
            refreshTtlDays: 14,
          },
          features: {},
        }),
      ).toThrow();
    });
  });

  describe('security field', () => {
    it('should accept valid security settings', () => {
      const result = updateSystemSettingsSchema.parse({
        ui: {
          allowUserThemeOverride: true,
        },
        security: {
          jwtAccessTtlMinutes: 30,
          refreshTtlDays: 7,
        },
        features: {},
      });

      expect(result.security.jwtAccessTtlMinutes).toBe(30);
      expect(result.security.refreshTtlDays).toBe(7);
    });

    it('should accept minimum jwtAccessTtlMinutes value of 1', () => {
      const result = updateSystemSettingsSchema.parse({
        ui: {
          allowUserThemeOverride: true,
        },
        security: {
          jwtAccessTtlMinutes: 1,
          refreshTtlDays: 14,
        },
        features: {},
      });

      expect(result.security.jwtAccessTtlMinutes).toBe(1);
    });

    it('should accept maximum jwtAccessTtlMinutes value of 60', () => {
      const result = updateSystemSettingsSchema.parse({
        ui: {
          allowUserThemeOverride: true,
        },
        security: {
          jwtAccessTtlMinutes: 60,
          refreshTtlDays: 14,
        },
        features: {},
      });

      expect(result.security.jwtAccessTtlMinutes).toBe(60);
    });

    it('should reject jwtAccessTtlMinutes less than 1', () => {
      expect(() =>
        updateSystemSettingsSchema.parse({
          ui: {
            allowUserThemeOverride: true,
          },
          security: {
            jwtAccessTtlMinutes: 0,
            refreshTtlDays: 14,
          },
          features: {},
        }),
      ).toThrow();
    });

    it('should reject jwtAccessTtlMinutes greater than 60', () => {
      expect(() =>
        updateSystemSettingsSchema.parse({
          ui: {
            allowUserThemeOverride: true,
          },
          security: {
            jwtAccessTtlMinutes: 61,
            refreshTtlDays: 14,
          },
          features: {},
        }),
      ).toThrow();
    });

    it('should accept minimum refreshTtlDays value of 1', () => {
      const result = updateSystemSettingsSchema.parse({
        ui: {
          allowUserThemeOverride: true,
        },
        security: {
          jwtAccessTtlMinutes: 15,
          refreshTtlDays: 1,
        },
        features: {},
      });

      expect(result.security.refreshTtlDays).toBe(1);
    });

    it('should accept maximum refreshTtlDays value of 90', () => {
      const result = updateSystemSettingsSchema.parse({
        ui: {
          allowUserThemeOverride: true,
        },
        security: {
          jwtAccessTtlMinutes: 15,
          refreshTtlDays: 90,
        },
        features: {},
      });

      expect(result.security.refreshTtlDays).toBe(90);
    });

    it('should reject refreshTtlDays less than 1', () => {
      expect(() =>
        updateSystemSettingsSchema.parse({
          ui: {
            allowUserThemeOverride: true,
          },
          security: {
            jwtAccessTtlMinutes: 15,
            refreshTtlDays: 0,
          },
          features: {},
        }),
      ).toThrow();
    });

    it('should reject refreshTtlDays greater than 90', () => {
      expect(() =>
        updateSystemSettingsSchema.parse({
          ui: {
            allowUserThemeOverride: true,
          },
          security: {
            jwtAccessTtlMinutes: 15,
            refreshTtlDays: 91,
          },
          features: {},
        }),
      ).toThrow();
    });

    it('should reject non-integer jwtAccessTtlMinutes', () => {
      expect(() =>
        updateSystemSettingsSchema.parse({
          ui: {
            allowUserThemeOverride: true,
          },
          security: {
            jwtAccessTtlMinutes: 15.5,
            refreshTtlDays: 14,
          },
          features: {},
        }),
      ).toThrow();
    });

    it('should reject non-integer refreshTtlDays', () => {
      expect(() =>
        updateSystemSettingsSchema.parse({
          ui: {
            allowUserThemeOverride: true,
          },
          security: {
            jwtAccessTtlMinutes: 15,
            refreshTtlDays: 14.5,
          },
          features: {},
        }),
      ).toThrow();
    });

    it('should require security field', () => {
      expect(() =>
        updateSystemSettingsSchema.parse({
          ui: {
            allowUserThemeOverride: true,
          },
          features: {},
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
        security: {
          jwtAccessTtlMinutes: 15,
          refreshTtlDays: 14,
        },
        features: {},
      });

      expect(result.features).toEqual({});
    });

    it('should accept features with boolean flags', () => {
      const result = updateSystemSettingsSchema.parse({
        ui: {
          allowUserThemeOverride: true,
        },
        security: {
          jwtAccessTtlMinutes: 15,
          refreshTtlDays: 14,
        },
        features: {
          enableNotifications: true,
          enableAnalytics: false,
        },
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
          security: {
            jwtAccessTtlMinutes: 15,
            refreshTtlDays: 14,
          },
          features: {
            enableNotifications: 'true',
          },
        }),
      ).toThrow();
    });

    it('should require features field', () => {
      expect(() =>
        updateSystemSettingsSchema.parse({
          ui: {
            allowUserThemeOverride: true,
          },
          security: {
            jwtAccessTtlMinutes: 15,
            refreshTtlDays: 14,
          },
        }),
      ).toThrow();
    });
  });

  describe('complete settings object', () => {
    it('should accept valid complete settings', () => {
      const result = updateSystemSettingsSchema.parse({
        ui: {
          allowUserThemeOverride: true,
        },
        security: {
          jwtAccessTtlMinutes: 20,
          refreshTtlDays: 30,
        },
        features: {
          enableNotifications: true,
          enableAdvancedFeatures: false,
        },
      });

      expect(result).toEqual({
        ui: {
          allowUserThemeOverride: true,
        },
        security: {
          jwtAccessTtlMinutes: 20,
          refreshTtlDays: 30,
        },
        features: {
          enableNotifications: true,
          enableAdvancedFeatures: false,
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

  describe('security field', () => {
    it('should make security field optional', () => {
      const result = patchSystemSettingsSchema.parse({});

      expect(result.security).toBeUndefined();
    });

    it('should accept partial security settings - only jwtAccessTtlMinutes', () => {
      const result = patchSystemSettingsSchema.parse({
        security: {
          jwtAccessTtlMinutes: 25,
        },
      });

      expect(result.security?.jwtAccessTtlMinutes).toBe(25);
      expect(result.security?.refreshTtlDays).toBeUndefined();
    });

    it('should accept partial security settings - only refreshTtlDays', () => {
      const result = patchSystemSettingsSchema.parse({
        security: {
          refreshTtlDays: 60,
        },
      });

      expect(result.security?.refreshTtlDays).toBe(60);
      expect(result.security?.jwtAccessTtlMinutes).toBeUndefined();
    });

    it('should accept empty security object', () => {
      const result = patchSystemSettingsSchema.parse({
        security: {},
      });

      expect(result.security).toEqual({});
    });

    it('should validate jwtAccessTtlMinutes range when provided', () => {
      expect(() =>
        patchSystemSettingsSchema.parse({
          security: {
            jwtAccessTtlMinutes: 0,
          },
        }),
      ).toThrow();
    });

    it('should validate refreshTtlDays range when provided', () => {
      expect(() =>
        patchSystemSettingsSchema.parse({
          security: {
            refreshTtlDays: 100,
          },
        }),
      ).toThrow();
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

    it('should accept update with only security field', () => {
      const result = patchSystemSettingsSchema.parse({
        security: {
          jwtAccessTtlMinutes: 10,
        },
      });

      expect(result).toEqual({
        security: {
          jwtAccessTtlMinutes: 10,
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
      });

      expect(result).toEqual({
        ui: {
          allowUserThemeOverride: false,
        },
        features: {
          experimental: true,
        },
      });
    });
  });
});

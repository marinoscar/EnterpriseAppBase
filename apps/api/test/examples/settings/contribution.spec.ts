// =============================================================================
// A package's settings contribution, imported for its side effect (PP-14.21)
// =============================================================================
//
// `platform-extensions/settings/contribution.ts` is written the way a package
// would write its entry module. These specs import it exactly as
// `app-registrations/settings-contributions.ts` would, assemble the registries
// with the real manifests and check the documented order and the collision
// message. Each case runs in its own module registry because the registries are
// module-level and freeze once an application bootstraps.
// =============================================================================

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */

const NO_APP = {
  APP_SYSTEM_SETTINGS_NAMESPACES: [] as unknown[],
  APP_USER_SETTINGS_NAMESPACES: [] as unknown[],
  APP_SYSTEM_SETTINGS_EXTENSIONS: [] as unknown[],
  APP_USER_SETTINGS_EXTENSIONS: [] as unknown[],
  APP_SYSTEM_SETTINGS_DEFAULT_OVERRIDES: [] as unknown[],
};

function inFreshRegistry(app: Partial<typeof NO_APP>, fn: () => void): void {
  jest.isolateModules(() => {
    jest.doMock('../../../src/app-registrations/settings', () => ({ ...NO_APP, ...app }));
    try {
      fn();
    } finally {
      jest.dontMock('../../../src/app-registrations/settings');
    }
  });
}

describe('a settings contribution', () => {
  it('without it the reference app registers exactly the platform namespaces', () => {
    inFreshRegistry({}, () => {
      require('../../../src/settings/registry/composed');
      const { systemSettingsNamespaceRegistry, userSettingsNamespaceRegistry, settingsContributionRegistry } = require('@marinoscar/platform-api/settings');
      expect(systemSettingsNamespaceRegistry.ids()).toEqual(['notifications', 'jobs', 'nodes', 'databaseBackup', 'maintenance', 'storage', 'ai', 'telemetry', 'retention']);
      expect(userSettingsNamespaceRegistry.ids()).toEqual(['dataTables', 'navigation', 'notifications', 'ai', 'onboarding']);
      expect(settingsContributionRegistry.size).toBe(0);
    });
  });

  it('adds its namespaces after the platform\'s and before the app\'s, and extends the platform\'s', () => {
    const appNamespace = {
      key: 'appOwned',
      description: 'An app namespace.',
      storedSchema: require('zod').z.object({ on: require('zod').z.boolean() }),
      patchSchema: require('zod').z.object({ on: require('zod').z.boolean().optional() }),
      putSchema: require('zod').z.object({ on: require('zod').z.boolean() }),
      wirePatchSchema: require('zod').z.object({ on: require('zod').z.boolean().optional() }),
      responseSchema: null,
      defaults: { on: false },
      requiredOnPut: false,
      merge: (current: object, patch: object) => ({ ...current, ...patch }),
    };
    inFreshRegistry({ APP_SYSTEM_SETTINGS_NAMESPACES: [appNamespace] }, () => {
      require('../../../src/platform-extensions/settings/contribution');
      require('../../../src/settings/registry/composed');
      const { systemSettingsNamespaceRegistry, userSettingsNamespaceRegistry } = require('@marinoscar/platform-api/settings');
      const keys: string[] = systemSettingsNamespaceRegistry.ids();
      expect(keys.slice(-2)).toEqual(['quotaPolicy', 'appOwned']);
      expect(userSettingsNamespaceRegistry.ids().slice(-1)).toEqual(['quotaView']);
      const telemetry = systemSettingsNamespaceRegistry.get('telemetry');
      expect(Object.keys(telemetry.storedSchema.shape.assistant.shape)).toContain('citations');
      expect(telemetry.defaults.assistant.citations).toBe(true);
      expect(systemSettingsNamespaceRegistry.get('quotaPolicy').org.readPermission).toBe('org_settings:read');
    });
  });

  it('fails the import naming the contribution when it declares a key the platform already has', () => {
    inFreshRegistry({}, () => {
      const { registerSettingsContribution } = require('@marinoscar/platform-api/settings');
      const { QUOTA_SYSTEM_SETTINGS } = require('../../../src/platform-extensions/settings/contribution');
      registerSettingsContribution({ id: '@example/clash', system: [{ ...QUOTA_SYSTEM_SETTINGS, key: 'storage' }] });
      expect(() => require('../../../src/settings/registry/composed')).toThrow(
        /System settings namespace "storage" is already registered: settings contribution "@example\/clash" declares it, but the platform already does/,
      );
    });
  });

  it('fails the import naming the key when an app namespace clashes with a contribution\'s', () => {
    inFreshRegistry({}, () => {
      const { QUOTA_SYSTEM_SETTINGS } = require('../../../src/platform-extensions/settings/contribution');
      jest.doMock('../../../src/app-registrations/settings', () => ({ ...NO_APP, APP_SYSTEM_SETTINGS_NAMESPACES: [QUOTA_SYSTEM_SETTINGS] }));
      expect(() => require('../../../src/settings/registry/composed')).toThrow(
        /"quotaPolicy" is already registered: the app declares it, but settings contribution "@example\/quota-settings" already does/,
      );
    });
  });

  it('fails the import, naming the key, when a contribution extends a namespace nobody declares', () => {
    inFreshRegistry({}, () => {
      const { registerSettingsContribution } = require('@marinoscar/platform-api/settings');
      registerSettingsContribution({
        id: '@example/lost',
        extensions: { system: [{ key: 'ghost', storedSchema: require('zod').z.object({ a: require('zod').z.string().max(3) }), defaults: { a: '' } }] },
      });
      expect(() => require('../../../src/settings/registry/composed')).toThrow(/Cannot extend system settings namespace "ghost": no such namespace/);
    });
  });

  it('a contribution imported twice is refused, naming the package', () => {
    inFreshRegistry({}, () => {
      const { registerSettingsContribution } = require('@marinoscar/platform-api/settings');
      registerSettingsContribution({ id: '@example/dup' });
      expect(() => registerSettingsContribution({ id: '@example/dup' })).toThrow(/"@example\/dup" is already registered: the package was imported twice/);
    });
  });
});

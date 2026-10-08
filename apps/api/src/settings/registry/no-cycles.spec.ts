// =============================================================================
// Settings registry import-cycle guard (issue #677)
// =============================================================================
//
// The composed settings objects import the manifests, the manifests import the
// namespace declaration files, and those import the per-namespace leaf
// schemas. Under CommonJS a cycle in that graph hands some module `undefined`
// at load time, and which module depends on which file happens to be loaded
// FIRST. So each entry point below is loaded first, in a fresh module registry,
// and every export it promises is checked.
//
// A failure means a leaf (a `*.schema.ts`, `*.schemas.ts` or declaration file)
// now imports something that imports `composed.ts`. Make it import the leaf it
// needs instead; see the import-cycle rule at the top of `composed.ts`.
// =============================================================================

const SYSTEM_KEYS = ['notifications', 'jobs', 'nodes', 'databaseBackup', 'maintenance', 'storage', 'ai', 'telemetry', 'retention'];
const USER_KEYS = ['dataTables', 'navigation', 'notifications', 'ai', 'onboarding'];

type Exports = Record<string, unknown>;

function keysOf(schema: unknown): string[] {
  return Object.keys((schema as { shape: Record<string, unknown> }).shape);
}

const ENTRY_POINTS: Array<[string, string, (mod: Exports) => void]> = [
  [
    'settings/registry/composed.ts',
    './composed',
    (mod) => {
      expect(keysOf(mod.systemSettingsSchema)).toEqual(SYSTEM_KEYS);
      expect(keysOf(mod.systemSettingsPatchSchema)).toEqual(SYSTEM_KEYS);
      expect(keysOf(mod.composedUpdateSystemSettingsSchema)).toEqual(SYSTEM_KEYS);
      expect(keysOf(mod.composedPatchSystemSettingsSchema)).toEqual(SYSTEM_KEYS);
      expect(Object.keys(mod.DEFAULT_SYSTEM_SETTINGS as object)).toEqual(SYSTEM_KEYS);
      expect(keysOf(mod.userSettingsSchema)).toEqual(['theme', 'profile', ...USER_KEYS]);
      expect(keysOf(mod.userSettingsPatchSchema)).toEqual(['theme', 'profile', ...USER_KEYS]);
    },
  ],
  [
    'common/types/settings.types.ts',
    '../../common/types/settings.types',
    (mod) => {
      expect(Object.keys(mod.DEFAULT_SYSTEM_SETTINGS as object)).toEqual(SYSTEM_KEYS);
      for (const key of SYSTEM_KEYS) {
        expect((mod.DEFAULT_SYSTEM_SETTINGS as Exports)[key]).toBeDefined();
      }
      expect(mod.DEFAULT_USER_SETTINGS).toBeDefined();
    },
  ],
  [
    // The request bodies and responses, composed in the app's snapshot since
    // #733 (the routes' DTOs are composed by `SettingsModule.forRoot()`).
    'settings/registry/composed.ts (request bodies and responses)',
    './composed',
    (mod) => {
      expect(keysOf(mod.updateSystemSettingsSchema)).toEqual(SYSTEM_KEYS);
      expect(keysOf(mod.patchSystemSettingsSchema)).toEqual(SYSTEM_KEYS);
      expect(keysOf(mod.systemSettingsResponseSchema)).toEqual([
        'security',
        ...SYSTEM_KEYS.filter((key) => key !== 'telemetry'),
        'updatedAt',
        'updatedBy',
        'version',
      ]);
      expect(keysOf(mod.updateUserSettingsSchema)).toEqual(['theme', 'profile', ...USER_KEYS]);
      expect(keysOf(mod.patchUserSettingsSchema)).toEqual(['theme', 'profile', ...USER_KEYS]);
      expect(keysOf(mod.userSettingsResponseSchema)).toEqual([
        'theme',
        'profile',
        ...USER_KEYS.filter((key) => key !== 'ai'),
        'updatedAt',
        'version',
      ]);
    },
  ],
  [
    // `SettingsModule.forRoot()` composes the routes' DTOs when this loads:
    // loaded first, it must still see every namespace.
    'platform/settings/settings.config.ts',
    '../../platform/settings/settings.config',
    (mod) => {
      expect(mod.SettingsModule).toBeDefined();
    },
  ],
  [
    'settings/registry/index.ts',
    './index',
    (mod) => {
      expect(keysOf(mod.systemSettingsSchema)).toEqual(SYSTEM_KEYS);
    },
  ],
];

describe('settings registry import graph has no load-order cycle (#677)', () => {
  it.each(ENTRY_POINTS)('%s loaded first exposes every export, fully composed', (_name, path, check) => {
    jest.isolateModules(() => {
      // A plain require on purpose: the point is to control load order.
      const mod = require(path) as Exports;
      for (const [name, value] of Object.entries(mod)) {
        expect({ name, defined: value !== undefined }).toEqual({ name, defined: true });
      }
      check(mod);
    });
  });

  it.each([
    '../../platform/jobs/jobs.system-settings',
    '../../platform/jobs/nodes.system-settings',
    '../../db-backup/db-backup.system-settings',
    '../../common/maintenance/maintenance.system-settings',
    '../../platform/storage/storage.system-settings',
    '../../ai/ai.system-settings',
    '../../platform/telemetry/telemetry.system-settings',
    '../../common/retention/retention.system-settings',
    '../../ai/ai.user-settings',
  ])('the declaration file %s is a leaf: loaded first, every schema it names is defined', (path) => {
    jest.isolateModules(() => {
      const mod = require(path) as Record<string, Record<string, unknown>>;
      const declarations = Object.values(mod);
      expect(declarations.length).toBeGreaterThan(0);
      for (const declaration of declarations) {
        for (const field of ['storedSchema', 'schema', 'patchSchema', 'putSchema', 'wirePatchSchema']) {
          if (field in declaration) expect({ field, defined: declaration[field] !== undefined }).toEqual({ field, defined: true });
        }
      }
    });
  });

  // The notifications declarations are the package's since #738: loaded first
  // on its own, every schema they name is defined.
  it('the packaged notifications declarations are leaves: loaded first, every schema they name is defined', () => {
    jest.isolateModules(() => {
      const mod = require('@marinoscar/platform-api/notifications') as Record<string, Record<string, unknown>>;
      for (const declaration of [mod.NOTIFICATIONS_SYSTEM_SETTINGS, mod.NOTIFICATIONS_USER_SETTINGS]) {
        expect(declaration).toBeDefined();
        for (const field of ['storedSchema', 'schema', 'patchSchema', 'putSchema', 'wirePatchSchema']) {
          if (field in declaration!) expect({ field, defined: declaration![field] !== undefined }).toEqual({ field, defined: true });
        }
      }
    });
  });
});

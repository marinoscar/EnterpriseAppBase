import { z } from 'zod';
import { RegistryError, withTemporaryEntries } from '../../common/registry';
import {
  composeDefaultSystemSettings,
  composePatchSystemSettingsSchema,
  composeSystemSettingsResponseValue,
  composeSystemSettingsSchema,
  composeUpdateSystemSettingsSchema,
  composeUserSettingsSchemas,
  currentSystemSettingsSchema,
  currentUserSettingsSchema,
} from './compose';
import { DEFAULT_SYSTEM_SETTINGS, systemSettingsSchema } from './composed';
import {
  extendSystemSettingsNamespace,
  extendUserSettingsNamespace,
  foldSettingsExtensions,
} from './extend';
import { findDefaultPaths, findSecretFieldPaths } from './schema-walk';
import {
  systemSettingsNamespaceRegistry,
  type SystemSettingsNamespace,
} from './system-settings-namespace';
import {
  userSettingsNamespaceRegistry,
  type UserSettingsNamespace,
} from './user-settings-namespace';

// =============================================================================
// Settings namespace registries (issue #677)
// =============================================================================

/** A minimal, valid system namespace; override any field per test. */
function systemNamespace(overrides: Partial<SystemSettingsNamespace> = {}): SystemSettingsNamespace {
  return {
    key: 'probe',
    description: 'A test-only namespace.',
    storedSchema: z.object({ enabled: z.boolean(), level: z.number().int() }),
    patchSchema: z.object({ enabled: z.boolean().optional(), level: z.number().int().optional() }),
    putSchema: z.object({ enabled: z.boolean(), level: z.number().int() }),
    wirePatchSchema: z.object({ enabled: z.boolean().optional(), level: z.number().int().optional() }),
    responseSchema: z.object({ enabled: z.boolean(), level: z.number() }),
    defaults: { enabled: false, level: 1 },
    requiredOnPut: false,
    merge: (current, patch) => {
      const c = current as { enabled: boolean; level: number };
      const p = patch as { enabled?: boolean; level?: number } | undefined;
      return { enabled: p?.enabled ?? c.enabled, level: p?.level ?? c.level };
    },
    ...overrides,
  };
}

/** A minimal, valid user namespace; override any field per test. */
function userNamespace(overrides: Partial<UserSettingsNamespace> = {}): UserSettingsNamespace {
  return {
    key: 'probe',
    description: 'A test-only user namespace.',
    schema: z.object({ pinned: z.array(z.string().max(32)).max(10) }),
    patchSchema: z.object({ pinned: z.array(z.string().max(32)).max(10).nullable().optional() }),
    merge: (current, patch) => (patch === undefined ? current : patch === null ? undefined : patch),
    ...overrides,
  };
}

function registrationError(fn: () => void): RegistryError {
  try {
    fn();
  } catch (err) {
    if (err instanceof RegistryError) return err;
    throw err;
  }
  throw new Error('expected registration to fail');
}

describe('settings namespace registries (#677)', () => {
  describe('platform registration', () => {
    it('registers the nine system namespaces in the pre-registry key order', () => {
      expect(systemSettingsNamespaceRegistry.ids()).toEqual([
        'notifications',
        'jobs',
        'nodes',
        'databaseBackup',
        'maintenance',
        'storage',
        'ai',
        'telemetry',
        'retention',
      ]);
    });

    it('registers the four optional user namespaces in the pre-registry key order', () => {
      expect(userSettingsNamespaceRegistry.ids()).toEqual(['dataTables', 'navigation', 'notifications', 'ai']);
    });

    it('marks only notifications as required on PUT', () => {
      expect(
        systemSettingsNamespaceRegistry
          .list()
          .filter((ns) => ns.requiredOnPut)
          .map((ns) => ns.key),
      ).toEqual(['notifications']);
    });

    it('gives every namespace a description', () => {
      for (const ns of [...systemSettingsNamespaceRegistry.list(), ...userSettingsNamespaceRegistry.list()]) {
        expect(ns.description.length).toBeGreaterThan(10);
      }
    });
  });

  describe('validation (refused when the manifest registers the entry)', () => {
    it.each([
      ['secret', z.object({ secret: z.string() })],
      ['password', z.object({ smtp: z.object({ password: z.string() }) })],
      ['apiKey (any case)', z.object({ ApiKey: z.string() })],
      ['token nested in an optional array of objects', z.object({ hooks: z.array(z.object({ token: z.string() })).optional() })],
      ['secretAccessKey in a record value', z.object({ buckets: z.record(z.string(), z.object({ secretAccessKey: z.string() })) })],
      ['sessionToken', z.object({ sessionToken: z.string().nullable() })],
      ['secretKey', z.object({ secretKey: z.string() })],
    ])('rejects a system namespace whose stored schema declares %s', (_label, storedSchema) => {
      const err = registrationError(() =>
        systemSettingsNamespaceRegistry.register(
          systemNamespace({ storedSchema, read: () => ({}), defaults: {} }),
        ),
      );
      expect(err.code).toBe('INVALID_ENTRY');
      expect(err.message).toMatch(/secret-named field/);
      expect(systemSettingsNamespaceRegistry.has('probe')).toBe(false);
    });

    it('rejects a secret-named field in a request-body branch too', () => {
      const err = registrationError(() =>
        systemSettingsNamespaceRegistry.register(
          systemNamespace({ wirePatchSchema: z.object({ apiKey: z.string().optional() }) }),
        ),
      );
      expect(err.message).toMatch(/wirePatchSchema declares secret-named field\(s\) apiKey/);
    });

    it('accepts identifiers that merely contain a secret word (accessKeyId, keyPolicy, requiresKey)', () => {
      expect(
        findSecretFieldPaths(
          z.object({ accessKeyId: z.string(), keyPolicy: z.string(), requiresKey: z.boolean(), maxTokens: z.number() }),
          ['secret', 'token', 'apiKey'],
        ),
      ).toEqual([]);
    });

    it('rejects a duplicate key', () => {
      const err = registrationError(() => systemSettingsNamespaceRegistry.register(systemNamespace({ key: 'jobs' })));
      expect(err.code).toBe('DUPLICATE_ID');
      expect(err.message).toMatch(/already registered.*extendSystemSettingsNamespace/);
    });

    it.each(['Jobs', 'my-namespace', '1st', 'with space', 'snake_case', ''])('rejects the key %j', (key) => {
      const err = registrationError(() => systemSettingsNamespaceRegistry.register(systemNamespace({ key })));
      expect(err.code).toBe('INVALID_ID');
    });

    it.each(['security', 'updatedAt', 'updatedBy', 'version'])('rejects the reserved system key %s', (key) => {
      const err = registrationError(() => systemSettingsNamespaceRegistry.register(systemNamespace({ key })));
      expect(err.code).toBe('INVALID_ENTRY');
    });

    it.each(['theme', 'profile', 'updatedAt', 'version'])('rejects the reserved user key %s', (key) => {
      const err = registrationError(() => userSettingsNamespaceRegistry.register(userNamespace({ key })));
      expect(err.code).toBe('INVALID_ENTRY');
    });

    it.each([
      ['storedSchema', { storedSchema: undefined }],
      ['patchSchema', { patchSchema: undefined }],
      ['putSchema', { putSchema: undefined }],
      ['wirePatchSchema', { wirePatchSchema: undefined }],
      ['responseSchema', { responseSchema: undefined }],
      ['defaults', { defaults: undefined }],
      ['merge', { merge: undefined }],
      ['description', { description: '' }],
      ['requiredOnPut', { requiredOnPut: undefined }],
    ])('rejects a system namespace without %s', (_field, overrides) => {
      const err = registrationError(() =>
        systemSettingsNamespaceRegistry.register(systemNamespace(overrides as unknown as Partial<SystemSettingsNamespace>)),
      );
      expect(err.code).toBe('INVALID_ENTRY');
    });

    it('rejects defaults that do not satisfy the stored schema', () => {
      const err = registrationError(() =>
        systemSettingsNamespaceRegistry.register(systemNamespace({ defaults: { enabled: 'yes', level: 1 } })),
      );
      expect(err.message).toMatch(/defaults do not satisfy storedSchema/);
    });

    it('rejects a non-object stored schema without its own read', () => {
      const err = registrationError(() =>
        systemSettingsNamespaceRegistry.register(
          systemNamespace({ storedSchema: z.record(z.string(), z.boolean()), defaults: {} }),
        ),
      );
      expect(err.message).toMatch(/must be a z.object unless the namespace declares its own read/);
    });

    it('rejects .default() anywhere in a user namespace', () => {
      const err = registrationError(() =>
        userSettingsNamespaceRegistry.register(
          userNamespace({ schema: z.object({ pinned: z.array(z.string()).default([]) }) }),
        ),
      );
      expect(err.message).toMatch(/carries \.default\(\) at pinned/);
      expect(findDefaultPaths(z.object({ a: z.object({ b: z.number().prefault(1) }) }))).toEqual(['a.b']);
    });

    it('rejects a secret-named field in a user namespace', () => {
      const err = registrationError(() =>
        userSettingsNamespaceRegistry.register(userNamespace({ schema: z.object({ token: z.string() }) })),
      );
      expect(err.message).toMatch(/secret-named field\(s\) token/);
    });

    it('refuses a bad entry at import time, from the app-owned file, naming the namespace', () => {
      jest.isolateModules(() => {
        jest.doMock('../../app-registrations/settings', () => ({
          APP_SYSTEM_SETTINGS_NAMESPACES: [systemNamespace({ key: 'coach', storedSchema: z.object({ apiKey: z.string() }), read: () => ({}), defaults: { apiKey: '' } })],
          APP_USER_SETTINGS_NAMESPACES: [],
          APP_SYSTEM_SETTINGS_EXTENSIONS: [],
          APP_USER_SETTINGS_EXTENSIONS: [],
        }));
        expect(() => require('./composed')).toThrow(/Invalid entry "coach".*secret-named field\(s\) apiKey/);
      });
      jest.dontMock('../../app-registrations/settings');
    });

    it('refuses, at import time, an app namespace whose key collides with a platform one', () => {
      jest.isolateModules(() => {
        jest.doMock('../../app-registrations/settings', () => ({
          APP_SYSTEM_SETTINGS_NAMESPACES: [systemNamespace({ key: 'storage' })],
          APP_USER_SETTINGS_NAMESPACES: [],
          APP_SYSTEM_SETTINGS_EXTENSIONS: [],
          APP_USER_SETTINGS_EXTENSIONS: [],
        }));
        expect(() => require('./composed')).toThrow(/System settings namespace "storage" is already registered/);
      });
      jest.dontMock('../../app-registrations/settings');
    });
  });

  describe('composition', () => {
    it('composes every schema in registration order, and the PUT body from requiredOnPut', () => {
      const a = systemNamespace({ key: 'alpha', requiredOnPut: true });
      const b = systemNamespace({ key: 'beta', responseSchema: null });
      const list = [b, a];

      expect(Object.keys(composeSystemSettingsSchema(list).shape)).toEqual(['beta', 'alpha']);
      expect(Object.keys(composeSystemSettingsResponseValue(list))).toEqual(['alpha']);
      expect(composeDefaultSystemSettings(list)).toEqual({ beta: { enabled: false, level: 1 }, alpha: { enabled: false, level: 1 } });

      const put = composeUpdateSystemSettingsSchema(list);
      expect(put.safeParse({ alpha: { enabled: true, level: 2 } }).success).toBe(true);
      expect(put.safeParse({ beta: { enabled: true, level: 2 } }).success).toBe(false);

      const patch = composePatchSystemSettingsSchema(list);
      expect(patch.parse({ beta: { level: 3 }, gamma: 1 })).toEqual({ beta: { level: 3 } });
    });

    it('composes user namespaces optional, patch branches nullable, and leaves null responses out', () => {
      const shapes = composeUserSettingsSchemas([userNamespace({ key: 'one' }), userNamespace({ key: 'two', responseSchema: null })]);
      const stored = z.object(shapes.stored);
      expect(stored.parse({})).toEqual({});
      expect(z.object(shapes.patch).parse({ one: null })).toEqual({ one: null });
      expect(Object.keys(shapes.response)).toEqual(['one']);
      expect(Object.keys(shapes.put)).toEqual(['one', 'two']);
    });

    it('DEFAULT_SYSTEM_SETTINGS is every namespace default, and satisfies the composed schema', () => {
      expect(Object.keys(DEFAULT_SYSTEM_SETTINGS)).toEqual(systemSettingsNamespaceRegistry.ids());
      for (const ns of systemSettingsNamespaceRegistry.list()) {
        expect((DEFAULT_SYSTEM_SETTINGS as unknown as Record<string, unknown>)[ns.key]).toBe(ns.defaults);
      }
      expect(() => systemSettingsSchema.parse(DEFAULT_SYSTEM_SETTINGS)).not.toThrow();
    });

    it('the per-request schemas follow the registry, and fall back to the cached one afterwards', async () => {
      const before = currentSystemSettingsSchema();
      expect(currentSystemSettingsSchema()).toBe(before);

      await withTemporaryEntries(systemSettingsNamespaceRegistry, [systemNamespace()], () => {
        expect(Object.keys(currentSystemSettingsSchema().shape)).toContain('probe');
      });
      await withTemporaryEntries(userSettingsNamespaceRegistry, [userNamespace()], () => {
        expect(Object.keys(currentUserSettingsSchema().shape)).toEqual([
          'theme',
          'profile',
          'dataTables',
          'navigation',
          'notifications',
          'ai',
          'probe',
        ]);
      });

      expect(Object.keys(currentSystemSettingsSchema().shape)).not.toContain('probe');
    });
  });

  describe('namespace extension (an app adds fields inside a platform namespace)', () => {
    const base = userSettingsNamespaceRegistry.require('ai');
    const extended = extendUserSettingsNamespace(base, {
      key: 'ai',
      schema: z.object({ training: z.object({ weeklyGoal: z.number().int().min(1).max(14) }) }),
    });

    it('validates a base field and an app field side by side', () => {
      const value = { defaultModel: { provider: 'openai', modelId: 'm-1' }, training: { weeklyGoal: 3 } };
      expect(extended.schema.parse(value)).toEqual(value);
      expect(extended.schema.safeParse({ ...value, training: { weeklyGoal: 99 } }).success).toBe(false);
      expect(extended.schema.safeParse({ defaultModel: 'x', training: { weeklyGoal: 3 } }).success).toBe(false);
    });

    it('merges the base field with the base merge and keeps the app field', () => {
      const current = { defaultModel: { provider: 'openai', modelId: 'm-1' }, training: { weeklyGoal: 3 } };
      expect(extended.merge(current, { defaultModel: null })).toEqual({ defaultModel: null, training: { weeklyGoal: 3 } });
      expect(extended.merge(current, { defaultModel: current.defaultModel, training: { weeklyGoal: 5 } })).toEqual({
        defaultModel: current.defaultModel,
        training: { weeklyGoal: 5 },
      });
      expect(extended.merge(current, { defaultModel: null, training: null })).toEqual({ defaultModel: null });
      expect(extended.merge(current, null)).toBeUndefined();
      expect(extended.merge(current, undefined)).toBe(current);
    });

    it('registers in place of the base and round-trips through the composed user schema', async () => {
      await withTemporaryEntries(userSettingsNamespaceRegistry, [], () => {
        // The manifest folds extensions before registering; emulate that.
        const { platform } = foldSettingsExtensions(
          { platform: [base], app: [] },
          [{ key: 'ai', schema: z.object({ training: z.object({ weeklyGoal: z.number().int() }) }) }],
          extendUserSettingsNamespace,
          'user settings',
        );
        const schema = z.object(composeUserSettingsSchemas(platform).stored);
        expect(schema.parse({ ai: { defaultModel: null, training: { weeklyGoal: 2 } } })).toEqual({
          ai: { defaultModel: null, training: { weeklyGoal: 2 } },
        });
      });
    });

    it('extends a system namespace: schemas, defaults, merge and salvage', async () => {
      const jobs = systemSettingsNamespaceRegistry.require('jobs');
      const ext = extendSystemSettingsNamespace(jobs, {
        key: 'jobs',
        storedSchema: z.object({ digestEnabled: z.boolean() }),
        defaults: { digestEnabled: false },
      });

      expect(ext.defaults).toEqual({ ...(jobs.defaults as object), digestEnabled: false });
      expect(ext.storedSchema.safeParse(ext.defaults).success).toBe(true);
      expect(ext.wirePatchSchema.parse({ digestEnabled: true, stuckThresholdMinutes: 5 })).toEqual({
        digestEnabled: true,
        stuckThresholdMinutes: 5,
      });
      expect(ext.merge(ext.defaults, { digestEnabled: true })).toEqual({ ...(jobs.defaults as object), digestEnabled: true });
      await withTemporaryEntries(systemSettingsNamespaceRegistry, [{ ...ext, key: 'jobsCopy' }], () => {
        expect(systemSettingsNamespaceRegistry.has('jobsCopy')).toBe(true);
      });
      const composed = composeSystemSettingsSchema([ext]).shape as Record<string, z.ZodObject<z.ZodRawShape>>;
      expect(Object.keys(composed.jobs.shape)).toEqual(['history', 'stuckThresholdMinutes', 'digestEnabled']);
    });

    it('keeps a base salvage (ai) for the base fields and salvages the app fields field by field', () => {
      const ai = systemSettingsNamespaceRegistry.require('ai');
      const ext = extendSystemSettingsNamespace(ai, {
        key: 'ai',
        storedSchema: z.object({ coachEnabled: z.boolean() }),
        defaults: { coachEnabled: false },
      });
      const helpers = {
        asPlainObject: (v: unknown) =>
          v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined,
        readNamespace: <T extends Record<string, unknown>>(stored: unknown, schema: z.ZodObject<z.ZodRawShape>, defaults: T) => {
          const source = (stored ?? {}) as Record<string, unknown>;
          return Object.fromEntries(
            Object.entries(schema.shape).map(([k, f]) => {
              const parsed = (f as z.ZodType).safeParse(source[k]);
              return [k, parsed.success ? parsed.data : defaults[k]];
            }),
          ) as T;
        },
        readDisabledEvents: () => [],
      };
      const read = ext.read!({ enabled: true, coachEnabled: 'nope' }, helpers) as Record<string, unknown>;
      expect(read.enabled).toBe(true);
      expect(read.coachEnabled).toBe(false);
    });

    it('refuses an extension that redeclares a base field, or names an unknown namespace', () => {
      expect(() =>
        extendUserSettingsNamespace(base, { key: 'ai', schema: z.object({ defaultModel: z.string() }) }),
      ).toThrow(/already declares "defaultModel"/);
      expect(() =>
        foldSettingsExtensions(
          { platform: [base], app: [] },
          [{ key: 'coach', schema: z.object({ x: z.boolean() }) }],
          extendUserSettingsNamespace,
          'user settings',
        ),
      ).toThrow(/Cannot extend user settings namespace "coach": no such namespace/);
      expect(() =>
        extendUserSettingsNamespace(userSettingsNamespaceRegistry.require('dataTables'), {
          key: 'dataTables',
          schema: z.object({ x: z.boolean() }),
        }),
      ).toThrow(/must be a z.object to be extended/);
    });
  });
});

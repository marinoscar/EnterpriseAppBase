// The core user fields `profile` and `theme` as extension points (PP-14.21):
// `extendUserProfile` and `registerThemePreference`, their composition into the
// request bodies and the response, and `UserSettingsService` carrying them.
import { themePreferenceSchema, userProfileSettingsPatchSchema, userProfileSettingsSchema } from '@marinoscar/platform-contract/settings';
import { z } from 'zod';

import { withTemporaryEntries } from '../../src/core/index';
import {
  UserSettingsService,
  extendUserProfile,
  registerThemePreference,
  themePreferenceRegistry,
  userProfileFieldRegistry,
} from '../../src/settings/index';
import {
  composePatchUserSettingsSchema,
  composeUpdateUserSettingsSchema,
  composeUserSettingsResponseSchema,
  composeUserSettingsSchema,
} from '../../src/settings/registry/compose';
import { composeThemeSchema, composeUserProfilePatchSchema, composeUserProfileSchema } from '../../src/settings/registry/core-user-fields';

const TZ = z.string().max(64).optional();

/** An in-memory `user_settings` table for one user, and the two host ports. */
function makeService() {
  let row: { value: Record<string, unknown>; version: number; updatedAt: Date } | null = null;
  const userSettings = {
    findUnique: jest.fn(async () => row),
    create: jest.fn(async ({ data }: { data: { value: Record<string, unknown> } }) => (row = { value: data.value, version: 1, updatedAt: new Date() })),
    upsert: jest.fn(async ({ create, update }: { create: { value: Record<string, unknown> }; update: { value: Record<string, unknown> } }) => {
      row = row ? { value: update.value, version: row.version + 1, updatedAt: new Date() } : { value: create.value, version: 1, updatedAt: new Date() };
      return row;
    }),
    update: jest.fn(async ({ data }: { data: { value: Record<string, unknown> } }) => (row = { value: data.value, version: (row?.version ?? 0) + 1, updatedAt: new Date() })),
  };
  const prisma = { userSettings, user: { update: jest.fn(async () => ({})) } };
  const profileImages = {
    normalize: (stored: unknown) => {
      const profile = (stored ?? {}) as { displayName?: string; imageSource?: 'none' | 'provider' | 'upload'; imageObjectId?: string | null };
      return {
        ...(profile.displayName !== undefined ? { displayName: profile.displayName } : {}),
        imageSource: profile.imageSource ?? 'provider',
        imageObjectId: profile.imageObjectId ?? null,
      };
    },
    isUploadedAvatar: jest.fn(async () => true),
  };
  const service = new UserSettingsService(prisma as never, { invalidate: jest.fn() } as never, profileImages as never);
  return { service, userSettings, setStored: (value: Record<string, unknown>) => (row = { value, version: 1, updatedAt: new Date() }) };
}

const USER = '11111111-1111-4111-8111-111111111111';

describe('with nothing registered the core fields are the contract schemas', () => {
  it('composes the contract profile, patch and theme schemas themselves', () => {
    expect(composeUserProfileSchema()).toBe(userProfileSettingsSchema);
    expect(composeUserProfilePatchSchema()).toBe(userProfileSettingsPatchSchema);
    expect(composeThemeSchema()).toBe(themePreferenceSchema);
  });

  it('keeps the response free of themeOptions', async () => {
    const { service } = makeService();
    const response = await service.getSettings(USER);
    expect(Object.keys(response)).toEqual(['theme', 'profile', 'updatedAt', 'version']);
    expect(Object.keys(composeUserSettingsResponseSchema().shape)).not.toContain('themeOptions');
  });
});

describe('extendUserProfile', () => {
  it('validates, patches (null deletes), keeps and returns the added field', async () => {
    await withTemporaryEntries(userProfileFieldRegistry, [], async () => {
      extendUserProfile({ fields: z.object({ timezone: TZ }) });
      const { service } = makeService();
      await service.getSettings(USER);

      const set = await service.patchSettings(USER, { profile: { timezone: 'Europe/Paris' } } as never);
      expect(set.profile).toMatchObject({ timezone: 'Europe/Paris', imageSource: 'provider', imageObjectId: null });

      // An unrelated profile write keeps it.
      const renamed = await service.patchSettings(USER, { profile: { displayName: 'Ada' } } as never);
      expect(renamed.profile).toMatchObject({ timezone: 'Europe/Paris', displayName: 'Ada' });
      // A theme write keeps it too.
      const themed = await service.patchSettings(USER, { theme: 'dark' } as never);
      expect(themed.profile).toMatchObject({ timezone: 'Europe/Paris' });

      const cleared = await service.patchSettings(USER, { profile: { timezone: null } } as never);
      expect(cleared.profile).not.toHaveProperty('timezone');
    });
  });

  it('is part of the request bodies and the documented response', async () => {
    await withTemporaryEntries(userProfileFieldRegistry, [], async () => {
      extendUserProfile({ fields: z.object({ timezone: TZ }) });
      expect(composeUpdateUserSettingsSchema().safeParse({ theme: 'dark', profile: { imageSource: 'none', timezone: 'UTC' } }).data?.profile).toMatchObject({ timezone: 'UTC' });
      expect(composeUserSettingsSchema().safeParse({ theme: 'dark', profile: { imageSource: 'none', timezone: 'x'.repeat(65) } }).success).toBe(false);
      expect(composePatchUserSettingsSchema().safeParse({ profile: { timezone: null } }).data?.profile).toEqual({ timezone: null });
      expect(Object.keys(composeUserSettingsResponseSchema().shape.profile.shape)).toEqual(['displayName', 'imageSource', 'imageObjectId', 'timezone']);
    });
  });

  it('replaces the profile on PUT (an omitted field is cleared) except the avatar reference', async () => {
    await withTemporaryEntries(userProfileFieldRegistry, [], async () => {
      extendUserProfile({ fields: z.object({ timezone: TZ }) });
      const { service } = makeService();
      await service.getSettings(USER);
      await service.patchSettings(USER, { profile: { timezone: 'UTC' } } as never);
      const replaced = await service.replaceSettings(USER, { theme: 'light', profile: { imageSource: 'none' } } as never);
      expect(replaced.profile).not.toHaveProperty('timezone');
      expect(replaced.theme).toBe('light');
    });
  });

  it('drops a stored value that no longer validates instead of returning it or failing the read', async () => {
    await withTemporaryEntries(userProfileFieldRegistry, [], async () => {
      extendUserProfile({ fields: z.object({ timezone: z.string().max(5).optional() }) });
      const { service, setStored } = makeService();
      setStored({ theme: 'system', profile: { imageSource: 'none', timezone: 'far too long for the schema' } });
      const response = await service.getSettings(USER);
      expect(response.profile).not.toHaveProperty('timezone');
    });
  });

  it('refuses a field that is required, defaulted, unbounded, free-form, secret-named or a core field', async () => {
    await withTemporaryEntries(userProfileFieldRegistry, [], async () => {
      expect(() => extendUserProfile({ fields: z.object({ timezone: z.string().max(5) }) })).toThrow(/must be optional/);
      expect(() => extendUserProfile({ fields: z.object({ timezone: z.string().max(5).default('UTC') }) })).toThrow(/\.default\(\)/);
      expect(() => extendUserProfile({ fields: z.object({ bio: z.string().optional() }) })).toThrow(/unbounded string/);
      expect(() => extendUserProfile({ fields: z.object({ tags: z.array(z.string().max(5)).optional() }) })).toThrow(/unbounded array/);
      expect(() => extendUserProfile({ fields: z.object({ extra: z.record(z.string(), z.string()).optional() }) })).toThrow(/free-form/);
      expect(() => extendUserProfile({ fields: z.object({ extra: z.any().optional() }) })).toThrow(/free-form/);
      expect(() => extendUserProfile({ fields: z.object({ apiKey: z.string().max(5).optional() }) })).toThrow(/CredentialsService|secret-named/);
      expect(() => extendUserProfile({ fields: z.object({ displayName: z.string().max(5).optional() }) })).toThrow(/core profile field/);
      expect(() => extendUserProfile({ fields: z.object({ imageSource: z.string().max(5).optional() }) })).toThrow(/core profile field/);
      expect(() => extendUserProfile({ fields: z.object({ 'bad-name': z.string().max(5).optional() }) })).toThrow(/not a field name|Invalid id/);
      expect(userProfileFieldRegistry.size).toBe(0);
    });
  });

  it('refuses a field named like a property every object has', async () => {
    await withTemporaryEntries(userProfileFieldRegistry, [], async () => {
      for (const name of ['constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
        expect(() => extendUserProfile({ fields: z.object({ [name]: z.string().max(5).optional() }) })).toThrow(/property every object has/);
      }
      expect(userProfileFieldRegistry.size).toBe(0);
    });
  });

  it('treats a fixed-shape string format as bounded', async () => {
    await withTemporaryEntries(userProfileFieldRegistry, [], async () => {
      extendUserProfile({ fields: z.object({ workspaceId: z.uuid().optional() }) });
      expect(userProfileFieldRegistry.has('workspaceId')).toBe(true);
      expect(() => extendUserProfile({ fields: z.object({ homepage: z.url().optional() }) })).toThrow(/unbounded string/);
    });
  });

  it('accepts bounded arrays, enums, numbers and nested objects, and refuses a duplicate field, all or nothing', async () => {
    await withTemporaryEntries(userProfileFieldRegistry, [], async () => {
      extendUserProfile({
        fields: z.object({
          languages: z.array(z.string().max(8)).max(5).optional(),
          density: z.enum(['a', 'b']).optional(),
          age: z.number().int().optional(),
          prefs: z.object({ units: z.string().max(10) }).optional(),
        }),
      });
      expect(userProfileFieldRegistry.ids().sort()).toEqual(['age', 'density', 'languages', 'prefs']);
      expect(() => extendUserProfile({ fields: z.object({ fresh: z.string().max(5).optional(), age: z.number().optional() }) })).toThrow(/already registered/);
      expect(userProfileFieldRegistry.has('fresh')).toBe(false);
    });
  });
});

describe('registerThemePreference', () => {
  it('accepts the id, lists it in themeOptions and in the documented response', async () => {
    await withTemporaryEntries(themePreferenceRegistry, [], async () => {
      registerThemePreference({ id: 'high-contrast', label: 'High contrast' });
      expect(composeUpdateUserSettingsSchema().safeParse({ theme: 'high-contrast', profile: { imageSource: 'none' } }).success).toBe(true);
      expect(composeUpdateUserSettingsSchema().safeParse({ theme: 'sepia', profile: { imageSource: 'none' } }).success).toBe(false);
      expect(composePatchUserSettingsSchema().safeParse({ theme: 'high-contrast' }).success).toBe(true);
      expect(Object.keys(composeUserSettingsResponseSchema().shape)).toContain('themeOptions');

      const { service } = makeService();
      const patched = await service.patchSettings(USER, { theme: 'high-contrast' } as never);
      expect(patched.themeOptions).toEqual([{ id: 'high-contrast', label: 'High contrast' }]);
      const read = await service.getSettings(USER);
      expect(read.theme).toBe('high-contrast');
      expect(read.themeOptions).toEqual([{ id: 'high-contrast', label: 'High contrast' }]);
    });
  });

  it('reads a theme that is no longer registered as system and does not brick later writes', async () => {
    const { service, setStored } = makeService();
    setStored({ theme: 'high-contrast', profile: { imageSource: 'none' } });
    const read = await service.getSettings(USER);
    expect(read.theme).toBe('system');
    expect(read).not.toHaveProperty('themeOptions');
    // An unrelated write still validates: the stale id was replaced, not carried.
    const written = await service.patchSettings(USER, { profile: { displayName: 'Ada' } } as never);
    expect(written.theme).toBe('system');
  });

  it('refuses a built-in id, a malformed id, an empty or long label and a duplicate', async () => {
    await withTemporaryEntries(themePreferenceRegistry, [], async () => {
      expect(() => registerThemePreference({ id: 'dark', label: 'Dark' })).toThrow(/built-in theme preference/);
      expect(() => registerThemePreference({ id: 'High Contrast', label: 'x' })).toThrow(/Invalid id/);
      expect(() => registerThemePreference({ id: 'sepia', label: '  ' })).toThrow(/label must be/);
      expect(() => registerThemePreference({ id: 'sepia', label: 'x'.repeat(61) })).toThrow(/label must be/);
      registerThemePreference({ id: 'sepia', label: 'Sepia' });
      expect(() => registerThemePreference({ id: 'sepia', label: 'Again' })).toThrow(/Duplicate id/);
    });
  });
});

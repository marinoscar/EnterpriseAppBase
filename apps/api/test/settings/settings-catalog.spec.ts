// =============================================================================
// Settings defaults and shapes baseline (issue #677, PP-1.5)
// =============================================================================
//
// THE LITERALS BELOW WERE CAPTURED FROM main BEFORE THE SETTINGS NAMESPACE
// REGISTRY EXISTED. The registry derives every composed schema, the defaults
// and the seed from per-namespace declarations; this file proves the derived
// values are the ones the hand-written lists produced: the same defaults with
// the same key order (which is also the stored JSON's key order), and the same
// top-level key order of every composed schema (which drives the OpenAPI
// document).
//
// A failure here means a namespace declaration changed a default or the
// manifest changed the registration order. If the change is deliberate, update
// the literal in the same commit and say why in the commit body.
// =============================================================================

import { DEFAULT_SYSTEM_SETTINGS, DEFAULT_USER_SETTINGS } from '../../src/common/types/settings.types';
import {
  systemSettingsSchema,
  systemSettingsPatchSchema,
  userSettingsSchema,
  userSettingsPatchSchema,
} from '../../src/settings/registry/composed';
import {
  updateSystemSettingsSchema,
  patchSystemSettingsSchema,
} from '../../src/settings/registry/composed';
import { systemSettingsResponseSchema } from '../../src/settings/registry/composed';
import {
  updateUserSettingsSchema,
  patchUserSettingsSchema,
} from '../../src/settings/registry/composed';
import { userSettingsResponseSchema } from '../../src/settings/registry/composed';
import { readFileSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import { withTemporaryEntries } from '@marinoscar/platform-api/core';
import {
  SETTINGS_CATALOG_STALE_MESSAGE,
  checkSystemSettingsCatalog,
  renderSystemSettingsCatalog,
} from '../../src/settings/registry/settings-catalog';
import {
  systemSettingsNamespaceRegistry,
  type SystemSettingsNamespace,
} from '@marinoscar/platform-api/settings';
import type { UserSettingsNamespace } from '@marinoscar/platform-api/settings';
import { DEFAULT_SYSTEM_SETTINGS as SEEDED_SYSTEM_SETTINGS } from '../../prisma/seed-data';

/** DEFAULT_SYSTEM_SETTINGS on main before #677 (including #681's `retention`), key order included. */
const BASELINE_DEFAULT_SYSTEM_SETTINGS = {
  "notifications": {
    "browserEnabled": true,
    "disabledEvents": []
  },
  "jobs": {
    "history": {
      "retentionDays": 30,
      "purgeEnabled": true
    },
    "stuckThresholdMinutes": 30
  },
  "nodes": {
    "staleHeartbeatSeconds": 90,
    "offlineStaleMultiplier": 4,
    "offlineRetentionDays": 30,
    "jobSecretBrokerEnabled": false
  },
  "databaseBackup": {
    "enabled": false,
    "frequency": "daily",
    "dayOfWeek": 0,
    "dayOfMonth": 1,
    "timeOfDay": "02:00",
    "timezone": "UTC",
    "retentionCount": 7,
    "storageProvider": "",
    "runStaleMinutes": 120,
    "compressionLevel": 6,
    "restoreRollbackMode": "retain_database",
    "oldDatabaseRetentionHours": 48,
    "nodeOffloadEnabled": false
  },
  "maintenance": {
    "enabled": false,
    "message": "This service is temporarily unavailable for scheduled maintenance. Please try again shortly.",
    "allowAdmins": true,
    "startedAt": null,
    "startedById": null
  },
  "storage": {
    "provider": "s3",
    "bucket": "",
    "region": "",
    "endpoint": "",
    "accountId": "",
    "accessKeyId": "",
    "forcePathStyle": null
  },
  "ai": {
    "enabled": false,
    "keyPolicy": "byok",
    "providers": {
      "openai": {
        "enabled": false
      },
      "anthropic": {
        "enabled": false
      },
      "gemini": {
        "enabled": false
      },
      "azure-openai": {
        "enabled": false
      },
      "openai-compatible": {
        "enabled": false
      }
    },
    "defaults": {
      "allowBackgroundRuns": true,
      "allowRealtime": false
    },
    "logPromptContent": false,
    "usageRetentionDays": 180,
    "hostedTools": {
      "web_search": false,
      "file_search": false,
      "code_interpreter": false,
      "image_generation": false,
      "mcp": false,
      "mcpAllowedHosts": []
    },
    "limits": {}
  },
  "telemetry": {
    "enabled": false,
    "retentionDays": 30,
    "instanceId": null,
    "query": {
      "maxRows": 10000,
      "timeoutSeconds": 30
    },
    "assistant": {
      "enabled": false,
      "provider": null,
      "modelId": null,
      "shareResults": true,
      "maxResultRowsToModel": 100,
      "maxSteps": 15
    }
  },
  "retention": {
    "notifications": {
      "enabled": true,
      "days": 180
    },
    "notificationDeliveries": {
      "enabled": true,
      "days": 90
    },
    "auditEvents": {
      "enabled": false,
      "days": 365
    },
    "aiRuns": {
      "enabled": true,
      "days": 90
    }
  }
};

/** DEFAULT_USER_SETTINGS on main before #677. */
const BASELINE_DEFAULT_USER_SETTINGS = {"theme":"system","profile":{"imageSource":"provider","imageObjectId":null}};

/** Top-level keys of every composed schema on main before #677, in order (plus `onboarding`, appended by #745). */
const BASELINE_SHAPE_KEYS: Record<string, string[]> = {
 "systemSettingsSchema": [
  "notifications",
  "jobs",
  "nodes",
  "databaseBackup",
  "maintenance",
  "storage",
  "ai",
  "telemetry",
  "retention"
 ],
 "systemSettingsPatchSchema": [
  "notifications",
  "jobs",
  "nodes",
  "databaseBackup",
  "maintenance",
  "storage",
  "ai",
  "telemetry",
  "retention"
 ],
 "updateSystemSettingsSchema": [
  "notifications",
  "jobs",
  "nodes",
  "databaseBackup",
  "maintenance",
  "storage",
  "ai",
  "telemetry",
  "retention"
 ],
 "patchSystemSettingsSchema": [
  "notifications",
  "jobs",
  "nodes",
  "databaseBackup",
  "maintenance",
  "storage",
  "ai",
  "telemetry",
  "retention"
 ],
 "systemSettingsResponseSchema": [
  "security",
  "notifications",
  "jobs",
  "nodes",
  "databaseBackup",
  "maintenance",
  "storage",
  "ai",
  "retention",
  "updatedAt",
  "updatedBy",
  "version"
 ],
 "userSettingsSchema": [
  "theme",
  "profile",
  "dataTables",
  "navigation",
  "notifications",
  "ai",
  "onboarding"
 ],
 "userSettingsPatchSchema": [
  "theme",
  "profile",
  "dataTables",
  "navigation",
  "notifications",
  "ai",
  "onboarding"
 ],
 "updateUserSettingsSchema": [
  "theme",
  "profile",
  "dataTables",
  "navigation",
  "notifications",
  "ai",
  "onboarding"
 ],
 "patchUserSettingsSchema": [
  "theme",
  "profile",
  "dataTables",
  "navigation",
  "notifications",
  "ai",
  "onboarding"
 ],
 "userSettingsResponseSchema": [
  "theme",
  "profile",
  "dataTables",
  "navigation",
  "notifications",
  "onboarding",
  "updatedAt",
  "version"
 ]
}
;

const keysOf = (schema: { shape: Record<string, unknown> }): string[] => Object.keys(schema.shape);

describe('settings defaults and shapes baseline (#677)', () => {
  it('DEFAULT_SYSTEM_SETTINGS deep-equals the pre-registry value', () => {
    expect(DEFAULT_SYSTEM_SETTINGS).toEqual(BASELINE_DEFAULT_SYSTEM_SETTINGS);
  });

  it('DEFAULT_SYSTEM_SETTINGS keeps the pre-registry key order at every depth', () => {
    // JSON.stringify follows insertion order, so equal strings mean equal
    // key order all the way down (toEqual ignores order).
    expect(JSON.stringify(DEFAULT_SYSTEM_SETTINGS, null, 2)).toBe(
      JSON.stringify(BASELINE_DEFAULT_SYSTEM_SETTINGS, null, 2),
    );
  });

  it('DEFAULT_USER_SETTINGS is unchanged', () => {
    expect(JSON.stringify(DEFAULT_USER_SETTINGS)).toBe(JSON.stringify(BASELINE_DEFAULT_USER_SETTINGS));
  });

  it.each([
    ['systemSettingsSchema', systemSettingsSchema],
    ['systemSettingsPatchSchema', systemSettingsPatchSchema],
    ['updateSystemSettingsSchema', updateSystemSettingsSchema],
    ['patchSystemSettingsSchema', patchSystemSettingsSchema],
    ['systemSettingsResponseSchema', systemSettingsResponseSchema],
    ['userSettingsSchema', userSettingsSchema],
    ['userSettingsPatchSchema', userSettingsPatchSchema],
    ['updateUserSettingsSchema', updateUserSettingsSchema],
    ['patchUserSettingsSchema', patchUserSettingsSchema],
    ['userSettingsResponseSchema', userSettingsResponseSchema],
  ] as const)('%s keeps its top-level keys in the pre-registry order', (name, schema) => {
    expect(keysOf(schema as unknown as { shape: Record<string, unknown> })).toEqual(BASELINE_SHAPE_KEYS[name]);
  });
});

describe('the generated system settings catalog (#677)', () => {
  const catalogPath = join(__dirname, '..', '..', 'prisma', 'catalog', 'system-settings-defaults.json');
  const committed = (): string => readFileSync(catalogPath, 'utf8');

  it('is current: the committed JSON is exactly what the registry renders', () => {
    // On failure, the message is the fix.
    expect(checkSystemSettingsCatalog(committed())).toBeNull();
  });

  it('equals DEFAULT_SYSTEM_SETTINGS, key order included, and is what the seed writes', () => {
    expect(committed()).toBe(`${JSON.stringify(DEFAULT_SYSTEM_SETTINGS, null, 2)}\n`);
    expect(JSON.parse(committed())).toEqual(BASELINE_DEFAULT_SYSTEM_SETTINGS);
    expect(SEEDED_SYSTEM_SETTINGS).toEqual(DEFAULT_SYSTEM_SETTINGS);
  });

  it('reports a namespace added without regenerating as stale, naming the command', async () => {
    const probe: SystemSettingsNamespace = {
      key: 'catalogProbe',
      description: 'Test-only namespace proving the staleness check.',
      storedSchema: z.object({ enabled: z.boolean() }),
      patchSchema: z.object({ enabled: z.boolean().optional() }),
      putSchema: z.object({ enabled: z.boolean() }),
      wirePatchSchema: z.object({ enabled: z.boolean().optional() }),
      responseSchema: z.object({ enabled: z.boolean() }),
      defaults: { enabled: false },
      requiredOnPut: false,
      merge: (current, patch) => ({ ...(current as object), ...(patch as object) }),
    };

    await withTemporaryEntries(systemSettingsNamespaceRegistry, [probe], () => {
      expect(renderSystemSettingsCatalog()).toContain('"catalogProbe"');
      expect(checkSystemSettingsCatalog(committed())).toBe(SETTINGS_CATALOG_STALE_MESSAGE);
    });
    expect(SETTINGS_CATALOG_STALE_MESSAGE).toContain('run npm run catalog:settings --workspace=api');
    expect(checkSystemSettingsCatalog(undefined)).toBe(SETTINGS_CATALOG_STALE_MESSAGE);
  });
});

// -----------------------------------------------------------------------------
// An app namespace, end to end through the HTTP layer
// -----------------------------------------------------------------------------
//
// The request-body DTOs are composed when their module is evaluated (that is
// what `createZodDto` and `openapi:dump` need), so an app namespace must be in
// the registry BEFORE the application's modules load — exactly as
// `app-registrations/settings.ts` puts it there in a real fork. The test
// therefore builds the application inside `jest.isolateModulesAsync`: a fresh
// module graph whose registry gets the platform namespaces from the manifest,
// then the app namespace through `withTemporaryEntries`, and only then loads
// `AppModule`.
describe('an app namespace registered through withTemporaryEntries (#677)', () => {
  const COACH_DEFAULTS = { enabled: false, nudgesPerWeek: 3 };

  function coachNamespace(zod: typeof z): SystemSettingsNamespace {
    return {
      key: 'coach',
      description: 'Test-only app namespace: accountability nudges.',
      storedSchema: zod.object({ enabled: zod.boolean(), nudgesPerWeek: zod.number().int().min(0).max(14) }),
      patchSchema: zod.object({ enabled: zod.boolean().optional(), nudgesPerWeek: zod.number().int().min(0).max(14).optional() }),
      putSchema: zod.object({ enabled: zod.boolean(), nudgesPerWeek: zod.number().int().min(0).max(14) }),
      wirePatchSchema: zod.object({
        enabled: zod.boolean().optional(),
        nudgesPerWeek: zod.number().int().min(0).max(14).optional(),
      }),
      responseSchema: zod.object({ enabled: zod.boolean(), nudgesPerWeek: zod.number() }),
      defaults: COACH_DEFAULTS,
      requiredOnPut: false,
      merge: (current, patch) => {
        const c = current as typeof COACH_DEFAULTS;
        const p = patch as Partial<typeof COACH_DEFAULTS> | undefined;
        return { enabled: p?.enabled ?? c.enabled, nudgesPerWeek: p?.nudgesPerWeek ?? c.nudgesPerWeek };
      },
    };
  }

  function pinnedNamespace(zod: typeof z): UserSettingsNamespace {
    return {
      key: 'pinned',
      description: 'Test-only app user namespace: pinned pages.',
      schema: zod.object({ pages: zod.array(zod.string().max(64)).max(10) }),
      patchSchema: zod.object({ pages: zod.array(zod.string().max(64)).max(10) }),
      merge: (current, patch) => (patch === undefined ? current : patch === null ? undefined : patch),
    };
  }

  it('is accepted by PUT and PATCH, returned by GET, read as defaults when absent, and keeps unknown stored keys', async () => {
    await jest.isolateModulesAsync(async () => {
      const isolatedZod = require('zod').z as typeof z;
      require('../../src/settings/registry/system-settings.manifest');
      require('../../src/settings/registry/user-settings.manifest');
      const { withTemporaryEntries: withEntries } = require('@marinoscar/platform-api/core');
      const { systemSettingsNamespaceRegistry: systemRegistry } = require('@marinoscar/platform-api/settings');
      const { userSettingsNamespaceRegistry: userRegistry } = require('@marinoscar/platform-api/settings');

      await withEntries(systemRegistry, [coachNamespace(isolatedZod)], () =>
        withEntries(userRegistry, [pinnedNamespace(isolatedZod)], async () => {
          const request = require('supertest');
          const { createTestApp, closeTestApp } = require('../helpers/test-app.helper');
          const { resetPrismaMock } = require('../mocks/prisma.mock');
          const { setupBaseMocks } = require('../fixtures/mock-setup.helper');
          const { createMockAdminUser, authHeader } = require('../helpers/auth-mock.helper');
          const { DEFAULT_SYSTEM_SETTINGS: isolatedDefaults } = require('../../src/common/types/settings.types');

          const context = await createTestApp({ useMockDatabase: true });
          try {
            resetPrismaMock();
            setupBaseMocks();
            const admin = await createMockAdminUser(context);
            const server = context.app.getHttpServer();

            // A row written before the app namespace existed, carrying a key
            // nothing models (left behind by some other build).
            const { coach: _absent, ...withoutCoach } = isolatedDefaults as Record<string, unknown>;
            let stored: Record<string, unknown> = { ...withoutCoach, legacyBranding: { colour: 'teal' } };
            const row = () => ({
              id: 'settings-1',
              key: 'global',
              value: stored,
              version: 1,
              updatedAt: new Date(),
              updatedByUserId: admin.id,
              updatedByUser: { id: admin.id, email: admin.email },
            });
            context.prismaMock.systemSettings.findUnique.mockImplementation(async () => row());
            context.prismaMock.systemSettings.update.mockImplementation(async ({ data }: any) => {
              stored = data.value;
              return row();
            });
            context.prismaMock.systemSettings.upsert.mockImplementation(async ({ update }: any) => {
              stored = update.value;
              return row();
            });
            context.prismaMock.auditEvent.create.mockResolvedValue({});

            // GET: absent on disk, read as its defaults.
            const initial = await request(server).get('/api/system-settings').set(authHeader(admin.accessToken)).expect(200);
            expect(initial.body.data.coach).toEqual(COACH_DEFAULTS);
            expect(initial.body.data.legacyBranding).toBeUndefined();

            // PATCH: the pipe keeps the app branch, the namespace merge runs,
            // and the unknown stored key survives the write.
            const patched = await request(server)
              .patch('/api/system-settings')
              .set(authHeader(admin.accessToken))
              .send({ coach: { nudgesPerWeek: 5 } })
              .expect(200);
            expect(patched.body.data.coach).toEqual({ enabled: false, nudgesPerWeek: 5 });
            expect(stored.coach).toEqual({ enabled: false, nudgesPerWeek: 5 });
            expect(stored.legacyBranding).toEqual({ colour: 'teal' });
            expect(stored.jobs).toEqual((isolatedDefaults as Record<string, unknown>).jobs);

            // PATCH validation applies to the app namespace like any other.
            await request(server)
              .patch('/api/system-settings')
              .set(authHeader(admin.accessToken))
              .send({ coach: { nudgesPerWeek: 99 } })
              .expect(400);

            // PUT: accepted and stored; omitting it would carry it forward.
            const { coach: _c, legacyBranding: _l, ...modelled } = stored;
            await request(server)
              .put('/api/system-settings')
              .set(authHeader(admin.accessToken))
              .send({ ...modelled, coach: { enabled: true, nudgesPerWeek: 2 } })
              .expect(200);
            expect(stored.coach).toEqual({ enabled: true, nudgesPerWeek: 2 });
            expect(stored.legacyBranding).toEqual({ colour: 'teal' });

            await request(server)
              .put('/api/system-settings')
              .set(authHeader(admin.accessToken))
              .send({ notifications: modelled.notifications })
              .expect(200);
            expect(stored.coach).toEqual({ enabled: true, nudgesPerWeek: 2 });

            // GET reads the stored app value back.
            const reread = await request(server).get('/api/system-settings').set(authHeader(admin.accessToken)).expect(200);
            expect(reread.body.data.coach).toEqual({ enabled: true, nudgesPerWeek: 2 });

            // The user side: an app user namespace through PATCH and GET.
            const userPatched = await request(server)
              .patch('/api/user-settings')
              .set(authHeader(admin.accessToken))
              .send({ pinned: { pages: ['/jobs'] } })
              .expect(200);
            expect(userPatched.body.data.pinned).toEqual({ pages: ['/jobs'] });
            const userRead = await request(server).get('/api/user-settings').set(authHeader(admin.accessToken)).expect(200);
            expect(userRead.body.data.pinned).toEqual({ pages: ['/jobs'] });
            const cleared = await request(server)
              .patch('/api/user-settings')
              .set(authHeader(admin.accessToken))
              .send({ pinned: null })
              .expect(200);
            expect(cleared.body.data.pinned).toBeUndefined();
          } finally {
            await closeTestApp(context);
          }
        }),
      );
    });
  }, 60_000);
});

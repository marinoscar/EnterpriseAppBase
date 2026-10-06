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
} from '../../src/settings/dto/update-system-settings.dto';
import { systemSettingsResponseSchema } from '../../src/settings/dto/system-settings-response.dto';
import {
  updateUserSettingsSchema,
  patchUserSettingsSchema,
} from '../../src/settings/dto/update-user-settings.dto';
import { userSettingsResponseSchema } from '../../src/settings/dto/user-settings-response.dto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import { withTemporaryEntries } from '../../src/common/registry';
import {
  SETTINGS_CATALOG_STALE_MESSAGE,
  checkSystemSettingsCatalog,
  renderSystemSettingsCatalog,
} from '../../src/settings/registry/settings-catalog';
import {
  systemSettingsNamespaceRegistry,
  type SystemSettingsNamespace,
} from '../../src/settings/registry/system-settings-namespace';
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

/** Top-level keys of every composed schema on main before #677, in order. */
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
  "ai"
 ],
 "userSettingsPatchSchema": [
  "theme",
  "profile",
  "dataTables",
  "navigation",
  "notifications",
  "ai"
 ],
 "updateUserSettingsSchema": [
  "theme",
  "profile",
  "dataTables",
  "navigation",
  "notifications",
  "ai"
 ],
 "patchUserSettingsSchema": [
  "theme",
  "profile",
  "dataTables",
  "navigation",
  "notifications",
  "ai"
 ],
 "userSettingsResponseSchema": [
  "theme",
  "profile",
  "dataTables",
  "navigation",
  "notifications",
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

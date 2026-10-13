// =============================================================================
// The `retention` namespace, composed from the policy registry (PP-14.19)
// =============================================================================
//
// Each case that registers a policy loads a fresh copy of the module graph
// (`jest.isolateModules`): the registry is static and seals when the namespace
// is composed, exactly as it does once per process in a real application.
// =============================================================================

import { retentionResponseSchema, retentionSettingsPatchSchema, retentionSettingsSchema, systemRetentionPatchSchema, systemRetentionSchema } from '@marinoscar/platform-contract/jobs';
import { z } from 'zod';

import type { SettingsReadHelpers } from '../../settings/index';

type Loaded = {
  jobs: typeof import('../index');
  settings: typeof import('../../settings/index');
  /** The warn spy of THIS copy of the module graph's `Logger`. */
  warn: jest.SpyInstance;
};

function load(register?: (jobs: typeof import('../index')) => void): Loaded {
  let loaded!: Loaded;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const jobs = require('../index') as typeof import('../index');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const settings = require('../../settings/index') as typeof import('../../settings/index');
    register?.(jobs);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Logger } = require('@nestjs/common') as typeof import('@nestjs/common');
    loaded = { jobs, settings, warn: jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined) };
  });

  return loaded;
}

/** The two helpers `read` uses, as the settings service lends them. */
const helpers: SettingsReadHelpers = {
  asPlainObject: (value) => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined),
  readNamespace: (stored, schema, defaults) => {
    const source = typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : {};
    const out: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(schema.shape) as Array<[string, z.ZodType]>) {
      const parsed = field.safeParse(source[key]);
      out[key] = parsed.success ? parsed.data : structuredClone((defaults as Record<string, unknown>)[key]);
    }
    return out as never;
  },
  readStringArray: () => [],
};

const json = (schema: z.ZodType) => z.toJSONSchema(schema, { io: 'input' });

const SHIPPED_DEFAULTS = {
  notifications: { enabled: true, days: 180 },
  notificationDeliveries: { enabled: true, days: 90 },
  auditEvents: { enabled: false, days: 365 },
  aiRuns: { enabled: true, days: 90 },
};

const registerImportRows = (jobs: typeof import('../index')) =>
  jobs.registerRetentionPolicy({
    key: 'importRows',
    label: 'Import rows',
    defaultDays: 30,
    minDays: 7,
    maxDays: 365,
    purge: { type: 'app.import-rows.purge', what: 'import row purge' },
  });

describe('RETENTION_SYSTEM_SETTINGS with only the built-ins (nothing an operator or a client sees changes)', () => {
  const { jobs } = load();
  const ns = jobs.RETENTION_SYSTEM_SETTINGS;

  it('has the shipped defaults, in the shipped key order, byte for byte', () => {
    expect(ns.defaults).toEqual(SHIPPED_DEFAULTS);
    expect(Object.keys(ns.defaults)).toEqual(Object.keys(SHIPPED_DEFAULTS));
    expect(JSON.stringify(ns.defaults)).toBe(JSON.stringify(SHIPPED_DEFAULTS));
  });

  it('composes schemas whose JSON Schema equals the contract constants the OpenAPI document was built from', () => {
    expect(json(ns.storedSchema)).toEqual(json(systemRetentionSchema));
    expect(json(ns.putSchema)).toEqual(json(retentionSettingsSchema));
    expect(json(ns.patchSchema)).toEqual(json(systemRetentionPatchSchema));
    expect(json(ns.wirePatchSchema)).toEqual(json(retentionSettingsPatchSchema));
    expect(json(ns.responseSchema as z.ZodType)).toEqual(json(retentionResponseSchema));
  });

  it('is a namespace the settings registry accepts (defaults satisfy the stored schema, no secret field)', () => {
    const fresh = load();
    expect(() => fresh.settings.registerSystemSettingsNamespaces([fresh.jobs.RETENTION_SYSTEM_SETTINGS as never])).not.toThrow();
  });

  it('merges leaf by leaf, exactly as before', () => {
    const merged = jobs.mergeRetentionSettings(SHIPPED_DEFAULTS, { auditEvents: { enabled: true }, aiRuns: { days: 30 } });

    expect(merged).toEqual({ ...SHIPPED_DEFAULTS, auditEvents: { enabled: true, days: 365 }, aiRuns: { enabled: true, days: 30 } });
    expect(merged.notifications).not.toBe(SHIPPED_DEFAULTS.notifications);
    expect(jobs.mergeRetentionSettings(SHIPPED_DEFAULTS)).toEqual(SHIPPED_DEFAULTS);
  });
});

describe('RETENTION_SYSTEM_SETTINGS with an app policy', () => {
  it('adds the key to every composed schema, the defaults and the merge, after the built-ins', () => {
    const { jobs } = load(registerImportRows);
    const ns = jobs.RETENTION_SYSTEM_SETTINGS;

    expect(Object.keys(ns.defaults)).toEqual([...Object.keys(SHIPPED_DEFAULTS), 'importRows']);
    // OFF unless the registration says otherwise: deleting rows is an operator decision.
    expect(ns.defaults['importRows']).toEqual({ enabled: false, days: 30 });
    expect(Object.keys((ns.storedSchema as z.ZodObject<z.ZodRawShape>).shape)).toContain('importRows');

    const put = ns.putSchema as z.ZodType;
    expect(put.safeParse({ ...SHIPPED_DEFAULTS, importRows: { enabled: true, days: 30 } }).success).toBe(true);
    expect(put.safeParse({ ...SHIPPED_DEFAULTS, importRows: { enabled: true, days: 6 } }).success).toBe(false);
    expect(put.safeParse({ ...SHIPPED_DEFAULTS, importRows: { enabled: true, days: 366 } }).success).toBe(false);
    expect(put.safeParse(SHIPPED_DEFAULTS).success).toBe(false);

    const merged = ns.merge({ ...SHIPPED_DEFAULTS, importRows: { enabled: false, days: 30 } }, { importRows: { enabled: true } });
    expect(merged['importRows']).toEqual({ enabled: true, days: 30 });
    expect(merged.notifications).toEqual(SHIPPED_DEFAULTS.notifications);
  });

  it('is accepted by the settings registry, and a policy registered after that is refused', () => {
    const fresh = load(registerImportRows);
    fresh.settings.registerSystemSettingsNamespaces([fresh.jobs.RETENTION_SYSTEM_SETTINGS as never]);

    expect(() =>
      fresh.jobs.registerRetentionPolicy({ key: 'tooLate', label: 'x', defaultDays: 5, purge: { type: 'app.late.purge', what: 'x' } }),
    ).toThrow(/registered after RETENTION_SYSTEM_SETTINGS was composed/);
  });

  it('strips a key nobody registered from a PUT and a PATCH body: it can never be stored', () => {
    const { jobs } = load(registerImportRows);
    const ns = jobs.RETENTION_SYSTEM_SETTINGS;

    const put = (ns.putSchema as z.ZodType).parse({ ...SHIPPED_DEFAULTS, importRows: { enabled: true, days: 30 }, ghost: { enabled: true, days: 1 } });
    const patch = (ns.wirePatchSchema as z.ZodType).parse({ ghost: { days: 1 }, importRows: { days: 10 } });

    expect(put).not.toHaveProperty('ghost');
    expect(patch).toEqual({ importRows: { days: 10 } });
  });
});

// The read-compat fixture: what is already stored when the registry changes.
describe('reading a stored retention row (read-compat)', () => {
  const legacyRow = {
    notifications: { enabled: false, days: 14 },
    notificationDeliveries: { enabled: true, days: 30 },
    auditEvents: { enabled: true, days: 730 },
    aiRuns: { enabled: true, days: 7 },
  };

  it('reads a row written before any app policy existed as itself, with the app policy at its default', () => {
    const { jobs } = load(registerImportRows);

    expect(jobs.RETENTION_SYSTEM_SETTINGS.read!(legacyRow, helpers)).toEqual({ ...legacyRow, importRows: { enabled: false, days: 30 } });
  });

  it('reads a row with no retention at all as the defaults', () => {
    const { jobs } = load(registerImportRows);

    for (const stored of [undefined, null, {}, [], 'x', 5]) {
      expect(jobs.RETENTION_SYSTEM_SETTINGS.read!(stored, helpers)).toEqual({ ...SHIPPED_DEFAULTS, importRows: { enabled: false, days: 30 } });
    }
  });

  it('degrades ONE damaged policy to its own default and keeps the others as the operator set them', () => {
    const { jobs } = load(registerImportRows);
    const stored = {
      ...legacyRow,
      aiRuns: { enabled: 'yes', days: -4 },
      importRows: { enabled: true, days: 9999 },
    };

    expect(jobs.RETENTION_SYSTEM_SETTINGS.read!(stored, helpers)).toEqual({
      ...legacyRow,
      aiRuns: SHIPPED_DEFAULTS.aiRuns,
      importRows: { enabled: false, days: 30 },
    });
  });

  it('ignores a key nobody registered any more, warns once, and does not brick the row', () => {
    const { jobs, warn } = load();
    const stored = { ...legacyRow, removedPlugin: { enabled: true, days: 5 } };

    expect(jobs.RETENTION_SYSTEM_SETTINGS.read!(stored, helpers)).toEqual(legacyRow);
    expect(jobs.RETENTION_SYSTEM_SETTINGS.read!(stored, helpers)).toEqual(legacyRow);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('removedPlugin');
  });

  it('reads a value an app policy bound tighter than the stored number as that policy default (a tightened bound never crashes a read)', () => {
    const { jobs } = load(registerImportRows);

    expect(jobs.RETENTION_SYSTEM_SETTINGS.read!({ ...legacyRow, importRows: { enabled: true, days: 3 } }, helpers)['importRows']).toEqual({ enabled: false, days: 30 });
  });
});

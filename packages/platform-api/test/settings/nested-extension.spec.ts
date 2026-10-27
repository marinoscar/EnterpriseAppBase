// Nested and org-layer extensions of a registered settings namespace (PP-14.21).
//
// `extendSystemSettingsNamespace` / `extendUserSettingsNamespace` take a dot
// `path` into an object field and, for a system namespace, an `org` block for
// the ADDED fields only. The folded declaration is validated like any other
// when it is registered, so these specs fold, register and read it back.
import { z } from 'zod';

import { withTemporaryEntries } from '../../src/core/index';
import {
  extendSystemSettingsNamespace,
  extendUserSettingsNamespace,
  systemSettingsNamespaceRegistry,
  type SystemSettingsNamespace,
  type UserSettingsNamespace,
} from '../../src/settings/index';
import { applyOrgLayer, readOrgFields } from '../../src/settings/org-settings/org-layer';
import { orgLayerMode } from '../../src/settings/org-settings/org-layer';
import type { SettingsReadHelpers } from '../../src/settings/registry/system-settings-namespace';

const stored = z.object({
  enabled: z.boolean(),
  limits: z.object({ daily: z.number().int().min(1).max(100), burst: z.number().int().min(1).max(10) }),
});
const patch = z.object({
  enabled: z.boolean().optional(),
  limits: z.object({ daily: z.number().int().min(1).max(100).optional(), burst: z.number().int().min(1).max(10).optional() }).optional(),
});

/** A base whose merge is explicit about its fields, like the telemetry one: it forgets anything it does not know. */
const BASE: SystemSettingsNamespace = {
  key: 'coachSample',
  description: 'A sample namespace with a nested object.',
  storedSchema: stored,
  patchSchema: patch,
  putSchema: stored,
  wirePatchSchema: patch,
  responseSchema: stored,
  defaults: { enabled: true, limits: { daily: 10, burst: 2 } },
  requiredOnPut: false,
  merge: (current, p) => {
    const c = current as z.infer<typeof stored>;
    const q = p as z.infer<typeof patch> | undefined;
    return { enabled: q?.enabled ?? c.enabled, limits: { daily: q?.limits?.daily ?? c.limits.daily, burst: q?.limits?.burst ?? c.limits.burst } };
  },
};

const ADDED = z.object({ weekly: z.number().int().min(1).max(500) });

const helpers: SettingsReadHelpers = {
  asPlainObject: (value) => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined),
  readNamespace: (storedValue, schema, defaults) => {
    const source = (storedValue ?? {}) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [name, field] of Object.entries(schema.shape)) {
      const parsed = (field as z.ZodType).safeParse(source[name]);
      out[name] = parsed.success ? parsed.data : structuredClone((defaults as Record<string, unknown>)[name]);
    }
    return out as never;
  },
  readStringArray: () => [],
};

function nested(extra: Record<string, unknown> = {}) {
  return extendSystemSettingsNamespace(BASE, {
    key: 'coachSample',
    path: 'limits',
    storedSchema: ADDED,
    defaults: { weekly: 50 },
    ...extra,
  });
}

describe('a nested extension of a system namespace', () => {
  it('adds the field inside the nested object of every schema and of the defaults', async () => {
    const ns = nested();
    expect(Object.keys((ns.storedSchema as typeof stored).shape.limits.shape)).toEqual(['daily', 'burst', 'weekly']);
    expect(ns.storedSchema.safeParse({ enabled: true, limits: { daily: 1, burst: 1, weekly: 7 } }).success).toBe(true);
    expect(ns.storedSchema.safeParse({ enabled: true, limits: { daily: 1, burst: 1 } }).success).toBe(false);
    expect(ns.wirePatchSchema.safeParse({ limits: { weekly: 7 } }).success).toBe(true);
    expect(ns.wirePatchSchema.safeParse({ limits: { weekly: 0 } }).success).toBe(false);
    expect(ns.putSchema.safeParse({ enabled: true, limits: { daily: 1, burst: 1, weekly: 7 } }).success).toBe(true);
    expect(ns.defaults).toEqual({ enabled: true, limits: { daily: 10, burst: 2, weekly: 50 } });
    expect(BASE.defaults).toEqual({ enabled: true, limits: { daily: 10, burst: 2 } });
    return withTemporaryEntries(systemSettingsNamespaceRegistry, [ns], () => {
      expect(systemSettingsNamespaceRegistry.has('coachSample')).toBe(true);
    });
  });

  it('throws on an existing LEAF key, not on the parent', () => {
    expect(() =>
      extendSystemSettingsNamespace(BASE, { key: 'coachSample', path: 'limits', storedSchema: z.object({ daily: z.number() }), defaults: { daily: 1 } }),
    ).toThrow(/storedSchema\.limits already declares "daily"/);
    // The parent object "limits" already exists and is the very thing being extended.
    expect(() => nested()).not.toThrow();
  });

  it('throws when the path names no field or a field that is not an object', () => {
    expect(() => nested({ path: 'nope' })).toThrow(/has no "nope" field to extend/);
    expect(() => nested({ path: 'enabled' })).toThrow(/must be a z.object to be extended/);
    expect(() => nested({ path: 'limits.' })).toThrow(/not a dot path/);
    expect(() => nested({ path: '1bad' })).toThrow(/not a dot path/);
  });

  it('keeps the added field through a base merge that drops what it does not know', () => {
    const ns = nested();
    const current = { enabled: true, limits: { daily: 10, burst: 2, weekly: 50 } };
    expect(ns.merge(current, undefined)).toEqual(current);
    expect(ns.merge(current, { limits: { weekly: 70 } })).toEqual({ enabled: true, limits: { daily: 10, burst: 2, weekly: 70 } });
    expect(ns.merge(current, { enabled: false, limits: { daily: 20 } })).toEqual({ enabled: false, limits: { daily: 20, burst: 2, weekly: 50 } });
  });

  it('salvages a stored value that predates the field without losing what the administrator saved', () => {
    const ns = nested();
    const read = ns.read!;
    // The stored object has no `weekly`: the base fields stay, `weekly` takes its default.
    expect(read({ enabled: false, limits: { daily: 33, burst: 4 } }, helpers)).toEqual({
      enabled: false,
      limits: { daily: 33, burst: 4, weekly: 50 },
    });
    // A bad added value falls back alone.
    expect(read({ enabled: false, limits: { daily: 33, burst: 4, weekly: 'x' } }, helpers)).toEqual({
      enabled: false,
      limits: { daily: 33, burst: 4, weekly: 50 },
    });
    expect(read(undefined, helpers)).toEqual({ enabled: true, limits: { daily: 10, burst: 2, weekly: 50 } });
  });

  it('composes with a second extension of the same path', () => {
    const first = nested();
    const second = extendSystemSettingsNamespace(first, {
      key: 'coachSample',
      path: 'limits',
      storedSchema: z.object({ monthly: z.number().int().min(1).max(2000) }),
      defaults: { monthly: 200 },
    });
    expect(second.defaults).toEqual({ enabled: true, limits: { daily: 10, burst: 2, weekly: 50, monthly: 200 } });
    expect(second.read!({ enabled: true, limits: { daily: 5, burst: 1, weekly: 9 } }, helpers)).toEqual({
      enabled: true,
      limits: { daily: 5, burst: 1, weekly: 9, monthly: 200 },
    });
    expect(second.merge({ enabled: true, limits: { daily: 5, burst: 1, weekly: 9, monthly: 3 } }, { limits: { monthly: 4 } })).toEqual({
      enabled: true,
      limits: { daily: 5, burst: 1, weekly: 9, monthly: 4 },
    });
  });

  it('leaves a top-level extension exactly as it was (no path)', () => {
    const ns = extendSystemSettingsNamespace(BASE, {
      key: 'coachSample',
      storedSchema: z.object({ note: z.string().max(10) }),
      defaults: { note: 'hi' },
    });
    expect(ns.defaults).toEqual({ enabled: true, limits: { daily: 10, burst: 2 }, note: 'hi' });
    expect(ns.read).toBeUndefined();
    expect(ns.merge({ enabled: true, limits: { daily: 1, burst: 1 }, note: 'a' }, { note: 'b' })).toEqual({
      enabled: true,
      limits: { daily: 1, burst: 1 },
      note: 'b',
    });
  });
});

describe('the org layer of an extension', () => {
  const orgNested = (extra: Record<string, unknown> = {}) =>
    nested({ org: { mode: 'tighten', tighten: { weekly: 'min' }, ...extra } });

  it('gives the namespace an org layer holding ONLY the added field, under its path', async () => {
    const ns = orgNested();
    expect(ns.org).toBeDefined();
    expect(Object.keys(ns.org!.schema.shape)).toEqual(['limits']);
    expect(ns.org!.readPermission).toBe('org_settings:read');
    expect(ns.org!.writePermission).toBe('org_settings:write');
    expect(orgLayerMode(ns.org!)).toBe('tighten');
    // The registry validates it like any org layer.
    return withTemporaryEntries(systemSettingsNamespaceRegistry, [ns], () => {
      expect(systemSettingsNamespaceRegistry.get('coachSample')?.org).toBeDefined();
    });
  });

  it('stores and reads only the added field; a system-only field beside it is refused', () => {
    const ns = orgNested();
    expect(readOrgFields(ns, { limits: { weekly: 20 } })).toEqual({ limits: { weekly: 20 } });
    // An organization naming `daily` (a system-only base field) gets nothing: the strict schema rejects the object.
    expect(ns.org!.schema.safeParse({ limits: { daily: 1 } }).success).toBe(false);
    expect(ns.org!.schema.safeParse({ limits: { weekly: 20, daily: 1 } }).success).toBe(false);
    expect(readOrgFields(ns, { limits: { weekly: 20, daily: 1 } })).toBeUndefined();
    expect(ns.org!.schema.safeParse({ enabled: false }).success).toBe(true); // stripped at the top level, never stored
    expect(Object.keys(ns.org!.schema.shape)).not.toContain('enabled');
  });

  it('shows an organization only the fields the layer made overridable, never the rest of the namespace', () => {
    const ns = orgNested();
    const system = { enabled: true, limits: { daily: 10, burst: 2, weekly: 50 } };
    const view = ns.org!.view!;
    expect(view(system)).toEqual({ limits: { weekly: 50 } });
    expect(view(applyOrgLayer(ns, system, { limits: { weekly: 20 } }).value)).toEqual({ limits: { weekly: 20 } });
    const top = extendSystemSettingsNamespace(BASE, {
      key: 'coachSample',
      storedSchema: z.object({ banner: z.string().max(20), secretish: z.string().max(5) }),
      defaults: { banner: 'hello', secretish: 'x' },
      org: { mode: 'override', fields: ['banner'] },
    });
    expect(top.org!.view!({ enabled: true, limits: { daily: 1, burst: 1 }, banner: 'hello', secretish: 'x' })).toEqual({ banner: 'hello' });
  });

  it('leaves what a layer that already existed showed unchanged', () => {
    const existing: SystemSettingsNamespace = {
      ...BASE,
      key: 'visibleSample',
      org: { schema: z.object({ enabled: z.boolean().optional() }), merge: 'override', readPermission: 'org_settings:read', writePermission: 'org_settings:write' },
    };
    const ns = extendSystemSettingsNamespace(existing, { key: 'visibleSample', storedSchema: z.object({ badge: z.string().max(5) }), defaults: { badge: 'b' }, org: { mode: 'override' } });
    expect(ns.org!.view).toBeUndefined();
  });

  it('tightens the added field and leaves every base field to the system value', () => {
    const ns = orgNested();
    const system = { enabled: true, limits: { daily: 10, burst: 2, weekly: 50 } };
    // lower is applied
    expect(applyOrgLayer(ns, system, { limits: { weekly: 20 } }).value).toEqual({ enabled: true, limits: { daily: 10, burst: 2, weekly: 20 } });
    // higher is refused: the system value is a ceiling
    expect(applyOrgLayer(ns, system, { limits: { weekly: 400 } }).value).toEqual(system);
  });

  it('supports every built-in tightener and a function', () => {
    const base = extendSystemSettingsNamespace(BASE, {
      key: 'coachSample',
      storedSchema: z.object({ on: z.boolean(), strict: z.boolean(), floor: z.number(), cap: z.number(), label: z.string().max(5) }),
      defaults: { on: true, strict: false, floor: 5, cap: 5, label: 'ab' },
      org: {
        mode: 'tighten',
        tighten: { on: 'and', strict: 'or', floor: 'max', cap: 'min', label: (system, org) => (String(org).length <= String(system).length ? org : system) },
      },
    });
    const system = { ...(base.defaults as object), enabled: true, limits: { daily: 1, burst: 1 } } as Record<string, unknown>;
    const apply = (org: Record<string, unknown>) => applyOrgLayer(base, system, org).value as Record<string, unknown>;
    expect(apply({ on: false }).on).toBe(false);
    expect(apply({ on: true }).on).toBe(true);
    expect(apply({ strict: true }).strict).toBe(true);
    expect(apply({ floor: 9 }).floor).toBe(9);
    expect(apply({ floor: 1 }).floor).toBe(5);
    expect(apply({ cap: 1 }).cap).toBe(1);
    expect(apply({ cap: 9 }).cap).toBe(5);
    expect(apply({ label: 'a' }).label).toBe('a');
    expect(apply({ label: 'abcd' }).label).toBe('ab');
    expect(orgLayerMode(base.org!)).toBe('tighten');
  });

  it('keeps the system value when the organization sends the wrong type for a tightener', () => {
    const ns = orgNested();
    const system = { enabled: true, limits: { daily: 10, burst: 2, weekly: 50 } };
    // `readOrgFields` would drop it; a merge fed one directly still cannot widen.
    expect((ns.org!.merge as (s: unknown, o: unknown) => unknown)(system, { limits: { weekly: 'lots' } })).toEqual(system);
  });

  it('an override layer on a top-level field is the plain string merge', () => {
    const ns = extendSystemSettingsNamespace(BASE, {
      key: 'coachSample',
      storedSchema: z.object({ banner: z.string().max(20) }),
      defaults: { banner: 'hello' },
      org: { mode: 'override' },
    });
    expect(ns.org!.merge).toBe('override');
    expect(orgLayerMode(ns.org!)).toBe('override');
    expect(Object.keys(ns.org!.schema.shape)).toEqual(['banner']);
    const system = { enabled: true, limits: { daily: 1, burst: 1 }, banner: 'hello' };
    expect(applyOrgLayer(ns, system, { banner: 'kappa' }).value).toEqual({ ...system, banner: 'kappa' });
  });

  it('an override at a nested path replaces the added field only, keeping its siblings', () => {
    const ns = nested({ org: { mode: 'override' } });
    expect(typeof ns.org!.merge).toBe('function');
    expect(orgLayerMode(ns.org!)).toBe('override');
    const system = { enabled: true, limits: { daily: 10, burst: 2, weekly: 50 } };
    expect(applyOrgLayer(ns, system, { limits: { weekly: 400 } }).value).toEqual({ enabled: true, limits: { daily: 10, burst: 2, weekly: 400 } });
  });

  it('refuses to make a base field org-overridable', () => {
    expect(() => nested({ org: { mode: 'override', fields: ['daily'] } })).toThrow(/names "daily", which the extension does not add/);
    expect(() => nested({ org: { mode: 'override', fields: ['weekly', 'enabled'] } })).toThrow(/names "enabled"/);
  });

  it('refuses a tighten layer without a tightener, with a stray tightener or with a bad mode', () => {
    expect(() => nested({ org: { mode: 'tighten' } })).toThrow(/needs org.tighten.weekly/);
    expect(() => nested({ org: { mode: 'tighten', tighten: { weekly: 'sideways' } } })).toThrow(/must be 'and', 'or', 'min', 'max' or a function/);
    expect(() => nested({ org: { mode: 'tighten', tighten: { weekly: 'min', other: 'min' } } })).toThrow(/names "other", which is not an org field/);
    expect(() => nested({ org: { mode: 'sideways' } })).toThrow(/org.mode must be/);
    expect(() => nested({ org: { mode: 'override', fields: [] } })).toThrow(/org.fields is empty/);
  });

  describe('on a namespace that already has an org layer', () => {
    const baseWithOrg: SystemSettingsNamespace = {
      ...BASE,
      key: 'guardedSample',
      org: {
        schema: z.object({ enabled: z.boolean().optional() }),
        merge: (system, org) => ({ ...(system as object), enabled: (system as { enabled: boolean }).enabled && ((org as { enabled?: boolean }).enabled ?? true) }) as never,
        readPermission: 'org_settings:read',
        writePermission: 'org_settings:write',
      },
    };

    it('adds its fields to the layer and keeps the base merge for the base fields', () => {
      const ns = extendSystemSettingsNamespace(baseWithOrg, {
        key: 'guardedSample',
        storedSchema: z.object({ badge: z.string().max(10) }),
        defaults: { badge: 'new' },
        org: { mode: 'override' },
      });
      expect(Object.keys(ns.org!.schema.shape)).toEqual(['enabled', 'badge']);
      // The base layer tightens, the extension overrides: the layer presents as tighten.
      expect(orgLayerMode(ns.org!)).toBe('tighten');
      const system = { enabled: true, limits: { daily: 1, burst: 1 }, badge: 'new' };
      expect(applyOrgLayer(ns, system, { enabled: false, badge: 'kappa' }).value).toEqual({ ...system, enabled: false, badge: 'kappa' });
      expect(applyOrgLayer(ns, { ...system, enabled: false }, { enabled: true }).value).toEqual({ ...system, enabled: false });
    });

    it('carries the added fields through a base org merge that builds its result field by field', () => {
      const explicit: SystemSettingsNamespace = {
        ...baseWithOrg,
        key: 'explicitSample',
        org: {
          ...baseWithOrg.org!,
          // Knows only `enabled` and `limits`, like notifications' tighten merge.
          merge: (system, org) => {
            const s = system as { enabled: boolean; limits: { daily: number; burst: number } };
            return { enabled: s.enabled && ((org as { enabled?: boolean }).enabled ?? true), limits: { daily: s.limits.daily, burst: s.limits.burst } } as never;
          },
        },
      };
      const ns = extendSystemSettingsNamespace(explicit, {
        key: 'explicitSample',
        storedSchema: z.object({ badge: z.string().max(10) }),
        defaults: { badge: 'new' },
        org: { mode: 'override' },
      });
      const system = { enabled: true, limits: { daily: 1, burst: 1 }, badge: 'new' };
      // The org tightens the base field only: the added field survives the base merge.
      expect(applyOrgLayer(ns, system, { enabled: false }).value).toEqual({ ...system, enabled: false });
      expect(applyOrgLayer(ns, system, { enabled: false, badge: 'kappa' }).value).toEqual({ ...system, enabled: false, badge: 'kappa' });
    });

    it('refuses different permissions (a namespace has one org permission pair) and a field already in the layer', () => {
      expect(() =>
        extendSystemSettingsNamespace(baseWithOrg, {
          key: 'guardedSample',
          storedSchema: z.object({ badge: z.string().max(10) }),
          defaults: { badge: 'new' },
          org: { mode: 'override', readPermission: 'billing:read' },
        }),
      ).toThrow(/already gated by org_settings:read/);
      expect(() =>
        extendSystemSettingsNamespace(baseWithOrg, {
          key: 'guardedSample',
          storedSchema: z.object({ enabled: z.boolean() }),
          defaults: { enabled: true },
          org: { mode: 'override' },
        }),
      ).toThrow(/already declares "enabled"/);
    });

    it('does not touch the org layer when the extension has no org block', () => {
      const ns = extendSystemSettingsNamespace(baseWithOrg, {
        key: 'guardedSample',
        storedSchema: z.object({ badge: z.string().max(10) }),
        defaults: { badge: 'new' },
      });
      expect(ns.org).toBe(baseWithOrg.org);
    });
  });

  it('a second org extension under the same nested root is refused with the remedy', () => {
    const first = orgNested();
    expect(() =>
      extendSystemSettingsNamespace(first, {
        key: 'coachSample',
        path: 'limits',
        storedSchema: z.object({ monthly: z.number() }),
        defaults: { monthly: 1 },
        org: { mode: 'override' },
      }),
    ).toThrow(/already owns "limits"; put every org field under one path root in one extension/);
  });
});

describe('a nested extension of a user namespace', () => {
  const userStored = z.object({ view: z.object({ density: z.enum(['a', 'b']).optional() }).optional(), theme: z.string().max(5).optional() });
  const BASE_USER: UserSettingsNamespace = {
    key: 'prefsSample',
    description: 'A sample user namespace.',
    schema: userStored,
    patchSchema: userStored,
    merge: (current, p) => {
      if (p === undefined) return current;
      if (p === null) return undefined;
      const c = (current ?? {}) as { view?: object };
      const q = p as { view?: object };
      return { ...c, ...q, ...(q.view || c.view ? { view: { ...c.view, ...q.view } } : {}) };
    },
  };
  const extend = () =>
    extendUserSettingsNamespace(BASE_USER, { key: 'prefsSample', path: 'view', schema: z.object({ zoom: z.number().int().min(1).max(5) }) });

  it('adds the field inside the nested object, refuses an existing leaf, a missing path and keeps the optional parent', () => {
    const ns = extend();
    expect(ns.schema.safeParse({ view: { zoom: 3 } }).success).toBe(true);
    expect(ns.schema.safeParse({ view: { zoom: 9 } }).success).toBe(false);
    expect(() => extendUserSettingsNamespace(BASE_USER, { key: 'prefsSample', path: 'view', schema: z.object({ density: z.string() }) })).toThrow(
      /schema\.view already declares "density"/,
    );
    expect(() => extendUserSettingsNamespace(BASE_USER, { key: 'prefsSample', path: 'zzz', schema: z.object({ a: z.string() }) })).toThrow(/no "zzz" field/);
  });

  it('merges: set, keep, null deletes, an emptied namespace collapses to absent', () => {
    const ns = extend();
    expect(ns.merge(undefined, { view: { zoom: 2 } })).toEqual({ view: { zoom: 2 } });
    expect(ns.merge({ view: { zoom: 2, density: 'a' } }, { theme: 'x' })).toEqual({ view: { zoom: 2, density: 'a' }, theme: 'x' });
    expect(ns.merge({ view: { zoom: 2, density: 'a' } }, { view: { zoom: null } })).toEqual({ view: { density: 'a' } });
    expect(ns.merge({ view: { zoom: 2 } }, null)).toBeUndefined();
    expect(ns.merge({ view: { zoom: 2 } }, undefined)).toEqual({ view: { zoom: 2 } });
  });
});

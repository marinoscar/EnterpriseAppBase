// Contributions, defaults overrides and the assembled order (PP-14.21).
import { z } from 'zod';

import { withTemporaryEntries } from '../../src/core/index';
import {
  applySettingsDefaultsOverrides,
  assembleSystemSettingsNamespaces,
  assembleUserSettingsNamespaces,
  overrideSettingsNamespaceDefaults,
  registerSettingsContribution,
  settingsContributionRegistry,
  settingsDefaultsOverrideRegistry,
  type SettingsContribution,
  type SystemSettingsNamespace,
  type UserSettingsNamespace,
} from '../../src/settings/index';

function system(key: string, extra: Partial<SystemSettingsNamespace> = {}): SystemSettingsNamespace {
  const stored = z.object({ size: z.number().int().min(1).max(100), nested: z.object({ flag: z.boolean() }), tags: z.record(z.string(), z.string()) });
  return {
    key,
    description: `Namespace ${key}.`,
    storedSchema: stored,
    patchSchema: stored.partial(),
    putSchema: stored,
    wirePatchSchema: stored.partial(),
    responseSchema: stored,
    defaults: { size: 10, nested: { flag: false }, tags: {} },
    requiredOnPut: false,
    merge: (current, patch) => ({ ...(current as object), ...((patch as object) ?? {}) }),
    ...extra,
  };
}

function user(key: string): UserSettingsNamespace {
  const stored = z.object({ view: z.string().max(10).optional() });
  return { key, description: `User ${key}.`, schema: stored, patchSchema: stored, merge: (current, patch) => (patch === null ? undefined : { ...(current as object), ...((patch as object) ?? {}) }) };
}

describe('overrideSettingsNamespaceDefaults', () => {
  it('changes only the defaults, deeply, leaving the shape, the merge and the other defaults', () => {
    const base = system('alpha');
    const [changed] = applySettingsDefaultsOverrides([base], [{ key: 'alpha', defaults: { size: 25, nested: { flag: true } } }]);
    expect(changed!.defaults).toEqual({ size: 25, nested: { flag: true }, tags: {} });
    expect(base.defaults).toEqual({ size: 10, nested: { flag: false }, tags: {} });
    expect(changed!.storedSchema).toBe(base.storedSchema);
    expect(changed!.merge).toBe(base.merge);
    expect(changed!.putSchema).toBe(base.putSchema);
    expect(changed!.requiredOnPut).toBe(false);
  });

  it('applies several overrides of one namespace in order, later over earlier', () => {
    const [changed] = applySettingsDefaultsOverrides(
      [system('alpha')],
      [
        { key: 'alpha', defaults: { size: 20 } },
        { key: 'alpha', defaults: { size: 30, nested: { flag: true } } },
      ],
    );
    expect(changed!.defaults).toEqual({ size: 30, nested: { flag: true }, tags: {} });
  });

  it('refuses a value the schema rejects, naming the namespace and the issue', () => {
    expect(() => applySettingsDefaultsOverrides([system('alpha')], [{ key: 'alpha', defaults: { size: 1000 } }])).toThrow(
      /"alpha".*does not satisfy its stored schema.*size/s,
    );
    expect(() => applySettingsDefaultsOverrides([system('alpha')], [{ key: 'alpha', defaults: { size: 'big' } }])).toThrow(/"alpha"/);
  });

  it('refuses a field the schema does not have, at any depth', () => {
    expect(() => applySettingsDefaultsOverrides([system('alpha')], [{ key: 'alpha', defaults: { sizee: 1 } }])).toThrow(/sizee is not a field/);
    expect(() => applySettingsDefaultsOverrides([system('alpha')], [{ key: 'alpha', defaults: { nested: { flagg: true } } }])).toThrow(
      /nested\.flagg is not a field/,
    );
  });

  it('accepts a key of a record field, which any schema leaves open', () => {
    const [changed] = applySettingsDefaultsOverrides([system('alpha')], [{ key: 'alpha', defaults: { tags: { team: 'blue' } } }]);
    expect((changed!.defaults as { tags: object }).tags).toEqual({ team: 'blue' });
  });

  it('refuses a __proto__ key instead of writing it onto the defaults', () => {
    const polluting = JSON.parse('{"tags":{"__proto__":{"admin":"yes"}}}') as Record<string, unknown>;
    expect(() => applySettingsDefaultsOverrides([system('alpha')], [{ key: 'alpha', defaults: polluting }])).toThrow(/"__proto__" is not a settings field/);
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
  });

  it('refuses an unknown namespace, listing the known ones', () => {
    expect(() => applySettingsDefaultsOverrides([system('alpha')], [{ key: 'ghost', defaults: { size: 1 } }])).toThrow(
      /"ghost": no such namespace. Known: alpha/,
    );
  });

  it('registers calls in order and refuses a malformed key or an empty value', async () => {
    await withTemporaryEntries(settingsDefaultsOverrideRegistry, [], () => {
      overrideSettingsNamespaceDefaults('alpha', { size: 5 });
      overrideSettingsNamespaceDefaults('alpha', { size: 6 });
      expect(settingsDefaultsOverrideRegistry.list().map((o) => o.defaults)).toEqual([{ size: 5 }, { size: 6 }]);
      expect(() => overrideSettingsNamespaceDefaults('Bad Key', { size: 1 })).toThrow(/not a settings namespace key/);
      expect(() => overrideSettingsNamespaceDefaults('alpha', {})).toThrow(/non-empty object/);
    });
  });
});

describe('the assembled order and contributions', () => {
  const contribution = (id: string, extra: Partial<SettingsContribution> = {}): SettingsContribution => ({ id, ...extra });

  it('lists the platform, then the contributions in import order, then the app', () => {
    const list = assembleSystemSettingsNamespaces({
      platform: [system('platformA'), system('platformB')],
      app: [system('appA')],
      contributions: [contribution('@kappa/one', { system: [system('contribOne')] }), contribution('@kappa/two', { system: [system('contribTwo')] })],
    });
    expect(list.map((ns) => ns.key)).toEqual(['platformA', 'platformB', 'contribOne', 'contribTwo', 'appA']);
    const users = assembleUserSettingsNamespaces({
      platform: [user('p')],
      app: [user('a')],
      contributions: [contribution('@kappa/one', { user: [user('c')] })],
    });
    expect(users.map((ns) => ns.key)).toEqual(['p', 'c', 'a']);
  });

  it('folds extensions into whichever namespace they name, contributions first, then the app', () => {
    const list = assembleSystemSettingsNamespaces({
      platform: [system('platformA')],
      app: [system('appA')],
      appExtensions: [{ key: 'platformA', storedSchema: z.object({ fromApp: z.string().max(5) }), defaults: { fromApp: 'a' } }],
      contributions: [
        contribution('@kappa/one', {
          system: [system('contribOne')],
          extensions: {
            system: [
              { key: 'platformA', storedSchema: z.object({ fromPkg: z.string().max(5) }), defaults: { fromPkg: 'p' } },
              { key: 'appA', path: 'nested', storedSchema: z.object({ deep: z.string().max(5) }), defaults: { deep: 'd' } },
            ],
          },
        }),
      ],
    });
    expect(Object.keys((list[0]!.storedSchema as z.ZodObject<z.ZodRawShape>).shape)).toEqual(['size', 'nested', 'tags', 'fromPkg', 'fromApp']);
    expect((list[2]!.defaults as { nested: object }).nested).toEqual({ flag: false, deep: 'd' });
    expect(list[0]!.defaults).toMatchObject({ fromPkg: 'p', fromApp: 'a' });
  });

  it('applies the defaults overrides after the extensions, so an override can reach an added field', () => {
    const list = assembleSystemSettingsNamespaces({
      platform: [system('platformA')],
      appExtensions: [{ key: 'platformA', storedSchema: z.object({ extra: z.number().int().min(1).max(9) }), defaults: { extra: 1 } }],
      appDefaults: [{ key: 'platformA', defaults: { extra: 7, size: 42 } }],
      contributions: [],
    });
    expect(list[0]!.defaults).toEqual({ size: 42, nested: { flag: false }, tags: {}, extra: 7 });
  });

  it('names the contribution that collides with a platform key, or with another contribution, or with the app', () => {
    expect(() =>
      assembleSystemSettingsNamespaces({ platform: [system('alpha')], contributions: [contribution('@kappa/one', { system: [system('alpha')] })] }),
    ).toThrow(/System settings namespace "alpha" is already registered: settings contribution "@kappa\/one" declares it, but the platform already does/);
    expect(() =>
      assembleSystemSettingsNamespaces({
        platform: [],
        contributions: [contribution('@kappa/one', { system: [system('alpha')] }), contribution('@kappa/two', { system: [system('alpha')] })],
      }),
    ).toThrow(/"alpha" is already registered: settings contribution "@kappa\/two" declares it, but settings contribution "@kappa\/one" already does/);
    expect(() =>
      assembleSystemSettingsNamespaces({ platform: [], app: [system('alpha')], contributions: [contribution('@kappa/one', { system: [system('alpha')] })] }),
    ).toThrow(/"alpha" is already registered: the app declares it, but settings contribution "@kappa\/one" already does/);
  });

  it('fails the boot, naming the key, when an extension names a namespace nobody declares', () => {
    expect(() =>
      assembleSystemSettingsNamespaces({
        platform: [system('alpha')],
        contributions: [contribution('@kappa/one', { extensions: { system: [{ key: 'missing', storedSchema: z.object({ a: z.string() }), defaults: { a: '' } }] } })],
      }),
    ).toThrow(/Cannot extend system settings namespace "missing": no such namespace. Known: alpha/);
  });

  it('reads the collected contributions by default, in import order', async () => {
    await withTemporaryEntries(settingsContributionRegistry, [], () => {
      registerSettingsContribution(contribution('@kappa/first', { system: [system('first')] }));
      registerSettingsContribution(contribution('@kappa/second', { system: [system('second')] }));
      expect(assembleSystemSettingsNamespaces({ platform: [system('base')] }).map((ns) => ns.key)).toEqual(['base', 'first', 'second']);
      expect(() => registerSettingsContribution(contribution('@kappa/first'))).toThrow(/already registered/);
    });
    expect(settingsContributionRegistry.has('@kappa/first')).toBe(false);
  });

  it('rejects a malformed contribution at registration', async () => {
    await withTemporaryEntries(settingsContributionRegistry, [], () => {
      expect(() => registerSettingsContribution({ id: '@kappa/bad', system: 'nope' as never })).toThrow(/system must be an array/);
      expect(() => registerSettingsContribution({ id: '@kappa/bad2', extensions: { user: {} as never } })).toThrow(/extensions.user must be an array/);
    });
  });
});

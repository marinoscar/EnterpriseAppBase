import { z } from 'zod';

import { pluggableDescriptorSchema } from '@marinoscar/platform-contract/settings';

import {
  PluggableSettingsError,
  PluggableUnknownError,
  RegistryError,
  definePluggableKind,
  listDefinedRegistries,
  withTemporaryEntries,
  type PluggableImplementation,
} from '../../../src/core';

interface Voice {
  say(text: string): string;
}

// Registry names are global per process: every test defines its own kind.
let counter = 0;
const uniqueKind = (): string => `spec-kind-${++counter}`;

const plain: PluggableImplementation<Voice, object, { volume: number; label: string }> = {
  id: 'plain',
  label: 'Plain voice',
  description: 'Says it as is',
  settingsSchema: z.object({
    volume: z.number().int().min(0).max(11).describe('Loudness'),
    label: z.string().max(20),
  }),
  defaults: { volume: 5, label: 'plain' },
  build: ({ settings }) => ({ say: (text) => `${settings.label}:${text}` }),
};

const keyed: PluggableImplementation<Voice, object, { host: string }> = {
  id: 'keyed',
  label: 'Keyed voice',
  settingsSchema: z.object({ host: z.string().default('example.test') }),
  defaults: { host: 'example.test' },
  secrets: [
    { name: 'apiKey', label: 'API key', required: true, help: 'From the vendor console' },
    { name: 'webhook', label: 'Webhook secret', required: false },
  ],
  build: async ({ settings, secret }) => ({ say: (text) => `${settings.host}:${text}:${String(secret)}` }),
  egressHosts: (settings) => [settings.host],
};

function makeKind() {
  const kind = definePluggableKind<Voice>({ kind: uniqueKind(), label: 'Voice' });
  kind.register(plain);
  kind.register(keyed);
  return kind;
}

describe('definePluggableKind', () => {
  describe('definition and registration', () => {
    it('defines a registry named pluggable.<kind>, in registration order', () => {
      const kind = makeKind();

      expect(listDefinedRegistries().map((r) => r.name)).toContain(`pluggable.${kind.kind}`);
      expect(kind.ids()).toEqual(['plain', 'keyed']);
      expect(kind.list().map((i) => i.id)).toEqual(['plain', 'keyed']);
      expect(kind.has('plain')).toBe(true);
      expect(kind.has('nope')).toBe(false);
      expect(kind.get('keyed')).toBe(keyed);
      expect(kind.label).toBe('Voice');
    });

    it('refuses a malformed or a duplicate kind id', () => {
      expect(() => definePluggableKind({ kind: 'Bad Kind', label: 'x' })).toThrow(/Invalid pluggable kind id/);
      expect(() => definePluggableKind({ kind: 'ok-kind', label: ' ' })).toThrow(/label/);
      const id = uniqueKind();
      definePluggableKind({ kind: id, label: 'one' });
      expect(() => definePluggableKind({ kind: id, label: 'two' })).toThrow(expect.objectContaining({ code: 'DUPLICATE_REGISTRY' }));
    });

    it('throws on a duplicate implementation id', () => {
      const kind = makeKind();

      expect(() => kind.register(plain)).toThrow(expect.objectContaining({ code: 'DUPLICATE_ID' }));
      expect(() => kind.register(plain)).toThrow(/Duplicate .* implementation "plain"/);
    });

    it('refuses an implementation id that does not match the pattern, or a structurally wrong implementation', () => {
      const kind = definePluggableKind<Voice>({ kind: uniqueKind(), label: 'Voice' });

      expect(() => kind.register({ ...plain, id: 'Plain' })).toThrow(RegistryError);
      expect(() => kind.register({ ...plain, id: 'p' })).toThrow(expect.objectContaining({ code: 'INVALID_ID' }));
      expect(() => kind.register({ ...plain, id: 'ok-one', label: '' })).toThrow(/label/);
      expect(() => kind.register({ ...plain, id: 'ok-two', settingsSchema: undefined as never })).toThrow(/settingsSchema/);
      expect(() =>
        kind.register({ ...plain, id: 'ok-three', secrets: [{ name: 'a', label: 'A', required: true }, { name: 'a', label: 'A', required: true }] }),
      ).toThrow(/declared twice/);
      expect(kind.ids()).toEqual([]);
    });

    it('freezes with the other defined registries', async () => {
      const kind = makeKind();
      const registry = listDefinedRegistries().find((r) => r.name === `pluggable.${kind.kind}`)!;

      await withTemporaryEntries(registry as never, [], () => {
        registry.freeze();
        expect(() => kind.register({ ...plain, id: 'late-one' })).toThrow(expect.objectContaining({ code: 'FROZEN' }));
      });
    });
  });

  describe('get with an unknown id', () => {
    it('throws PluggableUnknownError naming the kind, the id and the registered ids', () => {
      const kind = makeKind();

      let caught: unknown;
      try {
        kind.get('ghost');
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(PluggableUnknownError);
      const error = caught as PluggableUnknownError;
      expect(error.kind).toBe(kind.kind);
      expect(error.id).toBe('ghost');
      expect(error.registeredIds).toEqual(['plain', 'keyed']);
      expect(error.code).toBe('PLUGGABLE_UNKNOWN');
      expect(error.message).toContain(kind.kind);
      expect(error.message).toContain('"ghost"');
      expect(error.message).toContain('plain, keyed');
      expect(error.message).toContain('register()');
    });

    it('says (none) when nothing is registered', () => {
      const kind = definePluggableKind<Voice>({ kind: uniqueKind(), label: 'Voice' });

      expect(() => kind.get('x1')).toThrow(/Registered: \(none\)/);
    });
  });

  describe('parseSettings', () => {
    it('fills the implementation defaults under what is stored', () => {
      const kind = makeKind();

      expect(kind.parseSettings('plain', { volume: 9 })).toEqual({ volume: 9, label: 'plain' });
      expect(kind.parseSettings('plain', undefined)).toEqual({ volume: 5, label: 'plain' });
      expect(kind.parseSettings('plain', null)).toEqual({ volume: 5, label: 'plain' });
    });

    it('drops unknown keys (the schema strips them)', () => {
      const kind = makeKind();

      expect(kind.parseSettings('plain', { volume: 1, extra: true })).toEqual({ volume: 1, label: 'plain' });
    });

    it('throws PluggableSettingsError with the zod issues', () => {
      const kind = makeKind();

      let caught: unknown;
      try {
        kind.parseSettings('plain', { volume: 99 });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(PluggableSettingsError);
      const error = caught as PluggableSettingsError;
      expect(error.kind).toBe(kind.kind);
      expect(error.id).toBe('plain');
      expect(error.code).toBe('PLUGGABLE_SETTINGS_INVALID');
      expect(error.issues[0]?.path).toEqual(['volume']);
      expect(error.message).toContain('volume');
    });

    it('rejects a non-object value and an unknown id', () => {
      const kind = makeKind();

      expect(() => kind.parseSettings('plain', 'loud')).toThrow(PluggableSettingsError);
      expect(() => kind.parseSettings('ghost', {})).toThrow(PluggableUnknownError);
    });
  });

  describe('mergeSettingsRecord (write)', () => {
    it('merges a patch over the stored entry and parses it', () => {
      const kind = makeKind();

      const merged = kind.mergeSettingsRecord({ plain: { volume: 3, label: 'old' } }, { plain: { volume: 4 }, keyed: { host: 'h.test' } });

      expect(merged).toEqual({ plain: { volume: 4, label: 'old' }, keyed: { host: 'h.test' } });
    });

    it('rejects an unknown id in the patch', () => {
      const kind = makeKind();

      expect(() => kind.mergeSettingsRecord({}, { ghost: { a: 1 } })).toThrow(PluggableUnknownError);
    });

    it('rejects an invalid entry, naming the implementation', () => {
      const kind = makeKind();

      expect(() => kind.mergeSettingsRecord({}, { plain: { volume: 'loud' } })).toThrow(PluggableSettingsError);
      expect(() => kind.mergeSettingsRecord({}, { plain: 7 })).toThrow(/plain/);
    });

    it('removes an entry patched to null and keeps entries the patch does not name', () => {
      const kind = makeKind();

      const merged = kind.mergeSettingsRecord(
        { plain: { volume: 3, label: 'old' }, keyed: { host: 'h.test' }, retired: { a: 1 } },
        { plain: null },
      );

      expect(merged).toEqual({ keyed: { host: 'h.test' }, retired: { a: 1 } });
    });

    it('does not mutate the stored record', () => {
      const kind = makeKind();
      const stored = { plain: { volume: 3, label: 'old' } };

      kind.mergeSettingsRecord(stored, { plain: { volume: 4 } });

      expect(stored).toEqual({ plain: { volume: 3, label: 'old' } });
    });
  });

  describe('readSettingsRecord (read)', () => {
    it('drops unknown ids with a single warning that names all of them', () => {
      const kind = makeKind();
      const warn = jest.fn();

      const result = kind.readSettingsRecord({ plain: { volume: 2 }, gone: { a: 1 }, alsoGone: { b: 2 } }, warn);

      expect(result).toEqual({ plain: { volume: 2, label: 'plain' } });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('"gone", "alsoGone"');
      expect(warn.mock.calls[0][0]).toContain('plain, keyed');
    });

    it('does not warn when every stored id is registered', () => {
      const kind = makeKind();
      const warn = jest.fn();

      expect(kind.readSettingsRecord({ keyed: {} }, warn)).toEqual({ keyed: { host: 'example.test' } });
      expect(warn).not.toHaveBeenCalled();
    });

    it('falls back to the defaults of an entry that no longer parses, with a warning, and never throws', () => {
      const kind = makeKind();
      const warn = jest.fn();

      const result = kind.readSettingsRecord({ plain: { volume: 'loud' } }, warn);

      expect(result).toEqual({ plain: { volume: 5, label: 'plain' } });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('"plain"');
    });

    it('treats a missing record as empty', () => {
      const kind = makeKind();

      expect(kind.readSettingsRecord(undefined as never, jest.fn())).toEqual({});
    });
  });

  describe('describe and describeAll', () => {
    it('describes the non-secret fields (label, help) then one secret field per declared secret', () => {
      const kind = makeKind();

      expect(kind.describe('plain', { secrets: {} })).toEqual({
        kind: kind.kind,
        id: 'plain',
        label: 'Plain voice',
        description: 'Says it as is',
        fields: [
          { name: 'volume', kind: 'number', min: 0, max: 11, integer: true, label: 'Volume', help: 'Loudness' },
          { name: 'label', kind: 'string', maxLength: 20, label: 'Label' },
        ],
      });
      expect(kind.describe('keyed', { secrets: {} }).fields.slice(1)).toEqual([
        { name: 'apiKey', label: 'API key', help: 'From the vendor console', kind: 'secret', hasValue: false, required: true },
        { name: 'webhook', label: 'Webhook secret', kind: 'secret', hasValue: false, required: false },
      ]);
    });

    it('reflects presence flags, and a missing flag counts as no value', () => {
      const kind = makeKind();

      const fields = kind.describe('keyed', { secrets: { apiKey: true } }).fields;

      expect(fields.find((f) => f.name === 'apiKey')).toMatchObject({ kind: 'secret', hasValue: true });
      expect(fields.find((f) => f.name === 'webhook')).toMatchObject({ kind: 'secret', hasValue: false });
    });

    it('never carries a secret value, only the presence flag', () => {
      const kind = makeKind();

      const json = JSON.stringify(kind.describe('keyed', { secrets: { apiKey: true } }));

      expect(json).toContain('"hasValue":true');
      expect(json).not.toMatch(/"value"/);
    });

    it('validates against the contract descriptor schema', () => {
      const kind = makeKind();

      for (const descriptor of kind.describeAll(() => ({ secrets: { apiKey: true } }))) {
        expect(pluggableDescriptorSchema.safeParse(descriptor).success).toBe(true);
      }
    });

    it('describeAll asks for each implementation presence and keeps registration order', () => {
      const kind = makeKind();
      const presence = jest.fn((id: string): { secrets: Record<string, boolean> } => ({ secrets: id === 'keyed' ? { apiKey: true } : {} }));

      const all = kind.describeAll(presence);

      expect(all.map((d) => d.id)).toEqual(['plain', 'keyed']);
      expect(presence.mock.calls.map(([id]) => id)).toEqual(['plain', 'keyed']);
      expect(all[1]!.fields.find((f) => f.name === 'apiKey')).toMatchObject({ hasValue: true });
    });

    it('rejects an unknown id', () => {
      const kind = makeKind();

      expect(() => kind.describe('ghost', { secrets: {} })).toThrow(PluggableUnknownError);
    });
  });

  describe('build', () => {
    it('is what the consuming slice calls with the context, the parsed settings and a secret resolver', async () => {
      const kind = definePluggableKind<Voice, { tag: string }>({ kind: uniqueKind(), label: 'Voice' });
      kind.register({
        id: 'tagged',
        label: 'Tagged',
        settingsSchema: z.object({ n: z.number() }),
        defaults: { n: 1 },
        build: ({ tag, settings, secret }) => ({ say: (t) => `${tag}:${settings.n}:${t}:${typeof secret}` }),
      });

      const impl = kind.get('tagged');
      const voice = await impl.build({ tag: 'T', settings: kind.parseSettings('tagged', {}) as { n: number }, secret: async () => null });

      expect(voice.say('hi')).toBe('T:1:hi:function');
    });
  });
});

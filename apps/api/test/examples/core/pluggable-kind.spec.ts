import { PluggableSettingsError, PluggableUnknownError, RegistryFreezeService } from '@marinoscar/platform-api/core';
import { describePluggableKindConformance } from '@marinoscar/platform-api/core/testing';
import { pluggableDescriptorSchema } from '@marinoscar/platform-contract/settings';

// Registers the example implementations, exactly as the application does at import time.
import '../../../src/app-registrations/core';
import { GREETER_KIND_ID, greeterKind, plainGreeter, type Greeter } from '../../../src/platform-extensions/core/greeter.kind';

// =============================================================================
// PP-14.5 — a pluggable kind, proven end to end without any consumer slice
// =============================================================================
//
// `greeter` is a toy kind (src/platform-extensions/core/greeter.kind.ts) with
// two implementations registered by src/app-registrations/core.ts. Nothing in
// the platform consumes it, so this spec plays the consuming slice's part with
// a few lines: it keeps a settings record `{ <id>: settings }` and a secret
// store, merges writes, reads back, serves descriptors for a generated form
// and builds an instance with a secret resolver.
//
// Nothing here edits a package.
// =============================================================================

describePluggableKindConformance(greeterKind, { describe, it, expect });

/** The part of a consuming slice this spec stands in for. */
class FakeSlice {
  record: Record<string, Record<string, unknown>> = {};
  /** Encrypted credential store, reduced to a map. Settings never hold these. */
  readonly secrets = new Map<string, string>();
  readonly warnings: string[] = [];

  save(patch: Record<string, unknown>): void {
    this.record = greeterKind.mergeSettingsRecord(this.record, patch);
  }

  load(): Record<string, Record<string, unknown>> {
    return greeterKind.readSettingsRecord(this.record, (message) => this.warnings.push(message));
  }

  descriptors() {
    return greeterKind.describeAll((id) => ({
      secrets: Object.fromEntries(
        (greeterKind.get(id).secrets ?? []).map((spec) => [spec.name, this.secrets.has(`${id}/${spec.name}`)]),
      ),
    }));
  }

  async build(id: string): Promise<Greeter> {
    const impl = greeterKind.get(id);
    return impl.build({
      settings: greeterKind.parseSettings(id, this.load()[id]),
      secret: async (name) => this.secrets.get(`${id}/${name}`) ?? null,
    });
  }
}

describe('the greeter kind (an app-defined pluggable kind)', () => {
  it('registers both implementations under the kind registry, in order', () => {
    expect(greeterKind.kind).toBe(GREETER_KIND_ID);
    expect(greeterKind.ids()).toEqual(['plain', 'signed']);
  });

  it('refuses a duplicate implementation id', () => {
    expect(() => greeterKind.register(plainGreeter)).toThrow(expect.objectContaining({ code: 'DUPLICATE_ID' }));
  });

  it('names the kind, the id and the registered ids when an id is unknown', () => {
    const error = (() => {
      try {
        greeterKind.get('ghost');
      } catch (caught) {
        return caught as PluggableUnknownError;
      }
      throw new Error('expected get to throw');
    })();

    expect(error).toBeInstanceOf(PluggableUnknownError);
    expect(error.message).toContain('greeter');
    expect(error.message).toContain('"ghost"');
    expect(error.message).toContain('plain, signed');
  });

  describe('settings, as a consuming slice stores them', () => {
    it('fills defaults, merges a patch per implementation and builds from the parsed settings', async () => {
      const slice = new FakeSlice();

      slice.save({ plain: { shout: true, repeat: 2 } });

      expect(slice.record).toEqual({ plain: { greeting: 'Hello', shout: true, repeat: 2 } });
      await expect((await slice.build('plain')).greet('Ada')).resolves.toBe('HELLO, ADA! HELLO, ADA!');
    });

    it('rejects an unknown implementation and an invalid entry on write', () => {
      const slice = new FakeSlice();

      expect(() => slice.save({ ghost: { a: 1 } })).toThrow(PluggableUnknownError);
      expect(() => slice.save({ plain: { repeat: 9 } })).toThrow(PluggableSettingsError);
      expect(slice.record).toEqual({});
    });

    it('drops an implementation removed since it was stored, with one warning, on read', () => {
      const slice = new FakeSlice();
      slice.record = { plain: { greeting: 'Hi' }, retired: { a: 1 }, gone: { b: 2 } };

      expect(slice.load()).toEqual({ plain: { greeting: 'Hi', shout: false, repeat: 1 } });
      expect(slice.warnings).toHaveLength(1);
      expect(slice.warnings[0]).toContain('"retired", "gone"');
    });
  });

  describe('secrets', () => {
    it('are described as write-only fields with presence flags, never as values', () => {
      const slice = new FakeSlice();

      const before = slice.descriptors().find((d) => d.id === 'signed')!;
      slice.secrets.set('signed/apiKey', 'sk-super-secret');
      const after = slice.descriptors().find((d) => d.id === 'signed')!;

      expect(pluggableDescriptorSchema.safeParse(before).success).toBe(true);
      expect(before.fields.find((f) => f.name === 'apiKey')).toMatchObject({ kind: 'secret', hasValue: false, required: true });
      expect(after.fields.find((f) => f.name === 'apiKey')).toMatchObject({ kind: 'secret', hasValue: true });
      expect(JSON.stringify(slice.descriptors())).not.toContain('sk-super-secret');
    });

    it('describe every implementation for a generated form, labels and help included', () => {
      const descriptor = new FakeSlice().descriptors().find((d) => d.id === 'plain')!;

      expect(descriptor.fields).toEqual([
        { name: 'greeting', kind: 'string', maxLength: 40, label: 'Greeting', help: 'The word said before the name' },
        { name: 'shout', kind: 'boolean', label: 'Shout', help: 'Upper-case the whole greeting' },
        { name: 'repeat', kind: 'number', min: 1, max: 3, integer: true, label: 'Repeat', help: 'How many times to say it' },
      ]);
    });

    it('reach build through the resolver, and stay out of the stored settings', async () => {
      const slice = new FakeSlice();
      slice.save({ signed: { greeting: 'Salutations' } });
      slice.secrets.set('signed/apiKey', 'sk-super-secret');

      const greeting = await (await slice.build('signed')).greet('Ada');

      expect(greeting).toMatch(/^Salutations, Ada\. Signed: [0-9a-f]{8}$/);
      expect(JSON.stringify(slice.record)).not.toContain('sk-super-secret');
    });

    it('make build fail clearly when a required one is missing', async () => {
      await expect(new FakeSlice().build('signed')).rejects.toThrow(/apiKey/);
    });
  });

  describe('egress hosts', () => {
    it('are derived from the implementation settings, for the Doctor egress contributors', () => {
      const signed = greeterKind.get('signed');

      expect(signed.egressHosts?.({ greeting: 'x', style: 'formal', endpoint: 'https://greet.example.test/v1' })).toEqual([
        'greet.example.test',
      ]);
      expect(signed.egressHosts?.({ greeting: 'x', style: 'formal' })).toEqual([]);
    });
  });

  it('freezes with every other registry when the application has bootstrapped', () => {
    new RegistryFreezeService().onApplicationBootstrap();

    expect(() => greeterKind.register({ ...plainGreeter, id: 'late' })).toThrow(expect.objectContaining({ code: 'FROZEN' }));
  });
});

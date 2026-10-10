import { z } from 'zod';

import { RegistryError } from '../../../src/core';
import { SupportBundleRegistry } from '../../../src/doctor/support-bundle/support-bundle.registry';
import type { SupportBundleSection } from '../../../src/doctor/support-bundle/support-bundle-section.interface';

function section(id: string, overrides: Partial<SupportBundleSection> = {}): SupportBundleSection {
  return { id, label: id, schema: z.object({}).strict(), collect: async () => ({}), ...overrides };
}

describe('SupportBundleRegistry', () => {
  it('lists sections in registration order', () => {
    const registry = new SupportBundleRegistry();
    registry.register(section('meta'));
    registry.register(section('doctor'));
    registry.register(section('versions'));

    expect(registry.list().map((s) => s.id)).toEqual(['meta', 'doctor', 'versions']);
    expect(registry.get('doctor')?.id).toBe('doctor');
    expect(registry.get('missing')).toBeUndefined();
  });

  it('throws on a duplicate id, naming both', () => {
    const registry = new SupportBundleRegistry();
    registry.register(section('versions'));

    expect(() => registry.register(section('versions'))).toThrow(/Duplicate support-bundle section id "versions"/);
  });

  it.each(['Versions', '1meta', 'with space', 'a/b', ''])('refuses the id %j', (id) => {
    const registry = new SupportBundleRegistry();

    expect(() => registry.register(section(id))).toThrow(RegistryError);
  });

  it('refuses a section without collect(), without a zod schema or with a bad timeout', () => {
    const registry = new SupportBundleRegistry();

    expect(() => registry.register(section('a', { collect: undefined as never }))).toThrow(/no collect/);
    expect(() => registry.register(section('b', { schema: {} as never }))).toThrow(/no zod schema/);
    expect(() => registry.register(section('c', { timeoutMs: 0 }))).toThrow(/invalid timeoutMs/);
  });

  it('refuses registrations after bootstrap', () => {
    const registry = new SupportBundleRegistry();
    registry.onApplicationBootstrap();

    expect(() => registry.register(section('late'))).toThrow(expect.objectContaining({ code: 'FROZEN' }));
  });
});

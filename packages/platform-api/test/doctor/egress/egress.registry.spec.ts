import { RegistryError } from '../../../src/core';
import { EgressContributor, EgressRegistry } from '../../../src/doctor';

function contributor(id: string): EgressContributor {
  return { id, describe: async () => [] };
}

describe('EgressRegistry (#773)', () => {
  it('lists contributors in registration order, as a copy', () => {
    const registry = new EgressRegistry();
    registry.register(contributor('b'));
    registry.register(contributor('a'));

    const listed = registry.list();
    listed.pop();

    expect(registry.list().map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('throws on a duplicate id', () => {
    const registry = new EgressRegistry();
    registry.register(contributor('auth'));

    let caught: unknown;
    try {
      registry.register(contributor('auth'));
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(RegistryError);
    expect((caught as RegistryError).code).toBe('DUPLICATE_ID');
    expect((caught as RegistryError).message).toMatch(/Duplicate egress contributor id "auth"/);
    expect(registry.list()).toHaveLength(1);
  });

  it('refuses registrations after bootstrap', () => {
    const registry = new EgressRegistry();
    registry.onApplicationBootstrap();

    expect(() => registry.register(contributor('late'))).toThrow(RegistryError);
  });
});

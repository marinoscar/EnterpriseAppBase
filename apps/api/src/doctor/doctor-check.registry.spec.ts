import { DoctorCheck } from './doctor-check.interface';
import { DoctorCheckRegistry } from './doctor-check.registry';
import { RegistryError } from '../common/registry';

function check(id: string): DoctorCheck {
  return {
    id,
    category: 'core',
    label: id,
    run: async () => ({ status: 'pass', detail: 'ok' }),
  };
}

describe('DoctorCheckRegistry', () => {
  it('lists checks in registration order', () => {
    const registry = new DoctorCheckRegistry();

    registry.register(check('b'));
    registry.register(check('a'));

    expect(registry.list().map((c) => c.id)).toEqual(['b', 'a']);
    expect(registry.get('a')?.id).toBe('a');
    expect(registry.get('missing')).toBeUndefined();
  });

  it('throws on a duplicate id rather than silently dropping one check', () => {
    const registry = new DoctorCheckRegistry();

    registry.register(check('db.connection'));

    expect(() => registry.register(check('db.connection'))).toThrow(/Duplicate doctor check id "db.connection"/);
    expect(registry.list()).toHaveLength(1);
  });

  it('returns a copy, so a caller cannot mutate the registry through list()', () => {
    const registry = new DoctorCheckRegistry();
    registry.register(check('a'));

    registry.list().pop();

    expect(registry.list()).toHaveLength(1);
  });
});

describe('DoctorCheckRegistry on the registry primitive', () => {
  it('throws a RegistryError with code DUPLICATE_ID and the exact historical message', () => {
    const registry = new DoctorCheckRegistry();
    registry.register(check('db.connection'));

    let caught: unknown;
    try {
      registry.register(check('db.connection'));
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(RegistryError);
    expect((caught as RegistryError).code).toBe('DUPLICATE_ID');
    expect((caught as RegistryError).message).toBe(
      'Duplicate doctor check id "db.connection": Object and Object both register it. Check ids must be unique.',
    );
  });

  it('refuses registrations after onApplicationBootstrap and keeps serving reads', () => {
    const registry = new DoctorCheckRegistry();
    registry.register(check('a'));

    registry.onApplicationBootstrap();

    expect(() => registry.register(check('b'))).toThrow(expect.objectContaining({ code: 'FROZEN' }));
    expect(registry.list().map((c) => c.id)).toEqual(['a']);
    expect(registry.get('a')?.id).toBe('a');
  });

  it('freezing twice is harmless', () => {
    const registry = new DoctorCheckRegistry();

    registry.onApplicationBootstrap();
    registry.onApplicationBootstrap();

    expect(registry.list()).toEqual([]);
  });
});

import { afterEach, describe, expect, it } from 'vitest';

import {
  listEnvSpecFragments,
  registerEnvSpecFragment,
  resetEnvSpecRegistryForTests,
  resolveEnvMetadata,
} from './env-spec-registry.js';

describe('env-spec fragment registry', () => {
  afterEach(() => resetEnvSpecRegistryForTests());

  it('resolves a key to the metadata of the fragment that owns it', () => {
    registerEnvSpecFragment({ id: 'a', metadata: { ALPHA: { secret: true } } });
    registerEnvSpecFragment({ id: 'b', metadata: { BETA: { group: 'observability' } } });

    expect(resolveEnvMetadata('ALPHA')).toEqual({ secret: true });
    expect(resolveEnvMetadata('BETA')).toEqual({ group: 'observability' });
    expect(resolveEnvMetadata('GAMMA')).toBeUndefined();
  });

  it('lists fragments in registration order, as a copy', () => {
    registerEnvSpecFragment({ id: 'first', metadata: {} });
    registerEnvSpecFragment({ id: 'second', metadata: {} });

    const listed = listEnvSpecFragments();
    expect(listed.map((fragment) => fragment.id)).toEqual(['first', 'second']);
    expect(Object.isFrozen(listed)).toBe(true);
  });

  it('refuses a duplicate fragment id', () => {
    registerEnvSpecFragment({ id: 'telemetry', metadata: { A: {} } });
    expect(() => registerEnvSpecFragment({ id: 'telemetry', metadata: { B: {} } })).toThrow(
      /"telemetry" is already registered/,
    );
    expect(resolveEnvMetadata('B')).toBeUndefined();
  });

  it('refuses a key another fragment owns, naming both owners, and registers nothing', () => {
    registerEnvSpecFragment({ id: 'app', metadata: { GREPTIME_DB: { group: 'observability' } } });

    expect(() =>
      registerEnvSpecFragment({ id: 'telemetry', metadata: { OTHER: {}, GREPTIME_DB: {} } }),
    ).toThrow(/"GREPTIME_DB" is defined by env-spec fragment "app" and again by "telemetry"/);

    // All or nothing: the fragment's other key did not slip in.
    expect(resolveEnvMetadata('OTHER')).toBeUndefined();
    expect(listEnvSpecFragments().map((fragment) => fragment.id)).toEqual(['app']);
    expect(resolveEnvMetadata('GREPTIME_DB')).toEqual({ group: 'observability' });
  });

  it('refuses an empty id', () => {
    expect(() => registerEnvSpecFragment({ id: ' ', metadata: {} })).toThrow(/non-empty id/);
  });

  it('starts empty again after a reset', () => {
    registerEnvSpecFragment({ id: 'a', metadata: { ALPHA: {} } });
    resetEnvSpecRegistryForTests();

    expect(listEnvSpecFragments()).toEqual([]);
    expect(resolveEnvMetadata('ALPHA')).toBeUndefined();
    // The id and the key are free again.
    expect(() => registerEnvSpecFragment({ id: 'a', metadata: { ALPHA: {} } })).not.toThrow();
  });
});

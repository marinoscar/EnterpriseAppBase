import { RegistryError, withTemporaryEntries } from '../../../src/core';
import {
  ownerFieldOf,
  ownerRelationOf,
  registerUserOwnedModels,
  userOwnedModelRegistry,
  type UserOwnedModelDef,
} from '../../../src/core';

// =============================================================================
// The user-owned data registry's own rules (#688, moved by #699)
// =============================================================================
//
// The schema cross-check (every User relation registered, policies agree with
// onDelete) is the `userOwnedData` conformance suite
// (test/testing/user-owned-data.spec.ts). The reference app pins its own
// inventory in apps/api/src/prisma/ownership/user-owned-model.registry.spec.ts.
// =============================================================================

const valid: UserOwnedModelDef = {
  model: 'UserCredential',
  ownerField: 'userId',
  purge: 'delete',
  export: 'include',
  rationale: 'Test entry.',
};

/** Registers one entry for the duration of a no-op, and reports the error, if any. */
async function attempt(overrides: Partial<Record<keyof UserOwnedModelDef, unknown>>): Promise<RegistryError | undefined> {
  const def = { ...valid, model: 'Role', ...overrides } as UserOwnedModelDef;
  try {
    await withTemporaryEntries(userOwnedModelRegistry, [def], () => undefined);
    return undefined;
  } catch (err) {
    return err as RegistryError;
  }
}

describe('userOwnedModelRegistry', () => {
  it('is a static registry named user-owned-models, empty until an app fills it', () => {
    expect(userOwnedModelRegistry.name).toBe('user-owned-models');
    expect(userOwnedModelRegistry.size).toBe(0);
  });

  it('accepts a valid entry', async () => {
    await expect(attempt({})).resolves.toBeUndefined();
    await expect(attempt({ ownerField: undefined, actorFields: ['a', 'b'], purge: 'retain' })).resolves.toBeUndefined();
  });

  it.each<[string, Partial<Record<keyof UserOwnedModelDef, unknown>>, RegExp]>([
    ['no owner and no actor', { ownerField: undefined }, /ownerField, actorFields, or both/],
    ['an empty actor list and no owner', { ownerField: undefined, actorFields: [] }, /ownerField, actorFields, or both/],
    ['an empty owner field', { ownerField: ' ' }, /ownerField must not be empty/],
    ['an empty actor field', { actorFields: [''] }, /actorFields must be non-empty/],
    ['a repeated actor field', { ownerField: undefined, actorFields: ['a', 'a'] }, /must not repeat/],
    ['the owner also listed as an actor', { actorFields: ['userId'] }, /both the ownerField and an actor field/],
    ['an owner relation without an owner', { ownerField: undefined, actorFields: ['a'], ownerRelation: 'x' }, /ownerRelation requires/],
    ['an unknown purge policy', { purge: 'archive' }, /purge must be/],
    ['retain on an owned model', { purge: 'retain' }, /only for actor-only models/],
    ['an unknown export policy', { export: 'maybe' }, /export must be/],
    ['exportOmit on an excluded model', { export: 'exclude', exportOmit: ['secret'] }, /exportOmit is meaningless/],
    ['an empty rationale', { rationale: '  ' }, /rationale is required/],
  ])('rejects %s', async (_label, overrides, message) => {
    const err = await attempt(overrides);
    expect(err).toBeInstanceOf(RegistryError);
    expect(err?.code).toBe('INVALID_ENTRY');
    expect(err?.message).toMatch(message);
  });

  it('rejects an id that is not a Prisma model name', async () => {
    const err = await attempt({ model: 'user_credentials' });
    expect(err?.code).toBe('INVALID_ID');
  });

  it('registers a batch all or nothing, and rejects a second entry for a model', async () => {
    await withTemporaryEntries(userOwnedModelRegistry, [], () => {
      expect(() =>
        registerUserOwnedModels([valid, { ...valid, model: 'Note', purge: 'nope' as never }]),
      ).toThrow(RegistryError);
      expect(userOwnedModelRegistry.size).toBe(0);

      registerUserOwnedModels([valid]);
      expect(() => registerUserOwnedModels([valid])).toThrow(expect.objectContaining({ code: 'DUPLICATE_ID' }));
    });
    expect(userOwnedModelRegistry.size).toBe(0);
  });

  it('looks up owner fields and derives owner relations', async () => {
    const node: UserOwnedModelDef = { ...valid, model: 'WorkerNode', ownerField: 'createdById' };
    const audit: UserOwnedModelDef = { ...valid, model: 'AuditEvent', ownerField: undefined, actorFields: ['actorUserId'], purge: 'detach' };
    await withTemporaryEntries(userOwnedModelRegistry, [valid, node, audit], () => {
      expect(ownerFieldOf('UserCredential')).toBe('userId');
      expect(ownerFieldOf('WorkerNode')).toBe('createdById');
      expect(ownerFieldOf('AuditEvent')).toBeUndefined();
      expect(ownerFieldOf('Role')).toBeUndefined();
    });

    expect(ownerRelationOf(valid)).toBe('user');
    expect(ownerRelationOf({ ...valid, ownerField: 'uploadedById' })).toBe('uploadedBy');
    expect(ownerRelationOf({ ...valid, ownerRelation: 'owner' })).toBe('owner');
    expect(ownerRelationOf({ ...valid, ownerField: undefined, actorFields: ['a'] })).toBeUndefined();
  });

  it('narrows model names to an app type parameter', () => {
    type AppModel = 'Workout' | 'Meal';
    const defs: UserOwnedModelDef<AppModel>[] = [{ model: 'Workout', ownerField: 'userId', purge: 'delete', export: 'include', rationale: 'Log.' }];
    // @ts-expect-error a model name the app does not have
    const bad: UserOwnedModelDef<AppModel> = { ...defs[0]!, model: 'Wrokout' };
    expect(bad.model).toBe('Wrokout');
  });
});

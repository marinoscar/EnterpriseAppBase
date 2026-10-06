import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { RegistryError, withTemporaryEntries } from '../../common/registry';
import {
  ownerFieldOf,
  ownerRelationOf,
  PLATFORM_USER_OWNED_MODELS,
  userOwnedModelRegistry,
  type UserOwnedModelDef,
} from './index';
import { APP_USER_OWNED_MODELS } from '../../app-registrations/user-owned-models';

// =============================================================================
// The user-owned model registry: validation and the shipped inventory (#688)
// =============================================================================
//
// The schema cross-check (every User relation registered, policies agree with
// onDelete) is test/prisma/user-owned-models.spec.ts. This file pins the
// registry's own rules and the inventory's shape.
// =============================================================================

const valid: UserOwnedModelDef = {
  model: 'UserCredential',
  ownerField: 'userId',
  purge: 'delete',
  export: 'include',
  rationale: 'Test entry.',
};

/** Registers one entry under a model name not in the inventory, and reports the error, if any. */
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
  it('registers the platform inventory, then the (empty) app list', () => {
    expect(APP_USER_OWNED_MODELS).toEqual([]);
    expect(userOwnedModelRegistry.ids()).toEqual(PLATFORM_USER_OWNED_MODELS.map((def) => def.model));
  });

  it('holds 23 models and 25 User foreign keys', () => {
    const fields = userOwnedModelRegistry
      .list()
      .flatMap((def) => [...(def.ownerField ? [def.ownerField] : []), ...(def.actorFields ?? [])]);
    expect(userOwnedModelRegistry.size).toBe(23);
    expect(fields).toHaveLength(25);
  });

  it('gives every entry a non-empty rationale', () => {
    for (const def of userOwnedModelRegistry.list()) {
      expect(def.rationale.trim().length).toBeGreaterThan(10);
    }
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

  it('rejects a second entry for a registered model', async () => {
    const err = await attempt({ model: 'UserCredential' });
    expect(err?.code).toBe('DUPLICATE_ID');
  });

  it('looks up owner fields and derives owner relations', () => {
    expect(ownerFieldOf('UserCredential')).toBe('userId');
    expect(ownerFieldOf('WorkerNode')).toBe('createdById');
    expect(ownerFieldOf('AuditEvent')).toBeUndefined();
    expect(ownerFieldOf('Role')).toBeUndefined();

    expect(ownerRelationOf(valid)).toBe('user');
    expect(ownerRelationOf({ ...valid, ownerField: 'uploadedById' })).toBe('uploadedBy');
    expect(ownerRelationOf({ ...valid, ownerRelation: 'owner' })).toBe('owner');
    expect(ownerRelationOf({ ...valid, ownerField: undefined, actorFields: ['a'] })).toBeUndefined();
  });

  it('keeps the registry file framework-free (only the Prisma type and the primitive)', () => {
    const source = readFileSync(join(__dirname, 'user-owned-model.registry.ts'), 'utf8');
    const imports = [...source.matchAll(/^import\s.*?from\s+'([^']+)';/gms)].map((match) => match[0]);
    expect(imports).toEqual([
      "import type { Prisma } from '@prisma/client';",
      "import { defineRegistry } from '../../common/registry';",
    ]);
  });
});

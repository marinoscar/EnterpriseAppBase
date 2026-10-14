import { RegistryError, withTemporaryEntries } from '../../../src/core';
import {
  modelOwnershipRegistry,
  modelsOfKind,
  orgColumnOf,
  orgFieldOf,
  registerModelOwnership,
  type ModelOwnershipDef,
} from '../../../src/core';

// =============================================================================
// The model ownership registry's own rules (issue #725)
//
// The cross-check against the schema and the database (every `org` model has
// org_id and forced RLS, no other table has org_id) is the reference app's
// apps/api/test/tenancy/rls-coverage.db.spec.ts.
// =============================================================================

const valid: ModelOwnershipDef = { model: 'StorageObject', kind: 'org', rationale: 'Test entry.' };

async function attempt(overrides: Partial<Record<keyof ModelOwnershipDef, unknown>>): Promise<RegistryError | undefined> {
  const def = { ...valid, ...overrides } as ModelOwnershipDef;
  try {
    await withTemporaryEntries(modelOwnershipRegistry, [def], () => undefined);
    return undefined;
  } catch (err) {
    return err as RegistryError;
  }
}

describe('modelOwnershipRegistry', () => {
  it('is a static registry named model-ownership, empty until an app fills it', () => {
    expect(modelOwnershipRegistry.name).toBe('model-ownership');
    expect(modelOwnershipRegistry.size).toBe(0);
  });

  it.each(['org', 'org-optional', 'user', 'system'])('accepts kind %s', async (kind) => {
    await expect(attempt({ kind })).resolves.toBeUndefined();
  });

  it.each<[string, Partial<Record<keyof ModelOwnershipDef, unknown>>, RegExp]>([
    ['an unknown kind', { kind: 'tenant' }, /kind must be/],
    ['an org field on a user model', { kind: 'user', orgField: 'orgId' }, /orgField is only for/],
    ['an empty org field', { orgField: ' ' }, /orgField must not be empty/],
    ['an org reference on an org model', { orgReference: 'orgId' }, /orgReference is only for/],
    ['an empty org reference', { kind: 'system', orgReference: ' ' }, /orgReference must not be empty/],
    ['no rationale', { rationale: '' }, /rationale is required/],
  ])('refuses %s', async (_label, overrides, message) => {
    const err = await attempt(overrides);
    expect(err).toBeInstanceOf(RegistryError);
    expect(err?.code).toBe('INVALID_ENTRY');
    expect(err?.message).toMatch(message);
  });

  it('refuses a model name that is not PascalCase', async () => {
    expect((await attempt({ model: 'storage_object' }))?.code).toBe('INVALID_ID');
  });

  it('refuses a second entry for one model, atomically', async () => {
    await withTemporaryEntries(modelOwnershipRegistry, [valid], () => {
      expect(() => registerModelOwnership([{ model: 'Other', kind: 'system', rationale: 'x' }, valid])).toThrow(RegistryError);
      expect(modelOwnershipRegistry.has('Other')).toBe(false);
    });
  });

  it('lists models by kind and finds the org field', async () => {
    await withTemporaryEntries(
      modelOwnershipRegistry,
      [
        { model: 'Doc', kind: 'org', rationale: 'x' },
        { model: 'Audit', kind: 'org-optional', orgField: 'tenantId', rationale: 'x' },
        { model: 'Note', kind: 'user', rationale: 'x' },
        { model: 'Setting', kind: 'system', rationale: 'x' },
        { model: 'Member', kind: 'system', orgReference: 'orgId', rationale: 'x' },
      ],
      () => {
        expect(modelsOfKind('org').map((d) => d.model)).toEqual(['Doc']);
        expect(modelsOfKind('system').map((d) => d.model)).toEqual(['Setting', 'Member']);
        expect(orgFieldOf('Doc')).toBe('orgId');
        expect(orgFieldOf('Audit')).toBe('tenantId');
        expect(orgFieldOf('Note')).toBeUndefined();
        expect(orgFieldOf('Setting')).toBeUndefined();
        expect(orgFieldOf('Unknown')).toBeUndefined();
        expect(orgFieldOf('Member')).toBeUndefined();
        expect(orgColumnOf('Member')).toBe('orgId');
        expect(orgColumnOf('Doc')).toBe('orgId');
        expect(orgColumnOf('Audit')).toBe('tenantId');
        expect(orgColumnOf('Note')).toBeUndefined();
      },
    );
  });
});

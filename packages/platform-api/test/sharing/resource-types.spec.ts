// The resource-type registry (issue #729): validated at registration with a
// message naming the type, a group-ownable type also lands in the #728
// group-owned-resource registry (once), and the defaults are applied.

import { RegistryError } from '../../src/core/index';
import { findResourceType, requireResourceType } from '../../src/sharing/access/resource-types';
import { groupOwnedResourceRegistry, registerGroupOwnedResource, registerResourceType, resourceTypeRegistry } from '../../src/sharing/index';
import { docType, withTypes } from './grants-fakes';

function refusal(fn: () => void): RegistryError {
  try {
    fn();
  } catch (error) {
    return error as RegistryError;
  }
  throw new Error('expected a refusal');
}

describe('registerResourceType', () => {
  it('refuses an action that needs an unknown role, naming the type', async () => {
    await withTypes([], () => {
      const error = refusal(() => registerResourceType(docType(new Map(), { actions: { read: 'reader' as never } })));
      expect(error).toBeInstanceOf(RegistryError);
      expect(error.code).toBe('INVALID_ENTRY');
      expect(error.message).toContain('resource type "test_doc"');
      expect(error.message).toContain('action "read"');
      expect(resourceTypeRegistry.has('test_doc')).toBe(false);
    });
  });

  it('refuses group ownership without countOwnedByGroup, naming the type', async () => {
    await withTypes([], () => {
      for (const ownership of ['group', 'user_or_group'] as const) {
        const def = docType(new Map(), { ownership });
        delete (def as { countOwnedByGroup?: unknown }).countOwnedByGroup;
        const error = refusal(() => registerResourceType(def));
        expect(error.code).toBe('INVALID_ENTRY');
        expect(error.message).toMatch(/resource type "test_doc".*countOwnedByGroup/);
      }
    });
  });

  it.each([
    ['empty roles', { roles: [] }, '`roles` must be a non-empty array'],
    ['duplicate roles', { roles: ['viewer', 'viewer'] }, '`roles` must be unique'],
    ["'owner' as a role", { roles: ['viewer', 'owner'] }, "'owner' is implicit"],
    ['an unknown orgRole', { orgRole: 'admin' }, '`orgRole`'],
    ["'org' visibility without orgRole", { defaultVisibility: 'org' }, 'needs `orgRole`'],
    ['an unknown grantable role', { grantable: { user: ['owner'] } }, '`grantable.user`'],
    ['an unknown grantable kind', { grantable: { robot: ['viewer'] } }, '`grantable` key "robot"'],
    ['an unknown groupRoleMap role', { groupRoleMap: { admin: 'boss', editor: 'editor', viewer: 'viewer' } }, '`groupRoleMap.admin`'],
    ['a permission map naming an undeclared action', { actionPermissions: { publish: 'docs:publish' } }, 'action "publish"'],
    ['a zero grant cap', { maxGrantsPerResource: 0 }, '`maxGrantsPerResource`'],
    ['an unknown denyAs', { denyAs: 'hidden' }, '`denyAs`'],
  ])('refuses %s', async (_name, overrides, message) => {
    await withTypes([], () => {
      const error = refusal(() => registerResourceType(docType(new Map(), overrides as never)));
      expect(error.code).toBe('INVALID_ENTRY');
      expect(error.message).toContain('resource type "test_doc"');
      expect(error.message).toContain(message);
    });
  });

  it('refuses a malformed id and a duplicate', async () => {
    await withTypes([], () => {
      expect(refusal(() => registerResourceType(docType(new Map(), { type: 'Test-Doc' }))).code).toBe('INVALID_ID');
      registerResourceType(docType(new Map()));
      expect(refusal(() => registerResourceType(docType(new Map()))).code).toBe('DUPLICATE_ID');
    });
  });

  it('registers a group-ownable type as a group-owned resource, once, and a user-owned one not at all', async () => {
    await withTypes([docType(new Map()), docType(new Map(), { type: 'note', ownership: 'user', countOwnedByGroup: undefined })], () => {
      expect(groupOwnedResourceRegistry.has('test_doc')).toBe(true);
      expect(groupOwnedResourceRegistry.has('note')).toBe(false);
    });
  });

  it('does not register a type twice when the app already declared it group-owned', async () => {
    await withTypes([], () => {
      const appCount = jest.fn().mockResolvedValue(3);
      registerGroupOwnedResource({ type: 'test_doc', countOwnedByGroup: appCount });
      expect(() => registerResourceType(docType(new Map()))).not.toThrow();
      expect(groupOwnedResourceRegistry.ids().filter((id) => id === 'test_doc')).toHaveLength(1);
      expect(groupOwnedResourceRegistry.get('test_doc')!.countOwnedByGroup).toBe(appCount);
    });
  });

  it('is frozen once the application bootstrapped', async () => {
    await withTypes([], () => {
      resourceTypeRegistry.freeze();
      expect(refusal(() => registerResourceType(docType(new Map()))).code).toBe('FROZEN');
    });
  });
});

describe('the resolved defaults', () => {
  it('maps group roles admin -> owner, editor -> strongest, viewer -> weakest; share defaults to owner', async () => {
    const def = docType(new Map(), { actions: { read: 'viewer', write: 'editor' } });
    await withTypes([def], () => {
      const rt = requireResourceType('test_doc');
      expect([rt.groupRole('admin'), rt.groupRole('editor'), rt.groupRole('viewer')]).toEqual(['owner', 'editor', 'viewer']);
      expect(rt.required('share')).toBe('owner');
      expect(rt.required('publish')).toBeUndefined();
      expect([rt.rank('viewer'), rt.rank('editor'), rt.rank('owner'), rt.rank('nope')]).toEqual([1, 2, 3, 0]);
      expect(rt.grantable('user')).toEqual(['viewer', 'editor']);
      expect(rt.grantable('group')).toEqual(['viewer', 'editor']);
      expect(rt.grantable('link')).toEqual([]);
      expect([rt.denyAs, rt.maxGrantsPerResource, rt.defaultVisibility]).toEqual(['not_found', 500, 'private']);
    });
  });

  it('calls an unknown type a programming error', () => {
    expect(findResourceType('never_registered')).toBeUndefined();
    expect(() => requireResourceType('never_registered')).toThrow(/Unknown resource type "never_registered"/);
  });
});

// Test doubles for the grants specs (issue #729). Not a spec.

import { groupOwnedResourceRegistry, resourceTypeRegistry, registerResourceType, type ResourceOwner, type ResourceTypeDef } from '../../src/sharing/index';
import { withTemporaryEntries } from '../../src/core/index';
import { ORG } from './fakes';

export const DOC_A = 'd0000000-0000-4000-8000-00000000000a';
export const DOC_B = 'd0000000-0000-4000-8000-00000000000b';
export const DOC_C = 'd0000000-0000-4000-8000-00000000000c';
export const GROUP_2 = '77777777-7777-4777-8777-777777777777';

/** An in-memory table of records: id -> owner and org. */
export type OwnerTable = Map<string, { owner: ResourceOwner; orgId: string }>;

/** A shareable type over `table`, kvox-shaped by default (viewer/editor, write needs transcripts:write). */
export function docType(table: OwnerTable, overrides: Partial<ResourceTypeDef<'viewer' | 'editor'>> = {}): ResourceTypeDef<'viewer' | 'editor'> & { loadOwners: jest.Mock } {
  const loadOwners = jest.fn(async (ids: readonly string[]) => new Map([...table].filter(([id]) => ids.includes(id))));
  return {
    type: 'test_doc',
    roles: ['viewer', 'editor'],
    actions: { read: 'viewer', write: 'editor', share: 'owner', delete: 'owner' },
    actionPermissions: { write: 'docs:write' },
    bypassPermissions: { read: 'docs:read_any' },
    ownership: 'user_or_group',
    countOwnedByGroup: jest.fn().mockResolvedValue(0),
    loadOwners,
    ...overrides,
  } as ResourceTypeDef<'viewer' | 'editor'> & { loadOwners: jest.Mock };
}

/** A user-owned record of ORG. */
export function byUser(userId: string, orgId = ORG) {
  return { owner: { kind: 'user' as const, userId }, orgId };
}

/** A group-owned record of ORG. */
export function byGroup(groupId: string, orgId = ORG) {
  return { owner: { kind: 'group' as const, groupId }, orgId };
}

/** Registers `defs` for the duration of `fn`, in both registries, and puts both back. */
export function withTypes<R>(defs: ResourceTypeDef[], fn: () => Promise<R> | R): Promise<R> {
  return withTemporaryEntries(groupOwnedResourceRegistry, [], () =>
    withTemporaryEntries(resourceTypeRegistry, [], async () => {
      for (const def of defs) registerResourceType(def);
      return fn();
    }),
  );
}

/** A grant row as `grant.findMany` returns it for AccessPolicy. */
export function grantRow(input: { resourceId: string; role: string; userId?: string; groupId?: string; resourceType?: string }) {
  return {
    resourceType: input.resourceType ?? 'test_doc',
    resourceId: input.resourceId,
    granteeKind: input.groupId ? 'group' : 'user',
    granteeUserId: input.userId ?? null,
    granteeGroupId: input.groupId ?? null,
    role: input.role,
  };
}

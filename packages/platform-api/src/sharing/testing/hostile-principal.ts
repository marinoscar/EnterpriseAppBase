// =============================================================================
// A principal full of hostile strings, one DISTINCT value per field (PP-14.16)
// =============================================================================
//
// The conformance kits build a rule's or a grantee kind's SQL from a principal
// whose every string field carries a payload, and a different one per field, so
// a test can tell WHICH field reached the SQL: the organization bound in a
// sub-select must be the organization value, not any other. Not a spec.
// =============================================================================

import type { Principal } from '../../core/index';

/**
 * A hostile principal and the strings in it.
 *
 * @stability experimental
 */
export interface HostilePrincipal {
  /** The principal: every string field and array element carries `payload` plus its field name. */
  readonly principal: Principal;
  /** The value of `activeOrgId` (and of the groups' `orgId`): the one a sub-select must bind. */
  readonly orgValue: string;
  /** Every string put into the principal (none may appear in SQL text). */
  readonly values: readonly string[];
}

/**
 * Builds a principal like `base` whose string fields are all `payload` tagged
 * with the field name. Arrays are fuzzed too.
 *
 * @param base - a principal of the fixture matrix.
 * @param payload - the hostile string.
 * @returns the principal, its organization value and every string used.
 *
 * @stability experimental
 */
export function hostilePrincipal(base: Principal, payload: string): HostilePrincipal {
  const values: string[] = [];
  const tag = (field: string): string => {
    const value = `${payload}#${field}`;
    values.push(value);
    return value;
  };
  const orgValue = tag('activeOrgId');
  const principal = {
    ...base,
    userId: tag('userId'),
    email: tag('email'),
    roles: [tag('role-1'), tag('role-2')],
    permissions: [tag('permission-1'), tag('permission-2')],
    activeOrgId: orgValue,
    memberships: [{ orgId: tag('membership-org'), role: tag('membership-role'), status: 'active' as const }],
    groups: [
      { groupId: tag('group-1-id'), orgId: orgValue, role: tag('group-1-role') },
      { groupId: tag('group-2-id'), orgId: orgValue, role: tag('group-2-role') },
    ],
    ...(base.kind === 'node' ? { nodeId: tag('nodeId') } : {}),
  } as unknown as Principal;
  return { principal, orgValue, values };
}

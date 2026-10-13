// =============================================================================
// The role catalog: which roles exist, what they are called and who may assign
// them (PP-14.15)
// =============================================================================
//
// One place answers three questions for the invite, member, user-role and
// test-login routes and for `GET /api/roles`:
//
//   1. Does the role exist, and in which scope?
//   2. What is it called (the label the dialogs show)?
//   3. May a caller assign it (`assignable`)?
//
// The answer comes from core's `roleRegistry` (the platform roles, the app's
// roles and the roles of registered permission sets), plus the platform's own
// four roles when the registry does not hold them (an app that never ran
// `registerPlatformPermissions()` still has them: they are seeded
// unconditionally). Pure functions over a static registry, like
// `buildPermissionCatalog()`: no provider, so every module sees the same
// answer, and a test extends it with `withTemporaryEntries(roleRegistry, ...)`.
//
// FAIL-CLOSED. A role that is not in the catalog, is of the wrong scope or is
// registered `assignable: false` is refused with the same 400 and
// `details.reason: ROLE_NOT_ASSIGNABLE`; the response never says which of the
// three it was. The database is NOT the authority on what may be assigned: a
// `roles` row exists for every registered role, but a row left behind by a
// removed registration, or inserted by hand, is not assignable.
// =============================================================================

import { BadRequestException } from '@nestjs/common';
import { ROLE_NOT_ASSIGNABLE_REASON, type RoleDescriptor, type RoleScopeValue } from '@marinoscar/platform-contract/identity';

import { roleRegistry, type RoleDeclaration } from '../../core/index';
import { IDENTITY_ROLES } from '../identity.permissions';

/** The label of a role that declares none: `support_lead` reads as `Support lead`. */
function defaultLabel(id: string): string {
  const words = id.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Every known role declaration: the platform's own four first (the registry's
 * version of each when it holds one), then the registry's other roles in
 * registration order. In an app the registry already holds the platform roles
 * first, so this is registration order.
 */
function declarations(): readonly RoleDeclaration[] {
  const registered = roleRegistry.list();
  const byId = new Map(registered.map((role) => [role.id, role] as const));
  const builtins = Object.values(IDENTITY_ROLES).map((role) => byId.get(role.id) ?? role);
  const builtinIds = new Set(builtins.map((role) => role.id));
  return [...builtins, ...registered.filter((role) => !builtinIds.has(role.id))];
}

/**
 * One role as `GET /api/roles` describes it.
 *
 * @param role - the declaration.
 * @returns the descriptor: label defaulted, `assignable` defaulted to `true`.
 *
 * @stability experimental
 */
export function describeRole(role: RoleDeclaration): RoleDescriptor {
  return {
    id: role.id,
    label: role.label ?? defaultLabel(role.id),
    description: role.description,
    scope: role.scope,
    assignable: role.assignable ?? true,
  };
}

/**
 * Every known role, in registration order (the platform roles first),
 * optionally of one scope.
 *
 * @param scope - only roles of this scope; every scope when omitted.
 * @returns the descriptors.
 *
 * @example
 * ```ts
 * listRoles('org').filter((role) => role.assignable); // what an organization administrator can hand out
 * ```
 *
 * @stability experimental
 */
export function listRoles(scope?: RoleScopeValue): RoleDescriptor[] {
  return declarations()
    .filter((role) => scope === undefined || role.scope === scope)
    .map(describeRole);
}

/**
 * The 400 for a role that cannot be assigned: unknown, of the wrong scope, or
 * registered `assignable: false`. One message and one `details.reason` for all
 * three, so a caller learns nothing about roles it cannot assign.
 *
 * @param role - the role id as the caller sent it.
 *
 * @stability experimental
 */
export function roleNotAssignable(role: string): BadRequestException {
  // The id is echoed so the caller can see which of several it was; a request
  // body can carry any string, so it is cut short.
  const shown = role.length > 64 ? `${role.slice(0, 64)}...` : role;
  return new BadRequestException({
    message: `The role "${shown}" cannot be assigned`,
    details: { reason: ROLE_NOT_ASSIGNABLE_REASON, role: shown },
  });
}

/**
 * Whether `role` is a known, assignable role of `scope`: the predicate behind
 * {@link assertRoleAssignable}, for a caller that must skip rather than fail.
 *
 * @param role - the role id.
 * @param scope - the scope the caller assigns.
 * @returns `true` when the role exists in that scope and is not registered `assignable: false`.
 *
 * @stability experimental
 */
export function isRoleAssignable(role: string, scope: RoleScopeValue): boolean {
  const found = declarations().find((candidate) => candidate.id === role);
  return found !== undefined && found.scope === scope && found.assignable !== false;
}

/**
 * Whether the application registered `role` as `assignable: false` (a role it
 * manages itself). An unknown role is not "unassignable" in this sense: it is
 * simply not a role the application declared.
 *
 * @param role - the role id.
 * @returns `true` only for a registered role declared `assignable: false`.
 *
 * @stability experimental
 */
export function isAppManagedRole(role: string): boolean {
  return declarations().find((candidate) => candidate.id === role)?.assignable === false;
}

/**
 * Throws unless `role` is a known, assignable role of `scope`. Call it before
 * any lookup or write that would give the role to someone.
 *
 * @param role - the role id as the caller sent it.
 * @param scope - the scope the route assigns: `org` for a membership or an invitation, `system` for `user_roles`.
 * @throws BadRequestException (`details.reason: ROLE_NOT_ASSIGNABLE`) when the role is unknown, of another scope or not assignable.
 *
 * @example
 * ```ts
 * assertRoleAssignable(dto.roleName, 'org');
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function assertRoleAssignable(role: string, scope: RoleScopeValue): void {
  if (!isRoleAssignable(role, scope)) throw roleNotAssignable(role);
}

/**
 * Throws unless `role` is a known, assignable role of EITHER scope, and
 * returns its scope. For `PUT /api/users/:id/roles`, which takes system roles
 * and (in single-organization mode) org roles in one list.
 *
 * @param role - the role id as the caller sent it.
 * @returns the role's scope.
 * @throws BadRequestException (`details.reason: ROLE_NOT_ASSIGNABLE`) when the role is unknown or not assignable.
 *
 * @stability experimental
 */
export function assertAnyRoleAssignable(role: string): RoleScopeValue {
  const found = declarations().find((candidate) => candidate.id === role);
  if (!found || found.assignable === false) throw roleNotAssignable(role);
  return found.scope;
}

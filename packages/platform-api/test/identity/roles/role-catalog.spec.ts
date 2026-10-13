import { BadRequestException } from '@nestjs/common';

import { roleRegistry, withTemporaryEntries, type RoleDeclaration } from '../../../src/core';
import {
  assertAnyRoleAssignable,
  assertRoleAssignable,
  describeRole,
  isRoleAssignable,
  listRoles,
} from '../../../src/identity/roles/role-catalog';

// =============================================================================
// The role catalog (PP-14.15): one fail-closed answer for every assignment route
// =============================================================================

const COACH: RoleDeclaration = { id: 'coach', description: 'Reviews workouts', scope: 'org', label: 'Coach' };
const SUPPORT: RoleDeclaration = { id: 'support', description: 'Reads the user list', scope: 'system' };
const INTERNAL: RoleDeclaration = { id: 'robot', description: 'Managed by the app', scope: 'org', assignable: false };
const APP_ROLES: RoleDeclaration[] = [COACH, SUPPORT, INTERNAL];

function reasonOf(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(BadRequestException);
    return ((err as BadRequestException).getResponse() as { details: { reason: string } }).details.reason;
  }
  throw new Error('expected a 400');
}

describe('the role catalog', () => {
  it('knows the four platform roles even when nothing was registered', () => {
    expect(listRoles().map((role) => `${role.id}:${role.scope}:${role.assignable}`)).toEqual([
      'admin:system:true',
      'contributor:org:true',
      'viewer:org:true',
      'org_admin:org:true',
    ]);
    expect(listRoles('org').map((role) => role.label)).toEqual(['Contributor', 'Viewer', 'Administrator']);
    expect(listRoles('system').map((role) => role.id)).toEqual(['admin']);
  });

  it('lists registered roles after the platform ones, with a defaulted label and assignable flag', async () => {
    await withTemporaryEntries(roleRegistry, APP_ROLES, () => {
      const roles = listRoles();
      expect(roles.map((role) => role.id)).toEqual(expect.arrayContaining(['coach', 'support', 'robot']));
      expect(roles.find((role) => role.id === 'coach')).toEqual({
        id: 'coach',
        label: 'Coach',
        description: 'Reviews workouts',
        scope: 'org',
        assignable: true,
      });
      expect(roles.find((role) => role.id === 'support')?.label).toBe('Support');
      expect(roles.find((role) => role.id === 'robot')?.assignable).toBe(false);
      expect(describeRole({ id: 'support_lead', description: 'd', scope: 'system' }).label).toBe('Support lead');
    });
  });

  it('prefers the registry declaration over the built-in one and does not list a role twice', async () => {
    const registered: RoleDeclaration[] = [
      { id: 'admin', description: 'System administrator', scope: 'system', label: 'Root' },
      { id: 'viewer', description: 'Viewer', scope: 'org', assignable: false },
    ];
    await withTemporaryEntries(roleRegistry, registered, () => {
      const ids = listRoles().map((role) => role.id);
      expect(ids.filter((id) => id === 'admin')).toHaveLength(1);
      expect(listRoles('system')[0]?.label).toBe('Root');
      expect(isRoleAssignable('viewer', 'org')).toBe(false);
    });
  });
});

describe('assertRoleAssignable (fail closed)', () => {
  it('admits a built-in org role and a registered assignable org role', async () => {
    expect(() => assertRoleAssignable('viewer', 'org')).not.toThrow();
    expect(() => assertRoleAssignable('org_admin', 'org')).not.toThrow();
    await withTemporaryEntries(roleRegistry, APP_ROLES, () => {
      expect(() => assertRoleAssignable('coach', 'org')).not.toThrow();
      expect(() => assertRoleAssignable('support', 'system')).not.toThrow();
    });
  });

  it('refuses, with one reason, an unknown role, a role of the other scope and an unassignable role', async () => {
    await withTemporaryEntries(roleRegistry, APP_ROLES, () => {
      expect(reasonOf(() => assertRoleAssignable('ghost', 'org'))).toBe('ROLE_NOT_ASSIGNABLE');
      // The system admin is never an org role: no invite or member update can mint one.
      expect(reasonOf(() => assertRoleAssignable('admin', 'org'))).toBe('ROLE_NOT_ASSIGNABLE');
      expect(reasonOf(() => assertRoleAssignable('support', 'org'))).toBe('ROLE_NOT_ASSIGNABLE');
      expect(reasonOf(() => assertRoleAssignable('coach', 'system'))).toBe('ROLE_NOT_ASSIGNABLE');
      expect(reasonOf(() => assertRoleAssignable('robot', 'org'))).toBe('ROLE_NOT_ASSIGNABLE');
    });
  });

  it('gives the same message for every refusal, so it says nothing about roles the caller cannot assign', async () => {
    await withTemporaryEntries(roleRegistry, APP_ROLES, () => {
      const message = (role: string): string => {
        try {
          assertRoleAssignable(role, 'org');
        } catch (err) {
          return ((err as BadRequestException).getResponse() as { message: string }).message;
        }
        return '';
      };
      expect(message('robot')).toBe('The role "robot" cannot be assigned');
      expect(message('ghost')).toBe('The role "ghost" cannot be assigned');
    });
  });

  it('is not fooled by prototype keys or case', () => {
    for (const role of ['__proto__', 'constructor', 'toString', 'Viewer', 'VIEWER', 'viewer ', '']) {
      expect(reasonOf(() => assertRoleAssignable(role, 'org'))).toBe('ROLE_NOT_ASSIGNABLE');
    }
  });
});

describe('assertAnyRoleAssignable', () => {
  it('returns the scope of an assignable role and refuses the rest', async () => {
    await withTemporaryEntries(roleRegistry, APP_ROLES, () => {
      expect(assertAnyRoleAssignable('admin')).toBe('system');
      expect(assertAnyRoleAssignable('support')).toBe('system');
      expect(assertAnyRoleAssignable('coach')).toBe('org');
      expect(reasonOf(() => assertAnyRoleAssignable('robot'))).toBe('ROLE_NOT_ASSIGNABLE');
      expect(reasonOf(() => assertAnyRoleAssignable('ghost'))).toBe('ROLE_NOT_ASSIGNABLE');
    });
  });
});

import { platformSeedInputFrom } from '@marinoscar/platform-db/seed';

import { platformPermissionCatalog } from '@marinoscar/platform-api/manifest';

import { SEED_SNAPSHOT } from '../../prisma/seed-data';
import { APP_PERMISSIONS, APP_ROLES } from '../../src/app-registrations/permissions';
import { PERMISSIONS as PERMISSION_CONSTANTS } from '../../src/common/constants/roles.constants';
import { DEFAULT_SYSTEM_SETTINGS } from '../../src/common/types/settings.types';
import { systemSettingsSchema } from '../../src/settings/registry/composed';

// =============================================================================
// Seed data guard (#256, epic #254)
// =============================================================================
//
// WHAT THIS CAN AND CANNOT CHECK. `prisma/seed.ts` needs a real Postgres, so
// its behaviour is proven by CI's smoke job, which runs `npm run prisma:seed`
// against a live database — twice on a re-run of an existing environment, which
// is the actual idempotency evidence. Every write in that script is an `upsert`
// keyed on a natural unique (`role.name`, `permission.name`,
// `rolePermission.roleId_permissionId`, `systemSettings.key`), so re-running it
// updates rows rather than inserting duplicates.
//
// What no database can tell you is whether the DATA is self-consistent, and
// that is what this file asserts, against `prisma/seed-data.ts` — split out of
// the script for exactly this purpose, since the script itself connects to a
// database and runs `main()` at import time.
//
// The failure this most directly prevents: a permission added to
// `PERMISSIONS` in `roles.constants.ts` (which is what `@Auth()` decorators
// name) but not to the seed, so every route guarded by it 403s for everyone in
// a freshly seeded deployment, with nothing in the logs to explain why.
//
// WHAT IS UNDER TEST (#712, PP-5.5). The seed no longer owns any data: it builds
// a `PlatformSeedInput` from the registries' committed catalogs
// (`prisma/catalog/`, read by `prisma/seed-data.ts`) with
// `platformSeedInputFrom` and hands it to `seedPlatform`. So the assertions
// below target that registry-derived input, built here exactly as `seed.ts`
// builds it. `permission-catalog.spec.ts` pins the same data to a literal
// baseline, `settings-catalog.spec.ts` checks the catalogs are not stale, and
// `seed-platform.db.spec.ts` proves the rows the script writes.
// =============================================================================

const SEED_INPUT = platformSeedInputFrom(SEED_SNAPSHOT, {});
const ROLES = SEED_INPUT.roles;
const PERMISSIONS = SEED_INPUT.permissions;
const ROLE_GRANTS = SEED_INPUT.roleGrants;
const SEEDED_SYSTEM_SETTINGS = SEED_INPUT.systemSettingsDefaults;

describe('seed data', () => {
  describe('seed input', () => {
    it('is derived from the registries, snapshot for snapshot', () => {
      expect(SEED_INPUT.roles).toBe(SEED_SNAPSHOT.permissions.roles);
      expect(SEED_INPUT.permissions).toBe(SEED_SNAPSHOT.permissions.permissions);
      expect(SEED_INPUT.roleGrants).toBe(SEED_SNAPSHOT.permissions.rolePermissions);
      expect(SEED_INPUT.systemSettingsDefaults).toBe(SEED_SNAPSHOT.settings);
    });

    it('equals the input composed straight from the packaged registry plus the app-owned declarations (#866)', () => {
      // An app whose seed can import its packages composes the catalog instead
      // of reading the committed file; both must write exactly the same rows.
      const composed = platformPermissionCatalog({ app: { roles: [APP_ROLES], permissions: [APP_PERMISSIONS] } });
      expect(platformSeedInputFrom({ permissions: composed, settings: SEED_SNAPSHOT.settings }, {})).toEqual(SEED_INPUT);
    });

    it('takes the initial administrator from INITIAL_ADMIN_EMAIL only', () => {
      expect(SEED_INPUT.initialAdminEmail).toBeUndefined();
      expect(platformSeedInputFrom(SEED_SNAPSHOT, { INITIAL_ADMIN_EMAIL: 'Root@Example.test' }).initialAdminEmail).toBe('Root@Example.test');
    });
  });

  describe('permissions', () => {
    it('declares each permission exactly once', () => {
      // Duplicates would not break the upsert — the second one would simply
      // update the first — but they are always a copy-paste that meant to say
      // something else.
      const names = PERMISSIONS.map((permission) => permission.name);
      const duplicated = names.filter(
        (name, index) => names.indexOf(name) !== index,
      );

      expect(duplicated).toEqual([]);
    });

    it('gives every permission a description', () => {
      const undescribed = PERMISSIONS.filter(
        (permission) => !permission.description?.trim(),
      ).map((permission) => permission.name);

      expect(undescribed).toEqual([]);
    });

    it('seeds every permission the API actually enforces', () => {
      // `roles.constants.ts` is the list the guards read; this file is the list
      // the database gets. A permission in the first and not the second is a
      // route nobody can reach.
      const seeded = new Set<string>(
        PERMISSIONS.map((permission) => permission.name),
      );
      const missing = Object.values(PERMISSION_CONSTANTS).filter(
        (permission) => !seeded.has(permission),
      );

      expect(missing).toEqual([]);
    });

    it('seeds the operations permissions this epic introduces (#256)', () => {
      const seeded = new Set<string>(
        PERMISSIONS.map((permission) => permission.name),
      );

      for (const permission of [
        'jobs:read',
        'jobs:write',
        'nodes:read',
        'nodes:write',
        'db_backup:read',
        'db_backup:write',
        'db_backup:restore',
      ]) {
        expect(seeded.has(permission)).toBe(true);
      }
    });

    it('seeds the broadcasts permissions this epic introduces (#320)', () => {
      const seeded = new Set<string>(
        PERMISSIONS.map((permission) => permission.name),
      );

      for (const permission of ['broadcasts:read', 'broadcasts:write']) {
        expect(seeded.has(permission)).toBe(true);
      }
    });
  });

  describe('role-permission mappings', () => {
    it('names only roles that are seeded', () => {
      const roles = new Set<string>(ROLES.map((role) => role.name));
      const unknown = Object.keys(ROLE_GRANTS).filter(
        (role) => !roles.has(role),
      );

      expect(unknown).toEqual([]);
    });

    it('names only permissions that are seeded', () => {
      // `seedRolePermissions` skips a permission it cannot find, silently. A
      // typo here therefore costs a grant with no error anywhere.
      const seeded = new Set<string>(
        PERMISSIONS.map((permission) => permission.name),
      );
      const unknown = Object.entries(ROLE_GRANTS).flatMap(
        ([role, permissions]) =>
          permissions
            .filter((permission) => !seeded.has(permission))
            .map((permission) => `${role}: ${permission}`),
      );

      expect(unknown).toEqual([]);
    });

    it('grants each permission to a role at most once', () => {
      // The upsert makes a repeat harmless; it still means the list was edited
      // by someone who could not see what was already in it.
      const duplicated = Object.entries(ROLE_GRANTS).flatMap(
        ([role, permissions]) =>
          permissions
            .filter(
              (permission, index) =>
                permissions.indexOf(permission) !== index,
            )
            .map((permission) => `${role}: ${permission}`),
      );

      expect(duplicated).toEqual([]);
    });

    it('grants the operations permissions to Admin and to nobody else (#256)', () => {
      const operations = [
        'jobs:read',
        'jobs:write',
        'nodes:read',
        'nodes:write',
        'db_backup:read',
        'db_backup:write',
        'db_backup:restore',
      ];

      for (const permission of operations) {
        expect(ROLE_GRANTS.admin).toContain(permission);
      }

      // Including the READ halves. The queue, the fleet and the backup history
      // are operational surfaces; a later issue can widen one of them with an
      // argument for that surface, and widening is the direction that costs
      // nothing (these are rows, not a migration).
      const leaked = Object.entries(ROLE_GRANTS)
        .filter(([role]) => role !== 'admin')
        .flatMap(([role, permissions]) =>
          permissions
            .filter((permission) => operations.includes(permission))
            .map((permission) => `${role}: ${permission}`),
        );

      expect(leaked).toEqual([]);
    });

    it('grants the storage-config permissions to Admin and to nobody else (#375)', () => {
      const storageConfig = ['storage_config:read', 'storage_config:write'];

      for (const permission of storageConfig) {
        expect(ROLE_GRANTS.admin).toContain(permission);
      }

      const leaked = Object.entries(ROLE_GRANTS)
        .filter(([role]) => role !== 'admin')
        .flatMap(([role, permissions]) =>
          permissions
            .filter((permission) => storageConfig.includes(permission))
            .map((permission) => `${role}: ${permission}`),
        );

      expect(leaked).toEqual([]);
    });

    it('⚠ keeps storage_config:* distinct from storage:*, which every role holds (#375)', () => {
      // The two are one character apart and mean completely different things:
      // `storage:*` gates OBJECT ACCESS (Viewer holds `storage:read`), while
      // `storage_config:*` decides which object store the deployment uses and
      // under whose credential. Folding them together would put a
      // credential-bearing configuration screen in front of the whole user base.
      expect(ROLE_GRANTS.viewer).toContain('storage:read');
      expect(ROLE_GRANTS.viewer).not.toContain('storage_config:read');
      expect(ROLE_GRANTS.contributor).toContain('storage:write');
      expect(ROLE_GRANTS.contributor).not.toContain('storage_config:write');
    });

    it('grants the broadcasts permissions to Admin and to nobody else (#320)', () => {
      const broadcasts = ['broadcasts:read', 'broadcasts:write'];

      for (const permission of broadcasts) {
        expect(ROLE_GRANTS.admin).toContain(permission);
      }

      const leaked = Object.entries(ROLE_GRANTS)
        .filter(([role]) => role !== 'admin')
        .flatMap(([role, permissions]) =>
          permissions
            .filter((permission) => broadcasts.includes(permission))
            .map((permission) => `${role}: ${permission}`),
        );

      expect(leaked).toEqual([]);
    });

    it('grants ai_config:* to Admin only, and ai:use to Org admin and Contributor but NOT Viewer (#423, #499, #723)', () => {
      // `ai_config:*` is the deployment-wide policy — same "narrow,
      // operational surface" posture as `storage_config:*`, `push:*`,
      // `broadcasts:*` and `nodes:*` above: Admin only, including the read
      // half.
      const aiConfig = ['ai_config:read', 'ai_config:write'];

      for (const permission of aiConfig) {
        expect(ROLE_GRANTS.admin).toContain(permission);
      }

      const leakedConfig = Object.entries(ROLE_GRANTS)
        .filter(([role]) => role !== 'admin')
        .flatMap(([role, permissions]) =>
          permissions
            .filter((permission) => aiConfig.includes(permission))
            .map((permission) => `${role}: ${permission}`),
        );

      expect(leakedConfig).toEqual([]);

      // `ai:use` is the opposite axis — may this caller invoke AI with their
      // OWN key. It is ORG scope since #723, so the org roles hold it: Org admin
      // (which every system administrator also holds on their membership) and
      // Contributor. Viewer deliberately does NOT
      // (#499) — Viewer is the DEFAULT role every new signup lands in, and
      // under `byok_with_org_fallback` a default grant would let a brand-new
      // account spend the deployment's own org key with no administrator
      // having decided that.
      expect(ROLE_GRANTS.org_admin).toContain('ai:use');
      expect(ROLE_GRANTS.contributor).toContain('ai:use');
      expect(ROLE_GRANTS.viewer).not.toContain('ai:use');
    });

    it('⚠ keeps ai_config:* distinct from ai:use, and withholds ai:use from Viewer (#423, #499)', () => {
      // One character apart in spirit (a colon vs. an underscore) and mean
      // completely different things — the same distinction
      // `storage_config:*` vs. `storage:*` draws two tests above.
      // `ai_config:*` decides whether AI is enabled for the whole deployment
      // and under which policy; `ai:use` decides whether one caller, with
      // their own key, may call it at all.
      expect(ROLE_GRANTS.viewer).not.toContain('ai:use');
      expect(ROLE_GRANTS.viewer).not.toContain('ai_config:read');
      expect(ROLE_GRANTS.contributor).toContain('ai:use');
      expect(ROLE_GRANTS.contributor).not.toContain('ai_config:write');
    });

    it('grants the telemetry permissions to Admin only (epic #528, story #533)', () => {
      const telemetry = ['telemetry:read', 'telemetry:write', 'telemetry:query'];

      for (const permission of telemetry) {
        expect(ROLE_GRANTS.admin).toContain(permission);
      }

      const leaked = Object.entries(ROLE_GRANTS)
        .filter(([role]) => role !== 'admin')
        .flatMap(([role, permissions]) =>
          permissions
            .filter((permission) => telemetry.includes(permission))
            .map((permission) => `${role}: ${permission}`),
        );

      expect(leaked).toEqual([]);
    });
  });

  describe('role and permission scopes (#723)', () => {
    const OPERATIONAL = [
      'system_settings:read', 'system_settings:write', 'users:read', 'users:write', 'rbac:manage',
      'allowlist:read', 'allowlist:write', 'storage:delete_any', 'jobs:read', 'jobs:write', 'nodes:read',
      'nodes:write', 'db_backup:read', 'db_backup:write', 'db_backup:restore', 'broadcasts:read',
      'broadcasts:write', 'push:read', 'push:write', 'storage_config:read', 'storage_config:write',
      'ai_config:read', 'ai_config:write', 'telemetry:read', 'telemetry:write', 'telemetry:query',
      // #726 (PP-6.7): the deployment's list of organizations.
      'organizations:read', 'organizations:write',
    ];

    it('scopes every operational permission to the system and grants it to the system admin role only', () => {
      for (const name of OPERATIONAL) {
        expect(PERMISSIONS.find((permission) => permission.name === name)?.scope).toBe('system');
        expect(ROLE_GRANTS.admin).toContain(name);
        for (const role of ['org_admin', 'contributor', 'viewer']) expect(ROLE_GRANTS[role]).not.toContain(name);
      }
    });

    it('scopes admin to the system and the other platform roles to an organization', () => {
      expect(Object.fromEntries(ROLES.map((role) => [role.name, role.scope]))).toEqual({
        admin: 'system',
        contributor: 'org',
        viewer: 'org',
        org_admin: 'org',
      });
    });
  });

  describe('seeded system settings', () => {
    /**
     * The seed cannot import `DEFAULT_SYSTEM_SETTINGS` from `src/` — it runs
     * under ts-node outside the Nest build — so the two are a deliberate
     * duplicate, and a duplicate nobody checks is a duplicate that drifts. The
     * consequence of drift is mild but real: `readKnownSettings` degrades a
     * missing block to the API's defaults, so a seeded row that disagrees means
     * a fresh deployment's stored value and its effective value differ until the
     * first write, and an admin reading the row directly sees something the
     * application does not believe.
     */
    it('matches the API defaults exactly', () => {
      expect(SEEDED_SYSTEM_SETTINGS).toEqual(DEFAULT_SYSTEM_SETTINGS);
    });

    it('is a value the API would accept', () => {
      expect(() =>
        systemSettingsSchema.parse(SEEDED_SYSTEM_SETTINGS),
      ).not.toThrow();
    });
  });
});

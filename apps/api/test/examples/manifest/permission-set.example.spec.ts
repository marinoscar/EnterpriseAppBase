// =============================================================================
// A package outside the platform declares its own permission set (PP-14.15)
// =============================================================================
//
// `@kappa/reports`, a package an app installs, enforces `reports:run` and holds
// an `analyst` role. It declares both with `registerPermissionSet` when it is
// imported, BEFORE the app's permission manifest runs. The manifest registers
// the set after the platform's own and before the app's, in the seed catalog
// and in the registries, and `slices` selects it like a platform slice.
//
// A fresh copy of the manifest module is loaded per case (`jest.isolateModules`)
// because the registries are process-wide and freeze: the point is the order and
// the freeze, not a leak into the reference app's registries.
// =============================================================================

type Core = typeof import('@marinoscar/platform-api/core');
type Manifest = typeof import('@marinoscar/platform-api/manifest');

function load(): { core: Core; manifest: Manifest } {
  let loaded: { core: Core; manifest: Manifest } | undefined;
  jest.isolateModules(() => {
    loaded = {
      core: require('@marinoscar/platform-api/core'),
      manifest: require('@marinoscar/platform-api/manifest'),
    };
  });
  return loaded!;
}

/** What `@kappa/reports` registers when it is imported. */
const KAPPA_REPORTS = {
  slice: 'kappa-reports',
  roles: [{ id: 'analyst', description: 'Runs reports', scope: 'org' as const, label: 'Analyst' }],
  permissions: [
    { id: 'reports:run', description: 'Run a report', scope: 'org' as const, defaultGrants: ['org_admin', 'analyst'] },
  ],
};

/** What the app registers itself. */
const APP = {
  permissions: [[{ id: 'notes:read', description: 'Read notes', scope: 'org' as const, defaultGrants: ['org_admin'] }]],
};

describe('a package slice registered with registerPermissionSet', () => {
  it('lands after the platform sets and before the app, in the catalog and in the registries', () => {
    const { core, manifest } = load();
    manifest.registerPermissionSet(KAPPA_REPORTS);

    const composed = manifest.platformPermissionCatalog({ app: APP });
    expect(composed.roles.map((role) => role.name)).toEqual(['admin', 'contributor', 'viewer', 'org_admin', 'analyst']);
    expect(composed.permissions.map((permission) => permission.name).slice(-2)).toEqual(['reports:run', 'notes:read']);
    expect(composed.rolePermissions.analyst).toEqual(['reports:run']);
    expect(composed.rolePermissions.org_admin).toContain('reports:run');

    manifest.registerPlatformPermissions({ app: APP });
    expect(core.buildPermissionCatalog()).toEqual(composed);
  });

  it('is selected by its id like a platform slice, and identity stays mandatory', () => {
    const { manifest } = load();
    manifest.registerPermissionSet(KAPPA_REPORTS);

    const names = (slices: string[]) => manifest.platformPermissionCatalog({ slices }).permissions.map((permission) => permission.name);
    expect(names(['identity'])).not.toContain('reports:run');
    expect(names(['identity', 'kappa-reports'])).toContain('reports:run');
    expect(() => manifest.platformPermissionCatalog({ slices: ['kappa-reports'] })).toThrow(/must include 'identity'/);
    expect(() => manifest.platformPermissionCatalog({ slices: ['identity', 'kappa-other'] })).toThrow(/unknown slice\(s\) "kappa-other"/);
  });

  it('cannot take a platform slice id, and a late registration fails loudly instead of missing the seed', () => {
    const { manifest } = load();
    expect(() => manifest.registerPermissionSet({ ...KAPPA_REPORTS, slice: 'jobs' })).toThrow(/platform slice/);

    manifest.registerPermissionSet(KAPPA_REPORTS);
    manifest.registerPlatformPermissions();
    expect(() => manifest.registerPermissionSet({ slice: 'kappa-late', roles: [] })).toThrow(/frozen|FROZEN/i);
  });

  it('validates its permissions like any other: a grant to an unregistered role is refused, naming it', () => {
    const { manifest } = load();
    manifest.registerPermissionSet({
      ...KAPPA_REPORTS,
      permissions: [{ id: 'reports:run', description: 'Run a report', scope: 'org', defaultGrants: ['ghost'] }],
    });
    expect(() => manifest.platformPermissionCatalog()).toThrow(/unknown role "ghost"/);
  });
});

// SettingsResolver: system, then org, then user (issue #733). An org value
// overrides or tightens as its namespace's `org.merge` declares, a stored
// org value that no longer validates is ignored, and with no org row the
// resolver is exactly SystemSettingsService (the single-org parity).
import { withTemporaryEntries } from '../../src/core/index';
import {
  DATA_TABLES_USER_SETTINGS,
  NAVIGATION_USER_SETTINGS,
  systemSettingsNamespaceRegistry,
  userSettingsNamespaceRegistry,
} from '../../src/settings/index';
import { ALICE, ORG_A, ORG_B, SAMPLES, services } from './support';

function withSamples(fn: () => Promise<void>) {
  return () =>
    withTemporaryEntries(systemSettingsNamespaceRegistry, SAMPLES, () =>
      withTemporaryEntries(userSettingsNamespaceRegistry, [DATA_TABLES_USER_SETTINGS, NAVIGATION_USER_SETTINGS], fn),
    );
}

describe('SettingsResolver.resolveSystem', () => {
  it(
    'applies an override namespace field by field, only for the organization that stored it',
    withSamples(async () => {
      const s = services();
      await s.system.patchSettings({ brandingSample: { label: 'Deployment', pageSize: 50 } } as never, ALICE);
      await s.org.patch(ORG_A, { brandingSample: { label: 'Org A', accent: 'green' } }, { userId: ALICE });

      expect(await s.resolver.resolveSystem('brandingSample', { orgId: ORG_A })).toEqual({
        label: 'Org A',
        accent: 'green',
        pageSize: 50,
        showBanner: false,
        tags: [],
      });
      expect(await s.resolver.resolveSystem('brandingSample', { orgId: ORG_B })).toMatchObject({ label: 'Deployment', accent: 'blue' });
      expect(await s.resolver.resolveSystem('brandingSample')).toMatchObject({ label: 'Deployment' });
    }),
  );

  it(
    'lets a tighten namespace only restrict: an org can turn it off and lower the cap, never raise it',
    withSamples(async () => {
      const s = services();
      await s.org.patch(ORG_A, { exportsSample: { enabled: false, maxRows: 500 } });
      await s.org.patch(ORG_B, { exportsSample: { enabled: true, maxRows: 999_999 } });

      expect(await s.resolver.resolveSystem('exportsSample', { orgId: ORG_A })).toEqual({ enabled: false, maxRows: 500 });
      expect(await s.resolver.resolveSystem('exportsSample', { orgId: ORG_B })).toEqual({ enabled: true, maxRows: 10_000 });

      await s.system.patchSettings({ exportsSample: { enabled: false } } as never, ALICE);
      expect(await s.resolver.resolveSystem('exportsSample', { orgId: ORG_B })).toEqual({ enabled: false, maxRows: 10_000 });
    }),
  );

  it(
    'ignores a stored org field that no longer validates, keeping the valid ones',
    withSamples(async () => {
      const s = services();
      s.data.orgTable.rows.set(ORG_A, {
        id: 'row',
        orgId: ORG_A,
        value: { brandingSample: { pageSize: 5000, label: 'Kept' }, plainSample: { retentionDays: 1 } },
        version: 1,
        updatedAt: new Date(),
      });
      expect(await s.resolver.resolveSystem('brandingSample', { orgId: ORG_A })).toMatchObject({ pageSize: 20, label: 'Kept' });
      // A namespace without an org block is never overridden, whatever the row holds.
      expect(await s.resolver.resolveSystem('plainSample', { orgId: ORG_A })).toEqual({ retentionDays: 30 });
    }),
  );

  it(
    'skips the org layer entirely when the app switched it off',
    withSamples(async () => {
      const on = services();
      await on.org.patch(ORG_A, { brandingSample: { label: 'Org A' } });
      const off = services({ orgLayer: false });
      off.data.orgTable.rows.set(ORG_A, on.data.orgTable.rows.get(ORG_A)!);
      expect(await off.resolver.resolveSystem('brandingSample', { orgId: ORG_A })).toMatchObject({ label: 'Acme' });
      expect(off.data.scopes).toEqual([]);
    }),
  );

  it(
    'single-org parity: with no org row it equals SystemSettingsService for every registered namespace',
    withSamples(async () => {
      const s = services();
      await s.system.patchSettings({ brandingSample: { label: 'Stored' }, exportsSample: { maxRows: 7 } } as never, ALICE);
      const document = (await s.system.getSettings()) as unknown as Record<string, unknown>;
      for (const ns of systemSettingsNamespaceRegistry.list()) {
        expect(await s.resolver.resolveSystem(ns.key, { orgId: ORG_A })).toEqual(document[ns.key]);
        expect(await s.resolver.resolveSystem(ns.key)).toEqual(await s.system.getNamespace(ns.key as never));
      }
    }),
  );

  it('refuses an unregistered namespace', async () => {
    await expect(services().resolver.resolveSystem('nope')).rejects.toThrow();
  });
});

describe('SettingsResolver.resolveUser', () => {
  it(
    'returns a stored namespace, undefined for an absent or invalid one, and the core defaults without a row',
    withSamples(async () => {
      const s = services();
      expect(await s.resolver.resolveUser('theme', ALICE)).toBe('system');
      expect(await s.resolver.resolveUser('navigation', ALICE)).toBeUndefined();

      s.prisma.userSettings.rows.set(ALICE, {
        id: 'u',
        userId: ALICE,
        value: { theme: 'dark', profile: { imageSource: 'none' }, navigation: { railCollapsed: true }, dataTables: { BAD: {} } },
        version: 1,
        updatedAt: new Date(),
      });
      expect(await s.resolver.resolveUser('theme', ALICE)).toBe('dark');
      expect(await s.resolver.resolveUser('navigation', ALICE)).toEqual({ railCollapsed: true });
      expect(await s.resolver.resolveUser('dataTables', ALICE)).toBeUndefined();
      // A read never creates the row.
      expect(s.prisma.userSettings.create).not.toHaveBeenCalled();
    }),
  );
});

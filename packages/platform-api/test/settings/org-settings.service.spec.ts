// OrgSettingsService (issue #733): If-Match, audit with the organization's
// id, per-namespace permission filtering, and the 400s of a patch that names
// what an organization may not override.
import { withTemporaryEntries } from '../../src/core/index';
import { ORG_SETTINGS_PATCH_AUDIT_ACTION, systemSettingsNamespaceRegistry } from '../../src/settings/index';
import { ALICE, ORG_A, ORG_B, SAMPLES, services } from './support';

const run = (fn: () => Promise<void>) => () => withTemporaryEntries(systemSettingsNamespaceRegistry, SAMPLES, fn);
const ADMIN = { userId: ALICE, permissions: ['org_settings:read', 'org_settings:write', 'exports_admin:write'] };

describe('OrgSettingsService', () => {
  it(
    'reads version 0 and only the org-overridable namespaces while no row exists',
    run(async () => {
      const view = await services().org.get(ORG_A, ADMIN);
      expect(view).toMatchObject({ orgId: ORG_A, value: {}, version: 0, updatedAt: null });
      expect(view.namespaces.map((n) => [n.key, n.merge, n.writable])).toEqual([
        ['brandingSample', 'override', true],
        ['exportsSample', 'tighten', true],
      ]);
      expect(view.namespaces[0]!.fields).toEqual([
        { name: 'label', kind: 'string', maxLength: 40 },
        { name: 'accent', kind: 'enum', options: ['blue', 'green', 'red'] },
        { name: 'pageSize', kind: 'number', min: 10, max: 100, integer: true },
        { name: 'showBanner', kind: 'boolean' },
        { name: 'tags', kind: 'other' },
      ]);
      expect(view.effective).toEqual({
        brandingSample: { label: 'Acme', accent: 'blue', pageSize: 20, showBanner: false, tags: [] },
        exportsSample: { enabled: true, maxRows: 10_000 },
      });
    }),
  );

  it(
    'patches with If-Match: 0 creates, a stale version is a 409 and changes nothing',
    run(async () => {
      const s = services();
      const first = await s.org.patch(ORG_A, { brandingSample: { label: 'A' } }, ADMIN, 0);
      expect(first).toMatchObject({ version: 1, value: { brandingSample: { label: 'A' } } });
      await expect(s.org.patch(ORG_A, { brandingSample: { label: 'B' } }, ADMIN, 0)).rejects.toMatchObject({ status: 409 });
      expect((await s.org.get(ORG_A, ADMIN)).value).toEqual({ brandingSample: { label: 'A' } });
      const second = await s.org.patch(ORG_A, { brandingSample: { accent: 'red' } }, ADMIN, 1);
      expect(second).toMatchObject({ version: 2, value: { brandingSample: { label: 'A', accent: 'red' } } });
    }),
  );

  it(
    'audits every write with the organization and the actor',
    run(async () => {
      const s = services();
      await s.org.patch(ORG_A, { exportsSample: { enabled: false } }, ADMIN);
      expect(s.audit).toContainEqual(
        expect.objectContaining({
          action: ORG_SETTINGS_PATCH_AUDIT_ACTION,
          actorUserId: ALICE,
          orgId: ORG_A,
          targetType: 'org_settings',
          meta: { changes: { exportsSample: { enabled: false } }, resultingValue: { exportsSample: { enabled: false } } },
        }),
      );
      expect(s.data.scopes.every((scope) => scope.orgId === ORG_A)).toBe(true);
    }),
  );

  it(
    'null clears a field or a whole namespace, so the system value applies again',
    run(async () => {
      const s = services();
      await s.org.patch(ORG_A, { brandingSample: { label: 'A', accent: 'green' }, exportsSample: { maxRows: 3 } }, ADMIN);
      const cleared = await s.org.patch(ORG_A, { brandingSample: { label: null }, exportsSample: null }, ADMIN);
      expect(cleared.value).toEqual({ brandingSample: { accent: 'green' } });
      expect(cleared.effective).toMatchObject({ exportsSample: { maxRows: 10_000 }, brandingSample: { label: 'Acme', accent: 'green' } });
    }),
  );

  it.each([
    [{ nope: { a: 1 } }, /Unknown settings namespace "nope"/],
    [{ plainSample: { retentionDays: 3 } }, /cannot be overridden per organization/],
    [{ brandingSample: { secretField: 'x' } }, /"brandingSample.secretField" cannot be overridden/],
    [{ brandingSample: { pageSize: 5000 } }, /brandingSample\.pageSize/],
    [{}, /names no namespace/],
  ])('refuses %j with a 400', async (patch, message) => {
    await withTemporaryEntries(systemSettingsNamespaceRegistry, SAMPLES, async () => {
      const s = services();
      const error = await s.org.patch(ORG_A, patch as never, ADMIN).catch((e: unknown) => e);
      expect(error).toMatchObject({ status: 400 });
      expect((error as Error).message).toMatch(message);
      expect(s.data.orgTable.rows.size).toBe(0);
    });
  });

  it(
    "filters by each namespace's own permissions: omitted from GET, a 403 on PATCH",
    run(async () => {
      const s = services();
      const orgAdmin = { userId: ALICE, permissions: ['org_settings:read', 'org_settings:write'] };
      const view = await s.org.get(ORG_A, orgAdmin);
      expect(view.namespaces.find((n) => n.key === 'exportsSample')?.writable).toBe(false);
      await expect(s.org.patch(ORG_A, { exportsSample: { enabled: false } }, orgAdmin)).rejects.toMatchObject({ status: 403 });

      const blind = await s.org.get(ORG_A, { userId: ALICE, permissions: [] });
      expect(blind.namespaces).toEqual([]);
      expect(blind.effective).toEqual({});
    }),
  );

  it(
    "keeps organizations apart: B never sees A's overrides",
    run(async () => {
      const s = services();
      await s.org.patch(ORG_A, { brandingSample: { label: 'A only' } }, ADMIN);
      expect((await s.org.get(ORG_B, ADMIN)).value).toEqual({});
      expect(await s.org.getNamespace(ORG_B, 'brandingSample')).toBeUndefined();
      expect(await s.org.getNamespace(ORG_A, 'brandingSample')).toEqual({ label: 'A only' });
    }),
  );

  it('answers 404 when the org layer is off', async () => {
    await expect(services({ orgLayer: false }).org.get(ORG_A, ADMIN)).rejects.toMatchObject({ status: 404 });
  });
});

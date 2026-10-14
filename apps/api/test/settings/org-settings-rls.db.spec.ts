// =============================================================================
// Real Postgres: org_settings is isolated per organization under row-level
// security (issue #733, PP-8.1)
// =============================================================================
//
// The REAL OrgSettingsService and SettingsResolver, bound to the app's real
// `SETTINGS_DATA` adapter (`PrismaService.runInOrg`), over a database owned by
// an ordinary role that FORCEs row-level security (`createRlsDatabase`):
// organization A's transaction cannot read or write organization B's row,
// and the database itself refuses a cross-organization write.
// A `*.db.spec.ts` file: skipped with a warning when no Postgres is reachable.
// =============================================================================

import { ConfigService } from '@nestjs/config';
import { withTemporaryEntries } from '@marinoscar/platform-api/core';
import {
  OrgSettingsService,
  SettingsResolver,
  SystemSettingsService,
  systemSettingsNamespaceRegistry,
  type SettingsPrisma,
} from '@marinoscar/platform-api/settings';

import { SettingsDataAdapter } from '../../src/platform/settings/settings-data.adapter';
import { ORG_OVERRIDABLE_EXAMPLES } from '../../src/platform-extensions/settings/examples/org-overridable.namespaces';
import { resolveDbSuite } from '../jobs/db-test-support';
import { createRlsDatabase, ORG_A, ORG_B, rlsServices, type RlsDatabase } from '../helpers/rls-database.helper';
import { seedOrgs } from '../sharing/sharing-db.helper';

const { describeWithDb } = resolveDbSuite('org-settings-rls.db.spec');

describeWithDb('org_settings under row-level security (real Postgres, ordinary role)', () => {
  let db: RlsDatabase;
  let app: ReturnType<typeof rlsServices>;
  let org: OrgSettingsService;
  let resolver: SettingsResolver;
  const inExamples = (fn: () => Promise<void>) => () => withTemporaryEntries(systemSettingsNamespaceRegistry, ORG_OVERRIDABLE_EXAMPLES, fn);

  beforeAll(async () => {
    db = await createRlsDatabase('orgset');
    await seedOrgs(db, [[ORG_A, 'org-a'], [ORG_B, 'org-b']]);
    app = rlsServices(db);
    const client = app.prisma as unknown as SettingsPrisma;
    const config = { get: (_k: string, fallback?: unknown) => fallback } as unknown as ConfigService;
    const system = new SystemSettingsService(client, config);
    org = new OrgSettingsService(new SettingsDataAdapter(app.prisma), system);
    resolver = new SettingsResolver(system, org, client);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await db?.destroy();
  }, 60_000);

  it('runs as an ordinary role, with row-level security forced on org_settings', async () => {
    const rows = await db.admin((c) =>
      c.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'org_settings'",
      ),
    );
    expect(rows.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
    const role = await db.admin((c) => c.query<{ rolsuper: boolean; rolbypassrls: boolean }>('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1', [db.role]));
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it("keeps organization A from reading organization B's row", inExamples(async () => {
    await org.patch(ORG_A, { workspaceLabel: { label: 'Org A' } });
    await org.patch(ORG_B, { workspaceLabel: { label: 'Org B' }, exportPolicy: { enabled: false } });

    expect((await org.get(ORG_A)).value).toEqual({ workspaceLabel: { label: 'Org A' } });
    expect((await org.get(ORG_B)).value).toEqual({ workspaceLabel: { label: 'Org B' }, exportPolicy: { enabled: false } });
    expect(await resolver.resolveSystem('exportPolicy', { orgId: ORG_A })).toEqual({ enabled: true, maxRows: 10_000 });
    expect(await resolver.resolveSystem('exportPolicy', { orgId: ORG_B })).toEqual({ enabled: false, maxRows: 10_000 });

    // Org A's transaction sees exactly one row: its own.
    const visible = await app.prisma.runInOrg(ORG_A, (tx) => (tx as typeof db.tenant).orgSettings.findMany({ select: { orgId: true } }));
    expect(visible).toEqual([{ orgId: ORG_A }]);
  }));

  it("refuses at the database a write of B's row from A's scope (WITH CHECK), and shows an unscoped client nothing", inExamples(async () => {
    await expect(
      app.prisma.runInOrg(ORG_A, (tx) =>
        (tx as typeof db.tenant).orgSettings.update({ where: { orgId: ORG_B }, data: { value: { workspaceLabel: { label: 'stolen' } } } }),
      ),
    ).rejects.toThrow();
    await expect(
      db.tenant.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.org_id', ${ORG_A}, true)`;
        await tx.orgSettings.create({ data: { orgId: ORG_B, value: {} } });
      }),
    ).rejects.toThrow(/row-level security|unique/);
    expect(await db.tenant.orgSettings.count()).toBe(0);
    expect((await org.get(ORG_B)).value).toEqual({ workspaceLabel: { label: 'Org B' }, exportPolicy: { enabled: false } });
  }));
});

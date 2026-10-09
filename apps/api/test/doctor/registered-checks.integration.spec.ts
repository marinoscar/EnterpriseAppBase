// =============================================================================
// The reference app registers exactly the Doctor checks it registered before
// the generic ones were packaged (issue #879)
// =============================================================================
//
// `BASELINE` was captured from the composed AppModule on origin/main BEFORE the
// five generic checks (`db.connection`, `db.migrations`, `db.rls_role`,
// `secrets.encryption-key`, `core.deployment-mode`) and `network.egress` moved
// from this app into `PlatformHostCoreModule`. The report sorts by category and
// then by registration order, so the contract is: the same ids, and within
// every category the same relative order. A new check is an intentional edit of
// this list.
// =============================================================================

import { DoctorCheckRegistry, NetworkEgressDoctorCheck } from '@marinoscar/platform-api/doctor';
import {
  DbConnectionDoctorCheck,
  DbMigrationsDoctorCheck,
  DeploymentModeDoctorCheck,
  EncryptionKeyDoctorCheck,
  RlsRoleDoctorCheck,
} from '@marinoscar/platform-api/host';

import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { TestContext, closeTestApp, createTestApp } from '../helpers/test-app.helper';

/** `category/id`, in the registry's order on origin/main before #879. */
const BASELINE = [
  'push/push.vapid',
  'jobs/jobs.worker',
  'jobs/jobs.backlog',
  'auth/tenancy.mode',
  'core/core.event-bus',
  'maintenance/maintenance.mode',
  'core/core.deployment-mode',
  'network/network.egress',
  'email/email.config',
  'auth/auth.jwt-secret',
  'auth/auth.providers',
  'auth/auth.initial-admin',
  'auth/auth.principal-cache',
  'ai/ai.enabled',
  'ai/ai.providers',
  'core/db.connection',
  'core/db.migrations',
  'core/secrets.encryption-key',
  'core/db.rls_role',
  'storage/storage.config',
  'storage/storage.bucket',
  'nodes/nodes.fleet',
  'backup/backup.schedule',
  'backup/backup.pg-client',
  'backup/backup.rls-bypass',
  'telemetry/telemetry.export',
  'telemetry/telemetry.connection',
  'telemetry/telemetry.reachable',
  'telemetry/telemetry.tables',
  'telemetry/telemetry.freshness',
  'sharing/sharing.groups.orphaned',
  'android/android.assetlinks',
  'android/android.releases',
];

/** The relative order inside each category: what the report preserves. */
function byCategory(rows: readonly string[]): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};
  for (const row of rows) {
    const [category] = row.split('/', 1);
    (grouped[category] ??= []).push(row);
  }
  return grouped;
}

describe('registered Doctor checks (#879)', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestApp({ useMockDatabase: true });
    setupBaseMocks();
  }, 60000);

  afterAll(async () => {
    await closeTestApp(context);
  });

  it('registers the same ids as before the generic checks were packaged, once each', () => {
    const rows = context.module
      .get(DoctorCheckRegistry)
      .list()
      .map((check) => `${check.category}/${check.id}`);

    expect([...rows].sort()).toEqual([...BASELINE].sort());
  });

  it('keeps the relative order inside every category, so the report reads the same', () => {
    const rows = context.module
      .get(DoctorCheckRegistry)
      .list()
      .map((check) => `${check.category}/${check.id}`);

    expect(byCategory(rows)).toEqual(byCategory(BASELINE));
  });

  it('registers the generic checks from the host slice, not from app code', () => {
    const registry = context.module.get(DoctorCheckRegistry);

    expect(registry.get('db.connection')).toBeInstanceOf(DbConnectionDoctorCheck);
    expect(registry.get('db.migrations')).toBeInstanceOf(DbMigrationsDoctorCheck);
    expect(registry.get('db.rls_role')).toBeInstanceOf(RlsRoleDoctorCheck);
    expect(registry.get('secrets.encryption-key')).toBeInstanceOf(EncryptionKeyDoctorCheck);
    expect(registry.get('core.deployment-mode')).toBeInstanceOf(DeploymentModeDoctorCheck);
    expect(registry.get('network.egress')).toBeInstanceOf(NetworkEgressDoctorCheck);
  });
});

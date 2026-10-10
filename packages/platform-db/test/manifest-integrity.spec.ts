import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseLock, parseManifest, sha256Hex } from '../src/lock/index.js';
import { assertRequiresSatisfied } from '../src/sync/index.js';

const PACKAGE_DIR = join(__dirname, '..');
const MIGRATIONS = join(PACKAGE_DIR, 'migrations');
// The reference app is the repository's own apps/api; its lock maps every package id to a local directory.
const APP_PRISMA = join(PACKAGE_DIR, '..', '..', 'apps', 'api', 'prisma');

const manifest = parseManifest(readFileSync(join(MIGRATIONS, 'manifest.json'), 'utf8'));

describe('manifest.json', () => {
  it('has ids 0001..N with no gap and one entry per directory on disk', () => {
    expect(manifest.map((entry) => entry.id.slice(0, 4))).toEqual(
      manifest.map((_, index) => String(index + 1).padStart(4, '0')),
    );
    const onDisk = readdirSync(MIGRATIONS, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    expect(onDisk).toEqual(manifest.map((entry) => entry.dir));
  });

  it('records the sha256 of the raw bytes of every package migration.sql', () => {
    for (const entry of manifest) {
      const file = join(MIGRATIONS, entry.dir, 'migration.sql');
      expect(existsSync(file), `${entry.dir} has no migration.sql`).toBe(true);
      expect(sha256Hex(readFileSync(file)), `${entry.id} does not match its manifest hash`).toBe(entry.sha256);
    }
  });

  it('orders slices so every `requires` is provided earlier', () => {
    expect(() => assertRequiresSatisfied(manifest)).not.toThrow();
  });

  it('keeps the history frozen: the platform history v1 is 22 migrations', () => {
    // An append is allowed (raise the count in the same change as the promote); an edit or removal is not.
    expect(manifest.length).toBeGreaterThanOrEqual(22);
    expect(manifest[0]!.id).toBe('0001_initial');
    expect(manifest[20]!.id).toBe('0021_add_job_trace_context');
    expect(manifest[21]!.id).toBe('0022_add_retention_created_at_indexes');
  });

  it('is shipped: package.json files include the migrations, the schema fragments and the raw-SQL index list', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8')) as { files: string[] };
    expect(pkg.files).toEqual(expect.arrayContaining(['migrations', 'schema', 'raw-sql-indexes.json']));
  });

  it('is never rewritten by an editor: no CRLF and no byte order mark in a package migration', () => {
    for (const entry of manifest) {
      const bytes = readFileSync(join(MIGRATIONS, entry.dir, 'migration.sql'));
      expect(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), `${entry.id} starts with a BOM`).toBe(false);
      expect(bytes.includes(Buffer.from('\r\n')), `${entry.id} has CRLF line endings`).toBe(false);
    }
  });
});

describe.skipIf(!existsSync(join(APP_PRISMA, 'platform.lock')))('the reference app lock (apps/api/prisma/platform.lock)', () => {
  const lock = parseLock(readFileSync(join(APP_PRISMA, 'platform.lock'), 'utf8'));

  it('maps every package id, in order, to a distinct existing local directory', () => {
    expect(lock.migrations.map((m) => m.originId)).toEqual(manifest.map((entry) => `platform:${entry.id}`));
    expect(new Set(lock.migrations.map((m) => m.localDir)).size).toBe(lock.migrations.length);
    for (const entry of lock.migrations) {
      expect(existsSync(join(APP_PRISMA, 'migrations', entry.localDir, 'migration.sql')), entry.localDir).toBe(true);
    }
  });

  it('agrees with the manifest on hash and release, and the app copy is byte-identical to the package file', () => {
    for (const [index, entry] of lock.migrations.entries()) {
      const origin = manifest[index]!;
      expect(entry.sha256, `${origin.id}: lock vs manifest`).toBe(origin.sha256);
      expect(entry.since, `${origin.id}: since`).toBe(origin.since);
      expect(entry.localSha256, `${origin.id}: the base records no divergence`).toBeUndefined();
      const pkg = readFileSync(join(MIGRATIONS, origin.dir, 'migration.sql'));
      const app = readFileSync(join(APP_PRISMA, 'migrations', entry.localDir, 'migration.sql'));
      expect(app.equals(pkg), `${entry.localDir} differs from the package ${origin.dir}`).toBe(true);
      expect(sha256Hex(app)).toBe(entry.sha256);
    }
  });

  it('keeps the app-local directory names the deployed databases were migrated under', () => {
    // Prisma matches `_prisma_migrations.migration_name` to the directory name; a rename would
    // make `migrate deploy` report every migration unknown and missing. Appending is fine.
    expect(lock.migrations.slice(0, 22).map((m) => m.localDir)).toEqual([
      '20260124223146_initial',
      '20260329151231_add_personal_access_tokens',
      '20260830211041_add_credentials',
      '20260831010356_add_notification_deliveries',
      '20260831014110_drop_stale_uuid_defaults',
      '20260831030721_add_notifications',
      '20260905182958_add_push_subscriptions',
      '20260906120000_add_jobs',
      '20260906190000_add_worker_nodes',
      '20260907120000_add_database_backup_runs',
      '20260907130000_add_notification_broadcasts',
      '20260907140000_add_backup_run_job_link',
      '20260907150000_add_job_node_secrets',
      '20260907160000_add_backup_run_pg_dump_version',
      '20260908120000_add_job_claim_token',
      '20260926034919_add_ai_platform',
      '20260927000000_revoke_viewer_ai_use',
      '20260927120000_add_user_credentials',
      '20260927130000_add_device_session_credential_link',
      '20260928100000_add_worker_node_vitals',
      '20260930120000_add_job_trace_context',
      '20261006120000_add_retention_created_at_indexes',
    ]);
  });
});

// =============================================================================
// Real Postgres: jobs carry their organization (issue #734, PP-8.2)
// =============================================================================
//
// Over a database owned by an ordinary role that FORCEs row-level security
// (`createRlsDatabase`), the packaged queue (`JobsService`, `JobScope`,
// `enqueueHousekeepingJob`) bound to the app's real `PrismaService`:
//
//   - `jobs.org_id` exists as the migrations built it: nullable UUID, FK to
//     `organizations` ON DELETE SET NULL, and `jobs_org_id_status_idx`;
//   - `enqueue` stores the organization, housekeeping stores NULL, and
//     deleting an organization keeps its job history (org_id goes NULL);
//   - the dedup key is unchanged: two organizations' subject-less jobs of one
//     type, each with `subjectType: 'organization'`, never collapse onto each
//     other, while the same organization's do;
//   - `JobScope.run(job, fn)` makes RLS-protected tenant reads inside a
//     handler see only the job's organization.
//
// A `*.db.spec.ts` file: skipped with a warning when no Postgres is reachable.
// =============================================================================

import { Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  JobScope,
  JobsService,
  buildDedupKey,
  enqueueHousekeepingJob,
  type JobsPrisma,
} from '@marinoscar/platform-api/jobs';

import { resolveDbSuite } from './db-test-support';
import { createRlsDatabase, ORG_A, ORG_B, rlsServices, type RlsDatabase } from '../helpers/rls-database.helper';
import { seedOrgs } from '../sharing/sharing-db.helper';

const { describeWithDb } = resolveDbSuite('job-org-id.db.spec');

/** A third organization, created and deleted by the FK case. */
const ORG_C = '33333333-3333-4333-8333-cccccccccccc';

describeWithDb('jobs.org_id (real Postgres, ordinary role)', () => {
  let db: RlsDatabase;
  let app: ReturnType<typeof rlsServices>;
  let jobs: JobsService;
  let scope: JobScope;

  beforeAll(async () => {
    db = await createRlsDatabase('jobsorg');
    await seedOrgs(db, [
      [ORG_A, 'org-a'],
      [ORG_B, 'org-b'],
      [ORG_C, 'org-c'],
    ]);
    app = rlsServices(db);
    jobs = new JobsService(app.prisma as unknown as JobsPrisma);
    scope = new JobScope(app.prisma as never);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await db?.destroy();
  }, 60_000);

  it('has the column, the SET NULL foreign key and the (org_id, status) index the migrations built', async () => {
    const column = await db.admin((c) =>
      c.query<{ data_type: string; is_nullable: string; column_default: string | null }>(
        "SELECT data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'jobs' AND column_name = 'org_id'",
      ),
    );
    expect(column.rows).toEqual([{ data_type: 'uuid', is_nullable: 'YES', column_default: null }]);

    const fk = await db.admin((c) =>
      c.query<{ confdeltype: string; target: string; convalidated: boolean }>(
        "SELECT confdeltype, confrelid::regclass::text AS target, convalidated FROM pg_constraint WHERE conname = 'jobs_org_id_fkey'",
      ),
    );
    // 'n' is ON DELETE SET NULL.
    expect(fk.rows).toEqual([{ confdeltype: 'n', target: 'organizations', convalidated: true }]);

    const index = await db.admin((c) =>
      c.query<{ indexdef: string }>("SELECT indexdef FROM pg_indexes WHERE indexname = 'jobs_org_id_status_idx'"),
    );
    expect(index.rows.map((r) => r.indexdef)).toEqual(['CREATE INDEX jobs_org_id_status_idx ON public.jobs USING btree (org_id, status)']);

    // No row-level security on `jobs`: the claim is one cross-organization statement.
    const rls = await db.admin((c) => c.query<{ relrowsecurity: boolean }>("SELECT relrowsecurity FROM pg_class WHERE relname = 'jobs'"));
    expect(rls.rows).toEqual([{ relrowsecurity: false }]);
  });

  it("stores an organization's job with its org_id, and a housekeeping job with NULL", async () => {
    const orgJob = await jobs.enqueue({ type: 'test.org.export', reason: 'upload', orgId: ORG_A, skipDedup: true });
    const housekeeping = await enqueueHousekeepingJob({
      jobs,
      prisma: app.prisma as unknown as JobsPrisma,
      logger: new Logger('job-org-id.db.spec'),
      type: 'test.org.housekeeping',
      what: 'test housekeeping',
    });

    const rows = await app.prisma.job.findMany({
      where: { id: { in: [orgJob.id, housekeeping!.id] } },
      select: { type: true, orgId: true },
      orderBy: { type: 'asc' },
    });
    expect(rows).toEqual([
      { type: 'test.org.export', orgId: ORG_A },
      { type: 'test.org.housekeeping', orgId: null },
    ]);
  });

  it("keeps an organization's job history when the organization is deleted (ON DELETE SET NULL)", async () => {
    const job = await jobs.enqueue({ type: 'test.org.history', reason: 'upload', orgId: ORG_C, skipDedup: true });

    await db.admin((c) => c.query('DELETE FROM organizations WHERE id = $1', [ORG_C]));

    const row = await app.prisma.job.findUnique({ where: { id: job.id }, select: { id: true, orgId: true } });
    expect(row).toEqual({ id: job.id, orgId: null });
  });

  it("never dedups two organizations' subject-less jobs that use the organization subject, and dedups the same organization's", async () => {
    const type = 'test.org.report';
    const forOrg = (orgId: string) =>
      jobs.enqueue({ type, reason: 'upload', subjectType: 'organization', subjectId: orgId, orgId });

    const a1 = await forOrg(ORG_A);
    const b1 = await forOrg(ORG_B);
    const a2 = await forOrg(ORG_A);

    expect(b1.id).not.toBe(a1.id);
    expect(a2.id).toBe(a1.id);
    // The key format is the one every active row already has.
    expect(a1.dedupKey).toBe(buildDedupKey(type, 'organization', ORG_A));
    expect(await app.prisma.job.count({ where: { type, status: 'pending' } })).toBe(2);
  });

  it("makes RLS-protected tenant reads inside a handler see only the job's organization", async () => {
    // One org_settings row per organization, written past RLS.
    await db.system.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
      for (const orgId of [ORG_A, ORG_B]) {
        await tx.orgSettings.create({ data: { orgId, value: { marker: orgId } } });
      }
    });
    const jobA = await jobs.enqueue({ type: 'test.org.scoped', reason: 'upload', orgId: ORG_A, skipDedup: true });
    const jobB = await jobs.enqueue({ type: 'test.org.scoped', reason: 'upload', orgId: ORG_B, skipDedup: true });

    const seenBy = (job: typeof jobA) =>
      scope.run(job, (tx: Prisma.TransactionClient) => tx.orgSettings.findMany({ select: { orgId: true } }));

    expect(await seenBy(jobA)).toEqual([{ orgId: ORG_A }]);
    expect(await seenBy(jobB)).toEqual([{ orgId: ORG_B }]);
    // Without the scope the same client sees nothing (fail closed).
    expect(await app.prisma.orgSettings.findMany()).toEqual([]);

    // A write into another organization from A's scope is refused by the policy.
    await expect(
      scope.run(jobA, (tx: Prisma.TransactionClient) =>
        tx.orgSettings.update({ where: { orgId: ORG_B }, data: { value: { marker: 'stolen' } } }),
      ),
    ).rejects.toThrow();
  });

  it('refuses JobScope.run for a system job, which keeps the bypass connection', async () => {
    const system = await jobs.enqueue({ type: 'test.org.system', reason: 'backfill', orgId: null, skipDedup: true });

    await expect(scope.run(system, async () => 'never')).rejects.toThrow(/system job/);
  });
});

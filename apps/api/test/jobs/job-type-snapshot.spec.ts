// =============================================================================
// ⚠ JOB TYPE STRINGS ARE PERMANENT (issue #734): the reference app's snapshot
// =============================================================================
//
// A `Job.type` is written into every row the queue holds. Once rows of a type
// exist, renaming or dropping the string strands them: no handler claims the
// pending ones, the dashboard can no longer label the history, and a node
// that still advertises the old type is offered nothing. So the set of types
// this app registers is pinned here, together with each type's display label
// (which, since #734, lives on the handler as `readonly label`, not in a
// closed map):
//
//   - a type that DISAPPEARS fails with "job type strings are permanent";
//   - a NEW type fails until it is added below (a deliberate, reviewed step);
//   - a label that changes fails, so the admin job list keeps showing what
//     operators know (`typeLabel` in GET /api/admin/jobs, asserted over HTTP).
//
// Labels may legitimately change; when one does, update its entry here in the
// same pull request. Types may not.
// =============================================================================

import request from 'supertest';
import { JobHandlerRegistry, jobTypeLabel } from '@marinoscar/platform-api/jobs';

import { createTestApp, closeTestApp, type TestContext } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { authHeader, createMockAdminUser } from '../helpers/auth-mock.helper';

/**
 * Every job type the reference app registers, with its display label. The
 * labels are exactly those of the closed `JOB_TYPE_LABELS` map #734 deleted.
 */
const REGISTERED_JOB_TYPES: Readonly<Record<string, string>> = {
  'example.echo': 'Example echo',
  'example.checksum': 'Example checksum',
  'job.history.purge': 'Job history purge',
  'admin.broadcast.start': 'Broadcast start',
  'admin.broadcast.chunk': 'Broadcast delivery',
  'db.backup.run': 'Database backup',
  'db.restore.run': 'Database restore',
  'db.backup.sweep': 'Backup sweep',
  'db.restore.old-db-drop': 'Restore cleanup',
  'storage.cleanup.stale-uploads': 'Stale upload cleanup',
  'storage.object.process': 'Object processing',
  'auth.token.cleanup': 'Token cleanup',
  'device-auth.code.cleanup': 'Device code cleanup',
  'nodes.fleet.sweep': 'Fleet sweep',
  'nodes.fleet.prune': 'Fleet prune',
  'ai.catalog.refresh': 'AI model catalog refresh',
  'ai.keys.recheck': 'AI key recheck',
  'ai.response.run': 'AI background response',
  'ai.image.generate': 'AI image generation',
  'ai.audio.transcribe': 'AI audio transcription',
  'ai.audio.speech': 'AI speech synthesis',
  'ai.usage.purge': 'AI usage purge',
  'telemetry.retention.apply': 'Telemetry retention',
  'telemetry.stack.deploy': 'Telemetry services deploy',
  'notifications.inbox.purge': 'Notification inbox purge',
  'notifications.deliveries.purge': 'Delivery log purge',
  'audit.events.purge': 'Audit log purge',
  'ai.runs.purge': 'AI run purge',
  'export.run': 'Data export',
  'export.purge': 'Export expiry',
  // The user-data slice (#743).
  'user.data.purge': 'User data deletion',
  'admin.factory_reset': 'Factory reset',
  'org.offboard': 'Organization offboarding',
};

/**
 * Types registered without a label of their own, shown as the type string.
 * Listed so the snapshot covers them too; give one a `readonly label` and
 * move it to the map above.
 */
const UNLABELLED_JOB_TYPES: readonly string[] = ['sharing.grants.prune'];

describe('job type strings are permanent (#734)', () => {
  let context: TestContext;
  let registered: Set<string>;

  beforeAll(async () => {
    context = await createTestApp({ useMockDatabase: true });
    registered = new Set(context.app.get(JobHandlerRegistry).types());
  }, 60_000);

  afterAll(async () => {
    await closeTestApp(context);
  });

  it('still registers every job type it ever registered', () => {
    const expected = [...Object.keys(REGISTERED_JOB_TYPES), ...UNLABELLED_JOB_TYPES];
    const missing = expected.filter((type) => !registered.has(type));

    if (missing.length > 0) {
      throw new Error(
        `Job type strings are permanent: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} no longer registered. ` +
          'Rows of a type outlive its handler; keep the type string (and a handler for it), or retire it with a ' +
          'migration plan, never by renaming. See packages/platform-api/src/jobs/handlers/README.md.',
      );
    }
  });

  it('lists every registered type here, so a new one is a reviewed addition', () => {
    const known = new Set([...Object.keys(REGISTERED_JOB_TYPES), ...UNLABELLED_JOB_TYPES]);
    const unlisted = [...registered].filter((type) => !known.has(type)).sort();

    expect(unlisted).toEqual([]);
  });

  it('keeps every label, read from the handlers themselves', () => {
    const labels = Object.fromEntries(Object.keys(REGISTERED_JOB_TYPES).map((type) => [type, jobTypeLabel(type)]));

    expect(labels).toEqual(REGISTERED_JOB_TYPES);
    for (const type of UNLABELLED_JOB_TYPES) expect(jobTypeLabel(type)).toBe(type);
  });

  it('serves the same typeLabel for every type in GET /api/admin/jobs', async () => {
    resetPrismaMock();
    setupBaseMocks();
    const prisma = context.prismaMock;
    const types = Object.keys(REGISTERED_JOB_TYPES);
    prisma.job.findMany.mockResolvedValue(
      types.map((type, index) => ({
        id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        type,
        subjectType: null,
        subjectId: null,
        dedupKey: null,
        status: 'succeeded',
        reason: 'backfill',
        priority: 0,
        providerKey: null,
        modelVersion: null,
        attempts: 1,
        lastError: null,
        createdAt: new Date('2026-10-01T00:00:00Z'),
        startedAt: null,
        finishedAt: null,
        scheduledFor: null,
        rateLimitedAt: null,
        rateLimitHits: 0,
        claimedByNodeId: null,
        leaseExpiresAt: null,
        executor: null,
        orgId: null,
      })),
    );
    prisma.job.count.mockResolvedValue(types.length);
    const admin = await createMockAdminUser(context);

    const response = await request(context.app.getHttpServer())
      .get('/api/admin/jobs?pageSize=100')
      .set(authHeader(admin.accessToken))
      .expect(200);

    const served = Object.fromEntries(
      (response.body.data.items as Array<{ type: string; typeLabel: string }>).map((item) => [item.type, item.typeLabel]),
    );
    expect(served).toEqual(REGISTERED_JOB_TYPES);
  });
});

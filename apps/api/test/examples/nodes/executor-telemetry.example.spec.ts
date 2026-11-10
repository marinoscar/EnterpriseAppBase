// =============================================================================
// PP-14.19, proved from the app: an executor's own span and attributes
// =============================================================================
//
// The server half of apps/cli/src/examples/transcode.executor.ts. The app lists
// `TRANSCODE_SPAN_ATTRIBUTES` (registered here before the app boots, as
// `platform/jobs/jobs.config.ts` does for `APP_NODE_SPAN_ATTRIBUTES`); a node's
// `job.app.transcode` span is then accepted over the REAL HTTP stack and
// re-emitted with `job.app.frames` and `job.app.codec`. Nothing under
// packages/ is edited.
// =============================================================================

import { createHash, randomUUID } from 'crypto';

import { registerNodeSpanAttribute } from '@marinoscar/platform-api/nodes';
import request from 'supertest';

import { TRANSCODE_SPAN_ATTRIBUTES } from '../../../src/platform-extensions/nodes/transcode.span-attributes';
import { setupBaseMocks } from '../../fixtures/mock-setup.helper';
import { createMockAdminUser } from '../../helpers/auth-mock.helper';
import { installTestTracing, TestTracing } from '../../helpers/otel-tracing.helper';
import { closeTestApp, createTestApp, TestContext } from '../../helpers/test-app.helper';
import { resetPrismaMock } from '../../mocks/prisma.mock';

// Before the application boots: the registry freezes at bootstrap.
for (const attribute of TRANSCODE_SPAN_ATTRIBUTES) registerNodeSpanAttribute(attribute);

describe('an executor span, end to end (PP-14.19)', () => {
  let context: TestContext;
  let tracing: TestTracing;

  const NODE_TOKEN = 'nod_executor_telemetry_fixture';
  const NODE_ID = '11111111-1111-4111-8111-111111111111';
  const JOB_ID = '22222222-2222-4222-8222-222222222222';
  const url = `/api/nodes/${NODE_ID}/telemetry`;

  beforeAll(async () => {
    context = await createTestApp({ useMockDatabase: true });
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(async () => {
    tracing = installTestTracing();
    resetPrismaMock();
    setupBaseMocks();

    const admin = await createMockAdminUser(context);
    const expected = createHash('sha256').update(NODE_TOKEN).digest('hex');
    const fullUser = await (context.prismaMock.user.findUnique as jest.Mock)({ where: { id: admin.id } });
    (context.prismaMock.nodeCredential.findUnique as jest.Mock).mockImplementation(async ({ where }: { where: { tokenHash: string } }) =>
      where.tokenHash !== expected
        ? null
        : { id: randomUUID(), userId: admin.id, name: 'fixture', tokenHash: expected, tokenPrefix: 'nod_exec', expiresAt: null, lastUsedAt: null, createdAt: new Date(), revokedAt: null, user: fullUser },
    );
    (context.prismaMock.nodeCredential.update as jest.Mock).mockResolvedValue({});
    (context.prismaMock.workerNode.findUnique as jest.Mock).mockResolvedValue({
      id: NODE_ID, name: 'transcoder-1', hostname: 'box', platform: 'linux-x64', cliVersion: '1.0.0', eligibleTypes: ['example.transcode'],
      concurrency: 1, status: 'online', capabilities: null, registeredAt: new Date(), lastHeartbeatAt: null, createdById: admin.id,
    });
    (context.prismaMock.job.findMany as jest.Mock).mockResolvedValue([
      { id: JOB_ID, type: 'example.transcode', claimedByNodeId: NODE_ID, traceContext: null, orgId: null },
    ]);
  });

  afterEach(() => tracing.uninstall());

  const send = (spans: unknown[]) => request(context.app.getHttpServer()).post(url).set({ Authorization: `Bearer ${NODE_TOKEN}` }).send({ spans });
  const span = (overrides: Record<string, unknown> = {}) => ({
    jobId: JOB_ID,
    name: 'job.app.transcode',
    startTimeUnixMs: Date.now() - 5_000,
    durationMs: 4_000,
    status: 'ok',
    ...overrides,
  });

  it('accepts job.app.transcode and re-emits it with the registered attributes under job.app.*', async () => {
    const response = await send([span({ attributes: { frames: 240, codec: 'h264', bytes: 1024 } })]).expect(200);

    expect(response.body.data).toEqual({ accepted: 1, dropped: 0 });
    const [emitted] = tracing.exporter.getFinishedSpans();
    expect(emitted?.name).toBe('job.app.transcode');
    expect(emitted?.attributes).toMatchObject({
      'job.app.frames': 240,
      'job.app.codec': 'h264',
      'job.phase.bytes': 1024,
      'job.id': JOB_ID,
      'job.type': 'example.transcode',
      'node.id': NODE_ID,
      'telemetry.relay': 'node',
    });
  });

  it('drops an attribute nobody registered, or whose value breaks its shape, and keeps the span', async () => {
    await send([span({ attributes: { frames: 240, bitrate: 9000, codec: 'a-codec-name-far-too-long-for-16' } })]).expect(200);

    const [emitted] = tracing.exporter.getFinishedSpans();
    expect(emitted?.attributes['job.app.frames']).toBe(240);
    expect(Object.keys(emitted?.attributes ?? {}).filter((key) => /bitrate|codec/.test(key))).toEqual([]);
  });

  it('drops one malformed span and still relays the rest of the batch', async () => {
    const response = await send([span(), span({ name: 'job.transcribe' }), span({ name: 'job.execute' })]).expect(200);

    expect(response.body.data).toEqual({ accepted: 2, dropped: 1 });
    expect(tracing.exporter.getFinishedSpans().map((s) => s.name)).toEqual(['job.app.transcode', 'job.execute']);
  });

  it('can neither rename the identity attributes nor mint a name outside job.app.*', async () => {
    const response = await send([
      // A dotted key is not an attribute key at all: the span is refused.
      span({ attributes: { 'node.id': 'spoof' } }),
      span({ name: 'node.id' }),
      span({ name: 'job.app.' }),
      span({ name: 'job.app.UPPER' }),
      // A well-shaped key nobody registered: the span is kept, the attribute dropped.
      span({ attributes: { nodeId: 'spoof', jobId: 'spoof' } }),
    ]).expect(200);

    expect(response.body.data).toEqual({ accepted: 1, dropped: 4 });
    const [emitted] = tracing.exporter.getFinishedSpans();
    expect(emitted?.attributes['node.id']).toBe(NODE_ID);
    expect(emitted?.attributes['job.id']).toBe(JOB_ID);
    expect(Object.values(emitted?.attributes ?? {})).not.toContain('spoof');
  });
});

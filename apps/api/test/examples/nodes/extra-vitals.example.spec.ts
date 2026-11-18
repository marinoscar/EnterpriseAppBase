// =============================================================================
// PP-14.19, proved from the app: app-defined vitals on the heartbeat
// =============================================================================
//
// The server half of the transcode executor's `vitals()` and of the web app's
// `registerNodeVital`: `vitals.extra` is accepted over the REAL HTTP stack when
// it is a bounded `key -> number` bag, stored verbatim with the heartbeat, and
// refused (the whole heartbeat, which the CLI's sanitizer exists to prevent)
// when it is not.
// =============================================================================

import { createHash, randomUUID } from 'crypto';

import request from 'supertest';

import { setupBaseMocks } from '../../fixtures/mock-setup.helper';
import { createMockAdminUser } from '../../helpers/auth-mock.helper';
import { closeTestApp, createTestApp, TestContext } from '../../helpers/test-app.helper';
import { resetPrismaMock } from '../../mocks/prisma.mock';

describe('vitals.extra over the heartbeat (PP-14.19)', () => {
  let context: TestContext;

  const NODE_TOKEN = 'nod_extra_vitals_fixture';
  const NODE_ID = '11111111-1111-4111-8111-111111111111';
  const url = `/api/nodes/${NODE_ID}/heartbeat`;

  beforeAll(async () => {
    context = await createTestApp({ useMockDatabase: true });
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(async () => {
    resetPrismaMock();
    setupBaseMocks();

    const admin = await createMockAdminUser(context);
    const expected = createHash('sha256').update(NODE_TOKEN).digest('hex');
    const fullUser = await (context.prismaMock.user.findUnique as jest.Mock)({ where: { id: admin.id } });
    (context.prismaMock.nodeCredential.findUnique as jest.Mock).mockImplementation(async ({ where }: { where: { tokenHash: string } }) =>
      where.tokenHash !== expected
        ? null
        : { id: randomUUID(), userId: admin.id, name: 'fixture', tokenHash: expected, tokenPrefix: 'nod_extr', expiresAt: null, lastUsedAt: null, createdAt: new Date(), revokedAt: null, user: fullUser },
    );
    (context.prismaMock.nodeCredential.update as jest.Mock).mockResolvedValue({});
    const node = {
      id: NODE_ID, name: 'transcoder-1', hostname: 'box', platform: 'linux-x64', cliVersion: '1.0.0', eligibleTypes: [],
      concurrency: 1, status: 'online', capabilities: null, registeredAt: new Date(), lastHeartbeatAt: null, createdById: admin.id,
    };
    (context.prismaMock.workerNode.findUnique as jest.Mock).mockResolvedValue(node);
    (context.prismaMock.workerNode.update as jest.Mock).mockResolvedValue(node);
  });

  const beat = (vitals: unknown) =>
    request(context.app.getHttpServer()).post(url).set({ Authorization: `Bearer ${NODE_TOKEN}` }).send({ status: 'online', vitals });

  it('stores a bounded extra bag with the snapshot', async () => {
    await beat({ cpuPercent: 3, extra: { 'transcode.active': 1, 'transcode.frames': 240, temperature_c: -4 } }).expect(200);

    const call = (context.prismaMock.workerNode.update as jest.Mock).mock.calls.at(-1)?.[0];
    expect(call.data.lastVitals).toEqual({ cpuPercent: 3, extra: { 'transcode.active': 1, 'transcode.frames': 240, temperature_c: -4 } });
    expect(call.data.lastVitalsAt).toBeInstanceOf(Date);
  });

  it.each([
    ['a key outside the pattern', { 'Bad Key': 1 }],
    ['a string value', { 'transcode.fps': '29' }],
    ['a nested value', { 'transcode.fps': { a: 1 } }],
    ['a value past the ceiling', { 'transcode.fps': 1e16 }],
    ['a 17th key', Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`transcode.k${i}`, i]))],
  ])('refuses %s with a 400 and stores nothing', async (_label, extra) => {
    await beat({ extra }).expect(400);

    expect(context.prismaMock.workerNode.update).not.toHaveBeenCalled();
  });
});

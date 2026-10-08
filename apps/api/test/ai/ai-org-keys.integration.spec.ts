// =============================================================================
// /api/admin/ai/org-keys over HTTP (issue #739): RBAC and the egress sentinel
// =============================================================================
//
// An organization's own AI provider keys: org scope (`org_ai_config:*`, held
// through the `org_admin` membership role), never behind `AiEnabledGuard`,
// stored only through the credentials slice's `OrgCredentialsService`, and
// write-only (masked views). The deeper egress sweep is in
// ai-secret-egress.integration.spec.ts.
// =============================================================================

import request from 'supertest';
import { PERMISSIONS_KEY } from '@marinoscar/platform-api/identity';
import { OrgCredentialsService } from '@marinoscar/platform-api/credentials';
import { AiConfigService, AiEnabledGuard, AiOrgKeysController, AiProviderRegistry } from '@marinoscar/platform-api/ai';
import { FakeAiProvider } from '@marinoscar/platform-api/ai/testing';

import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { MOCK_DEFAULT_ORG_ID } from '../fixtures/test-data.factory';
import { authHeader, createMockAdminUser, createMockContributorUser, createMockViewerUser } from '../helpers/auth-mock.helper';
import { closeTestApp, createTestApp, type TestContext } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';

const ORG_KEY_SENTINEL = 'sk-org-keys-route-sentinel-Hb19Qa';

describe('AI organization keys (/api/admin/ai/org-keys, #739)', () => {
  let context: TestContext;
  const stored = new Map<string, string>();
  const orgCredentials = {
    getSecret: jest.fn(async (orgId: string, purpose: string, name: string) => stored.get(`${orgId}|${purpose}|${name}`) ?? null),
    describe: jest.fn(async () => null),
    list: jest.fn(async (orgId: string, purpose: string) =>
      [...stored.keys()]
        .filter((key) => key.startsWith(`${orgId}|${purpose}|`))
        .map((key) => ({ purpose, name: key.split('|')[2], hint: '••••19Qa', label: null, updatedByUserId: null, createdAt: new Date(), updatedAt: new Date('2026-10-01T00:00:00.000Z') })),
    ),
    setSecret: jest.fn(async (orgId: string, purpose: string, name: string, secret: string) => {
      stored.set(`${orgId}|${purpose}|${name}`, secret);
    }),
    deleteSecret: jest.fn(async (orgId: string, purpose: string, name: string) => {
      stored.delete(`${orgId}|${purpose}|${name}`);
    }),
  };

  beforeAll(async () => {
    context = await createTestApp({
      useMockDatabase: true,
      overrideProviders: [{ provide: OrgCredentialsService, useValue: orgCredentials }],
    });
    context.app.get(AiProviderRegistry).register(new FakeAiProvider({ id: 'openai', validKeys: [ORG_KEY_SENTINEL] }));
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
    stored.clear();
    jest.clearAllMocks();
    context.app.get(AiConfigService).invalidateCache();
    context.prismaMock.auditEvent.create.mockResolvedValue({} as never);
  });

  const server = () => context.app.getHttpServer();

  it('declares org_ai_config:read / :write and is NOT behind AiEnabledGuard', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, AiOrgKeysController.prototype.list)).toEqual(['org_ai_config:read']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, AiOrgKeysController.prototype.set)).toEqual(['org_ai_config:write']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, AiOrgKeysController.prototype.remove)).toEqual(['org_ai_config:write']);
    expect(Reflect.getMetadata('__guards__', AiOrgKeysController) ?? []).not.toContain(AiEnabledGuard);
  });

  it.each([
    ['contributor', createMockContributorUser],
    ['viewer', createMockViewerUser],
  ])('a %s (no org_ai_config:*) is refused on every route', async (_role, create) => {
    const user = await create(context);
    await request(server()).get('/api/admin/ai/org-keys').set(authHeader(user.accessToken)).expect(403);
    await request(server()).put('/api/admin/ai/org-keys/openai').set(authHeader(user.accessToken)).send({ apiKey: ORG_KEY_SENTINEL }).expect(403);
    await request(server()).delete('/api/admin/ai/org-keys/openai').set(authHeader(user.accessToken)).expect(403);
    expect(orgCredentials.setSecret).not.toHaveBeenCalled();
  });

  it('an organization administrator lists, sets and removes the key of the ACTIVE organization, reachable while AI is disabled', async () => {
    const admin = await createMockAdminUser(context);

    const empty = await request(server()).get('/api/admin/ai/org-keys').set(authHeader(admin.accessToken)).expect(200);
    expect(empty.body.data).toEqual(
      expect.arrayContaining([{ provider: 'openai', displayName: expect.any(String), configured: false, hint: null, verifiedAt: null }]),
    );

    const put = await request(server())
      .put('/api/admin/ai/org-keys/openai')
      .set(authHeader(admin.accessToken))
      .send({ apiKey: ORG_KEY_SENTINEL })
      .expect(200);
    expect(put.body.data).toMatchObject({ provider: 'openai', configured: true, hint: '••••19Qa' });
    expect(orgCredentials.setSecret).toHaveBeenCalledWith(MOCK_DEFAULT_ORG_ID, 'ai', 'openai', ORG_KEY_SENTINEL, expect.any(Object));
    expect(JSON.stringify(put.body)).not.toContain(ORG_KEY_SENTINEL);

    await request(server()).delete('/api/admin/ai/org-keys/openai').set(authHeader(admin.accessToken)).expect(204);
    expect(stored.size).toBe(0);

    const audits = context.prismaMock.auditEvent.create.mock.calls.map((call: any[]) => call[0].data);
    expect(audits).toEqual([
      expect.objectContaining({ action: 'org_ai_config:set_key', orgId: MOCK_DEFAULT_ORG_ID, targetId: 'openai' }),
      expect.objectContaining({ action: 'org_ai_config:delete_key', orgId: MOCK_DEFAULT_ORG_ID, targetId: 'openai' }),
    ]);
    expect(JSON.stringify(audits)).not.toContain(ORG_KEY_SENTINEL);
  });

  it('a key the provider rejects is a 400 AI_KEY_INVALID and stores nothing', async () => {
    const admin = await createMockAdminUser(context);
    const res = await request(server())
      .put('/api/admin/ai/org-keys/openai')
      .set(authHeader(admin.accessToken))
      .send({ apiKey: 'sk-not-the-valid-one-123' })
      .expect(400);
    expect(res.body.details.reason).toBe('AI_KEY_INVALID');
    expect(orgCredentials.setSecret).not.toHaveBeenCalled();
  });

  it('an unknown provider is a 404; a too-short key a 400', async () => {
    const admin = await createMockAdminUser(context);
    await request(server()).put('/api/admin/ai/org-keys/nope').set(authHeader(admin.accessToken)).send({ apiKey: ORG_KEY_SENTINEL }).expect(404);
    await request(server()).put('/api/admin/ai/org-keys/openai').set(authHeader(admin.accessToken)).send({ apiKey: 'short' }).expect(400);
  });
});

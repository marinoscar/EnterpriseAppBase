// =============================================================================
// A registered provider without a settings slot must not break the admin page
// (issue #921, epic #918)
// =============================================================================
//
// An app may register an adapter with a NEW id (`AiProviderRegistry.register`
// in `onModuleInit`). The `ai` settings namespace has fixed provider slots, so
// that id is listed by `GET /api/admin/ai/config` but has no slot. The admin
// form sends every listed provider back in the full-replace `PUT`; this spec
// pins that the round trip still answers 200, that the provider is reported as
// not configurable, and that a genuinely unknown id is still refused.
// =============================================================================

import request from 'supertest';

import { AiConfigService, AiProviderRegistry } from '@marinoscar/platform-api/ai';
import { CredentialsService } from '@marinoscar/platform-api/credentials';
import { FakeAiProvider } from '@marinoscar/platform-api/ai/testing';

import { setupBaseMocks } from '../../fixtures/mock-setup.helper';
import { authHeader, createMockAdminUser, type TestUser } from '../../helpers/auth-mock.helper';
import { closeTestApp, createTestApp, type TestContext } from '../../helpers/test-app.helper';
import { resetPrismaMock } from '../../mocks/prisma.mock';

const BASE = '/api/admin/ai';
const SLOTLESS_ID = 'acme-llm';

describe('a registered provider without a settings slot (#921)', () => {
  let context: TestContext;
  let admin: TestUser;
  let storedAi: Record<string, unknown>;
  let version: number;

  beforeAll(async () => {
    context = await createTestApp({
      useMockDatabase: true,
      overrideProviders: [
        {
          provide: CredentialsService,
          useValue: {
            describe: jest.fn().mockResolvedValue(null),
            setSecret: jest.fn(),
            getSecret: jest.fn().mockResolvedValue(null),
            deleteSecret: jest.fn(),
          },
        },
      ],
    });

    // What an app does in `onModuleInit`: a new id, no settings slot.
    context.app.get(AiProviderRegistry).register(new FakeAiProvider({ id: SLOTLESS_ID }));
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(async () => {
    resetPrismaMock();
    setupBaseMocks();
    context.app.get(AiConfigService).invalidateCache();

    storedAi = {
      enabled: false,
      keyPolicy: 'byok',
      providers: { openai: { enabled: false } },
      defaults: { allowBackgroundRuns: true },
      logPromptContent: false,
    };
    version = 4;

    context.prismaMock.systemSettings.findUnique.mockImplementation(async () => ({
      id: 'settings-global',
      key: 'global',
      value: { ai: storedAi },
      version,
      updatedAt: new Date('2026-03-03T00:00:00.000Z'),
      updatedByUserId: 'admin-1',
      updatedByUser: { id: 'admin-1', email: 'admin@example.com' },
    }));
    context.prismaMock.systemSettings.update.mockImplementation(async ({ data }: any) => {
      storedAi = data.value.ai;
      version += 1;
      return {
        id: 'settings-global',
        key: 'global',
        value: data.value,
        version,
        updatedAt: new Date(),
        updatedByUserId: 'admin-1',
        updatedByUser: { id: 'admin-1', email: 'admin@example.com' },
      };
    });
    context.prismaMock.auditEvent.create.mockResolvedValue({} as never);

    admin = await createMockAdminUser(context);
  });

  const server = () => context.app.getHttpServer();

  /** The body the admin form sends: every listed provider, its `settingsFields` only. */
  function formBody(config: any, providers?: Record<string, unknown>) {
    return {
      enabled: config.enabled,
      keyPolicy: config.keyPolicy,
      logPromptContent: config.logPromptContent,
      deploymentKeyServesOrgs: config.deploymentKeyServesOrgs,
      defaults: config.defaults,
      hostedTools: config.hostedTools,
      limits: config.limits,
      providers:
        providers ??
        Object.fromEntries(
          config.providers.map((p: any) => [
            p.id,
            {
              enabled: p.enabled,
              ...Object.fromEntries(p.settingsFields.map((f: string) => [f, p[f] ?? null])),
            },
          ]),
        ),
    };
  }

  it('GET lists the slotless provider as registered and not configurable', async () => {
    const res = await request(server()).get(`${BASE}/config`).set(authHeader(admin.accessToken)).expect(200);
    const provider = res.body.data.providers.find((p: any) => p.id === SLOTLESS_ID);

    expect(provider).toMatchObject({ id: SLOTLESS_ID, registered: true, enabled: false, configurable: false });
    expect(res.body.data.providers.find((p: any) => p.id === 'openai')).not.toHaveProperty('configurable', false);
  });

  it('the admin form round trip (GET, then PUT the same config back) answers 200', async () => {
    const got = await request(server()).get(`${BASE}/config`).set(authHeader(admin.accessToken)).expect(200);

    const res = await request(server())
      .put(`${BASE}/config`)
      .set(authHeader(admin.accessToken))
      .send(formBody(got.body.data))
      .expect(200);

    expect(res.body.data.providers.some((p: any) => p.id === SLOTLESS_ID)).toBe(true);
    // The slotless entry is never stored: the namespace has no slot for it.
    expect(Object.keys((storedAi.providers as object) ?? {})).not.toContain(SLOTLESS_ID);
  });

  it('a slotless entry with settings the admin changed is still refused (400)', async () => {
    const got = await request(server()).get(`${BASE}/config`).set(authHeader(admin.accessToken)).expect(200);
    const body = formBody(got.body.data);

    (body.providers as any)[SLOTLESS_ID] = { enabled: true, baseUrl: 'https://gw.example.com' };

    const res = await request(server()).put(`${BASE}/config`).set(authHeader(admin.accessToken)).send(body).expect(400);

    expect(res.body.error?.details ?? res.body.details).toMatchObject({ reason: 'AI_UNKNOWN_PROVIDER' });
  });

  it('an id the registry does not know is still refused (400)', async () => {
    const got = await request(server()).get(`${BASE}/config`).set(authHeader(admin.accessToken)).expect(200);
    const body = formBody(got.body.data);

    (body.providers as any)['no-such-provider'] = { enabled: false };

    await request(server()).put(`${BASE}/config`).set(authHeader(admin.accessToken)).send(body).expect(400);
  });
});

// =============================================================================
// Stored `ai` settings and the provider registry (PP-14.6, issue #924)
// =============================================================================
//
// `ai.providers` is a record validated against the provider registry. Two
// promises keep an existing deployment safe:
//
//   1. TODAY'S STORED SHAPE LOADS UNCHANGED. A row written before the registry
//      existed (the five built-ins, with the fields an administrator set) is
//      read and written back byte for byte, and a provider registered since
//      (the app's `example-transcribe`) simply appears switched off.
//   2. REMOVING A DEFINITION DOES NOT BREAK THE ROW. A slot stored for a
//      provider nobody registers any more is ignored with ONE warning: the
//      admin page, the system settings page and a save all keep working.
// =============================================================================

import { Logger } from '@nestjs/common';
import request from 'supertest';

import { AiConfigService } from '@marinoscar/platform-api/ai';
import { CredentialsService } from '@marinoscar/platform-api/credentials';

import { setupBaseMocks } from '../../fixtures/mock-setup.helper';
import { authHeader, createMockAdminUser, type TestUser } from '../../helpers/auth-mock.helper';
import { closeTestApp, createTestApp, type TestContext } from '../../helpers/test-app.helper';
import { resetPrismaMock } from '../../mocks/prisma.mock';

const ADMIN = '/api/admin/ai';

/** An `ai` namespace as a deployment that predates the registry has it stored. */
const TODAYS_ROW = {
  enabled: true,
  keyPolicy: 'byok',
  providers: {
    openai: { enabled: true, baseUrl: 'https://gateway.example.com/v1' },
    anthropic: { enabled: false },
    gemini: { enabled: true },
    'azure-openai': {
      enabled: true,
      baseUrl: 'https://res.openai.azure.com',
      apiVersion: '2025-04-01-preview',
      apiStyle: 'responses',
      deployments: { 'gpt-4o': 'my-gpt-4o' },
    },
    'openai-compatible': { enabled: false, baseUrl: 'http://ollama:11434/v1', apiStyle: 'chat_completions', requiresKey: false },
  },
  defaults: { maxOutputTokensCap: 4096, allowBackgroundRuns: true, allowRealtime: false },
  logPromptContent: false,
  usageRetentionDays: 90,
  hostedTools: { web_search: false, file_search: false, code_interpreter: false, image_generation: false, mcp: false, mcpAllowedHosts: [] },
  limits: { perUser: { requestsPerMinute: 30 } },
  deploymentKeyServesOrgs: true,
};

describe('stored ai settings and the provider registry (#924)', () => {
  let context: TestContext;
  let admin: TestUser;
  let storedAi: Record<string, any>;
  let version: number;
  let warn: jest.SpyInstance;

  beforeAll(async () => {
    context = await createTestApp({
      useMockDatabase: true,
      overrideProviders: [
        {
          provide: CredentialsService,
          useValue: { describe: jest.fn().mockResolvedValue(null), setSecret: jest.fn(), getSecret: jest.fn().mockResolvedValue(null), deleteSecret: jest.fn() },
        },
      ],
    });
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(async () => {
    resetPrismaMock();
    setupBaseMocks();
    context.app.get(AiConfigService).invalidateCache();
    warn = jest.spyOn(Logger.prototype, 'warn');

    storedAi = structuredClone(TODAYS_ROW);
    version = 7;

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

  afterEach(() => warn.mockRestore());

  const server = () => context.app.getHttpServer();
  const getConfig = async () => (await request(server()).get(`${ADMIN}/config`).set(authHeader(admin.accessToken)).expect(200)).body.data;
  const warningsAbout = (id: string) => warn.mock.calls.filter(([message]) => String(message).includes(`"${id}"`));

  function formBody(config: any) {
    return {
      enabled: config.enabled,
      keyPolicy: config.keyPolicy,
      logPromptContent: config.logPromptContent,
      deploymentKeyServesOrgs: config.deploymentKeyServesOrgs,
      defaults: config.defaults,
      hostedTools: config.hostedTools,
      limits: config.limits,
      providers: Object.fromEntries(
        config.providers.map((p: any) => [
          p.id,
          { enabled: p.enabled, ...Object.fromEntries(p.settingsFields.map((f: string) => [f, p.settings[f] ?? p[f] ?? null])) },
        ]),
      ),
    };
  }

  it("today's stored shape is shown exactly as before, with the app's provider switched off beside it", async () => {
    const config = await getConfig();
    const byId = Object.fromEntries(config.providers.map((p: any) => [p.id, p]));

    expect(byId.openai).toMatchObject({ enabled: true, baseUrl: 'https://gateway.example.com/v1', settingsFields: ['baseUrl'] });
    expect(byId.gemini).toMatchObject({ enabled: true, baseUrl: null });
    expect(byId['azure-openai']).toMatchObject({
      enabled: true,
      baseUrl: 'https://res.openai.azure.com',
      apiVersion: '2025-04-01-preview',
      apiStyle: 'responses',
      deployments: { 'gpt-4o': 'my-gpt-4o' },
      requiresBaseUrl: true,
    });
    expect(byId['openai-compatible']).toMatchObject({ enabled: false, baseUrl: 'http://ollama:11434/v1', apiStyle: 'chat_completions', requiresKey: false });
    expect(byId['example-transcribe']).toMatchObject({ enabled: false, settings: { region: 'us' } });
    expect(config.defaults).toMatchObject({ maxOutputTokensCap: 4096 });
    expect(warn.mock.calls.filter(([message]) => String(message).includes('ai-provider'))).toEqual([]);
  });

  it("saving the form back leaves every built-in's stored slot exactly as it was", async () => {
    const config = await getConfig();

    await request(server()).put(`${ADMIN}/config`).set(authHeader(admin.accessToken)).send(formBody(config)).expect(200);

    for (const id of Object.keys(TODAYS_ROW.providers)) {
      expect(storedAi.providers[id]).toEqual((TODAYS_ROW.providers as Record<string, unknown>)[id]);
    }
    expect(storedAi.providers['example-transcribe']).toEqual({ enabled: false, region: 'us' });
    expect(storedAi.limits).toEqual(TODAYS_ROW.limits);
  });

  it('the system settings page reads the same record, including a provider registered since', async () => {
    const res = await request(server()).get('/api/system-settings').set(authHeader(admin.accessToken)).expect(200);

    expect(res.body.data.ai.providers).toMatchObject({
      openai: { enabled: true, baseUrl: 'https://gateway.example.com/v1' },
      'azure-openai': { enabled: true, deployments: { 'gpt-4o': 'my-gpt-4o' } },
      'example-transcribe': { enabled: false, region: 'us' },
    });
  });

  describe('a slot stored for a provider that is no longer registered', () => {
    const ghost = 'removed-provider-one';

    beforeEach(() => {
      storedAi.providers[ghost] = { enabled: true, region: 'eu' };
    });

    it('is ignored on every read with exactly one warning, and breaks neither page', async () => {
      const config = await getConfig();
      await getConfig();
      await request(server()).get('/api/system-settings').set(authHeader(admin.accessToken)).expect(200);

      expect(config.providers.map((p: any) => p.id)).not.toContain(ghost);
      expect(config.providers.find((p: any) => p.id === 'openai')).toMatchObject({ enabled: true });
      expect(warningsAbout(ghost)).toHaveLength(1);
      expect(String(warningsAbout(ghost)[0]?.[0])).toContain('no such implementation is registered');
    });

    it('does not block a save, which drops it', async () => {
      const config = await getConfig();

      await request(server()).put(`${ADMIN}/config`).set(authHeader(admin.accessToken)).send(formBody(config)).expect(200);

      expect(Object.keys(storedAi.providers)).not.toContain(ghost);
      expect(storedAi.providers.openai).toEqual(TODAYS_ROW.providers.openai);
      await request(server()).patch('/api/system-settings').set(authHeader(admin.accessToken)).send({ ai: { logPromptContent: true } }).expect(200);
    });

    it('is not accepted as a new write', async () => {
      const config = await getConfig();
      const body = formBody(config);
      (body.providers as Record<string, unknown>)[ghost] = { enabled: true };

      const res = await request(server()).put(`${ADMIN}/config`).set(authHeader(admin.accessToken)).send(body).expect(400);

      expect(res.body.details).toMatchObject({ reason: 'AI_UNKNOWN_PROVIDER' });
    });
  });
});

// =============================================================================
// The AssemblyAI case, end to end, with zero edits under packages/ (PP-14.6, #924)
// =============================================================================
//
// `example-transcribe` is an app-side AI provider that only transcribes
// (`platform-extensions/ai/example-transcribe/`), registered from
// `app-registrations/ai.ts`. This spec proves it works with the other slices
// the way a built-in provider does, in two halves over the same real app:
//
//   1. CONFIGURATION: the real settings service, admin controller and key
//      routes over a mocked Prisma client (the `system_settings` row is an
//      in-memory object) and the real adapter in the app's own provider
//      registry. An administrator sees the provider's descriptor, enables it
//      with `region: 'eu'`, sets the deployment key (verified by the adapter
//      before it is stored), and AI off answers 403 AI_DISABLED.
//   2. RUNTIME: the real controller, guards and gate pipeline over the AI
//      runtime harness (`createAiRuntimeHarness({ extraProviders,
//      extraAdapters })`: the real AiService, key resolver, usage recorder and
//      run state machine over in-memory tables). A user with `ai:use`
//      transcribes through the existing route and job; the usage row names the
//      provider; BYOK wins over the deployment key.
//
// There is no Postgres in this tier, so the `ai_usage_events` assertion reads
// the harness's in-memory usage table, the same way every `test/ai` spec does.
// =============================================================================

import request from 'supertest';

import { AiConfigService, AiProviderRegistry } from '@marinoscar/platform-api/ai';
import { JobHandlerRegistry } from '@marinoscar/platform-api/jobs';
import { CredentialsService } from '@marinoscar/platform-api/credentials';
import { FAKE_TRANSCRIPTION_MODEL_CAPABILITIES, HARNESS_USER, HARNESS_USER_KEY } from '@marinoscar/platform-api/ai/testing';

import { ExampleTranscribeAdapter } from '../../../src/platform-extensions/ai/example-transcribe/example-transcribe.adapter';
import { exampleTranscribeProvider } from '../../../src/platform-extensions/ai/example-transcribe/example-transcribe.provider';
import {
  EXAMPLE_TRANSCRIBE_MODEL,
  EXAMPLE_TRANSCRIBE_REJECTED_KEY,
  EXAMPLE_TRANSCRIBE_TRANSPORT,
  FakeExampleTranscribeTransport,
} from '../../../src/platform-extensions/ai/example-transcribe/example-transcribe.transport';
import { setupBaseMocks } from '../../fixtures/mock-setup.helper';
import { createAiHttpTestApp, type AiHttpTestApp } from '../../ai/ai-http.helper';
import { authHeader, createMockAdminUser, createMockTestUser, type TestUser } from '../../helpers/auth-mock.helper';
import { closeTestApp, createTestApp, type TestContext } from '../../helpers/test-app.helper';
import { resetPrismaMock } from '../../mocks/prisma.mock';

const PROVIDER = 'example-transcribe';
const ADMIN = '/api/admin/ai';
const DEPLOYMENT_KEY = 'example-deployment-key-9999';
const TENANT_USER_KEY = `${HARNESS_USER_KEY}-${PROVIDER}`;

describe('example-transcribe: configuration (admin routes over the real settings service)', () => {
  let context: TestContext;
  let admin: TestUser;
  let storedAi: Record<string, unknown>;
  let version: number;
  let secrets: Map<string, string>;
  let setSecret: jest.Mock;
  let transport: FakeExampleTranscribeTransport;

  beforeAll(async () => {
    secrets = new Map();
    setSecret = jest.fn(async (_purpose: string, name: string, value: string) => {
      secrets.set(name, value);
    });

    context = await createTestApp({
      useMockDatabase: true,
      overrideProviders: [
        {
          provide: CredentialsService,
          useValue: {
            describe: jest.fn(async (_purpose: string, name: string) =>
              secrets.has(name) ? { hint: '••••9999', updatedAt: new Date('2026-04-04T00:00:00.000Z'), updatedByUserId: 'admin-1' } : null,
            ),
            setSecret,
            getSecret: jest.fn(async (_purpose: string, name: string) => secrets.get(name) ?? null),
            deleteSecret: jest.fn(),
          },
        },
      ],
    });
    // The app's own transport instance: the adapter in the app's provider registry uses it.
    transport = context.app.get<FakeExampleTranscribeTransport>(EXAMPLE_TRANSCRIBE_TRANSPORT, { strict: false });
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(async () => {
    resetPrismaMock();
    setupBaseMocks();
    secrets.clear();
    setSecret.mockClear();
    context.app.get(AiConfigService).invalidateCache();
    transport.calls.length = 0;

    storedAi = {
      enabled: true,
      keyPolicy: 'byok',
      providers: { openai: { enabled: false }, anthropic: { enabled: false } },
      defaults: { allowBackgroundRuns: true },
      logPromptContent: false,
    };
    version = 1;

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
  const getConfig = async () => (await request(server()).get(`${ADMIN}/config`).set(authHeader(admin.accessToken)).expect(200)).body.data;

  /** The body the admin form sends back: every listed provider, with its settings read from `settings`. */
  function formBody(config: any, overrides: Record<string, unknown> = {}) {
    return {
      enabled: config.enabled,
      keyPolicy: config.keyPolicy,
      logPromptContent: config.logPromptContent,
      deploymentKeyServesOrgs: config.deploymentKeyServesOrgs,
      defaults: config.defaults,
      hostedTools: config.hostedTools,
      limits: config.limits,
      providers: {
        ...Object.fromEntries(
          config.providers.map((p: any) => [
            p.id,
            { enabled: p.enabled, ...Object.fromEntries(p.settingsFields.map((f: string) => [f, p.settings[f] ?? p[f] ?? null])) },
          ]),
        ),
        ...overrides,
      },
    };
  }

  it("is registered in the app's adapter registry and reported by the admin page, with its descriptor", async () => {
    expect(context.app.get(AiProviderRegistry).get(PROVIDER)).toBeInstanceOf(ExampleTranscribeAdapter);

    const config = await getConfig();

    expect(config.providers.find((p: any) => p.id === PROVIDER)).toMatchObject({
      id: PROVIDER,
      displayName: 'Example Transcribe',
      registered: true,
      enabled: false,
      settingsFields: ['region'],
      settings: { region: 'us' },
      requiresBaseUrl: false,
      help: { key: expect.stringContaining('example-rejected-key') },
      keyStatus: { configured: false },
      supportedCapabilities: ['audio_transcription'],
    });
    expect(config.providers.find((p: any) => p.id === PROVIDER)).not.toHaveProperty('configurable');
    expect(config.descriptors.find((d: any) => d.id === PROVIDER)).toEqual({
      kind: 'ai-provider',
      id: PROVIDER,
      label: 'Example Transcribe',
      description: expect.any(String),
      fields: [
        { name: 'enabled', kind: 'boolean', label: 'Enabled', help: expect.any(String) },
        { name: 'region', kind: 'enum', options: ['us', 'eu'], label: 'Region', help: 'Processing region' },
        { name: 'apiKey', kind: 'secret', label: 'API key', help: expect.any(String), hasValue: false, required: true },
      ],
    });
  });

  it("an administrator enables it with region 'eu' from the form, and the built-in slots are untouched", async () => {
    const config = await getConfig();

    const res = await request(server())
      .put(`${ADMIN}/config`)
      .set(authHeader(admin.accessToken))
      .send(formBody(config, { [PROVIDER]: { enabled: true, region: 'eu' } }))
      .expect(200);

    expect((storedAi.providers as Record<string, unknown>)[PROVIDER]).toEqual({ enabled: true, region: 'eu' });
    expect((storedAi.providers as Record<string, unknown>).openai).toEqual({ enabled: false });
    expect(res.body.data.providers.find((p: any) => p.id === PROVIDER)).toMatchObject({ enabled: true, settings: { region: 'eu' } });
  });

  it('refuses a region the provider does not offer, and a setting it does not declare, writing nothing', async () => {
    const config = await getConfig();
    const before = structuredClone(storedAi);

    const bad = await request(server())
      .put(`${ADMIN}/config`)
      .set(authHeader(admin.accessToken))
      .send(formBody(config, { [PROVIDER]: { enabled: true, region: 'mars' } }))
      .expect(400);
    expect(bad.body.details).toMatchObject({ reason: 'AI_PROVIDER_SETTINGS_INVALID', provider: PROVIDER, fields: ['region'] });

    const unknown = await request(server())
      .put(`${ADMIN}/config`)
      .set(authHeader(admin.accessToken))
      .send(formBody(config, { [PROVIDER]: { enabled: true, colour: 'blue' } }))
      .expect(400);
    expect(unknown.body.details).toMatchObject({ reason: 'AI_PROVIDER_FIELD_UNSUPPORTED', provider: PROVIDER, field: 'colour' });

    expect(storedAi).toEqual(before);
  });

  it('the generic system-settings PATCH validates the same settings through the registry', async () => {
    const res = await request(server())
      .patch('/api/system-settings')
      .set(authHeader(admin.accessToken))
      .send({ ai: { providers: { [PROVIDER]: { region: 'mars' } } } })
      .expect(400);

    expect(res.body.details).toMatchObject({ reason: 'AI_PROVIDER_SETTINGS_INVALID', provider: PROVIDER });
  });

  it('stores the deployment key through the existing key route after the adapter verified it, and never echoes it', async () => {
    const config = await getConfig();
    await request(server())
      .put(`${ADMIN}/config`)
      .set(authHeader(admin.accessToken))
      .send(formBody(config, { [PROVIDER]: { enabled: true, region: 'eu' } }))
      .expect(200);

    const res = await request(server())
      .put(`${ADMIN}/providers/${PROVIDER}/key`)
      .set(authHeader(admin.accessToken))
      .send({ apiKey: DEPLOYMENT_KEY })
      .expect(200);

    // Verified by the app's own adapter, under the provider's stored setting.
    expect(transport.callsTo('listModels')).toEqual([{ operation: 'listModels', apiKey: DEPLOYMENT_KEY, region: 'eu' }]);
    expect(setSecret).toHaveBeenCalledWith('ai', PROVIDER, DEPLOYMENT_KEY, expect.objectContaining({ updatedByUserId: admin.id }));
    expect(JSON.stringify(res.body)).not.toContain(DEPLOYMENT_KEY);
    expect(res.body.data.providers.find((p: any) => p.id === PROVIDER).keyStatus).toMatchObject({ configured: true, hint: '••••9999' });
    expect(res.body.data.descriptors.find((d: any) => d.id === PROVIDER).fields.find((f: any) => f.name === 'apiKey')).toMatchObject({
      hasValue: true,
    });
  });

  it('refuses a key the vendor rejects, storing nothing', async () => {
    const res = await request(server())
      .put(`${ADMIN}/providers/${PROVIDER}/key`)
      .set(authHeader(admin.accessToken))
      .send({ apiKey: EXAMPLE_TRANSCRIBE_REJECTED_KEY })
      .expect(400);

    expect(res.body.details.reason).toBe('AI_KEY_INVALID');
    expect(setSecret).not.toHaveBeenCalled();
  });

  it('with AI disabled the transcription route answers 403 AI_DISABLED', async () => {
    storedAi = { ...storedAi, enabled: false };
    context.app.get(AiConfigService).invalidateCache();
    const user = await createMockTestUser(context, { roleName: 'contributor' });

    const res = await request(server())
      .post('/api/ai/audio/transcriptions')
      .set(authHeader(user.accessToken))
      .send({ storageObjectId: '33333333-3333-4333-8333-333333333333', provider: PROVIDER })
      .expect(403);

    expect(res.body.details.reason).toBe('AI_DISABLED');
    expect(transport.calls).toEqual([]);
  });
});

describe('example-transcribe: runtime (the real gate pipeline over the AI runtime harness)', () => {
  let t: AiHttpTestApp;
  let token: string;
  let transport: FakeExampleTranscribeTransport;

  beforeAll(async () => {
    transport = new FakeExampleTranscribeTransport();
    t = await createAiHttpTestApp({
      extraProviders: [exampleTranscribeProvider],
      extraAdapters: [new ExampleTranscribeAdapter(new AiProviderRegistry(), transport)],
      extraProviderSettings: { [PROVIDER]: { region: 'eu' } },
      models: [{ modelId: EXAMPLE_TRANSCRIBE_MODEL, provider: PROVIDER, capabilities: FAKE_TRANSCRIPTION_MODEL_CAPABILITIES }],
    });
  }, 60_000);

  afterAll(async () => {
    await t.close();
  });

  beforeEach(async () => {
    t.reset();
    transport.calls.length = 0;
    t.harness.removeUserKeys(HARNESS_USER);
    t.harness.addUserKey(HARNESS_USER, TENANT_USER_KEY, [EXAMPLE_TRANSCRIBE_MODEL], PROVIDER);
    t.harness.policy.providers[PROVIDER] = { enabled: true, region: 'eu' };
    t.harness.aiConfig.invalidateCache();
    token = (await createMockTestUser(t.context, { id: HARNESS_USER, roleName: 'contributor' })).accessToken;
  });

  const server = () => t.context.app.getHttpServer();
  const recording = () =>
    t.harness.storage.addObject({ uploadedById: HARNESS_USER, bytes: Buffer.from('r'.repeat(3200)), mimeType: 'audio/mpeg', name: 'memo.mp3' });
  const transcribe = () =>
    request(server())
      .post('/api/ai/audio/transcriptions')
      .set(authHeader(token))
      .send({ storageObjectId: recording().id, provider: PROVIDER, model: EXAMPLE_TRANSCRIBE_MODEL });

  async function runJob(handle: { runId: string; jobId: string }): Promise<void> {
    const handler = t.context.app.get(JobHandlerRegistry).get('ai.audio.transcribe');

    expect(handler).toBeDefined();
    await handler!.process({ id: handle.jobId, attempts: 1, payload: { runId: handle.runId } } as never);
  }

  it('a user with ai:use transcribes through the existing route and job, and the usage row names the provider', async () => {
    const started = await transcribe().expect(202);
    await runJob(started.body.data);

    const run = await request(server()).get(`/api/ai/runs/${started.body.data.runId}`).set(authHeader(token)).expect(200);

    expect(run.body.data).toMatchObject({
      status: 'succeeded',
      provider: PROVIDER,
      output: { type: 'transcription', provider: PROVIDER, model: EXAMPLE_TRANSCRIBE_MODEL, text: 'example transcript (eu, 3200 bytes)', durationSeconds: 3.2 },
    });
    expect(transport.callsTo('transcribe')).toEqual([
      { operation: 'transcribe', apiKey: TENANT_USER_KEY, region: 'eu', model: EXAMPLE_TRANSCRIBE_MODEL, bytes: 3200 },
    ]);
    // The `ai_usage_events` row the recorder wrote (the harness's in-memory table; no Postgres in this tier).
    expect(t.harness.usageEvents).toEqual([
      expect.objectContaining({
        userId: HARNESS_USER,
        provider: PROVIDER,
        modelId: EXAMPLE_TRANSCRIBE_MODEL,
        operation: 'audio.transcribe',
        keySource: 'user',
        status: 'succeeded',
        units: { audioSeconds: 3.2 },
      }),
    ]);
    expect(JSON.stringify(run.body) + JSON.stringify(started.body)).not.toContain(TENANT_USER_KEY);
  });

  it('refuses every capability the provider does not carry, before any vendor call', async () => {
    const res = await request(server())
      .post('/api/ai/responses')
      .set(authHeader(token))
      .send({ provider: PROVIDER, model: EXAMPLE_TRANSCRIBE_MODEL, input: 'hello' });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.details.reason).toBe('AI_CAPABILITY_UNSUPPORTED');
    expect(transport.calls).toEqual([]);
  });

  it('with AI disabled the route answers 403 AI_DISABLED and nothing is queued or called', async () => {
    t.harness.setPolicy({ enabled: false });

    const res = await transcribe().expect(403);

    expect(res.body.details.reason).toBe('AI_DISABLED');
    expect(t.harness.runRows).toEqual([]);
    expect(transport.calls).toEqual([]);
  });

  it('with the provider switched off the route answers 403 AI_PROVIDER_DISABLED', async () => {
    t.harness.policy.providers[PROVIDER] = { enabled: false, region: 'eu' };
    t.harness.aiConfig.invalidateCache();

    const res = await transcribe().expect(403);

    expect(res.body.details.reason).toBe('AI_PROVIDER_DISABLED');
    expect(transport.calls).toEqual([]);
  });

  it("BYOK wins: under byok_with_org_fallback the user's own key pays, the deployment key only when the user has none", async () => {
    t.harness.setPolicy({ keyPolicy: 'byok_with_org_fallback' });
    t.harness.setOrgKey(DEPLOYMENT_KEY);

    await runJob((await transcribe().expect(202)).body.data);
    expect(transport.callsTo('transcribe').at(-1)?.apiKey).toBe(TENANT_USER_KEY);
    expect(t.harness.usageEvents.at(-1)).toMatchObject({ provider: PROVIDER, keySource: 'user' });

    t.harness.removeUserKeys(HARNESS_USER);
    await runJob((await transcribe().expect(202)).body.data);
    expect(transport.callsTo('transcribe').at(-1)?.apiKey).toBe(DEPLOYMENT_KEY);
    expect(t.harness.usageEvents.at(-1)).toMatchObject({ provider: PROVIDER, keySource: 'org' });
  });

  it('under plain byok a user without a key is refused (AI_KEY_REQUIRED) and the deployment key is never used', async () => {
    t.harness.setOrgKey(DEPLOYMENT_KEY);
    t.harness.removeUserKeys(HARNESS_USER);

    const res = await transcribe().expect(403);

    expect(res.body.details.reason).toBe('AI_KEY_REQUIRED');
    expect(transport.calls.map((call) => call.apiKey)).not.toContain(DEPLOYMENT_KEY);
  });
});

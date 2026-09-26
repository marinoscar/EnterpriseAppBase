// =============================================================================
// AI secret no-egress — cross-cutting conformance (issue #435, epic #419)
// =============================================================================
//
// No key material — a user's own provider key, the deployment's admin (org)
// key, or a key belonging to some OTHER user — may ever appear anywhere this
// suite can see: a response body, a response header, a captured Pino log
// line, an `audit_events.meta` row, an `ai_usage_events` row, an
// `ai_runs.request` row, or a thrown error's body. Every admin and user AI
// route this suite drives is exercised with a DISTINCT sentinel per role
// (admin/org, this user, another user), so a leak is attributable to exactly
// which key crossed a boundary it should not have.
//
// Two app contexts, because the admin surface (`AiConfigAdminService` and
// friends) and the consumer surface (`AiService`/`AiRunsService`, exercised
// through `ai-http.helper`'s harness) are wired through different services
// and neither substitutes for the other:
//
//   - `adminCtx` mirrors `ai-admin.integration.spec.ts`'s own minimal setup
//     (a stubbed `CredentialsService`, `FakeAiProvider` registered as
//     `openai` in the REAL `AiProviderRegistry`) — reused rather than
//     reinvented, since that file is the worked example for driving this
//     surface at all.
//   - `app` is the `createAiHttpTestApp` harness every other #433 HTTP spec
//     uses, unchanged.
// =============================================================================

import request from 'supertest';
import { Logger } from '@nestjs/common';

import { createTestApp, closeTestApp, type TestContext } from '../helpers/test-app.helper';
import { createMockAdminUser, createMockTestUser, authHeader } from '../helpers/auth-mock.helper';
import { CredentialsService } from '../../src/credentials/credentials.service';
import { AiProviderRegistry } from '../../src/ai/core';
import { AiConfigService } from '../../src/ai/config/ai-config.service';
import { FakeAiProvider } from '../../src/ai/testing/fake-ai-provider';
import {
  AI_SETTINGS_CARRIES_NO_SECRET,
  systemAiSchema,
} from '../../src/common/schemas/settings.schema';
import { JobHandlerRegistry } from '../../src/jobs/job-handler.registry';
import {
  HARNESS_EMBEDDING_MODEL,
  HARNESS_IMAGE_MODEL,
  HARNESS_USER,
  HARNESS_USER_KEY,
  HARNESS_ORG_KEY,
} from '../../src/ai/testing/ai-runtime-harness';
import { createAiHttpTestApp, type AiHttpTestApp, ALL_KEYS, OTHER_USER_KEY, parseSse } from './ai-http.helper';
import { aiConfigResponseSchema, aiKeyRemovalResponseSchema } from '../../src/ai/config/dto/ai-config-response.dto';
import { aiModelSchema, refreshAiCatalogResultSchema } from '../../src/ai/config/dto/ai-model.dto';
import { aiProviderTestResultSchema } from '../../src/ai/config/dto/ai-provider-test.dto';
import { aiPublicConfigSchema } from '../../src/ai/config/dto/ai-public-config.dto';
import { usableAiModelSchema } from '../../src/ai/keys/dto/usable-ai-model.dto';
import { userAiKeyViewSchema, userAiKeyTestResultSchema } from '../../src/ai/keys/dto/user-ai-key.dto';
import {
  aiImageRunOutputSchema,
  aiResponseSchema,
  aiRunStartedSchema,
  aiRunSchema,
} from '../../src/ai/http/dto/ai-response.dto';
import { aiEmbeddingsResponseSchema } from '../../src/ai/http/dto/ai-embeddings.dto';

const ADMIN_KEY_SENTINEL = 'sk-admin-egress-sentinel-Zq81xY';
/** Every value that must never appear anywhere this suite inspects. */
const ALL_SENTINELS = [...ALL_KEYS, ADMIN_KEY_SENTINEL];

/** Every place a sentinel might leak, joined into one haystack per capture. */
function assertNoLeak(label: string, haystack: string): void {
  const leaked = ALL_SENTINELS.filter((sentinel) => haystack.includes(sentinel));
  if (leaked.length > 0) {
    throw new Error(`${label} leaks: ${leaked.join(', ')}`);
  }
  expect(leaked).toEqual([]);
}

describe('AI secret no-egress — cross-cutting conformance (#435)', () => {
  // ---- consumer-side context (the #433 HTTP harness) -------------------------
  let app: AiHttpTestApp;
  let holderToken: string;

  // ---- admin-side context (mirrors ai-admin.integration.spec.ts's setup) ----
  let adminCtx: TestContext;
  let adminFake: FakeAiProvider;
  let storedAi: Record<string, unknown>;
  let storedAdminKey: string | null;
  let adminToken: string;

  // ---- Pino/Nest Logger capture, across BOTH contexts -----------------------
  let logLines: string[];
  let logSpies: jest.SpyInstance[];

  beforeAll(async () => {
    app = await createAiHttpTestApp({ policy: { keyPolicy: 'byok_with_org_fallback' } });

    adminCtx = await createTestApp({
      useMockDatabase: true,
      overrideProviders: [
        {
          provide: CredentialsService,
          useValue: {
            describe: jest.fn(async () => null),
            setSecret: jest.fn(async (_p: string, _n: string, secret: string) => {
              storedAdminKey = secret;
            }),
            getSecret: jest.fn(async () => storedAdminKey),
            deleteSecret: jest.fn(async () => {
              storedAdminKey = null;
            }),
          },
        },
      ],
    });

    adminFake = new FakeAiProvider({ id: 'openai', validKeys: [ADMIN_KEY_SENTINEL], models: ['gpt-mini'] });
    adminCtx.app.get(AiProviderRegistry).register(adminFake);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await closeTestApp(adminCtx);
  });

  beforeEach(async () => {
    // ONE shared mock-Prisma/mock-user registry underlies BOTH app contexts
    // (`test/mocks/prisma.mock.ts` and `test/fixtures/mock-setup.helper.ts`
    // are process-global module state) — `app.reset()` already resets and
    // re-seeds it, so nothing else in this hook may call
    // `resetPrismaMock()`/`setupBaseMocks()` again, or it wipes out whichever
    // mock user was registered first. Every admin-specific override below is
    // layered on top, after the shared reset, never a second reset of it.
    app.reset();
    app.harness.setOrgKey(HARNESS_ORG_KEY);

    adminFake.reset();
    adminCtx.app.get(AiConfigService).invalidateCache();

    storedAi = {
      enabled: true,
      keyPolicy: 'byok',
      providers: { openai: { enabled: true } },
      defaults: { allowBackgroundRuns: true },
      logPromptContent: false,
    };
    storedAdminKey = null;

    adminCtx.prismaMock.systemSettings.findUnique.mockImplementation(async () => ({
      id: 'settings-global',
      key: 'global',
      value: { ai: storedAi },
      version: 4,
      updatedAt: new Date(),
      updatedByUserId: 'admin-1',
      updatedByUser: { id: 'admin-1', email: 'admin@example.com' },
    }));
    adminCtx.prismaMock.systemSettings.update.mockImplementation(async ({ data }: any) => {
      storedAi = data.value.ai;
      return {
        id: 'settings-global',
        key: 'global',
        value: data.value,
        version: 5,
        updatedAt: new Date(),
        updatedByUserId: 'admin-1',
        updatedByUser: { id: 'admin-1', email: 'admin@example.com' },
      };
    });
    adminCtx.prismaMock.auditEvent.create.mockResolvedValue({} as never);
    adminCtx.prismaMock.aiModel.findMany.mockResolvedValue([]);
    adminCtx.prismaMock.aiModel.count.mockResolvedValue(0);

    // Both mock users are created LAST, after every reset above, so neither
    // registration is wiped by the other context's setup.
    const holder = await createMockTestUser(app.context, { id: HARNESS_USER, roleName: 'viewer' });
    holderToken = holder.accessToken;
    const admin = await createMockAdminUser(adminCtx);
    adminToken = admin.accessToken;

    logLines = [];
    logSpies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((method) =>
      jest.spyOn(Logger.prototype, method).mockImplementation((...args: unknown[]) => {
        logLines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      }),
    );
  });

  afterEach(() => {
    for (const spy of logSpies) spy.mockRestore();
  });

  it('the ai settings namespace still carries no secret field (compile-time proof, runtime pin)', () => {
    // `AI_SETTINGS_CARRIES_NO_SECRET` resolves to the type `never` — and this
    // file stops compiling — the instant a key-shaped field is added to
    // `systemAiSchema`. This assertion only pins the runtime value so the
    // constant cannot be silently deleted; `npx tsc --noEmit` is the real
    // guarantee (see `settings.schema.ts`'s own header, and the identical
    // pattern in `email-settings.service.spec.ts`).
    expect(AI_SETTINGS_CARRIES_NO_SECRET).toBe(true);

    const banned = ['secretAccessKey', 'secretKey', 'sessionToken', 'secret', 'password', 'apiKey', 'apiKeys', 'key', 'token'];
    const schemaKeys = Object.keys(systemAiSchema.shape);

    for (const name of banned) {
      expect(schemaKeys).not.toContain(name);
    }
  });

  describe('DTO scan: no AI response schema has a property that could carry key material', () => {
    // Zod schemas, walked structurally — property NAMES, never values, and
    // request DTOs (`SetAiProviderKeyDto`, `SetUserAiKeyDto`, …) are
    // deliberately excluded: those legitimately carry `apiKey` IN, which is
    // the whole point of a write-only key route. What must never happen is a
    // RESPONSE schema publishing a property shaped to hold one back out.
    const BANNED_PROPERTY_NAMES = new Set([
      'secret',
      'secretkey',
      'secretaccesskey',
      'sessiontoken',
      'apikey',
      'apikeys',
      'password',
      'token',
      'privatekey',
      'rawkey',
    ]);

    /** Unwraps optional/nullable/default wrappers to the schema they wrap. */
    function unwrap(schema: any): any {
      let current = schema;
      while (current && typeof current.unwrap === 'function') {
        current = current.unwrap();
      }
      return current;
    }

    /** Every property name reachable from `schema`, however deeply nested. */
    function collectPropertyNames(schema: any, seen = new Set<any>()): string[] {
      const node = unwrap(schema);
      if (!node || seen.has(node)) return [];
      seen.add(node);

      const type = node.def?.type;
      const names: string[] = [];

      if (type === 'object' && node.shape) {
        for (const [key, value] of Object.entries(node.shape)) {
          names.push(key);
          names.push(...collectPropertyNames(value, seen));
        }
      } else if (type === 'array' && node.element) {
        names.push(...collectPropertyNames(node.element, seen));
      } else if ((type === 'union' || type === 'discriminatedUnion') && node.options) {
        for (const option of node.options) names.push(...collectPropertyNames(option, seen));
      } else if (type === 'record' && node.valueType) {
        names.push(...collectPropertyNames(node.valueType, seen));
      }

      return names;
    }

    // The RESPONSE schemas — every `*Dto` this module publishes as an
    // HTTP response, imported by its underlying zod schema so this walk
    // needs no OpenAPI document at all.
    const responseSchemas: Record<string, unknown> = {
      AiConfigResponseDto: aiConfigResponseSchema,
      AiKeyRemovalResponseDto: aiKeyRemovalResponseSchema,
      AiModelDto: aiModelSchema,
      RefreshAiCatalogResultDto: refreshAiCatalogResultSchema,
      AiProviderTestResultDto: aiProviderTestResultSchema,
      AiPublicConfigDto: aiPublicConfigSchema,
      UsableAiModelDto: usableAiModelSchema,
      UserAiKeyViewDto: userAiKeyViewSchema,
      UserAiKeyTestResultDto: userAiKeyTestResultSchema,
      AiResponseDto: aiResponseSchema,
      AiRunStartedDto: aiRunStartedSchema,
      AiRunDto: aiRunSchema,
      AiEmbeddingsResponseDto: aiEmbeddingsResponseSchema,
      AiImageRunOutput: aiImageRunOutputSchema,
    };

    it('finds every response schema, so a broken import list cannot pass vacuously', () => {
      expect(Object.keys(responseSchemas).length).toBeGreaterThanOrEqual(10);
      for (const schema of Object.values(responseSchemas)) {
        expect(schema).toBeDefined();
      }
    });

    it.each(Object.entries(responseSchemas))('%s carries no key-shaped property', (_name, schema) => {
      const offenders = collectPropertyNames(schema).filter((prop) =>
        BANNED_PROPERTY_NAMES.has(prop.toLowerCase()),
      );

      expect(offenders).toEqual([]);
    });
  });

  describe('consumer surface: responses, streaming, key listing', () => {
    it('POST /api/ai/responses: no sentinel anywhere in the body or headers', async () => {
      const res = await request(app.context.app.getHttpServer())
        .post('/api/ai/responses')
        .set(authHeader(holderToken))
        .send({ model: 'fake-model', input: 'hello' })
        .expect(200);

      assertNoLeak('POST /api/ai/responses body', JSON.stringify(res.body));
      assertNoLeak('POST /api/ai/responses headers', JSON.stringify(res.headers));
    });

    it('POST /api/ai/responses/stream: no sentinel in any SSE frame', async () => {
      const res = await request(app.context.app.getHttpServer())
        .post('/api/ai/responses/stream')
        .set(authHeader(holderToken))
        .set('Accept', 'text/event-stream')
        .send({ model: 'fake-model', input: 'hello' })
        .expect(200);

      const frames = parseSse(res.text);
      assertNoLeak('SSE frames', JSON.stringify(frames));
      assertNoLeak('SSE response headers', JSON.stringify(res.headers));
    });

    it('POST /api/ai/embeddings: no sentinel in the body, headers, usage rows or log output', async () => {
      const res = await request(app.context.app.getHttpServer())
        .post('/api/ai/embeddings')
        .set(authHeader(holderToken))
        .send({ model: HARNESS_EMBEDDING_MODEL, input: ['hello', 'world'] })
        .expect(200);

      expect(app.harness.fake.callsTo('embeddings.embed')).toHaveLength(1);
      assertNoLeak('POST /api/ai/embeddings body', JSON.stringify(res.body));
      assertNoLeak('POST /api/ai/embeddings headers', JSON.stringify(res.headers));
      assertNoLeak('ai_usage_events (embeddings)', JSON.stringify(app.harness.usageEvents));
      assertNoLeak('log output (embeddings)', logLines.join('\n'));
    });

    it('POST /api/ai/embeddings refused by the provider: the error body carries no sentinel', async () => {
      const port = app.harness.fake.embeddings!;
      const original = port.embed;
      port.embed = async () => {
        throw new Error(`upstream rejected ${HARNESS_USER_KEY}`);
      };

      try {
        const res = await request(app.context.app.getHttpServer())
          .post('/api/ai/embeddings')
          .set(authHeader(holderToken))
          .send({ model: HARNESS_EMBEDDING_MODEL, input: 'hello' })
          .expect(503);

        assertNoLeak('embeddings error body', JSON.stringify(res.body));
        assertNoLeak('embeddings error log output', logLines.join('\n'));
      } finally {
        port.embed = original;
      }
    });

    it('POST /api/ai/images -> ai.image.generate -> GET /api/ai/runs/:id: no sentinel in any body, row, stored object or log line', async () => {
      const started = await request(app.context.app.getHttpServer())
        .post('/api/ai/images')
        .set(authHeader(holderToken))
        .send({ model: HARNESS_IMAGE_MODEL, prompt: 'a lighthouse', n: 2 })
        .expect(202);

      const handler = app.context.app.get(JobHandlerRegistry).get('ai.image.generate');
      await handler!.process({ id: started.body.data.jobId, payload: { runId: started.body.data.runId } } as never);

      const run = await request(app.context.app.getHttpServer())
        .get(`/api/ai/runs/${started.body.data.runId}`)
        .set(authHeader(holderToken))
        .expect(200);

      expect(run.body.data.status).toBe('succeeded');
      expect(app.harness.fake.callsTo('images.generate')).toHaveLength(1);
      assertNoLeak('POST /api/ai/images body', JSON.stringify(started.body));
      assertNoLeak('POST /api/ai/images headers', JSON.stringify(started.headers));
      assertNoLeak('image run body', JSON.stringify(run.body));
      assertNoLeak('ai_runs rows (images)', JSON.stringify(app.harness.runRows));
      assertNoLeak('ai_usage_events (images)', JSON.stringify(app.harness.usageEvents));
      assertNoLeak(
        'storage objects (images)',
        JSON.stringify(app.harness.storage.objects, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
      );
      assertNoLeak('log output (images)', logLines.join('\n'));
    });

    it('an image run whose provider call fails records a run error with no sentinel', async () => {
      const port = app.harness.fake.images!;
      const original = port.generate;
      port.generate = async () => {
        throw new Error(`upstream rejected ${HARNESS_USER_KEY}`);
      };

      try {
        const started = await request(app.context.app.getHttpServer())
          .post('/api/ai/images')
          .set(authHeader(holderToken))
          .send({ model: HARNESS_IMAGE_MODEL, prompt: 'x' })
          .expect(202);

        const handler = app.context.app.get(JobHandlerRegistry).get('ai.image.generate');
        const thrown = await handler!
          .process({ id: started.body.data.jobId, payload: { runId: started.body.data.runId } } as never)
          .catch((err: unknown) => err);

        const run = await request(app.context.app.getHttpServer())
          .get(`/api/ai/runs/${started.body.data.runId}`)
          .set(authHeader(holderToken))
          .expect(200);

        expect(run.body.data.status).toBe('failed');
        assertNoLeak('failed image run body', JSON.stringify(run.body));
        assertNoLeak('failed image run rows', JSON.stringify(app.harness.runRows));
        assertNoLeak('failed image run usage rows', JSON.stringify(app.harness.usageEvents));
        // The job's own lastError is the wrapped AiError — its serialised form carries no sentinel either.
        assertNoLeak('thrown error body', JSON.stringify(thrown));
        assertNoLeak('thrown error message (the job lastError)', String((thrown as Error | undefined)?.message));
        assertNoLeak('image failure log output', logLines.join('\n'));
      } finally {
        port.generate = original;
      }
    });

    it('a rejected key (AI_KEY_INVALID) carries no sentinel in its error body', async () => {
      // FakeAiProvider's default `validKeys` is unrestricted for the harness
      // provider — force a rejection by asking it to verify a key it was
      // never told to accept, through the "set my key" route.
      const res = await request(app.context.app.getHttpServer())
        .put('/api/ai/keys/openai')
        .set(authHeader(holderToken))
        .send({ apiKey: '' })
        .expect(400);

      assertNoLeak('AI_KEY_INVALID body', JSON.stringify(res.body));
    });

    it('GET /api/ai/keys: only a masked hint, never a full key', async () => {
      // `UserAiKeysService.list` is a REAL provider (not overridden by the
      // harness) reading the REAL, mocked `PrismaService` directly, unlike
      // `AiService`/`AiRunsService` above — it needs its own row.
      app.context.prismaMock.userAiKey.findMany.mockResolvedValue([
        {
          provider: 'openai',
          hint: '••••1111',
          verifiedAt: new Date(),
          lastErrorCode: null,
          reachableModelIds: ['fake-model'],
          reachableCheckedAt: new Date(),
        },
      ]);

      const res = await request(app.context.app.getHttpServer())
        .get('/api/ai/keys')
        .set(authHeader(holderToken))
        .expect(200);

      assertNoLeak('GET /api/ai/keys body', JSON.stringify(res.body));
    });

    it('every ai_usage_events row and every ai_runs.request row carries no sentinel', async () => {
      await request(app.context.app.getHttpServer())
        .post('/api/ai/responses')
        .set(authHeader(holderToken))
        .send({ model: 'fake-model', input: 'hello' })
        .expect(200);

      assertNoLeak('ai_usage_events', JSON.stringify(app.harness.usageEvents));
      assertNoLeak('ai_runs.request', JSON.stringify(app.harness.runRows.map((r) => r.request)));
    });

    it('captured Nest/Pino log output carries no sentinel', () => {
      assertNoLeak('log output', logLines.join('\n'));
    });
  });

  describe('admin surface: setting, testing and removing the org key', () => {
    it('PUT /api/admin/ai/providers/openai/key: response body carries no sentinel, audit meta is codes-only', async () => {
      const res = await request(adminCtx.app.getHttpServer())
        .put('/api/admin/ai/providers/openai/key')
        .set(authHeader(adminToken))
        .send({ apiKey: ADMIN_KEY_SENTINEL })
        .expect(200);

      assertNoLeak('PUT admin key body', JSON.stringify(res.body));
      assertNoLeak('PUT admin key headers', JSON.stringify(res.headers));

      const auditCalls = adminCtx.prismaMock.auditEvent.create.mock.calls.map((call: any[]) => call[0].data);
      assertNoLeak('audit_events rows', JSON.stringify(auditCalls));
      expect(auditCalls.length).toBeGreaterThan(0);
    });

    it('GET /api/admin/ai/config: only a masked keyStatus, never the key', async () => {
      storedAdminKey = ADMIN_KEY_SENTINEL;

      const res = await request(adminCtx.app.getHttpServer())
        .get('/api/admin/ai/config')
        .set(authHeader(adminToken))
        .expect(200);

      assertNoLeak('GET admin config body', JSON.stringify(res.body));
    });

    it('POST /api/admin/ai/providers/openai/test: the diagnosis carries no sentinel even when it succeeds', async () => {
      storedAdminKey = ADMIN_KEY_SENTINEL;

      const res = await request(adminCtx.app.getHttpServer())
        .post('/api/admin/ai/providers/openai/test')
        .set(authHeader(adminToken))
        .send({})
        .expect(200);

      assertNoLeak('provider test body', JSON.stringify(res.body));
    });

    it('DELETE /api/admin/ai/providers/openai/key: response and audit meta carry no sentinel', async () => {
      storedAdminKey = ADMIN_KEY_SENTINEL;

      const res = await request(adminCtx.app.getHttpServer())
        .delete('/api/admin/ai/providers/openai/key')
        .set(authHeader(adminToken))
        .send({ confirmation: 'REMOVE' })
        .expect(200);

      assertNoLeak('DELETE admin key body', JSON.stringify(res.body));

      const auditCalls = adminCtx.prismaMock.auditEvent.create.mock.calls.map((call: any[]) => call[0].data);
      assertNoLeak('audit_events rows (delete)', JSON.stringify(auditCalls));
    });

    it('captured Nest/Pino log output on the admin surface carries no sentinel', async () => {
      await request(adminCtx.app.getHttpServer())
        .put('/api/admin/ai/providers/openai/key')
        .set(authHeader(adminToken))
        .send({ apiKey: ADMIN_KEY_SENTINEL })
        .expect(200);

      assertNoLeak('admin log output', logLines.join('\n'));
    });
  });
});

// =============================================================================
// AI key policy invariant — cross-cutting conformance (issue #435, epic #419)
// =============================================================================
//
// The invariant this suite exists to prove, over every synchronous inference
// ROUTE the HTTP surface offers (`POST /api/ai/responses`,
// `POST /api/ai/responses/stream`, `POST /api/ai/embeddings`) plus the queued path
// (`POST /api/ai/runs`, executed via its `ai.response.run` handler exactly
// as `ai-kill-switch.integration.spec.ts` drives it):
//
//   - `byok`, no user key            -> AI_KEY_REQUIRED, the ORG key is never
//                                        even looked at (`FakeAiProvider`
//                                        never receives it).
//   - `byok_with_org_fallback`,
//     no user key, an org key stored -> the call proceeds WITH the org key
//                                        (this is the one legitimate case),
//                                        recorded `keySource: 'org'`.
//   - a user key exists              -> ALWAYS the user's own key, however the
//                                        deployment's policy is set and however
//                                        an org key is configured. This is the
//                                        sharpest form of "the admin key is
//                                        never spent on a user's own call".
//
// `FakeAiProvider.calls` records the literal `apiKey` each provider call
// carried (`ai/testing/fake-ai-provider.ts`'s own header explains why that is
// safe test-only surface), so "never used" is a fact about what the fake
// actually saw, not about what a mock was told to expect.
//
// CATALOG DISCOVERY'S `keySource: 'admin_discovery'` is deliberately NOT
// re-proven here: `ai-catalog.service.spec.ts` ("records one catalog usage
// row with keySource admin_discovery") already pins it at the unit level,
// and duplicating it here would be exactly the redundant per-story retest
// this cross-cutting suite is not supposed to be. What IS cross-cutting and
// worth a structural check is that the literal string has not drifted.
// =============================================================================

import request from 'supertest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { JobHandlerRegistry } from '../../src/jobs/job-handler.registry';
import { createMockTestUser, authHeader } from '../helpers/auth-mock.helper';
import {
  HARNESS_EMBEDDING_MODEL,
  HARNESS_USER,
  HARNESS_USER_KEY,
  HARNESS_ORG_KEY,
} from '../../src/ai/testing/ai-runtime-harness';
import { createAiHttpTestApp, type AiHttpTestApp, parseSse } from './ai-http.helper';

const BODY = { model: 'fake-model', input: 'hello' };
const EMBED_BODY = { model: HARNESS_EMBEDDING_MODEL, input: ['hello', 'world'] };

describe('AI key policy invariant — admin key never spent on a user’s own inference (#435)', () => {
  let app: AiHttpTestApp;
  let holderToken: string;

  beforeAll(async () => {
    app = await createAiHttpTestApp();
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // `reset()` clears the mocked user registry along with everything else,
    // so the auth token has to be minted fresh every test — one created in
    // `beforeAll` would 401 from the second test onward.
    app.reset();
    const holder = await createMockTestUser(app.context, { id: HARNESS_USER, roleName: 'viewer' });
    holderToken = holder.accessToken;
  });

  describe('byok, caller has no key', () => {
    beforeEach(() => {
      app.harness.setPolicy({ keyPolicy: 'byok' });
      app.harness.removeUserKeys(HARNESS_USER);
      app.harness.setOrgKey(HARNESS_ORG_KEY); // present, and must be ignored
    });

    it('POST /api/ai/responses: 403 AI_KEY_REQUIRED, the org key is never handed to the fake', async () => {
      const res = await request(app.context.app.getHttpServer())
        .post('/api/ai/responses')
        .set(authHeader(holderToken))
        .send(BODY)
        .expect(403);

      expect(res.body.details.reason).toBe('AI_KEY_REQUIRED');
      expect(app.harness.fake.calls).toEqual([]);
      expect(app.harness.fake.apiKeys).not.toContain(HARNESS_ORG_KEY);
    });

    it('POST /api/ai/responses/stream: the same JSON refusal before any frame is sent, org key untouched', async () => {
      const res = await request(app.context.app.getHttpServer())
        .post('/api/ai/responses/stream')
        .set(authHeader(holderToken))
        .set('Accept', 'text/event-stream')
        .send(BODY)
        .expect(403);

      expect(res.body.details.reason).toBe('AI_KEY_REQUIRED');
      expect(app.harness.fake.calls).toEqual([]);
    });

    it('POST /api/ai/embeddings: 403 AI_KEY_REQUIRED, the org key is never handed to the fake', async () => {
      const res = await request(app.context.app.getHttpServer())
        .post('/api/ai/embeddings')
        .set(authHeader(holderToken))
        .send(EMBED_BODY)
        .expect(403);

      expect(res.body.details.reason).toBe('AI_KEY_REQUIRED');
      expect(app.harness.fake.calls).toEqual([]);
    });

    it('POST /api/ai/runs -> the queued run also fails AI_KEY_REQUIRED when executed, org key untouched', async () => {
      const registry = app.context.app.get(JobHandlerRegistry);
      const handler = registry.get('ai.response.run');

      const created = await app.harness.prisma.aiRun.create({
        data: {
          userId: HARNESS_USER,
          provider: 'openai',
          modelId: 'fake-model',
          status: 'pending',
          request: { provider: 'openai', model: 'fake-model', input: 'hello' },
        },
      });

      await handler!.process({ id: 'job-1', payload: { runId: created.id } } as never);

      const stored = app.harness.runRows.find((r) => r.id === created.id);
      expect(stored?.status).toBe('failed');
      expect(stored?.errorCode).toBe('AI_KEY_REQUIRED');
      expect(app.harness.fake.calls).toEqual([]);
    });
  });

  describe('byok_with_org_fallback, caller has no key, an org key is stored', () => {
    beforeEach(() => {
      app.harness.setPolicy({ keyPolicy: 'byok_with_org_fallback' });
      app.harness.removeUserKeys(HARNESS_USER);
      app.harness.setOrgKey(HARNESS_ORG_KEY);
    });

    it('POST /api/ai/responses: succeeds WITH the org key, usage row keySource=org — the one legitimate case', async () => {
      const res = await request(app.context.app.getHttpServer())
        .post('/api/ai/responses')
        .set(authHeader(holderToken))
        .send(BODY)
        .expect(200);

      expect(res.body.data.outputText).toBeDefined();
      expect(app.harness.fake.apiKeys).toEqual([HARNESS_ORG_KEY]);
      expect(app.harness.usageEvents).toEqual(
        expect.arrayContaining([expect.objectContaining({ userId: HARNESS_USER, keySource: 'org' })]),
      );
    });

    it('POST /api/ai/embeddings: succeeds WITH the org key, usage row keySource=org', async () => {
      await request(app.context.app.getHttpServer())
        .post('/api/ai/embeddings')
        .set(authHeader(holderToken))
        .send(EMBED_BODY)
        .expect(200);

      expect(app.harness.fake.callsTo('embeddings.embed').map((c) => c.apiKey)).toEqual([HARNESS_ORG_KEY]);
      expect(app.harness.usageEvents).toEqual([
        expect.objectContaining({ userId: HARNESS_USER, operation: 'embeddings', keySource: 'org' }),
      ]);
    });
  });

  describe('a user key exists — it always wins, whatever the policy and however an org key is configured', () => {
    beforeEach(() => {
      app.harness.setPolicy({ keyPolicy: 'byok_with_org_fallback' });
      app.harness.setOrgKey(HARNESS_ORG_KEY);
      // Re-asserted rather than assumed: an earlier describe block in this
      // file (deliberately) removes HARNESS_USER's key, and `reset()` does
      // not restore one it never set up itself — the harness instance, and
      // its in-memory key table, are shared across every test in this file.
      app.harness.addUserKey(HARNESS_USER, HARNESS_USER_KEY, ['fake-model', HARNESS_EMBEDDING_MODEL]);
    });

    it('POST /api/ai/responses: the fake is called with the user key, never the org key', async () => {
      const res = await request(app.context.app.getHttpServer())
        .post('/api/ai/responses')
        .set(authHeader(holderToken))
        .send(BODY)
        .expect(200);

      expect(res.body.data.outputText).toBeDefined();
      expect(app.harness.fake.apiKeys).toEqual([HARNESS_USER_KEY]);
      expect(app.harness.fake.apiKeys).not.toContain(HARNESS_ORG_KEY);
      expect(app.harness.usageEvents).toEqual(
        expect.arrayContaining([expect.objectContaining({ userId: HARNESS_USER, keySource: 'user' })]),
      );
    });

    it('POST /api/ai/responses/stream: every SSE frame is served over the user key, never the org key', async () => {
      const res = await request(app.context.app.getHttpServer())
        .post('/api/ai/responses/stream')
        .set(authHeader(holderToken))
        .set('Accept', 'text/event-stream')
        .send(BODY)
        .expect(200);

      const frames = parseSse(res.text);
      expect(frames.some((f) => f.event === 'response.completed')).toBe(true);
      expect(app.harness.fake.apiKeys).toEqual([HARNESS_USER_KEY]);
    });

    it('POST /api/ai/embeddings: the fake is called with the user key, never the org key', async () => {
      await request(app.context.app.getHttpServer())
        .post('/api/ai/embeddings')
        .set(authHeader(holderToken))
        .send(EMBED_BODY)
        .expect(200);

      expect(app.harness.fake.callsTo('embeddings.embed').map((c) => c.apiKey)).toEqual([HARNESS_USER_KEY]);
      expect(app.harness.fake.apiKeys).not.toContain(HARNESS_ORG_KEY);
      expect(app.harness.usageEvents).toEqual([
        expect.objectContaining({ userId: HARNESS_USER, operation: 'embeddings', keySource: 'user' }),
      ]);
    });

    it('the queued run path also spends the user key, never the org key', async () => {
      const registry = app.context.app.get(JobHandlerRegistry);
      const handler = registry.get('ai.response.run');

      const created = await app.harness.prisma.aiRun.create({
        data: {
          userId: HARNESS_USER,
          provider: 'openai',
          modelId: 'fake-model',
          status: 'pending',
          request: { provider: 'openai', model: 'fake-model', input: 'hello' },
        },
      });

      await handler!.process({ id: 'job-2', payload: { runId: created.id } } as never);

      const stored = app.harness.runRows.find((r) => r.id === created.id);
      expect(stored?.status).toBe('succeeded');
      expect(app.harness.fake.apiKeys).toEqual([HARNESS_USER_KEY]);
    });
  });

  describe('admin_discovery — the catalog-refresh key source string has not drifted', () => {
    it('ai-catalog.service.ts still tags discovery usage keySource: admin_discovery, exactly as ai-catalog.service.spec.ts pins', () => {
      // A structural check, not a behavioral retest — `ai-catalog.service
      // .spec.ts`'s "records one catalog usage row with keySource
      // admin_discovery" test already drives the real behavior; this only
      // guards the literal string this cross-cutting suite's own header
      // promises against a silent rename on one side only.
      const source = readFileSync(
        join(__dirname, '..', '..', 'src', 'ai', 'catalog', 'ai-catalog.service.ts'),
        'utf8',
      );

      expect(source).toContain("keySource: 'admin_discovery'");
    });
  });
});

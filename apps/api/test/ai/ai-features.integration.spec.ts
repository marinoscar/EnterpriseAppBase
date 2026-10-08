// =============================================================================
// GET /api/ai/features over HTTP (issue #739)
// =============================================================================
//
// The generic feature list behind `AiEnabledGuard` plus `ai:use`: every
// feature an app registered (`registerAiFeature`), in registration order,
// each with whether the caller has a usable model for it. The runtime is the
// harness's (`createAiRuntimeHarness`), so "usable" is computed over its
// in-memory catalog and keys.
// =============================================================================

import request from 'supertest';
import { PERMISSIONS_KEY } from '@marinoscar/platform-api/identity';
import {
  AiConfigService,
  AiEnabledGuard,
  AiFeaturesController,
  UsableModelsService,
  aiFeatureRegistry,
  type AiFeatureDefinition,
} from '@marinoscar/platform-api/ai';
import { createAiRuntimeHarness, HARNESS_MODEL, HARNESS_USER, type AiRuntimeHarness } from '@marinoscar/platform-api/ai/testing';
import { withTemporaryEntries } from '@marinoscar/platform-api/core';

import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { authHeader, createMockTestUser } from '../helpers/auth-mock.helper';
import { closeTestApp, createTestApp, type TestContext } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';

const SUMMARY: AiFeatureDefinition = { id: 'spec_http_summary', label: 'Summaries', group: 'Writing', needs: ['responses'] };
const PHOTO: AiFeatureDefinition = { id: 'spec_http_photo', label: 'Photo reading', needs: ['responses'], inputModalities: ['audio'] };

describe('GET /api/ai/features (#739)', () => {
  let context: TestContext;
  let harness: AiRuntimeHarness;

  beforeAll(async () => {
    harness = createAiRuntimeHarness({
      models: [{ modelId: HARNESS_MODEL, capabilities: { capabilities: ['responses'], inputModalities: ['text'], outputModalities: ['text'] } }],
    });
    context = await createTestApp({
      useMockDatabase: true,
      overrideProviders: [
        { provide: AiConfigService, useValue: harness.aiConfig },
        { provide: UsableModelsService, useValue: harness.usableModels },
      ],
    });
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
    harness.setPolicy({ enabled: true });
  });

  it('requires exactly ai:use and sits behind AiEnabledGuard', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, AiFeaturesController.prototype.list)).toEqual(['ai:use']);
    expect(Reflect.getMetadata('__guards__', AiFeaturesController)).toContain(AiEnabledGuard);
  });

  it('lists the registered features in order, with usable per feature', async () => {
    await withTemporaryEntries(aiFeatureRegistry, [SUMMARY, PHOTO], async () => {
      const user = await createMockTestUser(context, { id: HARNESS_USER, roleName: 'contributor' });
      const res = await request(context.app.getHttpServer()).get('/api/ai/features').set(authHeader(user.accessToken));

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([
        {
          id: 'spec_http_summary',
          label: 'Summaries',
          group: 'Writing',
          needs: ['responses'],
          inputModalities: [],
          providers: null,
          requiresHostedTools: [],
          defaultEffort: null,
          usable: true,
        },
        expect.objectContaining({ id: 'spec_http_photo', inputModalities: ['audio'], usable: false }),
      ]);
    });
  });

  it('is 403 without ai:use', async () => {
    const viewer = await createMockTestUser(context, { roleName: 'viewer' });
    const res = await request(context.app.getHttpServer()).get('/api/ai/features').set(authHeader(viewer.accessToken));
    expect(res.status).toBe(403);
  });

  it('is 403 AI_DISABLED while AI is off', async () => {
    harness.setPolicy({ enabled: false });
    const user = await createMockTestUser(context, { id: HARNESS_USER, roleName: 'contributor' });
    const res = await request(context.app.getHttpServer()).get('/api/ai/features').set(authHeader(user.accessToken));
    expect(res.status).toBe(403);
    expect(res.body.details?.reason).toBe('AI_DISABLED');
  });
});

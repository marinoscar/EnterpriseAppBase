import request from 'supertest';
import { Controller, Get, HttpCode, Module, Post } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  DeploymentModeService,
  buildCorsOptions,
  capabilitiesFor,
  parseDeploymentMode,
  MAINTENANCE_ERROR_MARKER,
  MaintenanceModeService,
  DatabaseHealthIndicator,
  registerHealthIndicator,
} from '@marinoscar/platform-api/host';
import { Public } from '@marinoscar/platform-api/identity';

import { DEFAULT_SYSTEM_SETTINGS } from '../../../src/common/types/settings.types';
import { createMockAdminUser, authHeader } from '../../helpers/auth-mock.helper';
import { setupBaseMocks } from '../../fixtures/mock-setup.helper';
import { resetPrismaMock } from '../../mocks/prisma.mock';
import { TestContext, closeTestApp, createTestApp } from '../../helpers/test-app.helper';

import { registerHostExamples } from '../../../src/app-registrations/host';
import { PAYMENTS_WEBHOOK_PATH } from '../../../src/platform-extensions/host/payments-webhook.bypass';
import { exampleQueue } from '../../../src/platform-extensions/host/queue-readiness.indicator';

// =============================================================================
// PP-14.13 — the host's extension points, from the app, through the REAL AppModule
// =============================================================================
//
// Registers the app's examples (`registerHostExamples`, opt-in) before the
// application is created, exactly as `app-registrations/host.ts` would, and
// drives them through the full request pipeline: the real maintenance guard, the
// real health controller, the real About controller and the real envelope.
// Nothing under `packages/` is edited.
//
//   * an indicator that flips readiness (and a non-critical one that does not)
//   * a bypass that lets a webhook route through an open window, failing closed
//   * an About contributor served as `extras`
//   * a response meta contributor
//   * a deployment mode and capability of the app's own
// =============================================================================

// Registered at import time, before the application exists (the registries
// freeze once it has bootstrapped).
registerHostExamples();
let sideService = { up: true };
registerHealthIndicator({
  id: 'example-side',
  critical: false,
  check: () => ({ status: sideService.up ? 'up' : 'down', details: { region: 'eu-1', apiKey: 'must-not-appear' } as never }),
});

/** The route the bypass is for: public, so only the maintenance guard stands in front of it. */
@Controller('webhooks')
class PaymentsWebhookController {
  @Post('payments')
  @Public()
  @HttpCode(200)
  receive() {
    return { received: true };
  }

  // Neighbours the bypass must NOT admit: another method, another path.
  @Get('payments')
  @Public()
  list() {
    return { received: false };
  }

  @Post('payments/refund')
  @Public()
  @HttpCode(200)
  refund() {
    return { refunded: true };
  }
}

@Module({ controllers: [PaymentsWebhookController] })
class WebhookModule {}

describe('Host extension points (PP-14.13, integration)', () => {
  let context: TestContext;
  let maintenance: MaintenanceModeService;
  let storedSettings: { value: Record<string, unknown> } & Record<string, unknown>;

  const databaseUp = {
    isHealthy: (key: string) => Promise.resolve({ [key]: { status: 'up', responseTime: '1ms' } }),
  };

  const openWindow = (overrides: Record<string, unknown> = {}) => {
    storedSettings.value.maintenance = { ...DEFAULT_SYSTEM_SETTINGS.maintenance, enabled: true, ...overrides };
    maintenance.invalidateCache();
  };

  beforeAll(async () => {
    context = await createTestApp({
      useMockDatabase: true,
      overrideProviders: [{ provide: DatabaseHealthIndicator, useValue: databaseUp }],
      imports: [WebhookModule],
    });
    maintenance = context.module.get(MaintenanceModeService);
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
    storedSettings = {
      id: '99999999-9999-4999-8999-999999999999',
      key: 'global',
      version: 1,
      updatedAt: new Date(),
      updatedByUserId: null,
      value: structuredClone(DEFAULT_SYSTEM_SETTINGS) as unknown as Record<string, unknown>,
    };
    (context.prismaMock.systemSettings.findUnique as jest.Mock).mockImplementation(async () => storedSettings);
    maintenance.setInMemoryOverride(null);
    maintenance.invalidateCache();
    delete process.env.MAINTENANCE_MODE;
    exampleQueue.up = true;
    sideService = { up: true };
  });

  const http = () => request(context.app.getHttpServer());

  // ---------------------------------------------------------------------------
  describe('health indicators', () => {
    it('reports every indicator under the Terminus maps, the database first', async () => {
      const { body } = await http().get('/api/health').expect(200);
      const health = body.data;
      expect(Object.keys(health.info)).toEqual(['database', 'example-queue', 'example-side']);
      expect(health.status).toBe('ok');
      expect(health.info.database).toEqual({ status: 'up', responseTime: '1ms' });
      expect(health.info['example-queue']).toEqual({ status: 'up', depth: 3 });
    });

    it('keeps secrets out of the PUBLIC response: a credential-named detail is dropped', async () => {
      const { body } = await http().get('/api/health').expect(200);
      expect(body.data.info['example-side']).toEqual({ status: 'up', region: 'eu-1' });
      expect(JSON.stringify(body)).not.toContain('must-not-appear');
    });

    it('/health/ready flips to 503 when the critical indicator goes down, and back', async () => {
      await http().get('/api/health/ready').expect(200);

      exampleQueue.up = false;
      const down = await http().get('/api/health/ready').expect(503);
      // `HttpExceptionFilter` rebuilds an error body from a fixed key set and carries Terminus' per-indicator map as `details`.
      expect(down.body.details['example-queue']).toEqual({ status: 'down', depth: 3 });
      expect(down.body.details.database.status).toBe('up');

      exampleQueue.up = true;
      await http().get('/api/health/ready').expect(200);
    });

    it('a non-critical indicator going down does not drain the instance but shows in /health', async () => {
      sideService.up = false;
      await http().get('/api/health/ready').expect(200);
      const full = await http().get('/api/health').expect(503);
      expect(full.body.details['example-side'].status).toBe('down');
    });

    it('/health/live runs no indicator at all', async () => {
      exampleQueue.up = false;
      sideService.up = false;
      await http().get('/api/health/live').expect(200);
    });
  });

  // ---------------------------------------------------------------------------
  describe('maintenance bypass', () => {
    it('without a window the webhook is reachable, as any public route', async () => {
      await http().post(PAYMENTS_WEBHOOK_PATH).expect(200);
    });

    it('lets the webhook through an open window and nothing else', async () => {
      openWindow();

      await http().post(PAYMENTS_WEBHOOK_PATH).expect(200);

      // the same path with another method, another path, and an ordinary API route stay blocked
      for (const blocked of [
        () => http().get(PAYMENTS_WEBHOOK_PATH),
        () => http().post(`${PAYMENTS_WEBHOOK_PATH}/refund`),
        () => http().get('/api/users'),
      ]) {
        const response = await blocked().expect(503);
        expect(response.body.details.reason).toBe(MAINTENANCE_ERROR_MARKER);
      }
    });

    it('does not change what an admin sees, and the built-in rule still runs first', async () => {
      const admin = await createMockAdminUser(context);
      openWindow({ allowAdmins: true });
      await http().get('/api/system-settings').set(authHeader(admin.accessToken)).expect(200);

      openWindow({ allowAdmins: false });
      await http().get('/api/system-settings').set(authHeader(admin.accessToken)).expect(503);
    });

    it('does not widen the reachable set for a forged bearer', async () => {
      openWindow();
      await http().get('/api/users').set('Authorization', 'Bearer not-a-real-token').expect(503);
    });
  });

  // ---------------------------------------------------------------------------
  describe('About contributors', () => {
    it('serves the registered contributor as extras on the real route', async () => {
      const admin = await createMockAdminUser(context);
      const { body } = await http().get('/api/admin/about').set(authHeader(admin.accessToken)).expect(200);
      expect(body.data.extras).toEqual([
        { id: 'transcription', label: 'Transcription', facts: { provider: 'example-transcribe', models: 2, batchOnly: true } },
      ]);
      // the platform's own facts are untouched
      expect(body.data.api.deploymentMode).toBe('self-hosted');
      expect(body.data.runtime).toBeDefined();
    });

    it('is still guarded by system_settings:read (the app host decorators)', async () => {
      await http().get('/api/admin/about').expect(401);
    });
  });

  // ---------------------------------------------------------------------------
  describe('response meta', () => {
    it('adds the contributed key to every enveloped response, beside the timestamp', async () => {
      const admin = await createMockAdminUser(context);
      const { body } = await http().get('/api/admin/about').set(authHeader(admin.accessToken)).expect(200);
      expect(body.meta.apiRevision).toBe(1);
      expect(new Date(body.meta.timestamp).toISOString()).toBe(body.meta.timestamp);
    });
  });

  // ---------------------------------------------------------------------------
  describe('deployment modes and capabilities', () => {
    it('knows the app capability in the running container', () => {
      const deployment = context.module.get(DeploymentModeService);
      expect(deployment.mode).toBe('self-hosted');
      expect(deployment.can('bulkExport')).toBe(true);
      expect(deployment.can('inAppRestore')).toBe(true);
    });

    it('accepts the app mode the way main.ts parses it, with its own capability values', () => {
      expect(parseDeploymentMode('byoc')).toBe('byoc');
      expect(capabilitiesFor('byoc')).toEqual({ inAppRestore: false, bulkExport: true });
      expect(capabilitiesFor('saas')).toEqual({ inAppRestore: false, bulkExport: false });

      const byoc = new DeploymentModeService({ get: () => 'byoc' } as unknown as ConfigService);
      expect(byoc.inAppRestoreEnabled).toBe(false);
      expect(() => byoc.assertInAppRestoreEnabled()).toThrow();
    });

    it('still refuses a mode nobody registered', () => {
      expect(() => parseDeploymentMode('on-prem')).toThrow(/Allowed values: self-hosted, saas, byoc/);
    });
  });

  // ---------------------------------------------------------------------------
  describe('CORS', () => {
    it('adds exposed headers and max age without touching the origin policy', () => {
      expect(buildCorsOptions('https://app.example.com', { exposedHeaders: ['x-request-id'], maxAge: 600 })).toEqual({
        origin: ['https://app.example.com'],
        credentials: true,
        exposedHeaders: ['x-request-id'],
        maxAge: 600,
      });
    });
  });
});


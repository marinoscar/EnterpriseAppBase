// =============================================================================
// Integration tests for GET /api/admin/doctor (issue #634)
// =============================================================================
//
// The package's `test/doctor/doctor.service.spec.ts`
// (`@marinoscar/platform-api/doctor`) proves what the service DECIDES. This
// suite drives the route through the REAL AppModule, guard stack, validation
// pipe and response interceptor — the things a unit test cannot see:
//
//   1. RBAC in both directions (anonymous 401, viewer 403, admin 200), for the
//      permissionless-route trap `about.integration.spec.ts` describes.
//   2. The checks every feature module registers really are wired: the report
//      an admin receives through the real app lists them.
//   3. ⚠ NO SECRET ON THE WIRE. The serialized report — every detail, error
//      and data value of every check in the application — must not contain the
//      configured JWT secret or encryption key.
// =============================================================================

// Set before the app (and `secret-cipher.ts`'s key cache) is loaded.
const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
const ORIGINAL_KEY_ENV = process.env.SECRETS_ENCRYPTION_KEY;
process.env.SECRETS_ENCRYPTION_KEY = ENCRYPTION_KEY;

import request from 'supertest';

import { DoctorService } from '@marinoscar/platform-api/doctor';
import {
  doctorCheckReportSchema,
  doctorQuerySchema,
  doctorReportSchema,
  doctorStatusSchema,
} from '@marinoscar/platform-contract/doctor';
import { z } from 'zod';

import { PERMISSIONS_KEY } from '@marinoscar/platform-api/identity';
import { doctorModule } from '../../src/doctor/doctor.config';
import { TestContext, closeTestApp, createTestApp } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import {
  authHeader,
  createMockAdminUser,
  createMockContributorUser,
  createMockViewerUser,
} from '../helpers/auth-mock.helper';

const ROUTE = '/api/admin/doctor';

// The controller class `DoctorModule.forRoot()` created for this app, with the
// app's own `@Auth()` applied through the platform host (#696).
const DoctorController = doctorModule.controllers![0] as { name: string; prototype: { getReport: object } };

describe('Doctor API (Integration)', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestApp({ useMockDatabase: true });
  }, 60000);

  afterAll(async () => {
    await closeTestApp(context);

    if (ORIGINAL_KEY_ENV === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
    else process.env.SECRETS_ENCRYPTION_KEY = ORIGINAL_KEY_ENV;
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
    context.prismaMock.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    context.module.get(DoctorService).invalidate();
  });

  const server = () => context.app.getHttpServer();
  const adminAuth = async () => authHeader((await createMockAdminUser(context)).accessToken);

  describe('permissions', () => {
    it('declares exactly system_settings:read, and invents no doctor:read', () => {
      expect(DoctorController.name).toBe('DoctorController');
      const declared = Reflect.getMetadata(PERMISSIONS_KEY, DoctorController.prototype.getReport);

      expect(declared).toEqual(['system_settings:read']);
    });

    it('refuses an unauthenticated caller with 401', async () => {
      await request(server()).get(ROUTE).expect(401);
    });

    it('refuses a viewer with 403', async () => {
      const viewer = await createMockViewerUser(context);

      await request(server()).get(ROUTE).set(authHeader(viewer.accessToken)).expect(403);
    });

    it('refuses a contributor with 403', async () => {
      const contributor = await createMockContributorUser(context);

      await request(server()).get(ROUTE).set(authHeader(contributor.accessToken)).expect(403);
    });

    it('gives an admin a populated 200 in the { data, meta } envelope', async () => {
      const { body } = await request(server()).get(ROUTE).set(await adminAuth()).expect(200);

      expect(body).toHaveProperty('meta');
      expect(body.data).toMatchObject({
        verdict: expect.stringMatching(/^(pass|warn|fail|skip)$/),
        generatedAt: expect.any(String),
        durationMs: expect.any(Number),
        checks: expect.any(Array),
      });
    }, 30000);
  });

  describe('the report', () => {
    it('lists every registered check with a full row, and a remedy on each warn/fail', async () => {
      const { body } = await request(server()).get(ROUTE).set(await adminAuth()).expect(200);
      const checks = body.data.checks as Array<Record<string, unknown>>;

      for (const check of checks) {
        expect(Object.keys(check).sort()).toEqual(
          ['category', 'data', 'detail', 'durationMs', 'error', 'id', 'label', 'remedy', 'settingsPath', 'status'].sort(),
        );

        if (check.status === 'warn' || check.status === 'fail') {
          expect(typeof check.remedy).toBe('string');
        }
      }
    }, 30000);

    it('filters by category', async () => {
      const { body } = await request(server())
        .get(`${ROUTE}?category=core&refresh=true`)
        .set(await adminAuth())
        .expect(200);

      for (const check of body.data.checks) expect(check.category).toBe('core');
    }, 30000);

    it('includes core.deployment-mode, passing for the default self-hosted mode (#685)', async () => {
      const { body } = await request(server())
        .get(`${ROUTE}?category=core&refresh=true`)
        .set(await adminAuth())
        .expect(200);

      const check = (body.data.checks as Array<Record<string, any>>).find(
        (entry) => entry.id === 'core.deployment-mode',
      );

      expect(check).toMatchObject({
        status: 'pass',
        detail: 'Self-hosted: in-app backup and restore available',
        data: { mode: 'self-hosted', inAppRestore: true },
      });
    }, 30000);

    it('includes tenancy.mode in the auth category, passing for a single-org database (PP-6.2, #722)', async () => {
      context.prismaMock.organization.count.mockImplementation(async (args?: { where?: { isDefault?: boolean } }) =>
        args?.where?.isDefault ? 1 : 1,
      );
      context.prismaMock.user.count.mockResolvedValue(0);

      const { body } = await request(server())
        .get(`${ROUTE}?category=auth&refresh=true`)
        .set(await adminAuth())
        .expect(200);

      const check = (body.data.checks as Array<Record<string, any>>).find((entry) => entry.id === 'tenancy.mode');

      expect(check).toMatchObject({
        category: 'auth',
        status: 'pass',
        settingsPath: '/admin/settings/users',
        data: { mode: 'single', organizations: 1, usersWithoutMembership: 0 },
      });
    }, 30000);

    it('fails tenancy.mode when single mode meets several organizations (PP-6.2, #722)', async () => {
      context.prismaMock.organization.count.mockImplementation(async (args?: { where?: { isDefault?: boolean } }) =>
        args?.where?.isDefault ? 1 : 2,
      );
      context.prismaMock.user.count.mockResolvedValue(0);

      const { body } = await request(server())
        .get(`${ROUTE}?category=auth&refresh=true`)
        .set(await adminAuth())
        .expect(200);

      const check = (body.data.checks as Array<Record<string, any>>).find((entry) => entry.id === 'tenancy.mode');

      expect(check).toMatchObject({ status: 'fail', detail: 'Single-org mode, but 2 organizations exist' });
      expect(check?.remedy).toMatch(/TENANCY_MODE=multi/);
    }, 30000);

    it('rejects a malformed category with 400', async () => {
      await request(server()).get(`${ROUTE}?category=${encodeURIComponent('DROP TABLE')}`).set(await adminAuth()).expect(400);
    });

    it('rejects a non-boolean refresh with 400', async () => {
      await request(server()).get(`${ROUTE}?refresh=yes`).set(await adminAuth()).expect(400);
    });

    it('never puts the JWT secret or the encryption key on the wire', async () => {
      const { text } = await request(server()).get(`${ROUTE}?refresh=true`).set(await adminAuth()).expect(200);

      const jwtSecret = process.env.JWT_SECRET;
      expect(jwtSecret && jwtSecret.length).toBeTruthy();
      expect(text).not.toContain(jwtSecret as string);
      expect(text).not.toContain(ENCRYPTION_KEY);
      expect(text).not.toContain(Buffer.from(ENCRYPTION_KEY, 'base64').toString('hex'));
    }, 30000);
  });

  // The wire and `@marinoscar/platform-contract/doctor` (#701), the schemas the
  // web client takes its types from, are the same shape in both directions.
  describe('the shared contract', () => {
    // The contract, extended in app code (never edited) to refuse any field it
    // does not declare: a field the API adds without the contract fails here.
    const exactReportSchema = doctorReportSchema
      .extend({ checks: z.array(doctorCheckReportSchema.strict()) })
      .strict();

    it('answers with exactly the contract report, field for field', async () => {
      const { body } = await request(server()).get(`${ROUTE}?refresh=true`).set(await adminAuth()).expect(200);

      expect(() => exactReportSchema.parse(body.data)).not.toThrow();
      expect(doctorStatusSchema.parse(body.data.verdict)).toBe(body.data.verdict);
    }, 30000);

    it.each([
      [{ category: 'core', refresh: 'true' }],
      [{ refresh: 'false' }],
      [{ category: 'fork_widgets' }],
      [{ category: 'Core' }],
      [{ refresh: 'yes' }],
    ])('validates the query %j exactly as the contract does', async (query) => {
      const expected = doctorQuerySchema.safeParse(query).success ? 200 : 400;

      await request(server())
        .get(`${ROUTE}?${new URLSearchParams(query).toString()}`)
        .set(await adminAuth())
        .expect(expected);
    }, 30000);
  });
});

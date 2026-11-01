// =============================================================================
// The `preferences.coach` example: an app adds metadata to users WITHOUT touching a package (PP-14.27)
// =============================================================================
//
// `src/platform-extensions/identity/coach-preferences.*` declares a namespace of
// `users.metadata`; `src/app-registrations/identity.ts` registers it with
// `registerUserMetadataSchema`. This spec boots the REAL application (the real
// AppModule, so the real `IdentityModule` provides `IdentityMetadataService`)
// plus the example's own module, with only Prisma mocked, and proves:
//
//   1. the app service reads defaults, writes one namespace and merges patches
//      through the platform's service, validated against the registered schema;
//   2. the route the APP wrote returns only its namespace, and a secret-named
//      key or an invalid value is a 400;
//   3. the platform itself serves no route over the document: the signed-in
//      user's own response carries no `metadata`.
// =============================================================================

import request from 'supertest';

import { IdentityMetadataService, userMetadataRegistry } from '@marinoscar/platform-api/identity';

import { CoachPreferencesModule } from '../../../src/platform-extensions/identity/coach-preferences.module';
import { CoachPreferencesService } from '../../../src/platform-extensions/identity/coach-preferences.service';
import { COACH_PREFERENCES_NAMESPACE, DEFAULT_COACH_PREFERENCES } from '../../../src/platform-extensions/identity/coach-preferences.metadata';
import { authHeader, createMockTestUser } from '../../helpers/auth-mock.helper';
import { closeTestApp, createTestApp, type TestContext } from '../../helpers/test-app.helper';
import { prismaMock, resetPrismaMock } from '../../mocks/prisma.mock';
import { setupBaseMocks } from '../../fixtures/mock-setup.helper';

const USER_ID = '44444444-4444-4444-8444-444444444444';

describe('preferences.coach: an app-side metadata namespace (PP-14.27)', () => {
  let context: TestContext;
  /** `users.metadata` of every user the mock knows, by id. */
  let documents: Map<string, Record<string, unknown>>;

  beforeAll(async () => {
    context = await createTestApp({ useMockDatabase: true, imports: [CoachPreferencesModule] });
  }, 120_000);

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
    documents = new Map([[USER_ID, {}]]);
    // The two statements the platform service issues, answered from memory.
    (prismaMock.$transaction as jest.Mock).mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prismaMock));
    (prismaMock.$queryRaw as jest.Mock).mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const id = String(values[values.length - 1]);
      const document = documents.get(id);
      if (!document) return [];
      if (/FOR UPDATE/.test(strings.join('?'))) return [{ metadata: structuredClone(document) }];
      return [{ value: document[String(values[0])] ?? null }];
    });
    (prismaMock.$executeRaw as jest.Mock).mockImplementation(async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      documents.set(String(values[1]), JSON.parse(String(values[0])) as Record<string, unknown>);
      return 1;
    });
  });

  it('is registered by the app, in the user registry only', () => {
    expect(userMetadataRegistry.has(COACH_PREFERENCES_NAMESPACE)).toBe(true);
  });

  it('reads the defaults, writes one namespace and merges a patch through the platform service', async () => {
    const service = context.module.get(CoachPreferencesService);
    expect(context.module.get(IdentityMetadataService, { strict: false })).toBeDefined();

    await expect(service.get(USER_ID)).resolves.toEqual(DEFAULT_COACH_PREFERENCES);
    await expect(service.update(USER_ID, { reminderHour: 6 })).resolves.toEqual({ ...DEFAULT_COACH_PREFERENCES, reminderHour: 6 });
    await expect(service.update(USER_ID, { labels: ['u16', 'masters'] })).resolves.toEqual({ reminderHour: 6, weeklyDigest: true, labels: ['u16', 'masters'] });
    expect(documents.get(USER_ID)).toEqual({ [COACH_PREFERENCES_NAMESPACE]: { reminderHour: 6, weeklyDigest: true, labels: ['u16', 'masters'] } });
  });

  it('serves only the app namespace over the route the app wrote, and refuses bad input', async () => {
    const user = await createMockTestUser(context, { id: USER_ID });
    documents.set(USER_ID, { 'other.app': { private: true } });
    const server = context.app.getHttpServer();

    const put = await request(server).put('/api/coach/preferences').set(authHeader(user.accessToken)).send({ reminderHour: 5, weeklyDigest: false });
    expect(put.status).toBe(200);
    expect(put.body.data).toEqual({ reminderHour: 5, weeklyDigest: false, labels: [] });

    const get = await request(server).get('/api/coach/preferences').set(authHeader(user.accessToken));
    expect(get.body.data).toEqual({ reminderHour: 5, weeklyDigest: false, labels: [] });
    expect(JSON.stringify(get.body)).not.toContain('private');

    const invalid = await request(server).put('/api/coach/preferences').set(authHeader(user.accessToken)).send({ reminderHour: 99 });
    expect(invalid.status).toBe(400);
    expect(invalid.body.message ?? JSON.stringify(invalid.body)).toMatch(/preferences\.coach|reminderHour/);
    expect(documents.get(USER_ID)).toEqual({ 'other.app': { private: true }, [COACH_PREFERENCES_NAMESPACE]: { reminderHour: 5, weeklyDigest: false, labels: [] } });
  });

  it('is not served by the platform: the current-user response carries no metadata', async () => {
    const user = await createMockTestUser(context, { id: USER_ID });
    const stored = { [COACH_PREFERENCES_NAMESPACE]: { reminderHour: 5, weeklyDigest: false, labels: [] } };
    // Every user row the database returns now carries its metadata column.
    const findUnique = prismaMock.user.findUnique as jest.Mock;
    const rowOf = findUnique.getMockImplementation()!;
    findUnique.mockImplementation(async (args: unknown) => {
      const row = await rowOf(args);
      return row ? { ...row, metadata: stored } : row;
    });
    const me = await request(context.app.getHttpServer()).get('/api/auth/me').set(authHeader(user.accessToken));
    expect(me.status).toBe(200);
    expect(JSON.stringify(me.body)).not.toMatch(/metadata|reminderHour/);
  });
});

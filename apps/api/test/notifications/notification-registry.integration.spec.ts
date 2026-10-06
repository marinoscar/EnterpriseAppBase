import { readFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';

import {
  TestContext,
  createTestApp,
  closeTestApp,
} from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { createMockAdminUser, authHeader } from '../helpers/auth-mock.helper';

// =============================================================================
// Notification registry, over HTTP (issue #678, PP-1.6)
// =============================================================================
//
// `GET /api/notifications/events` is what the web app's preferences matrix and
// the admin policy page render. Issue #678 moves the events, channels and
// templates behind it from closed literals to registries, and promises NO
// behaviour change: the same events, in the same order, with the same labels,
// channels and `declaredChannels`.
//
// `fixtures/notification-events.main.json` is that body's `data` as `main` served it
// BEFORE the registry existed (default policy: no `system_settings`
// notification override), captured from this same endpoint. It is the
// reference, not a snapshot to regenerate: a diff here is a behaviour change
// to review, and a deliberate new platform event is the only reason to edit it.
// =============================================================================

const mainEventsBody: unknown = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'notification-events.main.json'), 'utf8'),
);

describe('Notification registry integration (#678)', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestApp({ useMockDatabase: true });
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
  });

  describe('GET /api/notifications/events', () => {
    it('returns exactly the body main returned before the registry (events, order, labels, channels)', async () => {
      const admin = await createMockAdminUser(context);

      const response = await request(context.app.getHttpServer())
        .get('/api/notifications/events')
        .set(authHeader(admin.accessToken))
        .expect(200);

      expect(response.body.data).toEqual(mainEventsBody);
    });
  });
});

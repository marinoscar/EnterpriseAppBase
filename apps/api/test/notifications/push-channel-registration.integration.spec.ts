import {
  TestContext,
  createTestApp,
  closeTestApp,
} from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import {
  NOTIFICATION_CHANNEL_SENDERS,
  type NotificationChannelSender,
} from '../../src/notifications/notification.types';

// =============================================================================
// Conditional registration of PushNotificationChannel (issue #230, epic #215)
// =============================================================================
//
// `notifications.module.ts`'s factory is the ENTIRE effect of #230's feature
// gate: `PushNotificationChannel` is only pushed into the
// `NOTIFICATION_CHANNEL_SENDERS` array when `PushSubscriptionService.
// isEnabled()` is true (both VAPID keys configured). This is exercised over a
// REAL, fully-wired `NotificationsModule` (via the full `AppModule`, mocked
// Prisma only) rather than a hand-built test module with the four providers
// reimplemented, so a drift between this test and the real factory wiring is
// structurally impossible — there is only one factory, and this is it.
//
// `NOTIFICATION_CHANNEL_SENDERS` is NOT exported from `NotificationsModule`
// (see that file's header: exporting internals would let a feature reach past
// the dispatcher's preference/mandatory gates). `context.module.get(token,
// { strict: false })` is the same escape hatch `storage.integration.spec.ts`
// already uses to reach `STORAGE_PROVIDER` for an equivalent reason — it
// searches the whole compiled container rather than only what the root module
// exports, which is exactly what a white-box test of an internal wiring
// decision needs.
//
// `configuration()` (`src/config/configuration.ts`) reads
// `process.env.VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` directly, and
// `ConfigModule.forRoot({ load: [configuration] })` calls it once per module
// compilation — so setting the env vars BEFORE `createTestApp()` and
// restoring them in `afterAll` is enough to drive the two cases through two
// independently-compiled app instances. `.env.test` (loaded once by
// `test/setup.ts`) declares neither key, which is why the "disabled" describe
// block needs no setup of its own — see `push-subscriptions.integration.spec.
// ts`'s header comment, which documents the same default for the sibling
// suite.
// =============================================================================

function channelsOf(context: TestContext): string[] {
  const senders = context.module.get<NotificationChannelSender[]>(
    NOTIFICATION_CHANNEL_SENDERS,
    { strict: false },
  );
  return senders.map((sender) => sender.channel);
}

describe('NOTIFICATION_CHANNEL_SENDERS: push channel gating (#230)', () => {
  describe('no VAPID keys configured (the default test environment)', () => {
    let context: TestContext;

    beforeAll(async () => {
      // Belt-and-braces: `.env.test` already declares neither key, but a
      // prior describe block in a shared worker process must not be able to
      // leak env state into this one.
      delete process.env.VAPID_PUBLIC_KEY;
      delete process.env.VAPID_PRIVATE_KEY;

      context = await createTestApp({ useMockDatabase: true });
    });

    afterAll(async () => {
      await closeTestApp(context);
    });

    beforeEach(() => {
      resetPrismaMock();
      setupBaseMocks();
    });

    it('does not include "push" in the resolved channel senders', () => {
      expect(channelsOf(context)).not.toContain('push');
    });

    it('still includes "email" and "browser" — the gate is push-specific', () => {
      const channels = channelsOf(context);
      expect(channels).toContain('email');
      expect(channels).toContain('browser');
    });
  });

  describe('both VAPID keys configured', () => {
    let context: TestContext;

    beforeAll(async () => {
      process.env.VAPID_PUBLIC_KEY = 'test-public-key';
      process.env.VAPID_PRIVATE_KEY = 'test-private-key';

      context = await createTestApp({ useMockDatabase: true });
    });

    afterAll(async () => {
      delete process.env.VAPID_PUBLIC_KEY;
      delete process.env.VAPID_PRIVATE_KEY;

      await closeTestApp(context);
    });

    beforeEach(() => {
      resetPrismaMock();
      setupBaseMocks();
    });

    it('includes "push" in the resolved channel senders', () => {
      expect(channelsOf(context)).toContain('push');
    });

    it('registers exactly one sender per channel — no duplicate push entry', () => {
      const channels = channelsOf(context);
      expect(channels.filter((c) => c === 'push')).toHaveLength(1);
      expect(channels.sort()).toEqual(['browser', 'email', 'push']);
    });
  });

  describe('only one of the two VAPID keys configured', () => {
    let context: TestContext;

    beforeAll(async () => {
      process.env.VAPID_PUBLIC_KEY = 'test-public-key';
      delete process.env.VAPID_PRIVATE_KEY;

      context = await createTestApp({ useMockDatabase: true });
    });

    afterAll(async () => {
      delete process.env.VAPID_PUBLIC_KEY;
      delete process.env.VAPID_PRIVATE_KEY;

      await closeTestApp(context);
    });

    beforeEach(() => {
      resetPrismaMock();
      setupBaseMocks();
    });

    it('does not include "push" — a public key with no private key cannot sign anything', () => {
      expect(channelsOf(context)).not.toContain('push');
    });
  });
});

import { readFileSync } from 'fs';
import { join } from 'path';
import { Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import {
  TestContext,
  createTestApp,
  closeTestApp,
} from '../helpers/test-app.helper';
import { prismaMock, resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { createMockAdminUser, authHeader } from '../helpers/auth-mock.helper';
import { AppModule } from '../../src/app.module';
import { RegistryError, withTemporaryEntries } from '../../src/common/registry';
import { EmailSettingsService } from '../../src/email/email-settings.service';
import { SmtpEmailProvider } from '../../src/email/providers/smtp-email.provider';
import type { EmailTemplate } from '../../src/email/templates';
import { JobWorker } from '../../src/jobs/job.worker';
import { NotificationsModule } from '../../src/notifications/notifications.module';
import { NotificationsService } from '../../src/notifications/notifications.service';
import type { NotificationChannel } from '../../src/notifications/notification-events';
import type { NotificationChannelSender } from '../../src/notifications/notification.types';
import {
  emailTemplateRegistry,
  eventBrowserTemplateRegistry,
  eventEmailTemplateRegistry,
  notificationChannelRegistry,
  notificationEventRegistry,
  registerNotification,
  type NotificationRegistration,
} from '../../src/notifications/registry';
import { NotificationChannelSenderRegistry } from '../../src/notifications/registry/channel-sender.registry';
import { PrismaService } from '../../src/prisma/prisma.service';

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
//
// The rest of the suite proves the extension seams end to end, through the
// real `AppModule` with mocked Prisma: an app notification registered with
// `registerNotification` is listed and delivered by email and browser, and an
// app channel (`android_app`) whose sender self-registers in `onModuleInit`
// receives deliveries, while a second sender for `email` stops the bootstrap.
// =============================================================================

/** An app's own notification, as `app-registrations/notifications.ts` would declare it. */
const APP_TEMPLATE_NAME = 'coach-weekly-review';

const appEmailTemplate: EmailTemplate<{ week: string }> = ({ week }) => ({
  subject: `Your week ${week}`,
  html: `<p>Your week ${week}</p>`,
  text: `Your week ${week}`,
});

const APP_NOTIFICATION: NotificationRegistration = {
  event: {
    key: 'coach.weekly_review',
    label: 'Weekly review',
    description: 'Sent every Monday with a summary of your training week.',
    channels: ['email', 'browser'],
    defaultEnabled: true,
  },
  emailTemplate: APP_TEMPLATE_NAME,
  browserTemplate: (data: never) => ({
    title: 'Weekly review',
    body: `Week ${(data as { week: string }).week} is ready.`,
    link: '/coach',
  }),
};

/**
 * Runs `fn` with an app email template and `APP_NOTIFICATION` registered
 * through `registerNotification`, and restores every registry afterwards.
 */
function withAppNotification<R>(fn: () => Promise<R>): Promise<R> {
  return withTemporaryEntries(
    emailTemplateRegistry,
    [{ name: APP_TEMPLATE_NAME, render: appEmailTemplate as EmailTemplate<never> }],
    () =>
      withTemporaryEntries(notificationEventRegistry, [], () =>
        withTemporaryEntries(eventEmailTemplateRegistry, [], () =>
          withTemporaryEntries(eventBrowserTemplateRegistry, [], () => {
            registerNotification(APP_NOTIFICATION);
            return fn();
          }),
        ),
      ),
  );
}

/** The bookkeeping writes a dispatch makes, answered by the Prisma mock. */
function mockDispatchWrites(): void {
  (prismaMock.notificationDelivery.create as jest.Mock).mockResolvedValue({ id: 'delivery-1' });
  (prismaMock.notificationDelivery.update as jest.Mock).mockResolvedValue({});
  (prismaMock.notification.create as jest.Mock).mockResolvedValue({
    id: 'notification-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  });
}

/** Channels that `notification_deliveries` rows were opened for. */
function deliveryChannels(): string[] {
  return (prismaMock.notificationDelivery.create as jest.Mock).mock.calls.map(
    ([args]: [{ data: { channel: string } }]) => args.data.channel,
  );
}

const smtp = { send: jest.fn() };
const emailSettings = {
  get: jest.fn(async () => ({
    provider: 'smtp',
    enabled: true,
    smtpHost: 'smtp.example.test',
    fromAddress: 'noreply@example.test',
  })),
};

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

    it('lists an app notification registered with registerNotification after the platform events', async () => {
      const admin = await createMockAdminUser(context);

      await withAppNotification(async () => {
        const response = await request(context.app.getHttpServer())
          .get('/api/notifications/events')
          .set(authHeader(admin.accessToken))
          .expect(200);

        expect(response.body.data.slice(0, -1)).toEqual(mainEventsBody);
        expect(response.body.data.at(-1)).toEqual({
          key: 'coach.weekly_review',
          label: 'Weekly review',
          description: 'Sent every Monday with a summary of your training week.',
          channels: ['email', 'browser'],
          declaredChannels: ['email', 'browser'],
          defaultEnabled: true,
          mandatory: false,
        });
      });
    });
  });
});

describe('Notification registry: an app notification is delivered (#678)', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestApp({
      useMockDatabase: true,
      overrideProviders: [
        { provide: SmtpEmailProvider, useValue: smtp },
        { provide: EmailSettingsService, useValue: emailSettings },
      ],
    });
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
    mockDispatchWrites();
    smtp.send.mockReset();
    smtp.send.mockResolvedValue({ success: true, messageId: 'smtp-1' });
  });

  it('by email and browser, through the normal dispatcher', async () => {
    const admin = await createMockAdminUser(context);
    const notifications = context.module.get(NotificationsService);

    await withAppNotification(async () => {
      await notifications.notifyNow('coach.weekly_review', admin.id, { week: '2026-W40' });
    });

    expect(deliveryChannels().sort()).toEqual(['browser', 'email']);

    expect(smtp.send).toHaveBeenCalledTimes(1);
    expect(smtp.send.mock.calls[0][0]).toMatchObject({
      to: admin.email,
      subject: 'Your week 2026-W40',
      text: 'Your week 2026-W40',
    });

    expect(prismaMock.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: admin.id,
          eventKey: 'coach.weekly_review',
          title: 'Weekly review',
          body: 'Week 2026-W40 is ready.',
          link: '/coach',
        }),
      }),
    );
  });

  it('is gone again once the temporary registration ends', async () => {
    const admin = await createMockAdminUser(context);
    const notifications = context.module.get(NotificationsService);

    await notifications.notifyNow('coach.weekly_review', admin.id, { week: '2026-W40' });

    expect(prismaMock.notificationDelivery.create).not.toHaveBeenCalled();
    expect(smtp.send).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// An app channel: declared in the channel registry, delivered by a sender that
// self-registers from its own module (the doctor-check pattern)
// -----------------------------------------------------------------------------

const ANDROID_CHANNEL = {
  id: 'android_app',
  label: 'Android app',
  description: 'A notification on the paired Android app.',
};

const ANDROID_EVENT = {
  key: 'coach.reminder',
  label: 'Training reminder',
  description: 'Sent when a planned session is about to start.',
  channels: ['android_app' as NotificationChannel],
  defaultEnabled: true,
};

const androidDeliveries: Array<{ eventKey: string; to: string; data: unknown }> = [];

@Injectable()
class FakeAndroidAppSender implements NotificationChannelSender, OnModuleInit {
  readonly channel = 'android_app' as NotificationChannel;

  constructor(private readonly registry: NotificationChannelSenderRegistry) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  resolveTo(recipient: { userId: string | null }): string | null {
    return recipient.userId ? `device-of-${recipient.userId}` : null;
  }

  async deliver(context: { event: { key: string }; data: unknown }, to: string) {
    androidDeliveries.push({ eventKey: context.event.key, to, data: context.data });
    return { success: true, messageId: 'android-1' };
  }
}

@Module({ imports: [NotificationsModule], providers: [FakeAndroidAppSender] })
class AndroidAppChannelModule {}

@Injectable()
class ShadowEmailSender implements NotificationChannelSender, OnModuleInit {
  readonly channel = 'email' as NotificationChannel;

  constructor(private readonly registry: NotificationChannelSenderRegistry) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  resolveTo(): string | null {
    return null;
  }

  async deliver() {
    return { success: true };
  }
}

@Module({ imports: [NotificationsModule], providers: [ShadowEmailSender] })
class ShadowEmailChannelModule {}

describe('Notification registry: an app channel with a self-registering sender (#678)', () => {
  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
    mockDispatchWrites();
    androidDeliveries.length = 0;
  });

  it('receives deliveries for an event that declares it', async () => {
    await withTemporaryEntries(notificationChannelRegistry, [ANDROID_CHANNEL], () =>
      withTemporaryEntries(notificationEventRegistry, [ANDROID_EVENT], async () => {
        const context = await createTestApp({ useMockDatabase: true, imports: [AndroidAppChannelModule] });
        try {
          const admin = await createMockAdminUser(context);
          const notifications = context.module.get(NotificationsService);

          await notifications.notifyNow('coach.reminder', admin.id, { session: 'legs' });

          expect(androidDeliveries).toEqual([
            { eventKey: 'coach.reminder', to: `device-of-${admin.id}`, data: { session: 'legs' } },
          ]);
          expect(deliveryChannels()).toEqual(['android_app']);
          expect(prismaMock.notificationDelivery.create).toHaveBeenCalledWith(
            expect.objectContaining({
              data: expect.objectContaining({ channel: 'android_app', recipient: `device-of-${admin.id}` }),
            }),
          );
        } finally {
          await closeTestApp(context);
        }
      }),
    );
  });

  it('a second sender for `email` fails at bootstrap', async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule, ShadowEmailChannelModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(JobWorker)
      .useValue({})
      .compile();
    const app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());

    try {
      const failure = await app.init().then(
        () => undefined,
        (err: unknown) => err,
      );

      expect(failure).toBeInstanceOf(RegistryError);
      expect((failure as RegistryError).code).toBe('DUPLICATE_ID');
      expect((failure as RegistryError).message).toBe(
        "Duplicate notification channel sender registered for 'email'.",
      );
    } finally {
      await app.close().catch(() => undefined);
    }
  });
});

// =============================================================================
// Reference example: an app's own channel, end to end (PP-14.10)
// =============================================================================
//
// With no edit to a package file, the reference app registers a `webhook`
// channel (`platform-extensions/notifications/`), puts it on the platform's
// broadcast events, gives it a template for them and for an event of its own,
// and binds its per-user handles through `NotificationsModule.forRoot`. This
// spec proves, against the REAL app module:
//
//   1. the conformance kit: the sender never throws, leaks no secret, resolves
//      only reachable recipients and is dropped when switched off;
//   2. the preference matrix lists the channel and its label;
//   3. an administrator can switch it off, and a dispatch then skips it;
//   4. a broadcast can target it, and the critical rule still needs a channel
//      flagged `criticalCapable`;
//   5. a per-user handle from the app's handle source decides who it reaches,
//      and the delivery row stores the handle's redacted display, never the
//      handle or the endpoint;
//   6. `notify()` still runs after the write commits: it is detached from the
//      caller and the dispatch opens no transaction.
//
// The HTTP call is a fake: CI needs no network.
// =============================================================================

import request from 'supertest';
import {
  NOTIFICATION_RECIPIENT_HANDLES,
  NotificationsService,
  type NotificationChannelSenderRegistry,
} from '@marinoscar/platform-api/notifications';
import { describeNotificationSenderConformance } from '@marinoscar/platform-api/notifications/testing';

import '../../../src/platform/notifications';
import {
  InMemoryWebhookSettings,
  WEBHOOK_FETCH,
  WebhookChannel,
  WebhookRecipientHandles,
  type WebhookFetch,
} from '../../../src/platform-extensions/notifications/webhook.channel';
import { WEBHOOK_CHANNEL_ID, WEBHOOK_TEST_EVENT } from '../../../src/platform-extensions/notifications/webhook.notifications';
import { setupBaseMocks } from '../../fixtures/mock-setup.helper';
import { createMockSystemSettings } from '../../fixtures/test-data.factory';
import { authHeader, createMockAdminUser, createMockViewerUser } from '../../helpers/auth-mock.helper';
import { closeTestApp, createTestApp, type TestContext } from '../../helpers/test-app.helper';
import { prismaMock, resetPrismaMock } from '../../mocks/prisma.mock';

const ENDPOINT = 'https://hooks.example.test/in/TOKEN-123';
const HANDLE = { to: 'U-100', display: '@ada' };

/** A controllable stand-in for the HTTP POST. */
function makeFakeFetch() {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  let failure: Error | null = null;
  let status = 200;
  const post: WebhookFetch = async (url, init) => {
    if (failure) throw failure;
    calls.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
    return { ok: status >= 200 && status < 300, status };
  };
  return {
    post,
    calls,
    fail: (error: Error | null) => {
      failure = error;
    },
    respondWith: (next: number) => {
      status = next;
    },
    reset: () => {
      calls.length = 0;
      failure = null;
      status = 200;
    },
  };
}

// ---------------------------------------------------------------------------
// 1. The conformance kit
// ---------------------------------------------------------------------------

describe('the webhook sender passes the notification sender conformance kit (PP-14.10)', () => {
  const fake = makeFakeFetch();
  const settings = new InMemoryWebhookSettings();
  settings.configure(ENDPOINT);
  const handles = new WebhookRecipientHandles();
  handles.set('user-1', HANDLE);
  const registry = { register: jest.fn() } as unknown as NotificationChannelSenderRegistry;
  const sender = new WebhookChannel(registry, settings, fake.post);

  describeNotificationSenderConformance(sender, {
    describe,
    it,
    expect,
    recipient: { userId: 'user-1', email: 'u1@example.test', preferences: {} },
    handles,
    secrets: ['TOKEN-123', HANDLE.to],
    breakTransport: () => {
      fake.fail(new Error(`connect ECONNREFUSED ${ENDPOINT}`));
      return () => fake.fail(null);
    },
  });

  it('the conformance run above registered the sender under the channel it declares', () => {
    expect(sender.channel).toBe(WEBHOOK_CHANNEL_ID);
  });
});

// ---------------------------------------------------------------------------
// 2-6. Against the real application
// ---------------------------------------------------------------------------

/** Answers the dispatcher's recipient lookup (an account with no stored preferences and no organization). */
function mockRecipients(): void {
  prismaMock.user.findUnique.mockImplementation((async ({ where }: { where: { id: string } }) => ({
    id: where.id,
    email: `${where.id}@example.test`,
    userSettings: null,
    memberships: [],
  })) as never);
}

/** Points the mocked `system_settings` row at a notifications policy. */
function storePolicy(notifications: unknown): void {
  (prismaMock.systemSettings.findUnique as jest.Mock).mockResolvedValue(
    createMockSystemSettings({ value: { notifications } }),
  );
}

describe('the webhook channel in the reference app (PP-14.10)', () => {
  const fake = makeFakeFetch();
  let context: TestContext;
  let settings: InMemoryWebhookSettings;
  let handles: WebhookRecipientHandles;
  let notifications: NotificationsService;

  beforeAll(async () => {
    context = await createTestApp({
      useMockDatabase: true,
      overrideProviders: [{ provide: WEBHOOK_FETCH, useValue: fake.post }],
    });
    settings = context.module.get(InMemoryWebhookSettings);
    handles = context.module.get(NOTIFICATION_RECIPIENT_HANDLES, { strict: false });
    notifications = context.module.get(NotificationsService);
  }, 60000);

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
    fake.reset();
    settings.configure(null);
    for (const userId of ['user-1', 'user-2']) handles.remove(userId);
    prismaMock.notificationDelivery.create.mockResolvedValue({ id: 'delivery-1' } as never);
    prismaMock.notificationDelivery.update.mockResolvedValue({ id: 'delivery-1' } as never);
    prismaMock.notification.create.mockResolvedValue({ id: 'notif-1', createdAt: new Date() } as never);
  });

  describe('the preference matrix', () => {
    it('serves the channel to every signed-in user, with its label, after the platform channels', async () => {
      const viewer = await createMockViewerUser(context);
      const response = await request(context.app.getHttpServer())
        .get('/api/notifications/channels')
        .set(authHeader(viewer.accessToken))
        .expect(200);

      const channels: Array<{ id: string; label: string; criticalCapable: boolean; broadcastDefault: boolean; order: number }> =
        response.body.data;
      expect(channels.map((channel) => channel.id)).toEqual(['email', 'browser', 'push', 'android_app', 'webhook']);
      expect(channels.map((channel) => channel.order)).toEqual([0, 1, 2, 3, 4]);
      expect(channels.find((channel) => channel.id === 'webhook')).toMatchObject({
        label: 'Webhook',
        criticalCapable: false,
        broadcastCapable: true,
        broadcastDefault: false,
        userConfigurable: true,
      });
      // Registered, but the broadcast events do not declare it: the composer must not offer it.
      expect(channels.find((channel) => channel.id === 'android_app')).toMatchObject({ broadcastCapable: false });
      expect(channels.filter((channel) => channel.broadcastDefault).map((channel) => channel.id)).toEqual(['email', 'browser']);
      expect(channels.filter((channel) => channel.criticalCapable).map((channel) => channel.id)).toEqual(['browser']);
    });

    it('refuses the channel list without a session', async () => {
      await request(context.app.getHttpServer()).get('/api/notifications/channels').expect(401);
    });

    it('lists the channel on the broadcast events and on the app event', async () => {
      const viewer = await createMockViewerUser(context);
      const response = await request(context.app.getHttpServer())
        .get('/api/notifications/events')
        .set(authHeader(viewer.accessToken))
        .expect(200);

      const byKey = new Map<string, { channels: string[]; declaredChannels: string[] }>(
        response.body.data.map((event: { key: string; channels: string[]; declaredChannels: string[] }) => [event.key, event]),
      );
      expect(byKey.get('admin.broadcast')?.channels).toContain('webhook');
      expect(byKey.get('admin.broadcast_critical')?.channels).toContain('webhook');
      expect(byKey.get(WEBHOOK_TEST_EVENT.key)?.channels).toEqual(['webhook']);
      // The platform events that did not opt in are untouched.
      expect(byKey.get('user.welcome')?.channels).toEqual(['email']);
    });
  });

  describe('the administrator switch', () => {
    it('persists a channel switch through PATCH /api/system-settings and keeps the browser alias', async () => {
      const admin = await createMockAdminUser(context);
      prismaMock.systemSettings.update.mockResolvedValue({
        id: 'settings-1',
        key: 'global',
        value: {},
        version: 2,
        updatedAt: new Date(),
        updatedByUserId: admin.id,
        updatedByUser: { id: admin.id, email: admin.email },
      } as never);
      prismaMock.auditEvent.create.mockResolvedValue({} as never);

      await request(context.app.getHttpServer())
        .patch('/api/system-settings')
        .set(authHeader(admin.accessToken))
        .send({ notifications: { channels: { webhook: { enabled: false }, browser: { enabled: false } } } })
        .expect(200);

      const written = (prismaMock.systemSettings.update.mock.calls[0]![0] as { data: { value: { notifications: unknown } } }).data.value
        .notifications;
      expect(written).toEqual({
        browserEnabled: false,
        disabledEvents: [],
        channels: { webhook: { enabled: false }, browser: { enabled: false } },
      });
    });

    it('drops the channel from the events a user sees once it is switched off, and keeps the others', async () => {
      storePolicy({ browserEnabled: true, disabledEvents: [], channels: { webhook: { enabled: false } } });
      const viewer = await createMockViewerUser(context);
      const response = await request(context.app.getHttpServer())
        .get('/api/notifications/events')
        .set(authHeader(viewer.accessToken))
        .expect(200);

      const broadcast = response.body.data.find((event: { key: string }) => event.key === 'admin.broadcast');
      expect(broadcast.channels).toEqual(['email', 'browser', 'push']);
      // The unfiltered capability stays, so the admin page can still list it.
      expect(broadcast.declaredChannels).toContain('webhook');
    });

    it('delivers nothing over a channel an administrator switched off, even for a critical event', async () => {
      mockRecipients();
      settings.configure(ENDPOINT);
      handles.set('user-1', HANDLE);
      storePolicy({ browserEnabled: true, disabledEvents: [], channels: { webhook: { enabled: false } } });

      await notifications.notifyNow('admin.broadcast_critical', 'user-1', { title: 'T', body: 'B', critical: true }, { channels: ['webhook'] });

      expect(fake.calls).toEqual([]);
      expect(prismaMock.notificationDelivery.create).not.toHaveBeenCalled();
    });
  });

  describe('a broadcast', () => {
    const body = { title: 'Planned maintenance', body: 'We are offline from 01:00.' };

    it('can target the channel', async () => {
      const admin = await createMockAdminUser(context);
      prismaMock.notificationBroadcast.create.mockImplementation((async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'b1',
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      })) as never);
      prismaMock.job.create.mockResolvedValue({ id: 'job-1' } as never);

      const response = await request(context.app.getHttpServer())
        .post('/api/admin/broadcasts')
        .set(authHeader(admin.accessToken))
        .send({ ...body, channels: ['webhook'] })
        .expect(201);

      expect(response.body.data.broadcast.channels).toEqual(['webhook']);
    });

    it('delivers its title and body to a user who has a handle, through the platform event', async () => {
      mockRecipients();
      settings.configure(ENDPOINT);
      handles.set('user-1', HANDLE);

      await notifications.notifyNow(
        'admin.broadcast',
        'user-1',
        { ...body, critical: false, link: '/status' },
        { channels: [WEBHOOK_CHANNEL_ID] },
      );

      expect(fake.calls).toEqual([
        {
          url: ENDPOINT,
          body: {
            event: 'admin.broadcast',
            to: HANDLE.to,
            title: body.title,
            body: body.body,
            link: '/status',
            fields: { important: 'no' },
          },
        },
      ]);
    });

    it('still refuses a critical broadcast that relies on the webhook alone', async () => {
      const admin = await createMockAdminUser(context);

      const response = await request(context.app.getHttpServer())
        .post('/api/admin/broadcasts')
        .set(authHeader(admin.accessToken))
        .send({ ...body, channels: ['webhook'], critical: true })
        .expect(400);

      expect(response.body.details.issues).toEqual([
        { path: 'channels', message: expect.stringContaining('must include the "browser" channel') },
      ]);
      expect(prismaMock.notificationBroadcast.create).not.toHaveBeenCalled();
    });

    it('accepts a critical broadcast that includes the browser channel beside the webhook', async () => {
      const admin = await createMockAdminUser(context);
      prismaMock.notificationBroadcast.create.mockImplementation((async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'b2',
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      })) as never);
      prismaMock.job.create.mockResolvedValue({ id: 'job-2' } as never);

      await request(context.app.getHttpServer())
        .post('/api/admin/broadcasts')
        .set(authHeader(admin.accessToken))
        .send({ ...body, channels: ['browser', 'webhook'], critical: true })
        .expect(201);
    });
  });

  describe('the per-user handle', () => {
    it('reaches a user the app has a handle for, and the delivery row stores the redacted display only', async () => {
      mockRecipients();
      settings.configure(ENDPOINT);
      handles.set('user-1', HANDLE);

      await notifications.notifyNow(WEBHOOK_TEST_EVENT.key, 'user-1', { by: 'Ada' });

      expect(fake.calls).toHaveLength(1);
      expect(fake.calls[0]).toEqual({
        url: ENDPOINT,
        body: {
          event: WEBHOOK_TEST_EVENT.key,
          to: HANDLE.to,
          title: 'Webhook test',
          body: 'Ada sent a test message to check this webhook.',
        },
      });
      const row = prismaMock.notificationDelivery.create.mock.calls[0]![0] as { data: Record<string, unknown> };
      expect(row.data).toMatchObject({ channel: WEBHOOK_CHANNEL_ID, recipient: HANDLE.display, eventKey: WEBHOOK_TEST_EVENT.key });
      expect(JSON.stringify(row)).not.toContain(HANDLE.to);
      expect(JSON.stringify(row)).not.toContain('TOKEN-123');
    });

    it('skips a user with no handle: no request, no delivery row', async () => {
      mockRecipients();
      settings.configure(ENDPOINT);
      handles.set('user-1', HANDLE);

      await notifications.notifyNow(WEBHOOK_TEST_EVENT.key, 'user-2', { by: 'Ada' });

      expect(fake.calls).toEqual([]);
      expect(prismaMock.notificationDelivery.create).not.toHaveBeenCalled();
    });

    it('is inert until the endpoint is configured, even for a user with a handle', async () => {
      mockRecipients();
      handles.set('user-1', HANDLE);

      await notifications.notifyNow(WEBHOOK_TEST_EVENT.key, 'user-1', { by: 'Ada' });

      expect(fake.calls).toEqual([]);
      expect(prismaMock.notificationDelivery.create).not.toHaveBeenCalled();
    });

    it('records a failed delivery, without the endpoint, when the receiver refuses', async () => {
      mockRecipients();
      settings.configure(ENDPOINT);
      handles.set('user-1', HANDLE);
      fake.respondWith(503);

      await notifications.notifyNow(WEBHOOK_TEST_EVENT.key, 'user-1', { by: 'Ada' });

      const update = prismaMock.notificationDelivery.update.mock.calls[0]![0] as { data: { status: string; error?: string } };
      expect(update.data.status).toBe('failed');
      expect(update.data.error).toBe('The webhook responded with HTTP 503.');
      expect(JSON.stringify(update)).not.toContain('TOKEN-123');
    });
  });

  describe('notify() runs after the write commits, outside any transaction (CLAUDE.md invariant)', () => {
    it('is detached from the caller and the dispatch opens no transaction', async () => {
      mockRecipients();
      settings.configure(ENDPOINT);
      handles.set('user-1', HANDLE);
      const transaction = prismaMock.$transaction as unknown as jest.Mock;
      transaction.mockClear();
      const order: string[] = [];

      // The caller's own write, committed first; notify() is called after it.
      await prismaMock.$transaction(async () => {
        order.push('write');
      });
      const callsAfterWrite = transaction.mock.calls.length;
      await notifications.notify(WEBHOOK_TEST_EVENT.key, 'user-1', { by: 'Ada' });
      order.push('notify-returned');
      await notifications.flush();
      order.push('dispatched');

      expect(order).toEqual(['write', 'notify-returned', 'dispatched']);
      expect(fake.calls).toHaveLength(1);
      // The dispatch (resolve, row, deliver, mark) opened no transaction of its own.
      expect(transaction.mock.calls.length).toBe(callsAfterWrite);
    });
  });
});

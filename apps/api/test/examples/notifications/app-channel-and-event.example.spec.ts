// =============================================================================
// Reference examples: an app's own channel and event, end to end (issue #738)
// =============================================================================
//
// With no edit to a package file, the app registers a channel
// (`example_webhook`) and two events (the example invoice notification, and a
// ping over the new channel), provides the channel's transport from its own
// module, and then:
//
//   - `GET /api/notifications/events` lists both events and the new channel;
//   - user preferences accept the new channel key (the PATCH body is checked
//     against the channel registry);
//   - a dispatch reaches the new sender.
//
// Registered here, before the app boots (registries freeze at bootstrap);
// never in production.
// =============================================================================

import request from 'supertest';
import {
  NotificationsService,
  eventBrowserTemplateRegistry,
  eventEmailTemplateRegistry,
  registerNotificationEvent,
  type NotificationEventDef,
} from '@marinoscar/platform-api/notifications';

import {
  ExampleWebhookChannel,
  ExampleWebhookChannelModule,
  registerExampleWebhookChannel,
} from '../../../src/examples/notifications/example-webhook.channel';
import {
  EXAMPLE_INVOICE_READY_EVENT,
  registerExampleInvoiceNotification,
} from '../../../src/examples/notifications/invoice-ready.notification';
import { patchUserSettingsSchema } from '../../../src/settings/registry/composed';
import {
  EXAMPLE_SHIPMENT_SENT_EVENT,
  registerExampleShipmentNotification,
} from '../../../src/examples/notifications/shipment-sent.notification';
import { setupBaseMocks } from '../../fixtures/mock-setup.helper';
import { authHeader, createMockViewerUser } from '../../helpers/auth-mock.helper';
import { closeTestApp, createTestApp, type TestContext } from '../../helpers/test-app.helper';
import { resetPrismaMock } from '../../mocks/prisma.mock';

const PING_EVENT: NotificationEventDef = {
  key: 'example.webhook_ping',
  label: 'Webhook ping',
  description: 'A test event delivered to your webhook.',
  channels: ['example_webhook', 'browser'],
  defaultEnabled: true,
};

registerExampleWebhookChannel();
registerExampleInvoiceNotification();
registerExampleShipmentNotification();
registerNotificationEvent(PING_EVENT);

describe('an app channel and an app event, with no package edit (#738)', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestApp({ useMockDatabase: true, imports: [ExampleWebhookChannelModule] });
  }, 60000);

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
  });

  it('lists the app events, over the app channel, after the platform events', async () => {
    const viewer = await createMockViewerUser(context);
    const response = await request(context.app.getHttpServer())
      .get('/api/notifications/events')
      .set(authHeader(viewer.accessToken))
      .expect(200);
    const keys: string[] = response.body.data.map((event: { key: string }) => event.key);
    expect(keys.slice(-3)).toEqual([EXAMPLE_INVOICE_READY_EVENT.key, EXAMPLE_SHIPMENT_SENT_EVENT.key, PING_EVENT.key]);
    const ping = response.body.data.find((event: { key: string }) => event.key === PING_EVENT.key);
    expect(ping.declaredChannels).toEqual(['example_webhook', 'browser']);
  });

  it('binds the step-by-step event to both renderers', () => {
    expect(eventBrowserTemplateRegistry.get(EXAMPLE_SHIPMENT_SENT_EVENT.key)?.render({ orderId: 'A 1' } as never)).toEqual({
      title: 'Shipment sent',
      body: 'Order A 1 is on its way.',
      link: '/orders/A%201',
    });
    expect(eventEmailTemplateRegistry.get(EXAMPLE_SHIPMENT_SENT_EVENT.key)?.template).toBe('example-invoice-ready');
  });

  it('accepts a preference for the app channel, and still refuses an unregistered one', () => {
    expect(() =>
      patchUserSettingsSchema.parse({ notifications: { example_webhook: { [PING_EVENT.key]: false } } }),
    ).not.toThrow();
    expect(() => patchUserSettingsSchema.parse({ notifications: { carrier_pigeon: { [PING_EVENT.key]: false } } })).toThrow();
  });

  it('dispatches to the app sender', async () => {
    const prisma = context.prismaMock;
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'u1@example.test', userSettings: null, memberships: [] });
    prisma.notificationDelivery.create.mockResolvedValue({ id: 'delivery-1' });
    prisma.notificationDelivery.update.mockResolvedValue({ id: 'delivery-1' });
    prisma.notification.create.mockResolvedValue({ id: 'notif-1', createdAt: new Date() });

    const webhook = context.module.get(ExampleWebhookChannel);
    await context.module.get(NotificationsService).notifyNow(PING_EVENT.key, 'user-1', { hello: 'world' }, { channels: ['example_webhook'] });

    expect(webhook.deliveries).toEqual([
      { to: 'https://hooks.example.test/users/user-1', eventKey: PING_EVENT.key, data: { hello: 'world' } },
    ]);
    expect(prisma.notificationDelivery.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ channel: 'example_webhook', eventKey: PING_EVENT.key }) }),
    );
  });
});

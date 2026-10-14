// =============================================================================
// Reference example: an app's own delivery channel (issue #738)
// =============================================================================
//
// A channel is two things: an id in the channel registry
// (`registerNotificationChannel`, from the app's manifest, before
// `NotificationsModule.forRoot()` composes) and a transport, a
// `NotificationChannelSender` provided by the app's own module that registers
// itself with `NotificationChannelSenderRegistry` from `onModuleInit`. No
// package file changes; an event opts in by naming the channel id.
//
// This "webhook" is FAKE: it records what it would have POSTed instead of
// making a network call, so the example spec can prove dispatch reached it.
// It is registered only by that spec's test module, never in production. A
// real transport would resolve the account's webhook URL in `resolveTo` and
// POST in `deliver`, returning `{ success: false, error }` rather than
// throwing.
// =============================================================================

import { Injectable, Module, type OnModuleInit } from '@nestjs/common';
import {
  NotificationChannelSenderRegistry,
  registerNotificationChannel,
  type ChannelDeliveryResult,
  type NotificationChannelDef,
  type NotificationChannelSender,
  type NotificationDispatchContext,
  type NotificationRecipient,
} from '@marinoscar/platform-api/notifications';

/** The channel's registry entry. A channel id is persisted: never rename it. */
export const EXAMPLE_WEBHOOK_CHANNEL: NotificationChannelDef = {
  id: 'example_webhook',
  label: 'Webhook',
  description: "A JSON POST to the webhook URL on the user's account.",
  userConfigurable: true,
};

/** What the app's manifest would call. */
export function registerExampleWebhookChannel(): void {
  registerNotificationChannel(EXAMPLE_WEBHOOK_CHANNEL);
}

/** One delivery the fake webhook would have POSTed. */
export interface ExampleWebhookDelivery {
  to: string;
  eventKey: string;
  data: unknown;
}

/** The transport. Registers itself; never throws. */
@Injectable()
export class ExampleWebhookChannel implements NotificationChannelSender, OnModuleInit {
  readonly channel = EXAMPLE_WEBHOOK_CHANNEL.id;

  /** What would have been POSTed, in order. */
  readonly deliveries: ExampleWebhookDelivery[] = [];

  constructor(private readonly senders: NotificationChannelSenderRegistry) {}

  onModuleInit(): void {
    this.senders.register(this);
  }

  /** The account is the handle here; a real channel would read its URL. */
  resolveTo(recipient: NotificationRecipient): string | null {
    return recipient.userId ? `https://hooks.example.test/users/${recipient.userId}` : null;
  }

  async deliver(context: NotificationDispatchContext, to: string): Promise<ChannelDeliveryResult> {
    this.deliveries.push({ to, eventKey: context.event.key, data: context.data });
    return { success: true, messageId: `webhook-${this.deliveries.length}` };
  }
}

/** The app module that provides the transport (imports nothing: NotificationsModule is global). */
@Module({ providers: [ExampleWebhookChannel], exports: [ExampleWebhookChannel] })
export class ExampleWebhookChannelModule {}

// =============================================================================
// EXAMPLE: an app's own delivery channel, end to end (PP-14.10)
// =============================================================================
//
// A "webhook" channel: every notification that reaches it is POSTed as JSON to a
// URL the deployment configures, addressed to a per-user handle. It is the
// smallest complete transport, and the shape of a Slack, SMS or Teams one: the
// pieces below are the whole extension surface, and no file under `packages/`
// changes.
//
//   1. THE CHANNEL AND ITS TEMPLATES are data (`webhook.notifications.ts`),
//      registered from `app-registrations/notifications.ts`. An event opts in by
//      listing the channel id, and every event bound for the channel has a
//      template (`channelTemplates`), checked at registration and again by the
//      `notifications` conformance suite.
//   2. THE PER-USER HANDLE comes from the app's own source,
//      `WebhookRecipientHandles` (a `RecipientHandleSource`), bound with
//      `NotificationsModule.forRoot({ recipientHandles })` in
//      `platform/notifications/notifications.config.ts`. The slice never
//      stores a handle; it asks.
//   3. THE TRANSPORT is this class, a `NotificationChannelSender` that
//      registers itself with `NotificationChannelSenderRegistry` from its own
//      module's `onModuleInit`. It resolves a recipient asynchronously
//      (`resolveRecipient`): the delivery row stores the handle's REDACTED
//      `display`, never the handle itself, and the endpoint URL (which may
//      carry a token) appears nowhere: not in a row, not in an error.
//   4. THE ENDPOINT is "its own settings": a `WebhookChannelSettings` port. The
//      default is held in memory and EMPTY, so the channel is inert until
//      something configures it; a real app binds the port to its own settings
//      namespace or credential. The HTTP call goes through an injectable
//      `WebhookFetch`, so tests run against a fake and CI needs no network.
//
// The conformance kit proves the contract: `test/examples/notifications/
// webhook-channel.spec.ts` runs `describeNotificationSenderConformance` on it.
// =============================================================================

import { Inject, Injectable, Logger, Module, type OnModuleInit } from '@nestjs/common';
import {
  NotificationChannelSenderRegistry,
  type ChannelDeliveryResult,
  type NotificationChannelSender,
  type NotificationDispatchContext,
  type NotificationRecipient,
  type RecipientHandle,
  type RecipientHandleSource,
  type ResolveRecipientContext,
  renderChannelPayload,
} from '@marinoscar/platform-api/notifications';

import { WEBHOOK_CHANNEL_ID } from './webhook.notifications';

/** One HTTP POST, as the sender makes it. A fake in tests; `fetch` in production. */
export type WebhookFetch = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number }>;

/** Injection token of the {@link WebhookFetch} the sender uses. The module provides the default (global `fetch` with a timeout); a test overrides it with a fake. */
export const WEBHOOK_FETCH: unique symbol = Symbol.for('app/notifications/WEBHOOK_FETCH');

/** The request timeout of the default fetch. */
export const WEBHOOK_TIMEOUT_MS = 5_000;

/** The default {@link WebhookFetch}: global `fetch`, aborted after {@link WEBHOOK_TIMEOUT_MS}. */
export const defaultWebhookFetch: WebhookFetch = async (url, init) => {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS) });
  return { ok: response.ok, status: response.status };
};

/** The channel's own settings, as the sender reads them. */
export interface WebhookChannelSettings {
  /** The endpoint to POST to (an `https:` URL), or `null` while the channel is not configured. */
  endpoint(): Promise<string | null>;
}

/** Injection token of the {@link WebhookChannelSettings}. */
export const WEBHOOK_CHANNEL_SETTINGS: unique symbol = Symbol.for('app/notifications/WEBHOOK_CHANNEL_SETTINGS');

/**
 * The default settings: an endpoint held in memory, EMPTY until `configure` is
 * called, which keeps the channel inert on a fresh install. Replace the binding
 * with one over your own settings namespace or credential store; that is the
 * whole port.
 */
@Injectable()
export class InMemoryWebhookSettings implements WebhookChannelSettings {
  private url: string | null = null;

  /**
   * Sets or clears the endpoint.
   *
   * @param url - an `https:` URL, or `null` to switch the channel back to inert.
   * @throws Error when `url` is not an `https:` URL.
   */
  configure(url: string | null): void {
    if (url !== null && new URL(url).protocol !== 'https:') {
      throw new Error('The webhook endpoint must be an https: URL.');
    }
    this.url = url;
  }

  async endpoint(): Promise<string | null> {
    return this.url;
  }
}

/**
 * The app's per-user destinations on the channel: the "own table" a real app
 * keeps behind {@link RecipientHandleSource}. In memory here, to keep the
 * example free of a migration; the contract is the one method.
 */
@Injectable()
export class WebhookRecipientHandles implements RecipientHandleSource {
  private readonly handles = new Map<string, RecipientHandle>();

  /**
   * Sets a user's handle.
   *
   * @param userId - the account.
   * @param handle - `to` is the routing key the receiver understands (a member id, a room); `display` is its redacted form for delivery rows.
   */
  set(userId: string, handle: RecipientHandle): void {
    this.handles.set(userId, handle);
  }

  /** Removes a user's handle. */
  remove(userId: string): void {
    this.handles.delete(userId);
  }

  async handleFor(userId: string, channelId: string): Promise<RecipientHandle | null> {
    return channelId === WEBHOOK_CHANNEL_ID ? (this.handles.get(userId) ?? null) : null;
  }
}

/**
 * The transport. Resolves a recipient from the app's handle source and the
 * channel's settings; registers itself; never throws.
 */
@Injectable()
export class WebhookChannel implements NotificationChannelSender, OnModuleInit {
  readonly channel = WEBHOOK_CHANNEL_ID;

  private readonly logger = new Logger(WebhookChannel.name);

  constructor(
    private readonly senders: NotificationChannelSenderRegistry,
    @Inject(WEBHOOK_CHANNEL_SETTINGS) private readonly settings: WebhookChannelSettings,
    @Inject(WEBHOOK_FETCH) private readonly post: WebhookFetch,
  ) {}

  onModuleInit(): void {
    this.senders.register(this);
  }

  /**
   * Reachable when the channel is configured AND the user has a handle. `to` is
   * the handle's routing key; the row keeps the handle's redacted `display`.
   */
  async resolveRecipient(_recipient: NotificationRecipient, context: ResolveRecipientContext): Promise<{ to: string; display: string } | null> {
    if (!(await this.settings.endpoint())) return null;
    return context.handle();
  }

  async deliver(context: NotificationDispatchContext, to: string): Promise<ChannelDeliveryResult> {
    try {
      if (!to) return { success: false, error: 'No webhook destination for this recipient.' };
      const endpoint = await this.settings.endpoint();
      if (!endpoint) return { success: false, error: 'The webhook endpoint is not configured.' };

      const content = renderChannelPayload(this.channel, context) ?? {
        title: context.event.label,
        body: context.event.description,
      };
      const response = await this.post(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event: context.event.key, to, ...content }),
      });
      // The status only: the endpoint URL and the response body can carry secrets.
      if (!response.ok) return { success: false, error: `The webhook responded with HTTP ${response.status}.` };
      return { success: true, messageId: `webhook-${context.event.key}` };
    } catch (err) {
      // The error's NAME only: a fetch failure's message can include the URL.
      const name = err instanceof Error ? err.name : 'Error';
      this.logger.warn(`Webhook delivery of '${context.event.key}' failed (${name}).`);
      return { success: false, error: `The webhook request failed (${name}).` };
    }
  }
}

/** The app module that provides the transport. `NotificationsModule` is global, so it imports nothing. */
@Module({
  providers: [
    InMemoryWebhookSettings,
    { provide: WEBHOOK_CHANNEL_SETTINGS, useExisting: InMemoryWebhookSettings },
    { provide: WEBHOOK_FETCH, useValue: defaultWebhookFetch },
    WebhookChannel,
  ],
  exports: [WebhookChannel, InMemoryWebhookSettings, WEBHOOK_CHANNEL_SETTINGS],
})
export class WebhookChannelModule {}

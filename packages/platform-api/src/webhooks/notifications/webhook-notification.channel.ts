// =============================================================================
// The `webhook` notification channel's transport (issue #1046)
// =============================================================================
//
// A user's notification, forwarded to the user's own webhook endpoints. It is a
// `NotificationChannelSender` like the platform's: the dispatcher has already
// applied the user's preferences (they opt in per event in the matrix) and the
// administrator's channel switch before `deliver` runs.
//
//   - `resolveRecipient` answers `null` (the channel is skipped, no row, no
//     attempt) unless the user has at least one ENABLED user-scope endpoint
//     subscribed to `notification.<eventKey>` (or `notification.*`, `*`);
//   - `deliver` renders the notification the way the bell does (the event's
//     channel template, else its browser template, else its label) and
//     `WebhooksService.emitForUser`s it. The raw template data is NOT sent: only
//     the rendered title, body and link, the event identity and any `fields`
//     the channel template adds.
//
// It never throws and puts no secret or message text in an error. The send
// itself is the `webhooks.deliver` job's: this does one fan-out transaction.
// =============================================================================

import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import { PLATFORM_PRISMA } from '../../core/index';
import { resolveOrgId } from '../../identity/index';
import {
  NotificationChannelSenderRegistry,
  eventBrowserTemplateRegistry,
  renderChannelPayload,
  type ChannelDeliveryResult,
  type NotificationChannelSender,
  type NotificationDispatchContext,
  type NotificationRecipient,
  type ResolvedRecipient,
} from '../../notifications/index';
import { isSubscribed } from '../registry/webhook-event.registry';
import type { WebhooksPrisma } from '../ports';
import { WEBHOOK_NOTIFICATION_CHANNEL_ID, WEBHOOK_NOTIFICATION_EVENT_PREFIX } from '../webhooks.constants';
import { WebhooksRepository } from '../webhooks.repository';
import { WebhooksService } from '../webhooks.service';

/**
 * The transport. See the file header.
 *
 * @internal
 *
 * @stability experimental
 */
@Injectable()
export class WebhookNotificationChannel implements NotificationChannelSender, OnModuleInit {
  readonly channel = WEBHOOK_NOTIFICATION_CHANNEL_ID;

  private readonly logger = new Logger(WebhookNotificationChannel.name);

  constructor(
    private readonly senders: NotificationChannelSenderRegistry,
    private readonly webhooks: WebhooksService,
    private readonly repository: WebhooksRepository,
    @Inject(PLATFORM_PRISMA) private readonly prisma: WebhooksPrisma,
  ) {}

  /** Registers this sender for `webhook`; the channel id must be registered first. */
  onModuleInit(): void {
    this.senders.register(this);
  }

  async resolveRecipient(recipient: NotificationRecipient, context: { readonly event: { readonly key: string } }): Promise<ResolvedRecipient | null> {
    if (!recipient.userId) return null;
    try {
      const orgId = await resolveOrgId(this.prisma, recipient.orgId ?? null, 'Webhook notification');
      const endpoints = await this.repository.enabledEndpoints(orgId, { scope: 'user', ownerUserId: recipient.userId });
      const key = `${WEBHOOK_NOTIFICATION_EVENT_PREFIX}${context.event.key}`;
      if (!endpoints.some((endpoint) => isSubscribed(endpoint.eventKeys, key))) return null;
      return { to: recipient.userId, display: 'your webhook endpoints' };
    } catch (error) {
      this.logger.debug(`No webhook recipient for "${context.event.key}": ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  async deliver(context: NotificationDispatchContext, to: string): Promise<ChannelDeliveryResult> {
    try {
      const { event } = context;
      const rendered =
        renderChannelPayload(this.channel, context) ??
        this.renderLikeTheBell(context) ?? { title: event.label, body: event.description };
      const data = {
        event: { key: event.key, label: event.label, description: event.description },
        title: rendered.title,
        body: rendered.body,
        link: rendered.link ?? null,
        fields: ('fields' in rendered && rendered.fields ? rendered.fields : null) as Record<string, string> | null,
      };
      await this.webhooks.emitForUser(to, `${WEBHOOK_NOTIFICATION_EVENT_PREFIX}${event.key}`, data, { orgId: context.recipient.orgId ?? null });
      return { success: true };
    } catch (error) {
      this.logger.warn(`The webhook channel failed for "${context.event.key}": ${error instanceof Error ? error.constructor.name : 'error'}`);
      return { success: false, error: 'The webhook fan-out failed' };
    }
  }

  private renderLikeTheBell(context: NotificationDispatchContext): { title: string; body: string; link?: string } | null {
    const binding = eventBrowserTemplateRegistry.get(context.event.key);
    if (!binding) return null;
    try {
      const content = binding.render(context.data as never, { timeZone: context.recipient.timeZone ?? null });
      return { title: content.title, body: content.body, ...(content.link ? { link: content.link } : {}) };
    } catch {
      return null;
    }
  }
}

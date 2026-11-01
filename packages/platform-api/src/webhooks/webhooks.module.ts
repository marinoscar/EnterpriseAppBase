import { Module, type DynamicModule } from '@nestjs/common';

import { CredentialsModule, OrgCredentialsModule, UserCredentialsModule } from '../credentials/index';
import { isRegisteredNotificationChannel, registerNotificationChannel } from '../notifications/index';
import { systemHostResolver } from './egress/egress-guard';
import { WEBHOOKS_RESOLVER, WEBHOOKS_TRANSPORT, nodeWebhookTransport } from './egress/transport';
import { WebhookDeliverHandler } from './handlers/webhook-deliver.handler';
import { WebhookFanoutHandler } from './handlers/webhook-fanout.handler';
import { WebhookPurgeHandler } from './handlers/webhook-purge.handler';
import { AdminWebhooksController } from './http/admin-webhooks.controller';
import { OrgWebhooksController } from './http/org-webhooks.controller';
import { WebhooksController } from './http/webhooks.controller';
import { WebhookEventListeners } from './listeners/webhook-event.listeners';
import { WebhookNotificationChannel } from './notifications/webhook-notification.channel';
import { WEBHOOK_NOTIFICATION_CHANNEL } from './notifications/webhook-notifications';
import { registerBuiltinWebhookEvents } from './registry/builtin-events';
import { WebhookPurgeTask } from './tasks/webhook-purge.task';
import { WebhookEndpointsService } from './webhook-endpoints.service';
import { CredentialsWebhookSecrets, WebhookSecrets } from './webhook-secrets.service';
import { registerWebhooksSystemAccessReason } from './webhooks.constants';
import { WEBHOOKS_OPTIONS, resolveWebhooksModuleOptions, type WebhooksModuleOptions } from './webhooks.options';
import { registerWebhookErrorCodes } from './webhooks.errors';
import { PrismaWebhooksRepository, WebhooksRepository } from './webhooks.repository';
import { WebhooksService } from './webhooks.service';

// =============================================================================
// WebhooksModule (issue #1046)
// =============================================================================
//
// Outbound, signed webhooks: endpoints a member, an organization or the
// deployment registers; an event catalog; a fan-out; one delivery job per
// (event, endpoint) with retries and a circuit breaker; and a notification
// channel that forwards a member's notifications to their own endpoints.
//
// `JobsModule.forRoot()` and `NotificationsModule.forRoot()` are GLOBAL, so
// `JobsService`, `JobHandlerRegistry`, `NotificationsService` and
// `NotificationChannelSenderRegistry` need no import; the core host module
// provides `PLATFORM_PRISMA` and `AUDIT_SINK`; the three credential stores are
// imported here (they are deliberately not global). The app binds
// `WEBHOOKS_SYSTEM_PRISMA` (the bypass client) in a module it passes as `imports`.
// =============================================================================

/**
 * The webhooks slice for one app.
 *
 * @stability experimental
 */
@Module({})
export class WebhooksModule {
  /**
   * The slice for one app. Call once, before bootstrap. Registers the platform's
   * webhook events, the slice's error codes and (when the app's manifest has not
   * already) the `webhook` notification channel; each registration is
   * idempotent.
   *
   * @param options - see {@link WebhooksModuleOptions}; all optional.
   * @returns the dynamic module. It exports `WebhooksService`, `WebhookEndpointsService` and `WEBHOOKS_OPTIONS`.
   * @throws Error when an option is invalid.
   *
   * @example
   * ```ts
   * export const webhooksModule = WebhooksModule.forRoot({ appName: APP_NAME, imports: [WebhooksHostModule] });
   * ```
   *
   * @extensionPoint option
   * @stability experimental
   */
  static forRoot(options: WebhooksModuleOptions = {}): DynamicModule {
    const resolved = resolveWebhooksModuleOptions(options);
    registerBuiltinWebhookEvents();
    registerWebhookErrorCodes();
    registerWebhooksSystemAccessReason();
    if (!isRegisteredNotificationChannel(WEBHOOK_NOTIFICATION_CHANNEL.id)) registerNotificationChannel(WEBHOOK_NOTIFICATION_CHANNEL);

    return {
      module: WebhooksModule,
      imports: [CredentialsModule, UserCredentialsModule, OrgCredentialsModule, ...resolved.imports],
      controllers: [WebhooksController, OrgWebhooksController, AdminWebhooksController],
      providers: [
        { provide: WEBHOOKS_OPTIONS, useValue: resolved },
        { provide: WEBHOOKS_TRANSPORT, useValue: resolved.transport ?? nodeWebhookTransport },
        { provide: WEBHOOKS_RESOLVER, useValue: resolved.resolver ?? systemHostResolver },
        { provide: WebhooksRepository, useClass: PrismaWebhooksRepository },
        { provide: WebhookSecrets, useClass: CredentialsWebhookSecrets },
        WebhooksService,
        WebhookEndpointsService,
        WebhookDeliverHandler,
        WebhookFanoutHandler,
        WebhookPurgeHandler,
        WebhookEventListeners,
        WebhookNotificationChannel,
        ...(resolved.tasks.purge ? [WebhookPurgeTask] : []),
      ],
      exports: [WEBHOOKS_OPTIONS, WebhooksService, WebhookEndpointsService],
    };
  }
}

import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AUDIT_SINK, PLATFORM_PRISMA, errorCodeRegistry } from '../../src/core/index';
import { CredentialsService, OrgCredentialsService, UserCredentialsService } from '../../src/credentials/index';
import { JwtAuthGuard, PermissionsGuard, RolesGuard } from '../../src/identity/index';
import { JobHandlerRegistry, JobsService } from '../../src/jobs/index';
import { NotificationChannelSenderRegistry, NotificationsService, notificationChannelRegistry } from '../../src/notifications/index';
import {
  AdminWebhooksController,
  OrgWebhooksController,
  WEBHOOKS_OPTIONS,
  WEBHOOKS_RESOLVER,
  WEBHOOKS_SYSTEM_PRISMA,
  WEBHOOKS_TRANSPORT,
  WebhookDeliverHandler,
  WebhookEndpointsService,
  WebhookSecrets,
  WebhooksController,
  WebhooksModule,
  WebhooksRepository,
  WebhooksService,
  nodeWebhookTransport,
  resolveWebhooksModuleOptions,
  systemHostResolver,
  userAgentToken,
  webhookEventRegistry,
} from '../../src/webhooks/index';
import { WebhookNotificationChannel } from '../../src/webhooks/notifications/webhook-notification.channel';
import { WebhookPurgeTask } from '../../src/webhooks/tasks/webhook-purge.task';
import { FakeWebhookReceiver, ScriptedHostResolver } from '../../src/webhooks/testing/index';

@Global()
@Module({
  providers: [
    { provide: PLATFORM_PRISMA, useValue: { organization: { findFirst: async () => ({ id: 'org' }) }, job: { findFirst: async () => null }, $executeRaw: async () => 0 } },
    { provide: AUDIT_SINK, useValue: { record: async () => undefined } },
    { provide: WEBHOOKS_SYSTEM_PRISMA, useValue: { asSystem: () => ({}), runAsSystem: async () => undefined } },
    { provide: JobsService, useValue: { enqueue: async () => ({}), enqueueWithin: async () => ({}) } },
    JobHandlerRegistry,
    { provide: NotificationsService, useValue: { notifyNow: async () => ({ rateLimited: false, retryAfterMs: null }) } },
    { provide: NotificationChannelSenderRegistry, useFactory: () => new NotificationChannelSenderRegistry([] as never) },
    { provide: CredentialsService, useValue: {} },
    { provide: OrgCredentialsService, useValue: {} },
    { provide: UserCredentialsService, useValue: {} },
  ],
  exports: [PLATFORM_PRISMA, AUDIT_SINK, WEBHOOKS_SYSTEM_PRISMA, JobsService, JobHandlerRegistry, NotificationsService, NotificationChannelSenderRegistry, CredentialsService, OrgCredentialsService, UserCredentialsService],
})
class HostPortsModule {}

describe('WebhooksModule.forRoot', () => {
  it('composes: the controllers, the three handlers, the sender and the cron resolve their dependencies, and onModuleInit registers them', async () => {
    const allow = { canActivate: () => true };
    const moduleRef = await Test.createTestingModule({ imports: [HostPortsModule, WebhooksModule.forRoot({ appName: 'Product X' })] })
      .overrideGuard(JwtAuthGuard).useValue(allow)
      .overrideGuard(RolesGuard).useValue(allow)
      .overrideGuard(PermissionsGuard).useValue(allow)
      .compile();
    await moduleRef.init();

    const registry = moduleRef.get(JobHandlerRegistry);
    expect(registry.types().filter((type) => type.startsWith('webhooks.')).sort()).toEqual(['webhooks.deliver', 'webhooks.deliveries_purge', 'webhooks.fanout']);
    expect(registry.get('webhooks.deliver')).toBe(moduleRef.get(WebhookDeliverHandler));

    for (const token of [WebhooksService, WebhookEndpointsService, WebhooksRepository, WebhookSecrets, WebhookNotificationChannel, WebhookPurgeTask, WebhooksController, OrgWebhooksController, AdminWebhooksController]) {
      expect(moduleRef.get(token as never)).toBeDefined();
    }
    expect(moduleRef.get(WEBHOOKS_TRANSPORT)).toBe(nodeWebhookTransport);
    expect(moduleRef.get(WEBHOOKS_RESOLVER)).toBe(systemHostResolver);
    expect(moduleRef.get(WEBHOOKS_OPTIONS).appName()).toBe('Product-X');
    expect(moduleRef.get(NotificationChannelSenderRegistry).get('webhook')).toBe(moduleRef.get(WebhookNotificationChannel));
    await moduleRef.close();
  });

  it('registers the events, the error codes and the channel, idempotently', () => {
    WebhooksModule.forRoot();
    WebhooksModule.forRoot();
    expect(webhookEventRegistry.has('nodes.node.offline')).toBe(true);
    expect(notificationChannelRegistry.has('webhook')).toBe(true);
    for (const code of ['WEBHOOK_NOT_FOUND', 'WEBHOOK_DELIVERY_NOT_FOUND', 'WEBHOOK_URL_INVALID', 'WEBHOOK_URL_FORBIDDEN', 'WEBHOOK_EVENT_UNKNOWN', 'WEBHOOK_EVENT_NOT_PERMITTED', 'WEBHOOK_LIMIT_REACHED']) {
      expect(errorCodeRegistry.has(code)).toBe(true);
    }
    expect(errorCodeRegistry.get('WEBHOOK_NOT_FOUND')!.status).toBe(404);
    expect(errorCodeRegistry.get('WEBHOOK_URL_FORBIDDEN')!.status).toBe(422);
  });

  it('leaves out the purge cron when asked, and takes a transport and resolver override', async () => {
    const receiver = new FakeWebhookReceiver();
    const resolver = new ScriptedHostResolver();
    const dynamic = WebhooksModule.forRoot({ tasks: { purge: false }, transport: receiver, resolver });
    expect(dynamic.providers).not.toContain(WebhookPurgeTask);
    const providers = dynamic.providers as Array<{ provide?: unknown; useValue?: unknown }>;
    expect(providers.find((p) => p.provide === WEBHOOKS_TRANSPORT)!.useValue).toBe(receiver);
    expect(providers.find((p) => p.provide === WEBHOOKS_RESOLVER)!.useValue).toBe(resolver);
    expect(WebhooksModule.forRoot().providers).toContain(WebhookPurgeTask);
  });
});

describe('resolveWebhooksModuleOptions', () => {
  it('applies the documented defaults', () => {
    const options = resolveWebhooksModuleOptions();
    expect(options).toMatchObject({
      allowInsecureHttp: false,
      allowPrivateTargets: false,
      allowedHosts: [],
      circuitBreakerThreshold: 20,
      rotationOverlapHours: 24,
      deliveryRetentionDays: 30,
      limits: { user: 20, org: 50, system: 50 },
      requestTimeoutMs: 10_000,
      maxDeliveryAttempts: 10,
      tasks: { purge: true },
    });
    expect(options.appName()).toBe('App');
    expect(Object.isFrozen(options)).toBe(true);
  });

  it('takes overrides, reads a function name per call, and rejects bad numbers', () => {
    let name = 'One';
    const options = resolveWebhooksModuleOptions({ appName: () => name, circuitBreakerThreshold: 3, limits: { org: 5 }, allowedHosts: ['a.example.test'] });
    expect(options.appName()).toBe('One');
    name = 'Two words';
    expect(options.appName()).toBe('Two-words');
    expect(options).toMatchObject({ circuitBreakerThreshold: 3, limits: { user: 20, org: 5, system: 50 }, allowedHosts: ['a.example.test'] });
    for (const bad of [{ circuitBreakerThreshold: 0 }, { rotationOverlapHours: 1.5 }, { deliveryRetentionDays: -1 }, { requestTimeoutMs: NaN }, { maxDeliveryAttempts: 0 }, { limits: { user: 0 } }]) {
      expect(() => resolveWebhooksModuleOptions(bad as never)).toThrow(/must be a positive integer/);
    }
  });

  it('builds a safe User-Agent token', () => {
    expect(userAgentToken('Org Alpha / Console')).toBe('Org-Alpha-Console');
    expect(userAgentToken('***')).toBe('App');
    expect(userAgentToken('x'.repeat(100))).toHaveLength(40);
  });
});

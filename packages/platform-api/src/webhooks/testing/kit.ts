// =============================================================================
// The webhooks test kit (issue #1046)
// =============================================================================
//
// The real services (`WebhookEndpointsService`, `WebhooksService`, the three job
// handlers) wired over the in-memory ports, with a recording audit sink, a
// recording notifications service, a fake receiver and a scripted resolver.
// No Nest container, no database, no network. Never import it from production
// code.
// =============================================================================

import type { Job } from '../../jobs/index';
import { JobHandlerRegistry } from '../../jobs/index';
import type { AuditEventInput, AuditSink } from '../../core/index';
import type { NotificationsService } from '../../notifications/index';
import { WebhookDeliverHandler } from '../handlers/webhook-deliver.handler';
import { WebhookFanoutHandler } from '../handlers/webhook-fanout.handler';
import { WebhookPurgeHandler } from '../handlers/webhook-purge.handler';
import { registerBuiltinWebhookEvents } from '../registry/builtin-events';
import { generateWebhookSecret } from '../signing';
import { WebhookEndpointsService, type WebhookScopeContext } from '../webhook-endpoints.service';
import { resolveWebhooksModuleOptions, type ResolvedWebhooksModuleOptions, type WebhooksModuleOptions } from '../webhooks.options';
import { WebhooksService } from '../webhooks.service';
import { FakeWebhookReceiver, type RecordedNotification, InMemoryWebhookSecrets, InMemoryWebhooksRepository, RecordingJobs, ScriptedHostResolver } from './in-memory';
import { registerWebhookErrorCodes } from '../webhooks.errors';

/** The organization the kit's contexts live in. @stability experimental */
export const KIT_ORG_ID = '11111111-1111-4111-8111-111111111111';
/** A second organization, for isolation tests. @stability experimental */
export const KIT_OTHER_ORG_ID = '22222222-2222-4222-8222-222222222222';
/** A member. @stability experimental */
export const KIT_USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
/** Another member. @stability experimental */
export const KIT_USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/** What {@link WebhooksTestKit.seedEndpoint} takes. @stability experimental */
export interface SeedEndpointInput {
  /** The scope of the endpoint. */
  scope: WebhookScopeContext['scope'];
  /** The owner (user scope) or creator; default `KIT_USER_A`. */
  ownerUserId?: string | null;
  /** The organization; default `KIT_ORG_ID` (ignored for system scope). */
  orgId?: string | null;
  /** The subscriptions, stored as given. */
  eventKeys: string[];
  /** The URL; default `https://receiver.example.test/hooks/in`. */
  url?: string;
  /** Whether it starts enabled; default true. */
  enabled?: boolean;
}

/** What {@link WebhooksTestKit.seedEndpoint} returns. @stability experimental */
export interface SeedEndpointResult {
  /** The inserted row. */
  endpoint: Awaited<ReturnType<InMemoryWebhooksRepository['createEndpoint']>>;
  /** Its signing secret. */
  secret: string;
}

/** What {@link createWebhooksTestKit} returns. @stability experimental */
export interface WebhooksTestKit {
  /** Options. */
  readonly options: ResolvedWebhooksModuleOptions;
  /** Repository. */
  readonly repository: InMemoryWebhooksRepository;
  /** Secrets. */
  readonly secrets: InMemoryWebhookSecrets;
  /** Receiver. */
  readonly receiver: FakeWebhookReceiver;
  /** Resolver. */
  readonly resolver: ScriptedHostResolver;
  /** Jobs. */
  readonly jobs: RecordingJobs;
  /** Audit. */
  readonly audit: AuditEventInput[];
  /** Calls to `notifyNow`. */
  readonly notified: RecordedNotification[];
  /** Endpoints. */
  readonly endpoints: WebhookEndpointsService;
  /** Webhooks. */
  readonly webhooks: WebhooksService;
  /** Deliver. */
  readonly deliver: WebhookDeliverHandler;
  /** Fanout. */
  readonly fanout: WebhookFanoutHandler;
  /** Purge. */
  readonly purge: WebhookPurgeHandler;
  /** A context in the kit's organization. */
  context(scope: WebhookScopeContext['scope'], userId?: string, permissions?: readonly string[], orgId?: string | null): WebhookScopeContext;
  /** Runs a delivery's job as the queue would. */
  runDeliveryJob(deliveryId: string, orgId?: string | null): Promise<void>;
  /** Sets the clock of the services and the repository. */
  setNow(now: () => Date): void;
  /** Inserts an endpoint (and its secret) directly, bypassing the create-time validation: for scopes whose events the process has not registered. */
  seedEndpoint(input: SeedEndpointInput): Promise<SeedEndpointResult>;
}

/**
 * Builds the kit. The resolver answers `receiver.example.test` with a public
 * address (`93.184.216.34`) until a test changes it.
 *
 * @param options - `forRoot` options to resolve (the transport and resolver are the kit's).
 * @returns the kit.
 *
 * @stability experimental
 */
export function createWebhooksTestKit(options: WebhooksModuleOptions = {}): WebhooksTestKit {
  registerBuiltinWebhookEvents();
  registerWebhookErrorCodes();
  const receiver = new FakeWebhookReceiver();
  const resolver = new ScriptedHostResolver().set('receiver.example.test', '93.184.216.34');
  const resolved = resolveWebhooksModuleOptions({ ...options, transport: receiver, resolver });
  const repository = new InMemoryWebhooksRepository();
  const secrets = new InMemoryWebhookSecrets();
  const jobs = new RecordingJobs();
  const audit: AuditEventInput[] = [];
  const auditSink: AuditSink = { record: async (event) => void audit.push(event) };
  const notified: WebhooksTestKit['notified'] = [];
  const notifications = {
    notifyNow: async (eventKey: string, userId: string, data: unknown) => {
      notified.push({ eventKey, userId, data });
      return { rateLimited: false, retryAfterMs: null };
    },
  } as unknown as NotificationsService;
  const prisma = { organization: { findFirst: async () => ({ id: KIT_ORG_ID }) }, $executeRaw: async () => 0 } as never;
  const registry = new JobHandlerRegistry();

  const endpoints = new WebhookEndpointsService(repository, secrets, resolved, resolver, auditSink);
  const webhooks = new WebhooksService(repository, jobs as never, prisma, auditSink);
  const deliver = new WebhookDeliverHandler(registry, repository, secrets, resolved, receiver, resolver, notifications);
  const fanout = new WebhookFanoutHandler(registry, webhooks);
  const purge = new WebhookPurgeHandler(registry, repository, resolved);

  return {
    options: resolved,
    repository,
    secrets,
    receiver,
    resolver,
    jobs,
    audit,
    notified,
    endpoints,
    webhooks,
    deliver,
    fanout,
    purge,
    context: (scope, userId = KIT_USER_A, permissions = ['webhooks:read', 'webhooks:write', 'org_webhooks:read', 'org_webhooks:write', 'system_webhooks:read', 'system_webhooks:write'], orgId = scope === 'system' ? null : KIT_ORG_ID) => ({
      scope,
      userId,
      orgId,
      permissions,
    }),
    runDeliveryJob: (deliveryId, orgId = KIT_ORG_ID) => deliver.process({ id: 'job-1', type: deliver.type, subjectId: deliveryId, orgId } as unknown as Job),
    seedEndpoint: async (input) => {
      const orgId = input.scope === 'system' ? null : (input.orgId ?? KIT_ORG_ID);
      const endpoint = await repository.createEndpoint(orgId, {
        scope: input.scope,
        ownerUserId: input.scope === 'user' ? (input.ownerUserId ?? KIT_USER_A) : null,
        createdById: input.ownerUserId ?? KIT_USER_A,
        name: 'seeded',
        description: null,
        url: input.url ?? 'https://receiver.example.test/hooks/in',
        eventKeys: input.eventKeys,
        enabled: input.enabled ?? true,
      });
      const secret = generateWebhookSecret();
      await secrets.put(endpoint, endpoint.secretVersion, secret);
      return { endpoint, secret };
    },
    setNow: (now) => {
      repository.now = now;
      endpoints.now = now;
      deliver.now = now;
      purge.now = now;
    },
  };
}

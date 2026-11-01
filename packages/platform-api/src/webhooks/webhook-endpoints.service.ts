// =============================================================================
// WebhookEndpointsService: the endpoint and delivery routes' logic
// (issue #1046)
// =============================================================================
//
// One service behind the three controllers (user, organization, system). A
// {@link WebhookScopeContext} says which scope the caller is acting in; every
// query is pinned to it (scope, organization and, for user scope, the owner),
// so an endpoint or delivery outside it is a 404, never a 403: an id is not an
// oracle.
//
// The signing secret is generated here, stored in the credentials store, and
// returned exactly twice in an endpoint's life: by `create` and by
// `rotateSecret`. No other method returns it and none logs it.
//
// Nothing here performs outbound HTTP. `test` and `redeliver` queue a
// `webhooks.deliver` job like every other delivery.
// =============================================================================

import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  WEBHOOK_ERROR_CODES,
  type CreateWebhookEndpoint,
  type RotateWebhookSecretResponse,
  type UpdateWebhookEndpoint,
  type WebhookDeliveryDetail,
  type WebhookDeliveryList,
  type WebhookDeliveryListQuery,
  type WebhookEndpoint,
  type WebhookEndpointCreated,
  type WebhookEventCatalogEntry,
  type WebhookScope,
  type WebhookTestResponse,
} from '@marinoscar/platform-contract/webhooks';

import { AUDIT_SINK, type AuditSink } from '../core/index';
import {
  WebhookEgressError,
  resolveWebhookTarget,
  type HostResolver,
  type WebhookEgressPolicy,
} from './egress/egress-guard';
import { WEBHOOKS_RESOLVER } from './egress/transport';
import { buildEnvelope } from './webhook-envelope';
import { WebhookSecrets } from './webhook-secrets.service';
import { toDeliveryDetail, toDeliveryView, toEndpointView } from './webhook-views';
import { WEBHOOK_PING_EVENT_KEY } from './registry/builtin-events';
import { catalogFor, subscribableEvents, subscriptionIsSubscribable } from './registry/webhook-catalog';
import { subscriptionMatches } from './registry/webhook-event.registry';
import { generateWebhookSecret } from './signing';
import { WEBHOOK_AUDIT_ACTIONS, WEBHOOK_AUDIT_TARGET } from './webhooks.constants';
import {
  WebhookDeliveryNotFoundError,
  WebhookDisabledError,
  WebhookNotFoundError,
  WebhookRequestError,
} from './webhooks.errors';
import { WEBHOOKS_OPTIONS, userAgentToken, type ResolvedWebhooksModuleOptions } from './webhooks.options';
import { WebhooksRepository, type EndpointFilter } from './webhooks.repository';

/**
 * Who is acting, in which scope.
 *
 * @stability experimental
 */
export interface WebhookScopeContext {
  /** `user` (own endpoints), `org` (the organization's) or `system` (the deployment's). */
  readonly scope: WebhookScope;
  /** The acting user. */
  readonly userId: string;
  /** The active organization; `null` only for system scope. */
  readonly orgId: string | null;
  /** The caller's effective permissions, for the per-event permission gate. */
  readonly permissions: readonly string[];
}

/**
 * See the file header.
 *
 * @stability experimental
 */
@Injectable()
export class WebhookEndpointsService {
  private readonly logger = new Logger(WebhookEndpointsService.name);

  /** Overridable clock, for tests. */
  now: () => Date = () => new Date();

  constructor(
    private readonly repository: WebhooksRepository,
    private readonly secrets: WebhookSecrets,
    @Inject(WEBHOOKS_OPTIONS) private readonly options: ResolvedWebhooksModuleOptions,
    @Inject(WEBHOOKS_RESOLVER) private readonly resolver: HostResolver,
    @Inject(AUDIT_SINK) private readonly audit: AuditSink,
  ) {}

  // ---------------------------------------------------------------------------
  // Endpoints
  // ---------------------------------------------------------------------------

  /**
   * The endpoints in the caller's scope, newest first.
   *
   * @param ctx - who is acting.
   * @returns the endpoints (no secret).
   */
  async list(ctx: WebhookScopeContext): Promise<WebhookEndpoint[]> {
    const rows = await this.repository.listEndpoints(this.orgOf(ctx), this.filterOf(ctx));
    return rows.map(toEndpointView);
  }

  /**
   * One endpoint.
   *
   * @param ctx - who is acting.
   * @param id - the endpoint id.
   * @returns the endpoint.
   * @throws WebhookNotFoundError when it does not exist or is not in the caller's scope.
   */
  async get(ctx: WebhookScopeContext, id: string): Promise<WebhookEndpoint> {
    return toEndpointView(await this.require(ctx, id));
  }

  /**
   * Creates an endpoint and returns its signing secret, once.
   *
   * @param ctx - who is acting.
   * @param input - the validated body.
   * @returns the endpoint and the secret.
   * @throws WebhookRequestError for a forbidden URL, an unknown or not-permitted event, or the endpoint limit.
   */
  async create(ctx: WebhookScopeContext, input: CreateWebhookEndpoint): Promise<WebhookEndpointCreated> {
    const orgId = this.orgOf(ctx);
    const filter = this.filterOf(ctx);
    const limit = this.options.limits[ctx.scope];
    if ((await this.repository.countEndpoints(orgId, filter)) >= limit) {
      throw new WebhookRequestError(WEBHOOK_ERROR_CODES.WEBHOOK_LIMIT_REACHED, `You can have at most ${limit} webhook endpoints.`);
    }
    await this.assertUrlAllowed(input.url);
    this.assertEventKeys(ctx, input.eventKeys);

    const row = await this.repository.createEndpoint(orgId, {
      scope: ctx.scope,
      ownerUserId: ctx.scope === 'user' ? ctx.userId : null,
      createdById: ctx.userId,
      name: input.name,
      description: input.description ?? null,
      url: input.url,
      eventKeys: [...new Set(input.eventKeys)],
      enabled: input.enabled,
    });
    const secret = generateWebhookSecret();
    try {
      await this.secrets.put(row, row.secretVersion, secret);
    } catch (error) {
      await this.repository.deleteEndpoint(orgId, row.id).catch(() => undefined);
      throw error;
    }
    await this.record(WEBHOOK_AUDIT_ACTIONS.CREATE, ctx, row.id);
    return { endpoint: toEndpointView(row), secret };
  }

  /**
   * Changes an endpoint. Enabling a disabled endpoint clears its failure count
   * and its disabled reason.
   *
   * @param ctx - who is acting.
   * @param id - the endpoint id.
   * @param input - the validated patch.
   * @returns the endpoint.
   */
  async update(ctx: WebhookScopeContext, id: string, input: UpdateWebhookEndpoint): Promise<WebhookEndpoint> {
    const current = await this.require(ctx, id);
    if (input.url !== undefined && input.url !== current.url) await this.assertUrlAllowed(input.url);
    if (input.eventKeys !== undefined) this.assertEventKeys(ctx, input.eventKeys);

    const patch: Parameters<WebhooksRepository['updateEndpoint']>[2] = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description ?? null } : {}),
      ...(input.url !== undefined ? { url: input.url } : {}),
      ...(input.eventKeys !== undefined ? { eventKeys: [...new Set(input.eventKeys)] } : {}),
    };
    if (input.enabled !== undefined) {
      patch.enabled = input.enabled;
      if (input.enabled && !current.enabled) {
        patch.consecutiveFailures = 0;
        patch.disabledReason = null;
      }
      if (!input.enabled && current.enabled) patch.disabledReason = null;
    }
    const row = await this.repository.updateEndpoint(this.orgOf(ctx), id, patch);
    await this.record(WEBHOOK_AUDIT_ACTIONS.UPDATE, ctx, id);
    return toEndpointView(row);
  }

  /**
   * Deletes an endpoint, its deliveries and its stored secrets.
   *
   * @param ctx - who is acting.
   * @param id - the endpoint id.
   */
  async remove(ctx: WebhookScopeContext, id: string): Promise<void> {
    const current = await this.require(ctx, id);
    await this.repository.deleteEndpoint(this.orgOf(ctx), id);
    try {
      await this.secrets.removeAll(current, current.secretVersion);
    } catch (error) {
      this.logger.warn(`Could not remove the stored secrets of webhook endpoint ${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
    await this.record(WEBHOOK_AUDIT_ACTIONS.DELETE, ctx, id);
  }

  /**
   * Rotates the signing secret. The previous secret keeps signing for the
   * overlap window (two signatures per delivery), so the receiver can switch
   * without dropping an event.
   *
   * @param ctx - who is acting.
   * @param id - the endpoint id.
   * @returns the new secret, once.
   */
  async rotateSecret(ctx: WebhookScopeContext, id: string): Promise<RotateWebhookSecretResponse> {
    const current = await this.require(ctx, id);
    const version = current.secretVersion + 1;
    const secret = generateWebhookSecret();
    await this.secrets.put(current, version, secret);
    const until = new Date(this.now().getTime() + this.options.rotationOverlapHours * 3_600_000);
    await this.repository.updateEndpoint(this.orgOf(ctx), id, { secretVersion: version, previousSecretUntil: until });
    // The secret before the one that just became "previous" is no longer needed.
    if (current.secretVersion > 1) await this.secrets.remove(current, current.secretVersion - 1).catch(() => undefined);
    await this.record(WEBHOOK_AUDIT_ACTIONS.ROTATE, ctx, id);
    return { secret, secretVersion: version, previousSecretValidUntil: until.toISOString() };
  }

  /**
   * Queues a `webhooks.ping` delivery to the endpoint.
   *
   * @param ctx - who is acting.
   * @param id - the endpoint id.
   * @returns the delivery id.
   */
  async test(ctx: WebhookScopeContext, id: string): Promise<WebhookTestResponse> {
    const endpoint = await this.require(ctx, id);
    const eventId = randomUUID();
    const envelope = buildEnvelope({
      eventId,
      eventKey: WEBHOOK_PING_EVENT_KEY,
      orgId: endpoint.orgId,
      data: { message: 'This is a test delivery.', endpointId: endpoint.id },
      occurredAt: this.now(),
    });
    const [delivery] = await this.repository.insertDeliveries(endpoint.orgId, [
      { endpointId: endpoint.id, eventKey: WEBHOOK_PING_EVENT_KEY, eventId, payload: envelope },
    ]);
    if (!delivery) throw new Error('The test delivery could not be queued');
    return { deliveryId: delivery.id };
  }

  // ---------------------------------------------------------------------------
  // Deliveries
  // ---------------------------------------------------------------------------

  /**
   * A page of an endpoint's deliveries.
   *
   * @param ctx - who is acting.
   * @param id - the endpoint id.
   * @param query - page, size and filters.
   * @returns the page.
   */
  async listDeliveries(ctx: WebhookScopeContext, id: string, query: WebhookDeliveryListQuery): Promise<WebhookDeliveryList> {
    const endpoint = await this.require(ctx, id);
    const { items, total } = await this.repository.listDeliveries(endpoint.orgId, endpoint.id, query);
    return { items: items.map(toDeliveryView), total, page: query.page, pageSize: query.pageSize, totalPages: Math.ceil(total / query.pageSize) };
  }

  /**
   * One delivery with its payload.
   *
   * @param ctx - who is acting.
   * @param deliveryId - the delivery id.
   * @returns the detail.
   */
  async getDelivery(ctx: WebhookScopeContext, deliveryId: string): Promise<WebhookDeliveryDetail> {
    const delivery = await this.repository.findDelivery(this.orgOf(ctx), deliveryId, this.filterOf(ctx));
    if (!delivery) throw new WebhookDeliveryNotFoundError();
    return toDeliveryDetail(delivery, `${userAgentToken(this.options.appName())}-Webhooks/1.0`);
  }

  /**
   * Sends a delivery again: the same row goes back to `pending` with a fresh
   * attempt count and a new job. The event id (`webhook-id`) is unchanged, so a
   * receiver that deduplicates sees the same event.
   *
   * @param ctx - who is acting.
   * @param deliveryId - the delivery id.
   * @returns the delivery.
   * @throws WebhookDisabledError when the endpoint is switched off.
   */
  async redeliver(ctx: WebhookScopeContext, deliveryId: string): Promise<WebhookDeliveryDetail> {
    const orgId = this.orgOf(ctx);
    const delivery = await this.repository.findDelivery(orgId, deliveryId, this.filterOf(ctx));
    if (!delivery) throw new WebhookDeliveryNotFoundError();
    const endpoint = await this.repository.findEndpoint(orgId, delivery.endpointId, this.filterOf(ctx));
    if (!endpoint) throw new WebhookDeliveryNotFoundError();
    if (!endpoint.enabled) throw new WebhookDisabledError();
    const row = await this.repository.resetForRedelivery(orgId, deliveryId);
    await this.record(WEBHOOK_AUDIT_ACTIONS.REDELIVER, ctx, endpoint.id, { deliveryId });
    return toDeliveryDetail(row, `${userAgentToken(this.options.appName())}-Webhooks/1.0`);
  }

  /**
   * The events the caller may subscribe to at this scope.
   *
   * @param ctx - who is acting.
   * @returns the catalog entries the caller's permissions allow.
   */
  catalog(ctx: WebhookScopeContext): WebhookEventCatalogEntry[] {
    const permitted = new Set(subscribableEvents(ctx.scope).filter((event) => this.holds(ctx, event.permission)).map((event) => event.key));
    return catalogFor(ctx.scope).filter((entry) => permitted.has(entry.key));
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private orgOf(ctx: WebhookScopeContext): string | null {
    if (ctx.scope === 'system') return null;
    if (!ctx.orgId) throw new WebhookNotFoundError();
    return ctx.orgId;
  }

  private filterOf(ctx: WebhookScopeContext): EndpointFilter {
    return ctx.scope === 'user' ? { scope: 'user', ownerUserId: ctx.userId } : { scope: ctx.scope };
  }

  private async require(ctx: WebhookScopeContext, id: string) {
    const row = await this.repository.findEndpoint(this.orgOf(ctx), id, this.filterOf(ctx));
    if (!row) throw new WebhookNotFoundError();
    return row;
  }

  private policy(): WebhookEgressPolicy {
    return {
      allowInsecureHttp: this.options.allowInsecureHttp,
      allowPrivateTargets: this.options.allowPrivateTargets,
      allowedHosts: this.options.allowedHosts,
    };
  }

  /** Syntax and, best effort, DNS: a name that does not resolve yet is accepted (it may be set up later); one that resolves to a private address is not. */
  private async assertUrlAllowed(url: string): Promise<void> {
    try {
      await resolveWebhookTarget(url, this.policy(), this.resolver);
    } catch (error) {
      if (!(error instanceof WebhookEgressError)) throw error;
      if (error.code === 'unresolvable') return;
      throw new WebhookRequestError(
        error.code === 'invalid_url' ? WEBHOOK_ERROR_CODES.WEBHOOK_URL_INVALID : WEBHOOK_ERROR_CODES.WEBHOOK_URL_FORBIDDEN,
        error.message,
      );
    }
  }

  private holds(ctx: WebhookScopeContext, permission: string | undefined): boolean {
    return permission === undefined || ctx.permissions.includes(permission);
  }

  private assertEventKeys(ctx: WebhookScopeContext, keys: readonly string[]): void {
    for (const pattern of keys) {
      if (!subscriptionIsSubscribable(pattern, ctx.scope)) {
        throw new WebhookRequestError(WEBHOOK_ERROR_CODES.WEBHOOK_EVENT_UNKNOWN, `"${pattern}" names no event this kind of endpoint can receive.`);
      }
      const matching = subscribableEvents(ctx.scope).filter((event) => subscriptionMatches(pattern, event.key));
      if (!matching.some((event) => this.holds(ctx, event.permission))) {
        throw new WebhookRequestError(WEBHOOK_ERROR_CODES.WEBHOOK_EVENT_NOT_PERMITTED, `You may not subscribe to "${pattern}".`);
      }
    }
  }

  private async record(action: string, ctx: WebhookScopeContext, targetId: string, extra: Record<string, string> = {}): Promise<void> {
    try {
      await this.audit.record({ action, actorUserId: ctx.userId, targetType: WEBHOOK_AUDIT_TARGET, targetId, meta: { scope: ctx.scope, ...extra } });
    } catch (error) {
      this.logger.warn(`Could not record the audit event ${action}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}


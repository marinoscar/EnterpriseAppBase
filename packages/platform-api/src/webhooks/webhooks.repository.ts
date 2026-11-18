// =============================================================================
// WebhooksRepository: every read and write of the two webhook tables
// (issue #1046)
// =============================================================================
//
// ONE PLACE decides which client touches which row, so row-level security is
// never an afterthought of a caller:
//
//   - an organization's rows (`orgId` set: user and org scope) run in
//     `runInOrg(PLATFORM_PRISMA, { orgId }, ...)`, the transaction-local
//     `app.org_id` the policy reads;
//   - a system-scope row has NO organization (`orgId` null); the policy shows
//     it to the bypass client only, so those run in `WEBHOOKS_SYSTEM_PRISMA`
//     with the registered reason `webhooks` (the purge uses `retention`).
//
// Every method takes the row's `orgId` (null = system) as its first argument
// and every query also filters on it, so a mis-routed call finds nothing.
//
// Fan-out and redelivery insert the delivery rows and enqueue their jobs in ONE
// transaction (`JobsService.enqueueWithin`): a delivery without a job, or a job
// without a delivery, cannot exist.
//
// `WebhooksRepository` is an abstract class used as the injection token; the
// slice's testing entry has an in-memory implementation.
// =============================================================================

import { Inject, Injectable } from '@nestjs/common';
import type { WebhookScope } from '@marinoscar/platform-contract/webhooks';

import { PLATFORM_PRISMA, runInOrg } from '../core/index';
import { PRINCIPAL_USER_INCLUDE } from '../identity/index';
import { JobsService, type JobsTx } from '../jobs/index';
import type { WebhookDeliveryRow, WebhookEndpointRow, WebhookUserRow, WebhooksTx } from './data/webhooks-db';
import { WEBHOOKS_SYSTEM_PRISMA, type WebhooksPrisma, type WebhooksSystemPrisma } from './ports';
import { WEBHOOKS_SYSTEM_ACCESS_REASON, registerWebhooksSystemAccessReason, WEBHOOK_DELIVER_JOB_TYPE, WEBHOOK_DELIVERY_SUBJECT_TYPE, WEBHOOK_PURGE_BATCH, WEBHOOK_PURGE_MAX_BATCHES } from './webhooks.constants';

/** Which endpoints a query is about: a scope, and for user scope the owner. @stability experimental */
export interface EndpointFilter {
  /** The scope. */
  readonly scope: WebhookScope;
  /** User scope: the owner. */
  readonly ownerUserId?: string;
}

/** A new endpoint row. @stability experimental */
export interface NewEndpoint {
  /** Scope. */
  readonly scope: WebhookScope;
  /** Owner user id. */
  readonly ownerUserId: string | null;
  /** Created by id. */
  readonly createdById: string | null;
  /** Name. */
  readonly name: string;
  /** Description. */
  readonly description: string | null;
  /** Url. */
  readonly url: string;
  /** Event keys. */
  readonly eventKeys: string[];
  /** Enabled. */
  readonly enabled: boolean;
}

/** The columns an update may set. @stability experimental */
export type EndpointPatch = Partial<
  Pick<WebhookEndpointRow, 'name' | 'description' | 'url' | 'eventKeys' | 'enabled' | 'secretVersion' | 'previousSecretUntil' | 'disabledReason' | 'consecutiveFailures'>
>;

/** A delivery row to insert. @stability experimental */
export interface NewDelivery {
  /** Endpoint id. */
  readonly endpointId: string;
  /** Event key. */
  readonly eventKey: string;
  /** Event id. */
  readonly eventId: string;
  /** Payload. */
  readonly payload: unknown;
}

/** One page request of a delivery list. @stability experimental */
export interface DeliveryQuery {
  /** Page. */
  readonly page: number;
  /** Page size. */
  readonly pageSize: number;
  /** Status. */
  readonly status?: WebhookDeliveryRow['status'];
  /** Event key. */
  readonly eventKey?: string;
}

/** A delivery with its endpoint, for the job. @stability experimental */
export interface LoadedDelivery {
  /** The delivery. */
  delivery: WebhookDeliveryRow;
  /** Its endpoint, or `null` when it is gone. */
  endpoint: WebhookEndpointRow | null;
}

/** One page of deliveries. @stability experimental */
export interface DeliveryPage {
  /** The rows of the page, newest first. */
  items: WebhookDeliveryRow[];
  /** All rows matching the filter. */
  total: number;
}

/** What one attempt settled to. @stability experimental */
export interface AttemptOutcome {
  /** The delivery's new state. */
  readonly delivery: Partial<Pick<WebhookDeliveryRow, 'status' | 'attempt' | 'responseStatus' | 'responseSnippet' | 'errorCode' | 'durationMs' | 'nextAttemptAt' | 'deliveredAt'>>;
  /** `success` resets the endpoint's failure counter; `failure` counts one; `neutral` leaves it (the endpoint was already gone). */
  readonly endpoint: 'success' | 'failure' | 'neutral';
  /** Failures at which the endpoint is switched off. */
  readonly threshold: number;
  /** Disable at once, with this reason (a 410). */
  readonly disableNow?: string;
  /** When set, a retry job is enqueued for this time. */
  readonly retryAt?: Date;
}

/** What {@link WebhooksRepository.settleAttempt} reports. @stability experimental */
export interface SettledAttempt {
  /** The endpoint after the update, or `null` when it no longer exists. */
  readonly endpoint: WebhookEndpointRow | null;
  /** Whether THIS call switched the endpoint off (so the owner is told exactly once). */
  readonly disabled: boolean;
}

/**
 * The slice's data port. See the file header.
 *
 * @stability experimental
 */
export abstract class WebhooksRepository {
  /** The endpoints matching `filter`, newest first. */
  abstract listEndpoints(orgId: string | null, filter: EndpointFilter): Promise<WebhookEndpointRow[]>;
  /** One endpoint of `filter`, or `null` (also when it is another owner's or organization's). */
  abstract findEndpoint(orgId: string | null, id: string, filter: EndpointFilter): Promise<WebhookEndpointRow | null>;
  /** How many endpoints `filter` has. */
  abstract countEndpoints(orgId: string | null, filter: EndpointFilter): Promise<number>;
  /** Inserts an endpoint. */
  abstract createEndpoint(orgId: string | null, data: NewEndpoint): Promise<WebhookEndpointRow>;
  /** Updates an endpoint by id. */
  abstract updateEndpoint(orgId: string | null, id: string, patch: EndpointPatch): Promise<WebhookEndpointRow>;
  /** Deletes an endpoint (its deliveries cascade). */
  abstract deleteEndpoint(orgId: string | null, id: string): Promise<void>;
  /** The enabled endpoints an event of `filter` may reach. */
  abstract enabledEndpoints(orgId: string | null, filter: EndpointFilter): Promise<WebhookEndpointRow[]>;
  /** Switches an endpoint off with a reason; `true` when it was enabled. */
  abstract disableEndpoint(orgId: string | null, id: string, reason: string): Promise<boolean>;
  /** The user, with the role graph, for the owner's permission re-check. */
  abstract loadOwner(orgId: string | null, userId: string): Promise<WebhookUserRow | null>;

  /** Inserts the rows (skipping an `(endpointId, eventId)` that exists) and enqueues one job per inserted row, in one transaction. */
  abstract insertDeliveries(orgId: string | null, rows: readonly NewDelivery[]): Promise<WebhookDeliveryRow[]>;
  /** One delivery of `filter`'s endpoints, or `null`. */
  abstract findDelivery(orgId: string | null, id: string, filter: EndpointFilter): Promise<WebhookDeliveryRow | null>;
  /** One delivery by id with its endpoint, for the job (no owner filter: the job is trusted). */
  abstract loadDeliveryForJob(orgId: string | null, id: string): Promise<LoadedDelivery | null>;
  /** A page of one endpoint's deliveries, newest first. */
  abstract listDeliveries(orgId: string | null, endpointId: string, query: DeliveryQuery): Promise<DeliveryPage>;
  /** Marks the delivery `delivering` and counts the attempt. */
  abstract markDelivering(orgId: string | null, id: string): Promise<WebhookDeliveryRow>;
  /** Writes an attempt's outcome to the delivery and the endpoint; optionally enqueues the retry. */
  abstract settleAttempt(orgId: string | null, deliveryId: string, endpointId: string, outcome: AttemptOutcome): Promise<SettledAttempt>;
  /** Resets a delivery to `pending` and enqueues it again. */
  abstract resetForRedelivery(orgId: string | null, id: string): Promise<WebhookDeliveryRow>;
  /** Deletes deliveries created before `cutoff`, in batches; returns how many. */
  abstract purgeDeliveriesBefore(cutoff: Date): Promise<number>;
}

const SYSTEM_RETENTION_REASON = 'retention';

function endpointWhere(orgId: string | null, filter: EndpointFilter): Record<string, unknown> {
  return {
    orgId,
    scope: filter.scope,
    ...(filter.scope === 'user' && filter.ownerUserId !== undefined ? { ownerUserId: filter.ownerUserId } : {}),
  };
}

/**
 * The Prisma implementation. See the file header.
 *
 * @internal
 *
 * @stability experimental
 */
@Injectable()
export class PrismaWebhooksRepository extends WebhooksRepository {
  constructor(
    @Inject(PLATFORM_PRISMA) private readonly prisma: WebhooksPrisma,
    @Inject(WEBHOOKS_SYSTEM_PRISMA) private readonly system: WebhooksSystemPrisma,
    private readonly jobs: JobsService,
  ) {
    super();
    registerWebhooksSystemAccessReason();
  }

  private run<R>(orgId: string | null, fn: (tx: WebhooksTx) => Promise<R>): Promise<R> {
    if (orgId === null) return this.system.runAsSystem(WEBHOOKS_SYSTEM_ACCESS_REASON, fn);
    return runInOrg(this.prisma, { orgId }, (tx) => fn(tx as unknown as WebhooksTx));
  }

  listEndpoints(orgId: string | null, filter: EndpointFilter): Promise<WebhookEndpointRow[]> {
    return this.run(orgId, (tx) => tx.webhookEndpoint.findMany({ where: endpointWhere(orgId, filter), orderBy: { createdAt: 'desc' } }));
  }

  findEndpoint(orgId: string | null, id: string, filter: EndpointFilter): Promise<WebhookEndpointRow | null> {
    return this.run(orgId, (tx) => tx.webhookEndpoint.findFirst({ where: { id, ...endpointWhere(orgId, filter) } }));
  }

  countEndpoints(orgId: string | null, filter: EndpointFilter): Promise<number> {
    return this.run(orgId, (tx) => tx.webhookEndpoint.count({ where: endpointWhere(orgId, filter) }));
  }

  createEndpoint(orgId: string | null, data: NewEndpoint): Promise<WebhookEndpointRow> {
    return this.run(orgId, (tx) => tx.webhookEndpoint.create({ data: { ...data, orgId } }));
  }

  updateEndpoint(orgId: string | null, id: string, patch: EndpointPatch): Promise<WebhookEndpointRow> {
    return this.run(orgId, async (tx) => {
      const result = await tx.webhookEndpoint.updateMany({ where: { id, orgId }, data: patch });
      if (result.count !== 1) throw new Error('Webhook endpoint not found');
      return (await tx.webhookEndpoint.findFirst({ where: { id, orgId } })) as WebhookEndpointRow;
    });
  }

  async deleteEndpoint(orgId: string | null, id: string): Promise<void> {
    await this.run(orgId, (tx) => tx.webhookEndpoint.deleteMany({ where: { id, orgId } }));
  }

  enabledEndpoints(orgId: string | null, filter: EndpointFilter): Promise<WebhookEndpointRow[]> {
    return this.run(orgId, (tx) => tx.webhookEndpoint.findMany({ where: { ...endpointWhere(orgId, filter), enabled: true } }));
  }

  disableEndpoint(orgId: string | null, id: string, reason: string): Promise<boolean> {
    return this.run(orgId, async (tx) => {
      const result = await tx.webhookEndpoint.updateMany({ where: { id, orgId, enabled: true }, data: { enabled: false, disabledReason: reason } });
      return result.count === 1;
    });
  }

  loadOwner(orgId: string | null, userId: string): Promise<WebhookUserRow | null> {
    return this.run(orgId, (tx) => tx.user.findUnique({ where: { id: userId }, include: PRINCIPAL_USER_INCLUDE }));
  }

  insertDeliveries(orgId: string | null, rows: readonly NewDelivery[]): Promise<WebhookDeliveryRow[]> {
    if (rows.length === 0) return Promise.resolve([]);
    return this.run(orgId, async (tx) => {
      const inserted = await tx.webhookDelivery.createManyAndReturn({
        data: rows.map((row) => ({ ...row, orgId, payload: row.payload as never })),
        skipDuplicates: true,
      });
      for (const delivery of inserted) await this.enqueue(tx, orgId, delivery.id, 'upload', undefined);
      return inserted;
    });
  }

  private enqueue(tx: WebhooksTx, orgId: string | null, deliveryId: string, reason: 'upload' | 'rerun', scheduledFor: Date | undefined): Promise<unknown> {
    return this.jobs.enqueueWithin(tx as unknown as JobsTx, {
      type: WEBHOOK_DELIVER_JOB_TYPE,
      reason,
      subjectType: WEBHOOK_DELIVERY_SUBJECT_TYPE,
      subjectId: deliveryId,
      orgId,
      payload: { deliveryId },
      ...(scheduledFor ? { scheduledFor } : {}),
      // A retry is enqueued while the current attempt's job is still running: the dedup key (type + subject) would collapse onto it.
      skipDedup: true,
    });
  }

  findDelivery(orgId: string | null, id: string, filter: EndpointFilter): Promise<WebhookDeliveryRow | null> {
    return this.run(orgId, (tx) =>
      tx.webhookDelivery.findFirst({
        where: {
          id,
          orgId,
          endpoint: { is: { ...endpointWhere(orgId, filter) } },
        },
      }),
    );
  }

  loadDeliveryForJob(orgId: string | null, id: string): Promise<LoadedDelivery | null> {
    return this.run(orgId, async (tx) => {
      const delivery = await tx.webhookDelivery.findFirst({ where: { id, orgId } });
      if (!delivery) return null;
      const endpoint = await tx.webhookEndpoint.findFirst({ where: { id: delivery.endpointId, orgId } });
      return { delivery, endpoint };
    });
  }

  listDeliveries(orgId: string | null, endpointId: string, query: DeliveryQuery): Promise<DeliveryPage> {
    const where = {
      orgId,
      endpointId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.eventKey ? { eventKey: query.eventKey } : {}),
    };
    return this.run(orgId, async (tx) => {
      const [items, total] = [
        await tx.webhookDelivery.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
        await tx.webhookDelivery.count({ where }),
      ];
      return { items, total };
    });
  }

  markDelivering(orgId: string | null, id: string): Promise<WebhookDeliveryRow> {
    return this.run(orgId, async (tx) => {
      await tx.webhookDelivery.updateMany({ where: { id, orgId }, data: { status: 'delivering', attempt: { increment: 1 }, nextAttemptAt: null } });
      return (await tx.webhookDelivery.findFirst({ where: { id, orgId } })) as WebhookDeliveryRow;
    });
  }

  settleAttempt(orgId: string | null, deliveryId: string, endpointId: string, outcome: AttemptOutcome): Promise<SettledAttempt> {
    return this.run(orgId, async (tx) => {
      await tx.webhookDelivery.updateMany({ where: { id: deliveryId, orgId }, data: outcome.delivery });
      const now = new Date();
      let endpoint: WebhookEndpointRow | null = null;
      let disabled = false;
      if (outcome.endpoint === 'success') {
        await tx.webhookEndpoint.updateMany({ where: { id: endpointId, orgId }, data: { consecutiveFailures: 0, lastDeliveryAt: now, lastSuccessAt: now } });
        endpoint = await tx.webhookEndpoint.findFirst({ where: { id: endpointId, orgId } });
      } else if (outcome.endpoint === 'failure') {
        await tx.webhookEndpoint.updateMany({ where: { id: endpointId, orgId }, data: { consecutiveFailures: { increment: 1 }, lastDeliveryAt: now } });
        endpoint = await tx.webhookEndpoint.findFirst({ where: { id: endpointId, orgId } });
        const reason = outcome.disableNow ?? (endpoint && endpoint.consecutiveFailures >= outcome.threshold ? 'circuit_open' : undefined);
        if (endpoint && reason) {
          const result = await tx.webhookEndpoint.updateMany({ where: { id: endpointId, orgId, enabled: true }, data: { enabled: false, disabledReason: reason } });
          disabled = result.count === 1;
          if (disabled) endpoint = await tx.webhookEndpoint.findFirst({ where: { id: endpointId, orgId } });
        }
      }
      if (outcome.retryAt) await this.enqueue(tx, orgId, deliveryId, 'rerun', outcome.retryAt);
      return { endpoint, disabled };
    });
  }

  resetForRedelivery(orgId: string | null, id: string): Promise<WebhookDeliveryRow> {
    return this.run(orgId, async (tx) => {
      await tx.webhookDelivery.updateMany({
        where: { id, orgId },
        data: { status: 'pending', attempt: 0, responseStatus: null, responseSnippet: null, errorCode: null, durationMs: null, nextAttemptAt: null, deliveredAt: null },
      });
      await this.enqueue(tx, orgId, id, 'rerun', undefined);
      return (await tx.webhookDelivery.findFirst({ where: { id, orgId } })) as WebhookDeliveryRow;
    });
  }

  async purgeDeliveriesBefore(cutoff: Date): Promise<number> {
    let deleted = 0;
    for (let batch = 0; batch < WEBHOOK_PURGE_MAX_BATCHES; batch += 1) {
      const count = await this.system.runAsSystem(SYSTEM_RETENTION_REASON, async (tx) => {
        const rows = await tx.webhookDelivery.findMany({ where: { createdAt: { lt: cutoff } }, select: { id: true }, orderBy: { createdAt: 'asc' }, take: WEBHOOK_PURGE_BATCH });
        if (rows.length === 0) return 0;
        const result = await tx.webhookDelivery.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } });
        return result.count;
      });
      deleted += count;
      if (count < WEBHOOK_PURGE_BATCH) break;
    }
    return deleted;
  }
}

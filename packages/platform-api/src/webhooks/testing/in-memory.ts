// =============================================================================
// In-memory doubles of the webhooks slice's ports (issue #1046)
// =============================================================================
//
// The slice's logic (scope checks, fan-out, the owner re-check, the delivery
// state machine, the circuit breaker) lives in services over three ports: the
// data (`WebhooksRepository`), the signing secrets (`WebhookSecrets`) and the
// HTTP transport with its DNS resolver. These are in-memory implementations,
// plus a fake receiver, so a test (or the `webhooks` conformance suite) drives
// the real services with no database, no network and no Nest container.
// Never import this from production code.
// =============================================================================

import { randomUUID } from 'node:crypto';

import type { Job, JobsTx } from '../../jobs/index';
import type { WebhookDeliveryRow, WebhookEndpointRow, WebhookUserRow } from '../data/webhooks-db';
import type { HostResolver, ResolvedAddress } from '../egress/egress-guard';
import { WebhookTransportError, type WebhookTransport, type WebhookTransportRequest, type WebhookTransportResponse } from '../egress/transport';
import { WebhookSecrets, type SecretAddress, secretName } from '../webhook-secrets.service';
import {
  WebhooksRepository,
  type AttemptOutcome,
  type DeliveryPage,
  type DeliveryQuery,
  type LoadedDelivery,
  type EndpointFilter,
  type EndpointPatch,
  type NewDelivery,
  type NewEndpoint,
  type SettledAttempt,
} from '../webhooks.repository';

/** A job the in-memory repository "enqueued". @stability experimental */
export interface EnqueuedDeliveryJob {
  /** Delivery id. */
  readonly deliveryId: string;
  /** Org id. */
  readonly orgId: string | null;
  /** Reason. */
  readonly reason: 'upload' | 'rerun';
  /** Scheduled for. */
  readonly scheduledFor: Date | null;
}

/**
 * The data port in memory. Emulates the unique `(endpointId, eventId)` key, the
 * cascade on endpoint delete and the organization/owner pinning of every query.
 *
 * @stability experimental
 */
export class InMemoryWebhooksRepository extends WebhooksRepository {
  /** Endpoints by id. */
  readonly endpoints = new Map<string, WebhookEndpointRow>();
  /** Deliveries by id. */
  readonly deliveries = new Map<string, WebhookDeliveryRow>();
  /** Users by id, for the owner re-check; set with {@link InMemoryWebhooksRepository.setOwner}. */
  readonly owners = new Map<string, WebhookUserRow>();
  /** Every delivery job enqueued. */
  readonly enqueued: EnqueuedDeliveryJob[] = [];
  /** Clock. */
  now: () => Date = () => new Date();

  /** Sets what the owner re-check will see. */
  setOwner(user: WebhookUserRow): void {
    this.owners.set(user.id, user);
  }

  private matches(row: WebhookEndpointRow, orgId: string | null, filter: EndpointFilter): boolean {
    return row.orgId === orgId && row.scope === filter.scope && (filter.scope !== 'user' || filter.ownerUserId === undefined || row.ownerUserId === filter.ownerUserId);
  }

  async listEndpoints(orgId: string | null, filter: EndpointFilter): Promise<WebhookEndpointRow[]> {
    return [...this.endpoints.values()].filter((row) => this.matches(row, orgId, filter)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async findEndpoint(orgId: string | null, id: string, filter: EndpointFilter): Promise<WebhookEndpointRow | null> {
    const row = this.endpoints.get(id);
    return row && this.matches(row, orgId, filter) ? { ...row } : null;
  }

  async countEndpoints(orgId: string | null, filter: EndpointFilter): Promise<number> {
    return (await this.listEndpoints(orgId, filter)).length;
  }

  async createEndpoint(orgId: string | null, data: NewEndpoint): Promise<WebhookEndpointRow> {
    const now = this.now();
    const row: WebhookEndpointRow = {
      id: randomUUID(),
      orgId,
      scope: data.scope,
      ownerUserId: data.ownerUserId,
      createdById: data.createdById,
      name: data.name,
      description: data.description,
      url: data.url,
      eventKeys: [...data.eventKeys],
      enabled: data.enabled,
      secretVersion: 1,
      previousSecretUntil: null,
      consecutiveFailures: 0,
      disabledReason: null,
      lastDeliveryAt: null,
      lastSuccessAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.endpoints.set(row.id, row);
    return { ...row };
  }

  async updateEndpoint(orgId: string | null, id: string, patch: EndpointPatch): Promise<WebhookEndpointRow> {
    const row = this.endpoints.get(id);
    if (!row || row.orgId !== orgId) throw new Error('Webhook endpoint not found');
    Object.assign(row, patch, { updatedAt: this.now() });
    return { ...row };
  }

  async deleteEndpoint(orgId: string | null, id: string): Promise<void> {
    const row = this.endpoints.get(id);
    if (!row || row.orgId !== orgId) return;
    this.endpoints.delete(id);
    for (const [deliveryId, delivery] of this.deliveries) if (delivery.endpointId === id) this.deliveries.delete(deliveryId);
  }

  async enabledEndpoints(orgId: string | null, filter: EndpointFilter): Promise<WebhookEndpointRow[]> {
    return (await this.listEndpoints(orgId, filter)).filter((row) => row.enabled);
  }

  async disableEndpoint(orgId: string | null, id: string, reason: string): Promise<boolean> {
    const row = this.endpoints.get(id);
    if (!row || row.orgId !== orgId || !row.enabled) return false;
    row.enabled = false;
    row.disabledReason = reason;
    return true;
  }

  async loadOwner(_orgId: string | null, userId: string): Promise<WebhookUserRow | null> {
    return this.owners.get(userId) ?? null;
  }

  async insertDeliveries(orgId: string | null, rows: readonly NewDelivery[]): Promise<WebhookDeliveryRow[]> {
    const inserted: WebhookDeliveryRow[] = [];
    for (const row of rows) {
      const exists = [...this.deliveries.values()].some((delivery) => delivery.endpointId === row.endpointId && delivery.eventId === row.eventId);
      if (exists) continue;
      const delivery: WebhookDeliveryRow = {
        id: randomUUID(),
        orgId,
        endpointId: row.endpointId,
        eventKey: row.eventKey,
        eventId: row.eventId,
        payload: row.payload,
        status: 'pending',
        attempt: 0,
        responseStatus: null,
        responseSnippet: null,
        errorCode: null,
        durationMs: null,
        nextAttemptAt: null,
        deliveredAt: null,
        createdAt: this.now(),
      };
      this.deliveries.set(delivery.id, delivery);
      this.enqueued.push({ deliveryId: delivery.id, orgId, reason: 'upload', scheduledFor: null });
      inserted.push({ ...delivery });
    }
    return inserted;
  }

  async findDelivery(orgId: string | null, id: string, filter: EndpointFilter): Promise<WebhookDeliveryRow | null> {
    const delivery = this.deliveries.get(id);
    if (!delivery || delivery.orgId !== orgId) return null;
    const endpoint = this.endpoints.get(delivery.endpointId);
    return endpoint && this.matches(endpoint, orgId, filter) ? { ...delivery } : null;
  }

  async loadDeliveryForJob(orgId: string | null, id: string): Promise<LoadedDelivery | null> {
    const delivery = this.deliveries.get(id);
    if (!delivery || delivery.orgId !== orgId) return null;
    const endpoint = this.endpoints.get(delivery.endpointId);
    return { delivery: { ...delivery }, endpoint: endpoint && endpoint.orgId === orgId ? { ...endpoint } : null };
  }

  async listDeliveries(orgId: string | null, endpointId: string, query: DeliveryQuery): Promise<DeliveryPage> {
    const all = [...this.deliveries.values()]
      .filter((delivery) => delivery.orgId === orgId && delivery.endpointId === endpointId)
      .filter((delivery) => (query.status ? delivery.status === query.status : true))
      .filter((delivery) => (query.eventKey ? delivery.eventKey === query.eventKey : true))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return { items: all.slice((query.page - 1) * query.pageSize, query.page * query.pageSize).map((row) => ({ ...row })), total: all.length };
  }

  async markDelivering(orgId: string | null, id: string): Promise<WebhookDeliveryRow> {
    const delivery = this.deliveries.get(id);
    if (!delivery || delivery.orgId !== orgId) throw new Error('Webhook delivery not found');
    delivery.status = 'delivering';
    delivery.attempt += 1;
    delivery.nextAttemptAt = null;
    return { ...delivery };
  }

  async settleAttempt(orgId: string | null, deliveryId: string, endpointId: string, outcome: AttemptOutcome): Promise<SettledAttempt> {
    const delivery = this.deliveries.get(deliveryId);
    if (delivery && delivery.orgId === orgId) Object.assign(delivery, outcome.delivery);
    const endpoint = this.endpoints.get(endpointId);
    let disabled = false;
    if (endpoint && endpoint.orgId === orgId) {
      const now = this.now();
      if (outcome.endpoint === 'success') {
        endpoint.consecutiveFailures = 0;
        endpoint.lastDeliveryAt = now;
        endpoint.lastSuccessAt = now;
      } else if (outcome.endpoint === 'failure') {
        endpoint.consecutiveFailures += 1;
        endpoint.lastDeliveryAt = now;
        const reason = outcome.disableNow ?? (endpoint.consecutiveFailures >= outcome.threshold ? 'circuit_open' : undefined);
        if (reason && endpoint.enabled) {
          endpoint.enabled = false;
          endpoint.disabledReason = reason;
          disabled = true;
        }
      }
    }
    if (outcome.retryAt) this.enqueued.push({ deliveryId, orgId, reason: 'rerun', scheduledFor: outcome.retryAt });
    return { endpoint: endpoint && endpoint.orgId === orgId ? { ...endpoint } : null, disabled };
  }

  async resetForRedelivery(orgId: string | null, id: string): Promise<WebhookDeliveryRow> {
    const delivery = this.deliveries.get(id);
    if (!delivery || delivery.orgId !== orgId) throw new Error('Webhook delivery not found');
    Object.assign(delivery, { status: 'pending', attempt: 0, responseStatus: null, responseSnippet: null, errorCode: null, durationMs: null, nextAttemptAt: null, deliveredAt: null });
    this.enqueued.push({ deliveryId: id, orgId, reason: 'rerun', scheduledFor: null });
    return { ...delivery };
  }

  async purgeDeliveriesBefore(cutoff: Date): Promise<number> {
    let count = 0;
    for (const [id, delivery] of this.deliveries) {
      if (delivery.createdAt < cutoff) {
        this.deliveries.delete(id);
        count += 1;
      }
    }
    return count;
  }
}

/**
 * The signing-secret store in memory.
 *
 * @stability experimental
 */
export class InMemoryWebhookSecrets extends WebhookSecrets {
  /** `<scope>/<owner or org>/<name>` to secret. */
  readonly stored = new Map<string, string>();

  private key(endpoint: SecretAddress, version: number): string {
    return `${endpoint.scope}/${endpoint.ownerUserId ?? endpoint.orgId ?? 'system'}/${secretName(endpoint.id, version)}`;
  }

  async put(endpoint: SecretAddress, version: number, secret: string): Promise<void> {
    this.stored.set(this.key(endpoint, version), secret);
  }

  async get(endpoint: SecretAddress, version: number): Promise<string | null> {
    return this.stored.get(this.key(endpoint, version)) ?? null;
  }

  async remove(endpoint: SecretAddress, version: number): Promise<void> {
    this.stored.delete(this.key(endpoint, version));
  }

  async removeAll(endpoint: SecretAddress, upTo: number): Promise<void> {
    for (let version = 1; version <= upTo; version += 1) this.stored.delete(this.key(endpoint, version));
  }
}

/** One scripted answer of the fake receiver. @stability experimental */
export type FakeReceiverAnswer = FakeReceiverResponse | FakeReceiverFailure;

/** The receiver answers with an HTTP status. @stability experimental */
export interface FakeReceiverResponse {
  /** The status. */
  readonly status: number;
  /** The `Retry-After` header, raw. */
  readonly retryAfter?: string;
  /** The body kept as the snippet. */
  readonly snippet?: string;
}

/** The request fails before an answer. @stability experimental */
export interface FakeReceiverFailure {
  /** `timeout` or `network`. */
  readonly fail: 'timeout' | 'network';
}

/**
 * A fake receiver: records every request and answers from a script (the last
 * answer repeats; the default is `200 ok`).
 *
 * @stability experimental
 */
export class FakeWebhookReceiver implements WebhookTransport {
  /** Every request received. */
  readonly requests: WebhookTransportRequest[] = [];
  private script: FakeReceiverAnswer[] = [];

  /** Sets the answers, in order. */
  answerWith(...answers: FakeReceiverAnswer[]): this {
    this.script = [...answers];
    return this;
  }

  async send(request: WebhookTransportRequest): Promise<WebhookTransportResponse> {
    this.requests.push(request);
    const answer = (this.script.length > 1 ? this.script.shift() : this.script[0]) ?? { status: 200, snippet: 'ok' };
    if ('fail' in answer) throw new WebhookTransportError(answer.fail, 'scripted failure');
    return { status: answer.status, retryAfter: answer.retryAfter ?? null, snippet: answer.snippet ?? '' };
  }
}

/**
 * A DNS resolver whose answers a test scripts per host name (and changes
 * between calls, to model DNS rebinding).
 *
 * @stability experimental
 */
export class ScriptedHostResolver implements HostResolver {
  private readonly answers = new Map<string, ResolvedAddress[]>();
  /** Every name resolved, in order. */
  readonly lookups: string[] = [];

  /** Sets the addresses of `hostname`; an empty list means "does not resolve". */
  set(hostname: string, ...addresses: string[]): this {
    this.answers.set(hostname.toLowerCase(), addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })));
    return this;
  }

  async resolveAll(hostname: string): Promise<ResolvedAddress[]> {
    this.lookups.push(hostname);
    const answer = this.answers.get(hostname.toLowerCase());
    if (!answer || answer.length === 0) throw new Error('ENOTFOUND');
    return answer;
  }
}

/** What {@link RecordingJobs} keeps of an enqueue. @stability experimental */
export interface RecordedJob {
  /** The job type. */
  type: string;
  /** The subject id. */
  subjectId?: string | null;
  /** The organization. */
  orgId?: string | null;
  /** The payload. */
  payload?: unknown;
}

/** One `notifyNow` call the kit recorded. @stability experimental */
export interface RecordedNotification {
  /** The notification event key. */
  eventKey: string;
  /** The recipient. */
  userId: string;
  /** The event data. */
  data: unknown;
}

/** A fake `JobsService` that records what it was asked to enqueue. @stability experimental */
export class RecordingJobs {
  /** Every `enqueue` input. */
  readonly enqueued: RecordedJob[] = [];
  /** Every `enqueueWithin` input. */
  readonly enqueuedWithin: RecordedJob[] = [];

  /** Records the input. */
  async enqueue(input: RecordedJob): Promise<Job> {
    this.enqueued.push(input);
    return { id: randomUUID(), ...input } as unknown as Job;
  }

  /** Records the input. */
  async enqueueWithin(_tx: JobsTx, input: RecordedJob): Promise<Job> {
    this.enqueuedWithin.push(input);
    return { id: randomUUID(), ...input } as unknown as Job;
  }
}

/** Builds a user with the given permissions, as `loadOwner` returns it. @stability experimental */
export function makeWebhookOwner(input: {
  id: string;
  /** The permissions of the organization role (and none of the system roles). */
  permissions: readonly string[];
  /** The organization the membership is in; omit for a system-only user. */
  orgId?: string;
  /** System-role permissions (an administrator). */
  systemPermissions?: readonly string[];
  isActive?: boolean;
}): WebhookUserRow {
  const grants = (names: readonly string[]) => names.map((name) => ({ permission: { name } }));
  return {
    id: input.id,
    email: `${input.id}@example.test`,
    isActive: input.isActive ?? true,
    userRoles: input.systemPermissions ? [{ role: { name: 'admin', rolePermissions: grants(input.systemPermissions) } }] : [],
    memberships: input.orgId
      ? [{ orgId: input.orgId, status: 'active', lastActiveAt: null, org: { id: input.orgId, isDefault: true }, role: { name: 'member', rolePermissions: grants(input.permissions) } }]
      : [],
  };
}

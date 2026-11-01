// =============================================================================
// `webhooks.deliver`: one delivery attempt (issue #1046)
// =============================================================================
//
// The ONLY place the slice makes an outbound HTTP request. One job is one
// attempt of one delivery; a failed attempt that has retries left enqueues the
// next attempt's job itself (scheduled for the backoff time), in the same
// transaction as the delivery row's update, so the retry schedule is the
// slice's (30s, 2m, 10m, 30m, 1h, 2h, 4h, 6h, 6h; jittered; `Retry-After`
// honoured up to 24h) and not the queue's generic one. A job that throws (the
// database) is retried by the queue as usual.
//
// PER ATTEMPT:
//   1. load the delivery and its endpoint (`runInOrg` for an organization's
//      rows, the bypass client with reason `webhooks` for a system endpoint);
//      a gone delivery ends the job quietly, a disabled or gone endpoint
//      settles the delivery `dead`;
//   2. read the signing secret(s) from the credentials store;
//   3. run the egress guard (resolve EVERY address, refuse any non-public one,
//      pin the checked address for the connection): a refusal is `ssrf_blocked`
//      and final;
//   4. POST the stored body, signed (two signatures during a rotation overlap),
//      10 s deadline, no redirects, 1 KiB of the answer kept;
//   5. settle: 2xx succeeded; 410 switches the endpoint off at once; anything
//      else is a failed attempt (retry while attempts remain, else `dead`) that
//      counts toward the endpoint's circuit breaker; at the threshold the
//      endpoint is switched off and its owner is notified (after the commit).
//
// SERVER-ONLY: the job needs the signing secret, so it declares neither
// `nodeResultSchema` nor `persistNodeResult`, and no secret is ever brokered to a
// node. Nothing secret or URL-shaped is logged: a log line carries the delivery
// id, the host, the status and a code.
// =============================================================================

import { Inject, Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { WEBHOOK_HEADERS } from '@marinoscar/platform-contract/webhooks';

import { JobHandlerRegistry, type Job, type JobExecutionProfile, type JobHandler } from '../../jobs/index';
import { NotificationsService } from '../../notifications/index';
import { MetricsHostService } from '../../otel-core/index';
import type { WebhookEndpointRow } from '../data/webhooks-db';
import { WebhookEgressError, hostForLog, resolveWebhookTarget, type HostResolver, type WebhookEgressPolicy } from '../egress/egress-guard';
import { WEBHOOKS_RESOLVER, WEBHOOKS_TRANSPORT, WebhookTransportError, type WebhookTransport } from '../egress/transport';
import { WEBHOOK_PING_EVENT_KEY } from '../registry/builtin-events';
import { signedHeaders } from '../signing';
import { eventGroupOf } from '../webhook-envelope';
import { WebhookSecrets } from '../webhook-secrets.service';
import {
  WEBHOOK_DELIVER_JOB_TYPE,
  WEBHOOK_DISABLED_REASONS,
  WEBHOOK_ENDPOINT_DISABLED_EVENT_KEY,
  WEBHOOK_RETRY_AFTER_CAP_MS,
  WEBHOOK_RETRY_SCHEDULE_MS,
} from '../webhooks.constants';
import { WEBHOOK_DELIVERIES_METRIC, WEBHOOK_DELIVERY_DURATION_METRIC } from '../webhooks.metrics';
import { WEBHOOKS_OPTIONS, type ResolvedWebhooksModuleOptions } from '../webhooks.options';
import { WebhooksRepository, type AttemptOutcome } from '../webhooks.repository';

/**
 * The delay before the retry that follows failed attempt number `attempt`.
 *
 * @param attempt - the attempt that just failed (1-based).
 * @param retryAfterMs - the receiver's `Retry-After`, when it sent one.
 * @param rand - a random source in [0, 1), for tests.
 * @returns milliseconds: the schedule entry with half-range jitter, never less than `Retry-After` (capped at 24 h).
 *
 * @stability experimental
 */
export function retryDelayMs(attempt: number, retryAfterMs: number | null = null, rand: () => number = Math.random): number {
  const index = Math.min(Math.max(1, Math.floor(attempt)), WEBHOOK_RETRY_SCHEDULE_MS.length) - 1;
  const base = WEBHOOK_RETRY_SCHEDULE_MS[index] as number;
  const jittered = base / 2 + rand() * (base / 2);
  const floor = retryAfterMs === null ? 0 : Math.min(retryAfterMs, WEBHOOK_RETRY_AFTER_CAP_MS);
  return Math.round(Math.max(floor, jittered));
}

/**
 * Parses a `Retry-After` header: delta-seconds or an HTTP date.
 *
 * @param value - the raw header.
 * @param now - the current time in ms.
 * @returns milliseconds to wait, or `null` when absent or malformed.
 *
 * @stability experimental
 */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const at = Date.parse(trimmed);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/**
 * The `webhooks.deliver` job. See the file header.
 *
 * @stability experimental
 */
@Injectable()
export class WebhookDeliverHandler implements JobHandler, OnModuleInit {
  private readonly logger = new Logger(WebhookDeliverHandler.name);

  /** PERMANENT once jobs of this type exist. */
  readonly type = WEBHOOK_DELIVER_JOB_TYPE;

  /** Its name in the jobs console. */
  readonly label = 'Webhook delivery';

  /** 30 s per run (the request has 10 s); a failed attempt schedules its own retry, so the queue's attempts only cover infrastructure failures. */
  readonly profile: JobExecutionProfile = { maxRuntimeMs: 30_000, maxAttempts: 10 };

  /** Overridable clock, for tests. */
  now: () => Date = () => new Date();

  /** Overridable random source, for tests. */
  rand: () => number = Math.random;

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly repository: WebhooksRepository,
    private readonly secrets: WebhookSecrets,
    @Inject(WEBHOOKS_OPTIONS) private readonly options: ResolvedWebhooksModuleOptions,
    @Inject(WEBHOOKS_TRANSPORT) private readonly transport: WebhookTransport,
    @Inject(WEBHOOKS_RESOLVER) private readonly resolver: HostResolver,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly metrics?: MetricsHostService,
  ) {}

  /** Registers the handler with the job registry. */
  onModuleInit(): void {
    this.registry.register(this);
  }

  /**
   * Runs one attempt.
   *
   * @param job - the claimed job; `subjectId` is the delivery id and `orgId` its organization (`null`: a system endpoint).
   */
  async process(job: Job): Promise<void> {
    const deliveryId = job.subjectId;
    if (!deliveryId) throw new Error(`Job ${job.id} names no delivery`);
    const orgId = job.orgId ?? null;

    const loaded = await this.repository.loadDeliveryForJob(orgId, deliveryId);
    if (!loaded) {
      this.logger.debug(`Delivery ${deliveryId} no longer exists; nothing to do`);
      return;
    }
    const { delivery, endpoint } = loaded;
    if (delivery.status === 'succeeded') return;

    const isPing = delivery.eventKey === WEBHOOK_PING_EVENT_KEY;
    if (!endpoint || (!endpoint.enabled && !isPing)) {
      await this.repository.settleAttempt(orgId, deliveryId, delivery.endpointId, {
        delivery: { status: 'dead', errorCode: endpoint ? 'endpoint_disabled' : 'endpoint_gone', nextAttemptAt: null },
        endpoint: 'neutral',
        threshold: this.options.circuitBreakerThreshold,
      });
      this.count('dead', delivery.eventKey, 0);
      return;
    }

    const marked = await this.repository.markDelivering(orgId, deliveryId);
    const attempt = marked.attempt;
    const span = trace.getTracer('webhooks').startSpan('webhooks.deliver', {
      attributes: { 'webhook.endpoint.id': endpoint.id, 'webhook.event.type': delivery.eventKey, 'webhook.attempt': attempt },
    });
    const started = Date.now();
    try {
      const outcome = await this.attempt(endpoint, delivery.eventId, delivery.payload, attempt, span);
      const durationMs = Date.now() - started;
      const settled = await this.repository.settleAttempt(orgId, deliveryId, endpoint.id, { ...outcome.settle, delivery: { ...outcome.settle.delivery, durationMs } });
      this.count(outcome.metric, delivery.eventKey, durationMs);
      this.logger.log(
        `Webhook delivery ${deliveryId} attempt ${attempt}: ${outcome.metric}` +
          `${outcome.status ? ` (HTTP ${outcome.status})` : ''}${outcome.code ? ` [${outcome.code}]` : ''} -> ${hostForLog(endpoint.url)}`,
      );
      if (settled.disabled && settled.endpoint) await this.tellOwner(settled.endpoint, outcome.settle.disableNow ?? WEBHOOK_DISABLED_REASONS.CIRCUIT_OPEN);
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  }

  private async attempt(
    endpoint: WebhookEndpointRow,
    eventId: string,
    payload: unknown,
    attempt: number,
    span: ReturnType<ReturnType<typeof trace.getTracer>['startSpan']>,
  ): Promise<{ settle: AttemptOutcome; metric: 'succeeded' | 'failed' | 'dead' | 'blocked'; status?: number; code?: string }> {
    const threshold = this.options.circuitBreakerThreshold;
    const dead = (code: string, metric: 'dead' | 'blocked' = 'dead', disableNow?: string) => ({
      settle: { delivery: { status: 'dead' as const, attempt, errorCode: code, nextAttemptAt: null }, endpoint: 'failure' as const, threshold, ...(disableNow ? { disableNow } : {}) },
      metric,
      code,
    });

    const secrets = await this.signingSecrets(endpoint);
    if (secrets.length === 0) return dead('secret_missing');

    let target;
    try {
      target = await resolveWebhookTarget(endpoint.url, this.policy(), this.resolver);
    } catch (error) {
      if (error instanceof WebhookEgressError && error.code !== 'unresolvable') return dead('ssrf_blocked', 'blocked');
      return this.failed(attempt, 'network', null, null, null, null);
    }

    const body = JSON.stringify(payload);
    const timestamp = Math.floor(this.now().getTime() / 1000);
    const headers = await signedHeaders({
      id: eventId,
      timestamp,
      body,
      secrets,
      userAgent: `${this.options.appName()}-Webhooks/1.0`,
    });

    let response;
    try {
      response = await this.transport.send({ target, headers, body, timeoutMs: this.options.requestTimeoutMs });
    } catch (error) {
      const code = error instanceof WebhookTransportError ? error.code : 'network';
      return this.failed(attempt, code, null, null, null, null);
    }
    span.setAttribute('http.response.status_code', response.status);

    if (response.status >= 200 && response.status < 300) {
      return {
        settle: {
          delivery: { status: 'succeeded', attempt, responseStatus: response.status, responseSnippet: response.snippet, errorCode: null, deliveredAt: this.now(), nextAttemptAt: null },
          endpoint: 'success',
          threshold,
        },
        metric: 'succeeded',
        status: response.status,
      };
    }
    if (response.status === 410) {
      return {
        settle: {
          delivery: { status: 'dead', attempt, responseStatus: response.status, responseSnippet: response.snippet, errorCode: 'http_410', nextAttemptAt: null },
          endpoint: 'failure',
          threshold,
          disableNow: WEBHOOK_DISABLED_REASONS.GONE,
        },
        metric: 'dead',
        status: response.status,
        code: 'http_410',
      };
    }
    const code = response.status >= 500 ? 'http_5xx' : response.status >= 400 ? 'http_4xx' : 'http_3xx';
    return this.failed(attempt, code, response.status, response.snippet, parseRetryAfter(response.retryAfter, this.now().getTime()), response.status);
  }

  private failed(
    attempt: number,
    code: string,
    responseStatus: number | null,
    snippet: string | null,
    retryAfterMs: number | null,
    status: number | null,
  ): { settle: AttemptOutcome; metric: 'failed' | 'dead'; status?: number; code: string } {
    const exhausted = attempt >= this.options.maxDeliveryAttempts;
    const delay = retryDelayMs(attempt, retryAfterMs, this.rand);
    const retryAt = new Date(this.now().getTime() + delay);
    return {
      settle: {
        delivery: {
          status: exhausted ? 'dead' : 'failed',
          attempt,
          responseStatus,
          responseSnippet: snippet,
          errorCode: code,
          nextAttemptAt: exhausted ? null : retryAt,
        },
        endpoint: 'failure',
        threshold: this.options.circuitBreakerThreshold,
        ...(exhausted ? {} : { retryAt }),
      },
      metric: exhausted ? 'dead' : 'failed',
      ...(status !== null ? { status } : {}),
      code,
    };
  }

  /** The current secret first, then the previous one while the rotation overlap lasts. */
  private async signingSecrets(endpoint: WebhookEndpointRow): Promise<string[]> {
    const secrets: string[] = [];
    const current = await this.secrets.get(endpoint, endpoint.secretVersion);
    if (current) secrets.push(current);
    const overlap = endpoint.previousSecretUntil && endpoint.previousSecretUntil.getTime() > this.now().getTime();
    if (overlap && endpoint.secretVersion > 1) {
      const previous = await this.secrets.get(endpoint, endpoint.secretVersion - 1);
      if (previous) secrets.push(previous);
    }
    return secrets;
  }

  private policy(): WebhookEgressPolicy {
    return { allowInsecureHttp: this.options.allowInsecureHttp, allowPrivateTargets: this.options.allowPrivateTargets, allowedHosts: this.options.allowedHosts };
  }

  private count(outcome: 'succeeded' | 'failed' | 'dead' | 'blocked', eventKey: string, durationMs: number): void {
    const attributes = { outcome, event_group: eventGroupOf(eventKey) };
    this.metrics?.add(WEBHOOK_DELIVERIES_METRIC, 1, attributes);
    if (durationMs > 0) this.metrics?.record(WEBHOOK_DELIVERY_DURATION_METRIC, durationMs / 1000, attributes);
  }

  /** After the commit, outside any transaction. */
  private async tellOwner(endpoint: WebhookEndpointRow, reason: string): Promise<void> {
    const ownerId = endpoint.ownerUserId ?? endpoint.createdById;
    if (!ownerId || !this.notifications) return;
    try {
      await this.notifications.notifyNow(
        WEBHOOK_ENDPOINT_DISABLED_EVENT_KEY,
        ownerId,
        { endpointId: endpoint.id, endpointName: endpoint.name, scope: endpoint.scope, reason, host: hostForLog(endpoint.url) },
        endpoint.orgId ? { orgId: endpoint.orgId } : undefined,
      );
    } catch (error) {
      this.logger.warn(`Could not notify the owner of webhook endpoint ${endpoint.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/** The `webhook-*` header names a delivery carries, for the docs and the testing entry. @stability experimental */
export const WEBHOOK_REQUEST_HEADER_NAMES = Object.freeze([WEBHOOK_HEADERS.ID, WEBHOOK_HEADERS.TIMESTAMP, WEBHOOK_HEADERS.SIGNATURE, 'content-type', 'user-agent']);



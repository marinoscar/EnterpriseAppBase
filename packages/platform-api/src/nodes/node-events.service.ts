// =============================================================================
// Node events: ingestion and reads (issue #1045)
// =============================================================================
//
// A heartbeat may carry `events[]` the node observed about itself (power source
// changed, battery low, woke from sleep, disk low). This service is the one
// place they are turned into rows, metrics, a span and a domain event.
//
// ORDER, AND WHY
//
//   1. RATE CAP (per node, in memory): at most `NODE_EVENTS_PER_HOUR` accepted
//      events per node per hour. A node in a flapping loop (or a stolen
//      credential used as a firehose) cannot grow the table without bound;
//      the excess is DROPPED AND COUNTED, never an error, because a heartbeat
//      carries liveness and must not fail over its events. In memory and per
//      replica for the reason `NodeTelemetryRateLimiter` gives.
//   2. CLAMP: `occurredAt` is the node's clock. A value outside
//      `[now - 24h, now + 5m]` (a wrong clock, a replayed queue) is replaced
//      by the server's `receivedAt`, so a timeline never shows next year.
//   3. WRITE: one `createMany`.
//   4. AFTER THE WRITE, outside any transaction: the `app.nodes.events`
//      counter, a short `node.event` span, and one `NODE_EVENT_REPORTED` domain
//      event per row. All three are observers and never throw.
//
// ⚠ NOTHING HERE MAY FAIL THE HEARTBEAT. `ingest` swallows its own errors
// (logged): a node whose heartbeats fail goes stale and is swept offline, a
// far worse outcome than a missing power event.
//
// SPAN ATTRIBUTES ARE BOUNDED: `node.id`, `node.name`, `node.event.type` (a
// known type, else `other`) and `node.event.severity`. The free-form `attrs`
// never reach a span or a metric label; they are stored and displayed only.
// =============================================================================

import { Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SpanKind, trace } from '@opentelemetry/api';
import type { AdminNodeEvent, AdminNodeEventList, NodeEvent, NodeEventListQuery } from '@marinoscar/platform-contract/nodes';

import { PLATFORM_PRISMA } from '../core/index';
import { type JobsInputJsonValue, type JobsPrisma, type WorkerNode } from '../jobs/index';
import { MetricsHostService, resolveServiceName } from '../otel-core/index';
import { NODE_EVENT_REPORTED, NodeEventReportedEvent } from './events/node-event.event';
import { NODE_EVENT_METRIC_TYPES } from './nodes.metrics';

/**
 * Accepted events per node per hour; the excess is dropped and counted.
 *
 * @stability experimental
 */
export const NODE_EVENTS_PER_HOUR = 120;

/**
 * An `occurredAt` older than this (relative to receipt) is replaced by the receipt time.
 *
 * @stability experimental
 */
export const NODE_EVENT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * An `occurredAt` further in the future than this is replaced by the receipt time.
 *
 * @stability experimental
 */
export const NODE_EVENT_MAX_FUTURE_MS = 5 * 60 * 1000;

/** Default page size of the events list. */
export const NODE_EVENTS_DEFAULT_PAGE_SIZE = 20;

/** Largest page size of the events list. */
export const NODE_EVENTS_MAX_PAGE_SIZE = 100;

/** Cap on tracked nodes in the in-memory limiter. */
const MAX_BUCKETS = 10_000;

interface Bucket {
  tokens: number;
  updatedAtMs: number;
}

/**
 * A per-node token bucket: `NODE_EVENTS_PER_HOUR` capacity, refilled evenly
 * over the hour. In memory and per replica, on purpose (see the header).
 *
 * @stability experimental
 */
export class NodeEventRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  /**
   * Takes up to `wanted` tokens for `nodeId` and returns how many it granted.
   *
   * @param nodeId - the node (proven owned by the caller before this is asked).
   * @param wanted - how many events the heartbeat carried.
   * @param nowMs - the clock, injectable for tests.
   */
  take(nodeId: string, wanted: number, nowMs: number = Date.now()): number {
    let bucket = this.buckets.get(nodeId);
    if (bucket === undefined) {
      if (this.buckets.size >= MAX_BUCKETS) this.evict(nowMs);
      bucket = { tokens: NODE_EVENTS_PER_HOUR, updatedAtMs: nowMs };
      this.buckets.set(nodeId, bucket);
    } else {
      const elapsed = Math.max(0, nowMs - bucket.updatedAtMs);
      bucket.tokens = Math.min(NODE_EVENTS_PER_HOUR, bucket.tokens + (elapsed * NODE_EVENTS_PER_HOUR) / 3_600_000);
      bucket.updatedAtMs = nowMs;
    }
    const granted = Math.min(wanted, Math.floor(bucket.tokens));
    bucket.tokens -= granted;
    return granted;
  }

  /** Forgets full (idle) buckets first; a fresh bucket starts full, so nothing is lost. */
  private evict(nowMs: number): void {
    for (const [id, bucket] of this.buckets) {
      const elapsed = Math.max(0, nowMs - bucket.updatedAtMs);
      if (bucket.tokens + (elapsed * NODE_EVENTS_PER_HOUR) / 3_600_000 >= NODE_EVENTS_PER_HOUR) this.buckets.delete(id);
    }
    if (this.buckets.size >= MAX_BUCKETS) this.buckets.clear();
  }
}

/**
 * What one ingestion did.
 *
 * @stability experimental
 */
export interface NodeEventIngestOutcome {
  /** Rows written. */
  accepted: number;
  /** Events dropped by the per-node rate cap. */
  dropped: number;
}

/** `occurredAt` after the clamp (see the header). */
export function clampOccurredAt(at: string, receivedAt: Date): Date {
  const parsed = new Date(at);
  const ms = parsed.getTime();
  if (Number.isNaN(ms)) return receivedAt;
  const now = receivedAt.getTime();
  if (ms < now - NODE_EVENT_MAX_AGE_MS || ms > now + NODE_EVENT_MAX_FUTURE_MS) return receivedAt;
  return parsed;
}

/**
 * Records the events a heartbeat carries and serves the per-node event log:
 * the rate cap, the clamp, the write, then the metric, span, log line and
 * `nodes.node.event` domain event. `ingest` never throws.
 *
 * @stability experimental
 */
@Injectable()
export class NodeEventsService {
  private readonly logger = new Logger(NodeEventsService.name);
  private readonly limiter = new NodeEventRateLimiter();
  private readonly metrics: MetricsHostService;

  constructor(
    @Inject(PLATFORM_PRISMA) private readonly prisma: JobsPrisma,
    // `EventEmitterModule.forRoot()` is global in the app; absent in a hand-built test.
    @Optional() private readonly events?: EventEmitter2,
    @Optional() metrics?: MetricsHostService,
  ) {
    this.metrics = metrics ?? new MetricsHostService();
  }

  /**
   * Persists the events a heartbeat carried and announces them. NEVER THROWS.
   *
   * @param node - the node row the heartbeat was proven to belong to.
   * @param events - the validated `events` of the heartbeat body.
   */
  async ingest(node: Pick<WorkerNode, 'id' | 'name' | 'createdById'>, events: readonly NodeEvent[] | undefined): Promise<NodeEventIngestOutcome> {
    if (events === undefined || events.length === 0) return { accepted: 0, dropped: 0 };

    try {
      const receivedAt = new Date();
      const granted = this.limiter.take(node.id, events.length, receivedAt.getTime());
      const accepted = events.slice(0, granted);
      const dropped = events.length - accepted.length;
      if (dropped > 0) {
        this.logger.warn(`Node ${node.id}: dropped ${dropped} event(s) over the ${NODE_EVENTS_PER_HOUR}/hour cap`);
      }
      if (accepted.length === 0) return { accepted: 0, dropped };

      const rows = accepted.map((event) => ({
        nodeId: node.id,
        type: event.type,
        severity: event.severity,
        attrs: event.attrs === undefined ? null : (event.attrs as JobsInputJsonValue),
        occurredAt: clampOccurredAt(event.at, receivedAt),
        receivedAt,
      }));

      await this.prisma.workerNodeEvent.createMany({ data: rows });

      // After the write, outside any transaction: observers only.
      for (const row of rows) this.announce(node, row);

      return { accepted: rows.length, dropped };
    } catch (error) {
      this.logger.warn(`Node ${node.id}: could not record ${events.length} event(s): ${error instanceof Error ? error.message : String(error)}`);
      return { accepted: 0, dropped: 0 };
    }
  }

  private announce(
    node: Pick<WorkerNode, 'id' | 'name' | 'createdById'>,
    row: { type: string; severity: string; attrs: JobsInputJsonValue | null; occurredAt: Date },
  ): void {
    const severity = row.severity as 'info' | 'warning' | 'critical';
    const knownType = NODE_EVENT_METRIC_TYPES.includes(row.type) ? row.type : 'other';

    this.metrics.add('nodesEvents', 1, { type: knownType, severity });

    // A structured log line: with log shipping on, this is the OTel log record
    // the dashboard's events feed reads. Bounded fields only, never `attrs`.
    const line = `Node event ${knownType === 'other' ? 'other' : row.type} (${severity}) from node ${node.id}`;
    if (severity === 'info') this.logger.log(line);
    else this.logger.warn(line);

    try {
      const span = trace.getTracer(resolveServiceName()).startSpan('node.event', {
        kind: SpanKind.INTERNAL,
        attributes: {
          'node.id': node.id,
          'node.name': node.name,
          'node.event.type': knownType,
          'node.event.severity': severity,
          'telemetry.relay': 'node',
        },
      });
      span.end();
    } catch {
      // Tracing is an observer.
    }

    try {
      this.events?.emit(
        NODE_EVENT_REPORTED,
        new NodeEventReportedEvent(
          node.id,
          node.name,
          node.createdById ?? null,
          row.type,
          severity,
          (row.attrs ?? {}) as Record<string, string | number | boolean>,
          row.occurredAt,
        ),
      );
    } catch (error) {
      this.logger.debug(`A ${NODE_EVENT_REPORTED} listener threw: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * One page of a node's events, newest first. The caller has already proven
   * access to the node; `nodeId` not existing is a 404 here as a backstop.
   */
  async list(nodeId: string, query: NodeEventListQuery): Promise<AdminNodeEventList> {
    const exists = await this.prisma.workerNode.findUnique({ where: { id: nodeId }, select: { id: true } });
    if (!exists) throw new NotFoundException(`Worker node ${nodeId} not found`);

    const where = {
      nodeId,
      ...(query.type !== undefined ? { type: query.type } : {}),
      ...(query.severity !== undefined ? { severity: query.severity } : {}),
    };
    const pageSize = Math.min(Math.max(1, query.pageSize), NODE_EVENTS_MAX_PAGE_SIZE);
    const page = Math.max(1, query.page);

    const [total, rows] = await Promise.all([
      this.prisma.workerNodeEvent.count({ where }),
      this.prisma.workerNodeEvent.findMany({
        where,
        orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const items: AdminNodeEvent[] = rows.map((row) => ({
      id: row.id,
      nodeId: row.nodeId,
      type: row.type,
      severity: row.severity as AdminNodeEvent['severity'],
      attrs: (row.attrs ?? {}) as AdminNodeEvent['attrs'],
      occurredAt: row.occurredAt.toISOString(),
      receivedAt: row.receivedAt.toISOString(),
    }));

    return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }
}

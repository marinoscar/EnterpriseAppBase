// =============================================================================
// The platform's own webhook events (issue #1046)
// =============================================================================
//
// `webhooks.ping` (the test route), the two node events and the permanent job
// failure. The notification bridge (`notification.<eventKey>`) is not
// registered one by one: it is derived from the notifications registry when the
// catalog is read (`./webhook-catalog.ts`). The alerts slice registers its own
// two events (`alerts.alert.fired`, `alerts.alert.resolved`) from its module.
// =============================================================================

import { z } from 'zod';

import { WEBHOOK_PERMISSIONS } from '@marinoscar/platform-contract/webhooks';

import { registerWebhookEvent, type WebhookEventDef } from './webhook-event.registry';

/** The key of the test event; sent only by the `.../test` route, never subscribable. @stability experimental */
export const WEBHOOK_PING_EVENT_KEY = 'webhooks.ping';
/** The key of the node-offline event. @stability experimental */
export const NODE_OFFLINE_WEBHOOK_EVENT_KEY = 'nodes.node.offline';
/** The key of the node-reported-event event. @stability experimental */
export const NODE_EVENT_WEBHOOK_EVENT_KEY = 'nodes.node.event';
/** The key of the permanent-job-failure event. @stability experimental */
export const JOB_FAILED_WEBHOOK_EVENT_KEY = 'jobs.job.failed';

const iso = z.string();

/** `data` of `webhooks.ping`. @stability experimental */
export const webhookPingDataSchema = z.object({ message: z.string(), endpointId: z.string() });
/** `data` of `nodes.node.offline`. @stability experimental */
export const nodeOfflineDataSchema = z.object({
  nodeId: z.string(),
  nodeName: z.string(),
  lastHeartbeatAt: iso.nullable(),
  markedOfflineAt: iso,
  staleAfterMinutes: z.number(),
});
/** `data` of `nodes.node.event`. @stability experimental */
export const nodeEventDataSchema = z.object({
  nodeId: z.string(),
  nodeName: z.string(),
  type: z.string(),
  severity: z.enum(['info', 'warning', 'critical']),
  attrs: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  occurredAt: iso,
});
/** `data` of `jobs.job.failed`. @stability experimental */
export const jobFailedDataSchema = z.object({
  jobId: z.string(),
  type: z.string(),
  subjectType: z.string().nullable(),
  subjectId: z.string().nullable(),
  orgId: z.string().nullable(),
  attempts: z.number().int(),
  lastError: z.string().nullable(),
  finishedAt: iso.nullable(),
});

/** The platform's events, in registration order. @stability experimental */
export const BUILTIN_WEBHOOK_EVENTS: readonly WebhookEventDef[] = Object.freeze([
  {
    key: WEBHOOK_PING_EVENT_KEY,
    label: 'Test ping',
    description: 'Sent by the Test button of an endpoint to check that the receiver answers and verifies the signature.',
    group: 'Webhooks',
    audience: 'user',
    payloadSchema: webhookPingDataSchema,
    example: { message: 'This is a test delivery.', endpointId: '00000000-0000-4000-8000-000000000000' },
    source: 'platform',
  },
  {
    key: NODE_OFFLINE_WEBHOOK_EVENT_KEY,
    label: 'Worker node offline',
    description: 'A worker node stopped heartbeating and was marked offline.',
    group: 'Nodes',
    audience: 'system',
    permission: WEBHOOK_PERMISSIONS.SYSTEM_READ,
    payloadSchema: nodeOfflineDataSchema,
    example: { nodeId: 'node-1', nodeName: 'builder-1', lastHeartbeatAt: '2026-11-01T10:00:00.000Z', markedOfflineAt: '2026-11-01T10:05:00.000Z', staleAfterMinutes: 5 },
    source: 'platform',
  },
  {
    key: NODE_EVENT_WEBHOOK_EVENT_KEY,
    label: 'Worker node event',
    description: 'A worker node reported an event (power, sleep, low disk).',
    group: 'Nodes',
    audience: 'system',
    permission: WEBHOOK_PERMISSIONS.SYSTEM_READ,
    payloadSchema: nodeEventDataSchema,
    example: { nodeId: 'node-1', nodeName: 'builder-1', type: 'disk.low', severity: 'warning', attrs: { freeGb: 3 }, occurredAt: '2026-11-01T10:00:00.000Z' },
    source: 'platform',
  },
  {
    key: JOB_FAILED_WEBHOOK_EVENT_KEY,
    label: 'Job failed',
    description: 'A background job failed for good: it used its last attempt.',
    group: 'Jobs',
    audience: 'system',
    permission: WEBHOOK_PERMISSIONS.SYSTEM_READ,
    payloadSchema: jobFailedDataSchema,
    example: { jobId: 'job-1', type: 'example.task', subjectType: null, subjectId: null, orgId: null, attempts: 3, lastError: 'Connection refused', finishedAt: '2026-11-01T10:00:00.000Z' },
    source: 'platform',
  },
] satisfies WebhookEventDef[]);

/**
 * Registers the platform's events. Idempotent. Called by
 * `WebhooksModule.forRoot()`.
 *
 * @stability experimental
 */
export function registerBuiltinWebhookEvents(): void {
  for (const event of BUILTIN_WEBHOOK_EVENTS) registerWebhookEvent(event);
}

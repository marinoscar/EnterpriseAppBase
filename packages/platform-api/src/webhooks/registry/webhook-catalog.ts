// =============================================================================
// The event catalog a caller sees, and event resolution (issue #1046)
// =============================================================================
//
// Registered events (`registerWebhookEvent`) plus the notification bridge: every
// event of the notifications registry that declares the `webhook` channel is
// subscribable by a member as
// `notification.<eventKey>` (audience `user`), with a fixed payload shape. Read
// fresh each time (the notifications registry is filled by the app's manifest).
// =============================================================================

import { z } from 'zod';
import type { WebhookEventCatalogEntry, WebhookScope } from '@marinoscar/platform-contract/webhooks';

import { notificationEventRegistry } from '../../notifications/index';
import { WEBHOOK_NOTIFICATION_CHANNEL_ID, WEBHOOK_NOTIFICATION_EVENT_PREFIX } from '../webhooks.constants';
import { WEBHOOK_PING_EVENT_KEY } from './builtin-events';
import { jsonSchemaOf, subscriptionMatches, webhookEventRegistry, type WebhookEventDef } from './webhook-event.registry';

/** `data` of every `notification.<eventKey>` event. @stability experimental */
export const notificationBridgeDataSchema = z.object({
  event: z.object({ key: z.string(), label: z.string(), description: z.string() }),
  title: z.string(),
  body: z.string(),
  link: z.string().nullable(),
  fields: z.record(z.string(), z.string()).nullable(),
});

/** The sample `data` of a bridged notification. */
const NOTIFICATION_EXAMPLE = {
  event: { key: 'example.thing_happened', label: 'Thing happened', description: 'Sent when a thing happens.' },
  title: 'Thing happened',
  body: 'Something you follow changed.',
  link: '/things/1',
  fields: null,
};

function bridged(): WebhookEventDef[] {
  // Only an event that declares the `webhook` channel is ever routed to the sender, so only those are subscribable.
  return notificationEventRegistry.list().filter((event) => event.channels.includes(WEBHOOK_NOTIFICATION_CHANNEL_ID)).map(
    (event): WebhookEventDef => ({
      key: `${WEBHOOK_NOTIFICATION_EVENT_PREFIX}${event.key}`,
      label: `Notification: ${event.label}`,
      description: `${event.description} Delivered to your endpoints only when you also switch the Webhooks channel on for this event in your notification preferences.`,
      group: 'Notifications',
      audience: 'user',
      payloadSchema: notificationBridgeDataSchema,
      example: NOTIFICATION_EXAMPLE,
      source: 'notifications',
    }),
  );
}

/**
 * Every event the catalog knows: the registered ones, then the bridged
 * notifications.
 *
 * @returns the definitions.
 *
 * @stability experimental
 */
export function allWebhookEvents(): WebhookEventDef[] {
  return [...webhookEventRegistry.list(), ...bridged()];
}

/**
 * Resolves an exact event key: registered first, then a bridged notification.
 *
 * @param key - the emitted key.
 * @returns the definition, or `undefined` for an unknown key.
 *
 * @stability experimental
 */
export function resolveWebhookEvent(key: string): WebhookEventDef | undefined {
  const registered = webhookEventRegistry.get(key);
  if (registered) return registered;
  if (!key.startsWith(WEBHOOK_NOTIFICATION_EVENT_PREFIX)) return undefined;
  return bridged().find((event) => event.key === key);
}

/**
 * The events an endpoint of `scope` may subscribe to (the test ping excluded).
 *
 * @param scope - the endpoint scope.
 * @returns the definitions.
 *
 * @stability experimental
 */
export function subscribableEvents(scope: WebhookScope): WebhookEventDef[] {
  return allWebhookEvents().filter((event) => event.audience === scope && event.key !== WEBHOOK_PING_EVENT_KEY);
}

/**
 * Whether a subscription entry names at least one event an endpoint of `scope`
 * can receive.
 *
 * @param pattern - an `eventKeys` entry.
 * @param scope - the endpoint scope.
 * @returns `true` when subscribable.
 *
 * @stability experimental
 */
export function subscriptionIsSubscribable(pattern: string, scope: WebhookScope): boolean {
  return subscribableEvents(scope).some((event) => subscriptionMatches(pattern, event.key));
}

/**
 * The catalog entries for `scope`, as the route serves them.
 *
 * @param scope - the endpoint scope.
 * @returns the entries.
 *
 * @stability experimental
 */
export function catalogFor(scope: WebhookScope): WebhookEventCatalogEntry[] {
  return subscribableEvents(scope).map((event) => ({
    key: event.key,
    label: event.label,
    description: event.description,
    group: event.group,
    audience: event.audience,
    jsonSchema: jsonSchemaOf(event),
    ...(event.example !== undefined ? { example: event.example } : {}),
  }));
}

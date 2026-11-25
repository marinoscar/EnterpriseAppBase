// =============================================================================
// The webhook event catalog (issue #1046)
// =============================================================================
//
// An OPEN vocabulary: an event key is a string, registered with
// `registerWebhookEvent` from the slice that raises it (the nodes and jobs
// bridges below are the platform's own; the alerts slice registers its two the
// same way). A key is permanent once an endpoint subscribes to it. Framework-
// free, like every registry: no Nest, so the catalog loads in a seed or a script.
// =============================================================================

import { z } from 'zod';
import {
  WEBHOOK_EVENT_KEY_MAX,
  WEBHOOK_EVENT_KEY_PATTERN,
  WEBHOOK_EVENT_KEY_REGEX_SOURCE,
  type WebhookScope,
} from '@marinoscar/platform-contract/webhooks';

import { defineRegistry } from '../../core/index';

/**
 * One event an endpoint can subscribe to.
 *
 * @stability experimental
 */
export interface WebhookEventDef {
  /** `area.entity.action`, lower snake case segments, at least two (`nodes.node.offline`). PERMANENT. */
  readonly key: string;
  /** A short name for the event picker. */
  readonly label: string;
  /** One sentence: when the event fires. */
  readonly description: string;
  /** The picker's group heading (`Nodes`). */
  readonly group: string;
  /**
   * Who may subscribe: `user` (a member's own endpoints; the event is about
   * that member), `org` (an organization's endpoints) or `system` (the
   * deployment's endpoints). An endpoint of a scope receives only events whose
   * audience is that scope.
   */
  readonly audience: WebhookScope;
  /**
   * The permission the endpoint's OWNER must hold when the event fans out
   * (re-read every time, so revoking it silences the endpoint). Absent: none.
   */
  readonly permission?: string;
  /** Validates the event's `data`; exported as JSON Schema by `GET .../events`. */
  readonly payloadSchema: z.ZodType;
  /** A sample `data` for the catalog and the docs. */
  readonly example?: unknown;
  /** Who registered it (`platform` or a slice or app id). */
  readonly source: string;
}

const KEY_FULL = new RegExp(`^${WEBHOOK_EVENT_KEY_REGEX_SOURCE}$`);

/**
 * The registered events.
 *
 * @stability experimental
 */
export const webhookEventRegistry = defineRegistry<WebhookEventDef>({
  name: 'webhook-events',
  idOf: (event) => event.key,
  idPattern: KEY_FULL,
  order: 'registration',
  validate: (event) => {
    if (event.key.length > WEBHOOK_EVENT_KEY_MAX) throw new Error(`key must be at most ${WEBHOOK_EVENT_KEY_MAX} characters`);
    for (const field of ['label', 'description', 'group', 'source'] as const) {
      if (typeof event[field] !== 'string' || event[field].trim() === '') throw new Error(`${field} must be a non-empty string`);
    }
    if (!['user', 'org', 'system'].includes(event.audience)) throw new Error(`audience must be user, org or system (got ${String(event.audience)})`);
    if (event.permission !== undefined && (typeof event.permission !== 'string' || event.permission === '')) {
      throw new Error('permission must be a non-empty string when present');
    }
    if (!event.payloadSchema || typeof (event.payloadSchema as { safeParse?: unknown }).safeParse !== 'function') {
      throw new Error('payloadSchema must be a zod schema');
    }
  },
  describeDuplicate: (existing, incoming) =>
    `Webhook event "${incoming.key}" is already registered by "${existing.source}"; "${incoming.source}" cannot claim it too. An event key is permanent once an endpoint subscribes to it.`,
});

/**
 * Adds an event to the catalog. Registering the same definition again (the
 * same object) is a no-op, so a module that composes twice in one process
 * (Jest workers) does not fail.
 *
 * @param def - the event.
 * @throws RegistryError when the key is malformed, the definition invalid, or another definition owns the key.
 *
 * @example
 * ```ts
 * registerWebhookEvent({
 *   key: 'invoices.invoice.paid', label: 'Invoice paid', description: 'An invoice was paid.',
 *   group: 'Invoices', audience: 'org', permission: 'org_webhooks:read',
 *   payloadSchema: z.object({ invoiceId: z.string() }), source: 'invoices',
 * });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerWebhookEvent(def: WebhookEventDef): void {
  if (webhookEventRegistry.get(def.key) === def) return;
  webhookEventRegistry.register(def);
}

/**
 * The event definition for a key, or `undefined`.
 *
 * @param key - an exact event key.
 * @returns the definition.
 *
 * @stability experimental
 */
export function findWebhookEvent(key: string): WebhookEventDef | undefined {
  return webhookEventRegistry.get(key);
}

/**
 * The registered events whose audience is `scope`, in registration order.
 *
 * @param scope - the endpoint scope.
 * @returns the definitions.
 *
 * @stability experimental
 */
export function webhookEventsForScope(scope: WebhookScope): WebhookEventDef[] {
  return webhookEventRegistry.list().filter((event) => event.audience === scope);
}

/**
 * Whether a subscription entry (`exact`, `group.*` or `*`) matches an event key.
 *
 * @param pattern - one entry of an endpoint's `eventKeys`.
 * @param eventKey - the emitted event's key.
 * @returns `true` when it matches.
 *
 * @stability experimental
 */
export function subscriptionMatches(pattern: string, eventKey: string): boolean {
  if (pattern === '*') return true;
  if (pattern.endsWith('.*')) return eventKey.startsWith(pattern.slice(0, -1));
  return pattern === eventKey;
}

/**
 * Whether any entry of `patterns` matches `eventKey`.
 *
 * @param patterns - an endpoint's `eventKeys`.
 * @param eventKey - the emitted event's key.
 * @returns `true` when subscribed.
 *
 * @stability experimental
 */
export function isSubscribed(patterns: readonly string[], eventKey: string): boolean {
  return patterns.some((pattern) => subscriptionMatches(pattern, eventKey));
}

/**
 * Whether a subscription entry could ever match a registered event of `scope`
 * (an exact key that is registered for the scope, a wildcard that matches at
 * least one, or `*`).
 *
 * @param pattern - one entry.
 * @param scope - the endpoint scope.
 * @returns `true` when it names something subscribable.
 *
 * @stability experimental
 */
export function patternHasEventsForScope(pattern: string, scope: WebhookScope): boolean {
  return webhookEventsForScope(scope).some((event) => subscriptionMatches(pattern, event.key));
}

/** The JSON Schema of an event's `data`, or an open object when conversion is not possible. */
export function jsonSchemaOf(event: WebhookEventDef): Record<string, unknown> {
  try {
    return z.toJSONSchema(event.payloadSchema, { unrepresentable: 'any' }) as Record<string, unknown>;
  } catch {
    return { type: 'object' };
  }
}

export { WEBHOOK_EVENT_KEY_PATTERN };

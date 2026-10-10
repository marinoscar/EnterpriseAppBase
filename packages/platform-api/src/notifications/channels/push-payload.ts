// =============================================================================
// Push payload extras (PP-14.10)
// =============================================================================
//
// A Web Push payload carried exactly five fields (`id`, `eventKey`, `title`,
// `body`, `link`). An app that wants its notification to look different (action
// buttons, its own icon, a collapse tag) or to ask the push service for a
// different delivery urgency had no seam. `NotificationsModule.forRoot({
// pushPayload })` is that seam, and this file is its guard: the hook returns
// whatever it likes, and ONLY the five allowlisted extras below survive, each
// bounded, so an app cannot smuggle an arbitrary object (or a payload past the
// push services' ~4 KB ceiling) into a user's device.
//
// FRAMEWORK-FREE: pure functions and types.
// =============================================================================

import type { NotificationEventDef } from './../registry/event.registry';

/**
 * One action button on a push notification. The service worker shows it; a
 * click on it, like a click on the notification, opens the notification's link.
 *
 * @stability experimental
 */
export interface PushAction {
  /** The action id (at most 64 characters). */
  action: string;
  /** The button label (at most 64 characters). */
  title: string;
  /** An icon, as a root-relative path or an `https:` URL. */
  icon?: string;
}

/**
 * The Web Push urgency header values (RFC 8030): how eagerly the push service
 * wakes the device.
 *
 * @stability experimental
 */
export type PushUrgency = 'very-low' | 'low' | 'normal' | 'high';

/**
 * The extras an app may add to a push: the allowlist, and nothing else.
 * `actions`, `icon`, `badge` and `tag` travel in the payload; `urgency` is the
 * delivery option sent to the push service and never reaches the device.
 *
 * @example
 * ```ts
 * const extras: Partial<PushPayloadExtras> = { tag: 'invoice', urgency: 'high' };
 * ```
 *
 * @extensionPoint contract
 * @stability experimental
 */
export interface PushPayloadExtras {
  /** Up to two action buttons. */
  actions: PushAction[];
  /** The notification icon: a root-relative path or an `https:` URL (at most 500 characters). */
  icon: string;
  /** The status-bar badge: a root-relative path or an `https:` URL (at most 500 characters). */
  badge: string;
  /** The delivery urgency. */
  urgency: PushUrgency;
  /** A collapse tag (at most 64 characters): pushes with the same tag replace each other. */
  tag: string;
}

/**
 * The hook `NotificationsModule.forRoot({ pushPayload })` takes: the extras for
 * one event and payload. Called once per push delivery; a throw is logged and
 * the push goes out without extras.
 *
 * @param event - the event being pushed.
 * @param data - the payload the caller passed to `notify`.
 * @returns the extras to add; unknown keys are dropped.
 *
 * @extensionPoint option
 * @stability experimental
 */
export type PushPayloadHook = (event: NotificationEventDef, data: unknown) => Partial<PushPayloadExtras> | null | undefined;

/** The most action buttons a push carries (browsers show two or fewer). */
export const PUSH_MAX_ACTIONS = 2;

/** The longest `action`, `title` and `tag`. */
export const PUSH_EXTRA_TEXT_MAX = 64;

/** The longest `icon`, `badge` and action icon. */
export const PUSH_EXTRA_URL_MAX = 500;

/** The largest serialized payload sent; a larger one is sent without its extras. */
export const PUSH_MAX_PAYLOAD_BYTES = 3_800;

const URGENCIES: readonly string[] = ['very-low', 'low', 'normal', 'high'];

function text(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined;
}

/** A root-relative path or an `https:` URL, bounded: the only places a device may load an image from. */
function imageUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > PUSH_EXTRA_URL_MAX) return undefined;
  if (/[\u0000- \u007F]/.test(value)) return undefined;
  if (value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')) return value;
  return value.startsWith('https://') ? value : undefined;
}

/**
 * What survives the allowlist: the payload fields and the delivery urgency.
 *
 * @stability experimental
 */
export interface SanitizedPushExtras {
  /** Fields merged into the payload JSON. */
  readonly payload: { actions?: PushAction[]; icon?: string; badge?: string; tag?: string };
  /** The `Urgency` option for the push service, when valid. */
  readonly urgency?: PushUrgency;
}

/**
 * Applies the allowlist to a hook's result: unknown keys are dropped, every
 * value is type- and size-checked, an invalid value is dropped on its own (the
 * rest survive), and nothing here throws.
 *
 * @param raw - whatever the hook returned.
 * @returns the surviving extras.
 *
 * @example
 * ```ts
 * sanitizePushExtras({ tag: 'a', surprise: 1 }); // { payload: { tag: 'a' } }
 * ```
 *
 * @stability experimental
 */
export function sanitizePushExtras(raw: unknown): SanitizedPushExtras {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { payload: {} };
  const input = raw as Record<string, unknown>;
  const payload: { actions?: PushAction[]; icon?: string; badge?: string; tag?: string } = {};

  const icon = imageUrl(input.icon);
  if (icon) payload.icon = icon;
  const badge = imageUrl(input.badge);
  if (badge) payload.badge = badge;
  const tag = text(input.tag, PUSH_EXTRA_TEXT_MAX);
  if (tag) payload.tag = tag;

  if (Array.isArray(input.actions)) {
    const actions: PushAction[] = [];
    for (const candidate of input.actions) {
      if (actions.length >= PUSH_MAX_ACTIONS) break;
      if (candidate === null || typeof candidate !== 'object') continue;
      const entry = candidate as Record<string, unknown>;
      const action = text(entry.action, PUSH_EXTRA_TEXT_MAX);
      const title = text(entry.title, PUSH_EXTRA_TEXT_MAX);
      if (!action || !title) continue;
      const actionIcon = imageUrl(entry.icon);
      actions.push(actionIcon ? { action, title, icon: actionIcon } : { action, title });
    }
    if (actions.length > 0) payload.actions = actions;
  }

  const urgency = typeof input.urgency === 'string' && URGENCIES.includes(input.urgency) ? (input.urgency as PushUrgency) : undefined;
  return urgency ? { payload, urgency } : { payload };
}

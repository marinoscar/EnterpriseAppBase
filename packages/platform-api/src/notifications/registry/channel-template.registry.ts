// =============================================================================
// Per-channel templates (PP-14.10)
// =============================================================================
//
// Email has its template registry (`emailTemplateRegistry`, bound by event in
// `eventEmailTemplateRegistry`) and the browser and push channels share one
// renderer (`eventBrowserTemplateRegistry`). A channel an app adds (Slack, SMS,
// Teams, a webhook) had nothing: it rendered from the raw `data` of the event
// with no registry and no validation, so a typo or a missing template was a
// delivery failure found by the first recipient.
//
// `channelTemplateRegistry` is that missing registry: one entry per
// (channel, event) pair, validated when it is registered, with the same rule the
// two older bindings follow (the event is registered and declares the channel).
// A channel that really does render the same way for every event says so
// (`NotificationChannelDef.rendersRawData`), and the `notifications`
// conformance suite then asks only that EVERY event bound for a channel has a
// template or the channel declares it does not need one.
//
// A sender calls {@link renderChannelPayload} from `deliver`. The dispatcher
// never renders: it does not know what a channel's payload looks like.
//
// FRAMEWORK-FREE, like the other registries: types and a registry, no Nest.
// =============================================================================

import { RegistryError, defineRegistry } from '../../core/index';
import type { NotificationDispatchContext, NotificationRecipient } from '../notification.types';
import { notificationChannelRegistry } from './channel.registry';
import { notificationEventRegistry, type NotificationEventDef } from './event.registry';

/**
 * What a channel template renders: plain text, no markup, because each channel
 * decides how to present it (a Slack block, an SMS body, a JSON field). The
 * same three fields the browser content has, plus free `fields` for a channel
 * that carries structured data.
 *
 * @example
 * ```ts
 * const payload: ChannelPayload = { title: 'Invoice ready', body: 'Invoice 42 is ready.', link: '/billing' };
 * ```
 *
 * @extensionPoint schema
 * @stability experimental
 */
export interface ChannelPayload {
  /** One short line. */
  title: string;
  /** A sentence or two of detail. */
  body: string;
  /** Where it should lead, as a root-relative path (`/billing`); the channel decides how to make it absolute. */
  link?: string;
  /** Extra plain-text facts for a channel that carries structure (a webhook's JSON, a card's fields). */
  fields?: Record<string, string>;
}

/**
 * What a template is given besides the payload.
 *
 * @stability experimental
 */
export interface ChannelTemplateContext {
  /** The channel being rendered for. */
  readonly channel: string;
  /** The event. */
  readonly event: NotificationEventDef;
  /** Who it goes to (an address, a user id, preferences): read-only. */
  readonly recipient: NotificationRecipient;
}

/**
 * A pure renderer for one (channel, event) pair. It receives the payload the
 * caller passed to `notify` untouched (`unknown`: the call site is untyped by
 * design) and must not throw on a payload it does not understand beyond what a
 * delivery failure can describe; a throw is recorded as a failed delivery.
 *
 * @stability experimental
 */
export type ChannelTemplateRender = (data: never, context: ChannelTemplateContext) => ChannelPayload;

/**
 * One binding: the template for an event over a channel.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export interface ChannelTemplateBinding {
  /** A registered channel. */
  readonly channelId: string;
  /** A registered event that declares that channel. */
  readonly eventKey: string;
  /** The pure renderer. */
  readonly render: ChannelTemplateRender;
}

const CHANNEL_TEMPLATE_ID_PATTERN = /^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

/** The registry id of a binding. */
function templateId(binding: Pick<ChannelTemplateBinding, 'channelId' | 'eventKey'>): string {
  return `${binding.channelId}:${binding.eventKey}`;
}

/**
 * The rule a channel template binding must satisfy. Takes the event rather
 * than looking it up, so `registerNotification` can check a binding against an
 * event it has not registered yet.
 *
 * @param event - the event, or `undefined` when it is not registered.
 * @param channelId - the channel.
 * @param eventKey - the event key (for the message).
 * @param render - the renderer.
 * @throws Error naming the problem.
 *
 * @stability experimental
 */
export function assertChannelTemplateBinding(
  event: NotificationEventDef | undefined,
  channelId: string,
  eventKey: string,
  render: unknown,
): void {
  if (!notificationChannelRegistry.has(channelId)) {
    throw new Error(
      `channel "${channelId}" is not a registered notification channel ` +
        `(known: ${notificationChannelRegistry.ids().join(', ') || 'none'})`,
    );
  }
  if (!event) {
    throw new Error(`event "${eventKey}" is not a registered notification event`);
  }
  if (!event.channels.includes(channelId)) {
    throw new Error(
      `event "${eventKey}" does not declare the ${channelId} channel, so a ${channelId} template would never be used`,
    );
  }
  if (typeof render !== 'function') {
    throw new Error('a channel template needs a render function');
  }
}

/**
 * (channel, event) -\> renderer. Filled by `registerChannelTemplate` or
 * `registerNotification({ channelTemplates })`; frozen once the application has
 * bootstrapped. The id is `<channelId>:<eventKey>`.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const channelTemplateRegistry = defineRegistry<ChannelTemplateBinding>({
  name: 'notification-channel-templates',
  idOf: templateId,
  idPattern: CHANNEL_TEMPLATE_ID_PATTERN,
  validate: (binding) =>
    assertChannelTemplateBinding(
      notificationEventRegistry.get(binding.eventKey),
      binding.channelId,
      binding.eventKey,
      binding.render,
    ),
  describeDuplicate: (existing) =>
    `Event "${existing.eventKey}" already has a ${existing.channelId} template.`,
});

/**
 * Binds the template that renders an already registered event over a
 * channel. The channel must be registered and the event must declare it.
 * Prefer `registerNotification({ channelTemplates })` to register an event and
 * its templates atomically; this is for binding a template to an event another
 * module registered.
 *
 * @param binding - the channel, the event key and the pure renderer.
 * @throws RegistryError `INVALID_ENTRY` (unregistered channel or event, the
 *   event does not declare the channel, no function), `DUPLICATE_ID` or `FROZEN`.
 *
 * @example
 * ```ts
 * registerChannelTemplate({
 *   channelId: 'webhook',
 *   eventKey: 'billing.invoice_ready',
 *   render: (data: { number: string }) => ({ title: 'Invoice ready', body: `Invoice ${data.number} is ready.` }),
 * });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerChannelTemplate(binding: ChannelTemplateBinding): void {
  channelTemplateRegistry.register(binding);
}

/**
 * Checks a binding for `registerNotification` and reports a refusal the way the
 * registry would (so the event and every binding stay atomic).
 *
 * @internal
 */
export function preflightChannelTemplate(event: NotificationEventDef, channelId: string, render: unknown): void {
  const id = `${channelId}:${event.key}`;
  if (channelTemplateRegistry.has(id)) {
    throw new RegistryError(
      'DUPLICATE_ID',
      channelTemplateRegistry.name,
      `Duplicate id "${id}" in registry "${channelTemplateRegistry.name}".`,
      { id },
    );
  }
  try {
    assertChannelTemplateBinding(event, channelId, event.key, render);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new RegistryError(
      'INVALID_ENTRY',
      channelTemplateRegistry.name,
      `Invalid entry "${id}" in registry "${channelTemplateRegistry.name}": ${message}`,
      { id, cause: err },
    );
  }
}

/**
 * The template for `(channelId, eventKey)`, or `undefined`.
 *
 * @param channelId - the channel.
 * @param eventKey - the event key.
 * @returns the binding, or `undefined` when none is registered.
 *
 * @stability experimental
 */
export function findChannelTemplate(channelId: string, eventKey: string): ChannelTemplateBinding | undefined {
  return channelTemplateRegistry.get(`${channelId}:${eventKey}`);
}

/**
 * Renders what a dispatch carries for `channelId`: the registered template's
 * payload, or `null` when the channel has none for this event (a channel that
 * `rendersRawData` then builds its own from `context.data`). Call it from
 * `deliver`.
 *
 * A template that throws propagates: the dispatcher records the delivery as
 * failed (the sender's contract is not to throw, so a sender wraps this in its
 * own try/catch and returns `{ success: false, error }`).
 *
 * @param channelId - the sender's channel.
 * @param context - the dispatch context passed to `deliver`.
 * @returns the payload, or `null`.
 *
 * @example
 * ```ts
 * const payload = renderChannelPayload(this.channel, context) ?? { title: context.event.label, body: context.event.description };
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function renderChannelPayload(channelId: string, context: NotificationDispatchContext): ChannelPayload | null {
  const binding = findChannelTemplate(channelId, context.event.key);
  if (!binding) return null;
  return binding.render(context.data as never, { channel: channelId, event: context.event, recipient: context.recipient });
}


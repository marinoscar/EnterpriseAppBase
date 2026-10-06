// =============================================================================
// Event -> template bindings, and `registerNotification` (issue #678, PP-1.6)
// =============================================================================
//
// Two registries link an event to what renders it:
//
//   - `eventEmailTemplateRegistry`: event key -> email template NAME. Until #678
//     the closed map `EVENT_EMAIL_TEMPLATES` in email-notification.channel.ts.
//   - `eventBrowserTemplateRegistry`: event key -> browser renderer, which also
//     serves push. Until #678 `EVENT_BROWSER_TEMPLATES` in
//     browser-notification.channel.ts.
//
// They are separate from the event itself on purpose. `NotificationEventDef` is
// served to the web by `GET /api/notifications/events` and must stay pure data,
// and email templates exist without an event (`test-email`). A map and not a
// naming convention: event keys are dotted (`user.welcome`), template names are
// kebab-case and match their file (`user-welcome`), and deriving one from the
// other would couple two naming schemes and turn a rename into a silent
// "template not found" at send time.
//
// `registerNotification` is the one call an app needs: an event plus its
// optional email template and browser renderer, validated together before
// anything is registered, so a typo in the template name never leaves an event
// half-registered.
//
// FRAMEWORK-FREE: registries, a type, nothing else.
// =============================================================================

import { RegistryError, defineRegistry } from '../../common/registry';
import type { BrowserNotificationTemplate } from '../channels/browser-notification.channel';
import { emailTemplateRegistry } from './email-template.registry';
import {
  NOTIFICATION_EVENT_KEY_PATTERN,
  assertValidNotificationEvent,
  notificationEventRegistry,
  type NotificationEventDef,
} from './event.registry';

/** Event key -> the name of the email template that renders it. */
export interface EventEmailTemplateBinding {
  /** A registered event that declares the `email` channel. */
  readonly eventKey: string;
  /** A registered email template name. One template may serve several events. */
  readonly template: string;
}

/** Event key -> the renderer for its bell row and OS toast (browser and push). */
export interface EventBrowserTemplateBinding {
  /** A registered event that declares `browser` or `push`. */
  readonly eventKey: string;
  /** The pure renderer. Its absence is fine: the channel falls back to the event's label and description. */
  readonly render: BrowserNotificationTemplate;
}

/**
 * The rule an email binding must satisfy. Takes the event rather than looking
 * it up, so `registerNotification` can check a binding against an event it has
 * not registered yet.
 */
function assertEmailBinding(event: NotificationEventDef | undefined, eventKey: string, template: string): void {
  if (!event) {
    throw new Error(`event "${eventKey}" is not a registered notification event`);
  }
  if (!event.channels.includes('email')) {
    throw new Error(`event "${eventKey}" does not declare the email channel, so an email template would never be used`);
  }
  if (!emailTemplateRegistry.has(template)) {
    throw new Error(
      `email template "${template}" is not registered ` +
        `(known: ${emailTemplateRegistry.ids().join(', ') || 'none'})`,
    );
  }
}

/** The rule a browser binding must satisfy. See {@link assertEmailBinding}. */
function assertBrowserBinding(
  event: NotificationEventDef | undefined,
  eventKey: string,
  render: BrowserNotificationTemplate,
): void {
  if (!event) {
    throw new Error(`event "${eventKey}" is not a registered notification event`);
  }
  if (!event.channels.includes('browser') && !event.channels.includes('push')) {
    throw new Error(
      `event "${eventKey}" declares neither the browser nor the push channel, so a browser renderer would never be used`,
    );
  }
  if (typeof render !== 'function') {
    throw new Error('a browser binding needs a render function');
  }
}

/**
 * Event key -> email template name. Filled by `notification.manifest.ts`
 * through {@link registerNotification}; frozen once the application has
 * bootstrapped.
 */
export const eventEmailTemplateRegistry = defineRegistry<EventEmailTemplateBinding>({
  name: 'notification-event-email-templates',
  idOf: (binding) => binding.eventKey,
  idPattern: NOTIFICATION_EVENT_KEY_PATTERN,
  validate: (binding) =>
    assertEmailBinding(notificationEventRegistry.get(binding.eventKey), binding.eventKey, binding.template),
  describeDuplicate: (existing) => `Event "${existing.eventKey}" already has an email template ("${existing.template}").`,
});

/**
 * Event key -> browser/push renderer. Filled by `notification.manifest.ts`
 * through {@link registerNotification}; frozen once the application has
 * bootstrapped.
 */
export const eventBrowserTemplateRegistry = defineRegistry<EventBrowserTemplateBinding>({
  name: 'notification-event-browser-templates',
  idOf: (binding) => binding.eventKey,
  idPattern: NOTIFICATION_EVENT_KEY_PATTERN,
  validate: (binding) =>
    assertBrowserBinding(notificationEventRegistry.get(binding.eventKey), binding.eventKey, binding.render),
  describeDuplicate: (existing) => `Event "${existing.eventKey}" already has a browser template.`,
});

/** One notification, as a module declares it: the event and what renders it. */
export interface NotificationRegistration {
  /** The event. Pure data, served as is by `GET /api/notifications/events`. */
  readonly event: NotificationEventDef;
  /** A registered email template name. Required in practice when the event declares `email`. */
  readonly emailTemplate?: string;
  /** The bell row / OS toast renderer; also serves push. Optional: the channel falls back to the event's label. */
  readonly browserTemplate?: BrowserNotificationTemplate;
}

/**
 * Registers one notification: its event, then its email template binding and
 * its browser binding.
 *
 * ATOMIC: the event and both bindings are checked before anything is
 * registered, so a bad template name leaves no event behind. Every refusal is a
 * `RegistryError` from the registry that refused, naming the event key.
 *
 * @example
 * registerNotification({
 *   event: { key: 'coach.weekly_review', label: 'Weekly review', description: '...',
 *            channels: ['email', 'browser'], defaultEnabled: true },
 *   emailTemplate: 'coach-weekly-review',
 *   browserTemplate: weeklyReviewBrowserTemplate,
 * });
 *
 * @throws RegistryError `INVALID_ID`, `INVALID_ENTRY`, `DUPLICATE_ID` or `FROZEN`.
 */
export function registerNotification(input: NotificationRegistration): void {
  const { event, emailTemplate, browserTemplate } = input;

  // 1. Writes are possible at all.
  const writing = [
    notificationEventRegistry,
    ...(emailTemplate !== undefined ? [eventEmailTemplateRegistry] : []),
    ...(browserTemplate !== undefined ? [eventBrowserTemplateRegistry] : []),
  ];
  for (const registry of writing) {
    if (registry.frozen) {
      throw new RegistryError(
        'FROZEN',
        registry.name,
        `Registry "${registry.name}" is frozen: notifications are registered before the application bootstraps.`,
      );
    }
  }

  // 2. The event itself, so its own problems are reported first and under its
  //    own registry: the key's shape, a duplicate, the event's invariants. The
  //    event registry repeats these checks in step 4; they cannot disagree.
  const key = event.key;
  if (typeof key !== 'string' || !NOTIFICATION_EVENT_KEY_PATTERN.test(key)) {
    throw new RegistryError(
      'INVALID_ID',
      notificationEventRegistry.name,
      `Invalid id ${JSON.stringify(key)} in registry "${notificationEventRegistry.name}": ` +
        `an id must match ${NOTIFICATION_EVENT_KEY_PATTERN}.`,
      { id: typeof key === 'string' ? key : undefined },
    );
  }
  if (notificationEventRegistry.has(key)) {
    // Let the registry raise its own DUPLICATE_ID (and its message); a
    // duplicate is refused before anything is written.
    notificationEventRegistry.register(event);
  }
  preflight(notificationEventRegistry, key, () => assertValidNotificationEvent(event));

  // 3. The bindings hold against the (not yet registered) event and are not
  //    duplicates. Checked here, against `event` itself, because their own
  //    registries look the event up and would not find it yet.
  if (emailTemplate !== undefined) {
    preflight(eventEmailTemplateRegistry, key, () => assertEmailBinding(event, key, emailTemplate));
  }
  if (browserTemplate !== undefined) {
    preflight(eventBrowserTemplateRegistry, key, () => assertBrowserBinding(event, key, browserTemplate));
  }

  // 4. The event. Its registry checks the key, the event's invariants and
  //    duplicates; a refusal here has registered nothing.
  notificationEventRegistry.register(event);

  // 5. The bindings. Everything that could refuse them was checked in step 3.
  if (emailTemplate !== undefined) {
    eventEmailTemplateRegistry.register({ eventKey: key, template: emailTemplate });
  }
  if (browserTemplate !== undefined) {
    eventBrowserTemplateRegistry.register({ eventKey: key, render: browserTemplate });
  }
}

/** Registers several notifications in order. Each one is atomic; see {@link registerNotification}. */
export function registerNotifications(inputs: readonly NotificationRegistration[]): void {
  for (const input of inputs) registerNotification(input);
}

/**
 * Runs a binding's rule for `registerNotification` and reports a refusal the
 * way the binding's own registry would.
 */
function preflight(registry: { name: string; has(id: string): boolean }, key: string, check: () => void): void {
  if (registry.has(key)) {
    throw new RegistryError('DUPLICATE_ID', registry.name, `Duplicate id "${key}" in registry "${registry.name}".`, {
      id: key,
    });
  }
  try {
    check();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new RegistryError('INVALID_ENTRY', registry.name, `Invalid entry "${key}" in registry "${registry.name}": ${message}`, {
      id: key,
      cause: err,
    });
  }
}

// =============================================================================
// Email template registry (issue #737, PP-8.4; a registry since #678, PP-1.6;
// templates date from #123)
// =============================================================================
//
// Name -> renderer, for every email the application can send. The platform's
// nine templates register through `registerPlatformEmailTemplates()` (called
// by `EmailModule.forRoot` and by an app's notification manifest, idempotent);
// an app adds its own with `registerEmailTemplate`, typed by augmenting
// {@link EmailTemplateDataMap}; another slice's adapter (sharing's
// `group-invitation`, identity's `org-invitation`) registers the same way.
//
// RE-REGISTERING A NAME THROWS `DUPLICATE_ID` naming it, unless the caller
// passes `{ override: true }`: an override replaces what an existing name
// renders, without editing the package (EvoPath restyles `broadcast` this
// way). Overrides live in a registry of their own, so the base registry keeps
// its strict duplicate rule and its order; `findEmailTemplate` and
// `renderEmailTemplate` read the override first. `EmailModule` logs each
// override once, at bootstrap.
//
// TEMPLATE NAMES ARE STABLE IDS once a notification event maps to them (the
// event -> template bindings and the delivery records persist them). Add a new
// name; never rename one.
//
// A template is not tied to an event: `test-email` is sent by the admin test
// send with no event at all. The event -> template link is the notifications
// slice's binding registry.
//
// FRAMEWORK-FREE: the registry primitive, the templates and their types.
// =============================================================================

import { defineRegistry } from '../../core/index';
import type { EmailTemplate, RenderedEmail } from './email-template.types';
import { PLATFORM_EMAIL_TEMPLATES, type PlatformEmailTemplateDataMap } from './platform-email-templates';
import { resolveEmailRenderContext, type EmailRenderContext } from './render-context';

/**
 * Every template, mapped to the data it renders from: the platform's nine,
 * plus whatever an app declares by module augmentation, next to its
 * registration:
 *
 * ```ts
 * declare module '@marinoscar/platform-api/email' {
 *   interface EmailTemplateDataMap { 'coach-weekly-review': CoachWeeklyReviewEmailData }
 * }
 * registerEmailTemplate('coach-weekly-review', coachWeeklyReviewEmail);
 * ```
 *
 * @extensionPoint schema
 * @stability experimental
 */
export interface EmailTemplateDataMap extends PlatformEmailTemplateDataMap {}

/**
 * A template name declared in {@link EmailTemplateDataMap}. Kebab-case,
 * matching the template's file (`test-email` → `test-email.email.ts`), and a
 * STABLE ID: never rename one, add a new name.
 *
 * @stability experimental
 */
export type EmailTemplateName = keyof EmailTemplateDataMap & string;

/**
 * One registered email template.
 *
 * @stability experimental
 */
export interface EmailTemplateEntry {
  /** Stable name: kebab-case. Persisted by delivery records; never rename one. */
  readonly name: string;
  /**
   * The pure renderer. Typed `EmailTemplate<never>` because the registry
   * holds templates of every payload type; `renderEmailTemplate` pins the
   * payload by name for a caller that knows it statically.
   */
  readonly render: EmailTemplate<never>;
  /** Who registered it, for the bootstrap log of overrides. Default: `app`. */
  readonly registrant?: string;
}

/**
 * Options of {@link registerEmailTemplate}.
 *
 * @stability experimental
 */
export interface RegisterEmailTemplateOptions {
  /** Replace the template already registered under the name. Default `false`: a duplicate throws. */
  override?: boolean;
  /** Who registers it, for the bootstrap log (`app`, `sharing`, ...). Default: `app`. */
  registrant?: string;
}

/**
 * What every template name must look like.
 *
 * @stability experimental
 */
export const EMAIL_TEMPLATE_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

function assertRenderFunction(entry: EmailTemplateEntry): void {
  if (typeof entry.render !== 'function') {
    throw new Error('a template needs a render function');
  }
}

/**
 * Every email template, in registration order (platform first). Frozen once
 * the application has bootstrapped.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const emailTemplateRegistry = defineRegistry<EmailTemplateEntry>({
  name: 'email-templates',
  idOf: (entry) => entry.name,
  idPattern: EMAIL_TEMPLATE_NAME_PATTERN,
  validate: assertRenderFunction,
  describeDuplicate: (existing) =>
    `Duplicate email template "${existing.name}". Template names are persisted; ` +
    'pick a new name, or pass { override: true } to registerEmailTemplate to replace it on purpose.',
});

/**
 * The templates registered with `{ override: true }`, by the name they
 * replace. Read before {@link emailTemplateRegistry} by every lookup.
 *
 * @stability experimental
 */
export const emailTemplateOverrideRegistry = defineRegistry<EmailTemplateEntry>({
  name: 'email-template-overrides',
  idOf: (entry) => entry.name,
  idPattern: EMAIL_TEMPLATE_NAME_PATTERN,
  validate: (entry) => {
    assertRenderFunction(entry);
    if (!emailTemplateRegistry.has(entry.name)) {
      throw new Error(
        `email template "${entry.name}" is not registered, so there is nothing to override ` +
          `(known: ${emailTemplateRegistry.ids().join(', ') || 'none'}); register it without { override: true }`,
      );
    }
  },
  describeDuplicate: (existing) =>
    `Email template "${existing.name}" is already overridden (by ${existing.registrant ?? 'app'}); one override per name.`,
});

/**
 * Registers email templates, all or nothing. A name that is already
 * registered throws `DUPLICATE_ID`.
 *
 * @param entries - the templates.
 * @throws RegistryError `INVALID_ID`, `INVALID_ENTRY`, `DUPLICATE_ID` or `FROZEN`.
 *
 * @stability experimental
 */
export function registerEmailTemplates(entries: readonly EmailTemplateEntry[]): void {
  emailTemplateRegistry.registerAll(entries);
}

/**
 * Registers one email template under `name`, its data typed by
 * {@link EmailTemplateDataMap}. Register before the application bootstraps
 * (a manifest, at import time), never from `onModuleInit`.
 *
 * @param name - the template name, declared in {@link EmailTemplateDataMap}.
 * @param template - the pure renderer.
 * @param opts - `{ override: true }` replaces the template registered under
 *   `name`; `registrant` names who did, for the bootstrap log.
 * @throws RegistryError `DUPLICATE_ID` naming the template when `name` is
 *   registered and `override` is not set (or is already overridden),
 *   `INVALID_ENTRY` when overriding a name nothing registered, `INVALID_ID`
 *   or `FROZEN`.
 *
 * @example
 * ```ts
 * registerEmailTemplate('example-digest', exampleDigestEmail, { registrant: 'examples' });
 * registerEmailTemplate('broadcast', brandedBroadcastEmail, { override: true });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerEmailTemplate<K extends EmailTemplateName>(
  name: K,
  template: EmailTemplate<EmailTemplateDataMap[K]>,
  opts: RegisterEmailTemplateOptions = {},
): void {
  const entry: EmailTemplateEntry = {
    name,
    render: template as EmailTemplate<never>,
    registrant: opts.registrant ?? 'app',
  };
  if (opts.override === true) {
    emailTemplateOverrideRegistry.register(entry);
  } else {
    emailTemplateRegistry.register(entry);
  }
}

/**
 * Registers the platform's nine templates (`test-email`, `user-welcome`,
 * `allowlist-invitation`, `role-changed`, `broadcast`, `job-failed`,
 * `node-offline`, `backup-failed`, `restore-completed`). IDEMPOTENT: a name
 * already registered with the platform's own renderer is skipped, so
 * `EmailModule.forRoot` and an app's manifest may both call it. A name an app
 * registered first with a different renderer throws `DUPLICATE_ID`: use
 * `{ override: true }` instead.
 *
 * @throws RegistryError `DUPLICATE_ID` or `FROZEN` (only when something is left to register).
 *
 * @stability experimental
 */
export function registerPlatformEmailTemplates(): void {
  const missing = Object.entries(PLATFORM_EMAIL_TEMPLATES)
    .filter(([name, render]) => emailTemplateRegistry.get(name)?.render !== render)
    .map(([name, render]) => ({ name, render: render as EmailTemplate<never>, registrant: 'platform' }));
  if (missing.length > 0) emailTemplateRegistry.registerAll(missing);
}

/**
 * Is `value` a registered template name? The guard for a string that comes
 * back from persisted data (a delivery record, a job payload).
 *
 * @param value - the candidate name.
 * @returns whether a template is registered under it.
 *
 * @stability experimental
 */
export function isEmailTemplateName(value: string): value is EmailTemplateName {
  return emailTemplateRegistry.has(value);
}

/**
 * The renderer that serves `name` (its override, else the registered one).
 *
 * @internal
 */
function lookup(name: string): EmailTemplate<never> | undefined {
  return emailTemplateOverrideRegistry.get(name)?.render ?? emailTemplateRegistry.get(name)?.render;
}

/**
 * Adds the layout's inline parts (the brand mark) to a rendered message whose
 * HTML references them by `cid:` and that does not carry them yet. Returns
 * the message unchanged (same object) when there is nothing to add.
 *
 * @param rendered - what the template returned.
 * @param ctx - the render context it rendered with.
 * @returns the message with its inline parts.
 *
 * @stability experimental
 */
export function withLayoutAttachments(rendered: RenderedEmail, ctx: EmailRenderContext): RenderedEmail {
  const parts = ctx.layout.attachments.filter(
    (part) =>
      part.contentId !== undefined &&
      rendered.html.includes(`cid:${part.contentId}`) &&
      !(rendered.attachments ?? []).some((own) => own.contentId === part.contentId),
  );
  if (parts.length === 0) return rendered;
  return { ...rendered, attachments: [...(rendered.attachments ?? []), ...parts.map((part) => ({ ...part }))] };
}

/**
 * The renderer registered under `name` (its override when there is one), or
 * `undefined` when nothing is: never throws, because the caller is often
 * holding a name from persisted data written before a template was removed,
 * and a notification failure must never fail the action that triggered it.
 *
 * The returned function renders with the context it is given, or the
 * configured one, and adds the layout's inline parts.
 *
 * @param name - the template name, as a plain string.
 * @returns the renderer, or `undefined`.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function findEmailTemplate(name: string): EmailTemplate<unknown> | undefined {
  const render = lookup(name);
  if (!render) return undefined;
  return (data: unknown, ctx?: EmailRenderContext): RenderedEmail => {
    const context = resolveEmailRenderContext(ctx);
    return withLayoutAttachments((render as EmailTemplate<unknown>)(data, context), context);
  };
}

/**
 * Renders a template by name, its data type checked against that name: the
 * typed front door for a caller that knows the template statically. Does not
 * catch: a template is pure and total, and wrapping it would hide a bug.
 *
 * @param name - a name declared in {@link EmailTemplateDataMap}.
 * @param data - that template's data.
 * @param ctx - the render context; default: the configured one.
 * @returns subject, HTML, text, headers and any inline parts.
 * @throws RegistryError `UNKNOWN_ID` when `name` is declared but not registered.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function renderEmailTemplate<K extends EmailTemplateName>(
  name: K,
  data: EmailTemplateDataMap[K],
  ctx?: EmailRenderContext,
): RenderedEmail {
  const render = (emailTemplateOverrideRegistry.get(name)?.render ??
    emailTemplateRegistry.require(name).render) as EmailTemplate<EmailTemplateDataMap[K]>;
  const context = resolveEmailRenderContext(ctx);
  return withLayoutAttachments(render(data, context), context);
}

/**
 * The registered overrides, in registration order: what `EmailModule` logs at
 * bootstrap.
 *
 * @returns each overridden name and who overrode it.
 *
 * @stability experimental
 */
export function listEmailTemplateOverrides(): Array<{ name: string; registrant: string }> {
  return emailTemplateOverrideRegistry.list().map((entry) => ({ name: entry.name, registrant: entry.registrant ?? 'app' }));
}


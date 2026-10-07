import { emailTemplateRegistry } from '../../notifications/registry';
import type { EmailTemplate, RenderedEmail } from './email-template.types';
import type { PlatformEmailTemplateDataMap } from './platform-email-templates';

// =============================================================================
// Email template registry (issue #123, epic #109; a registry view since #678)
// =============================================================================
//
// The same idea as `../../notifications/notification-events.ts` on a different
// axis: ONE declaration of what exists, so the thing that dispatches and the
// thing that renders cannot hold different lists.
//
// #125's dispatcher receives an event key from the registry next door and has
// to turn it into a message. Without a keyed registry it does that with a
// `switch` — and a `switch` over strings is exactly the construct that silently
// grows a missing arm, in a code path whose failure mode is "the email was
// never sent" and which therefore produces no error to notice.
//
// -----------------------------------------------------------------------------
// SINCE #678 (PP-1.6): THE TEMPLATES LIVE IN A REGISTRY
// -----------------------------------------------------------------------------
//
// The closed `EMAIL_TEMPLATES` literal that used to live here made an app that
// added a template edit this platform file. Now:
//
//   - the platform's templates are `PLATFORM_EMAIL_TEMPLATES` in
//     `./platform-email-templates.ts`, which keeps the compile-time
//     "three-way lock" between a name, its data type and its renderer;
//   - an app adds its own in `app-registrations/notifications.ts`, and widens
//     {@link EmailTemplateDataMap} by module augmentation;
//   - `notifications/registry/notification.manifest.ts` registers both into
//     `emailTemplateRegistry`, platform first.
//
// Every export below keeps its name and meaning. `EMAIL_TEMPLATES` and
// `EMAIL_TEMPLATE_NAMES` are frozen snapshots of the registry (complete: the
// manifest runs before this module finishes loading); the functions read the
// registry live.
//
// This file is intentionally NOT a Nest provider, for the same reason
// notification-events.ts is not: it is pure data and pure functions, so a test
// or #125 can render a message without standing up DI for a constant.
// =============================================================================

/**
 * Every template, mapped to the data it renders from.
 *
 * The source of truth for {@link EmailTemplateName}. The platform's entries are
 * {@link PlatformEmailTemplateDataMap}; an app adds its own by augmentation,
 * next to its registration in `app-registrations/notifications.ts`:
 *
 * ```ts
 * declare module '../email/templates' {
 *   interface EmailTemplateDataMap { 'coach-weekly-review': CoachWeeklyReviewData }
 * }
 * ```
 *
 * Names are kebab-case and match the file; see `./platform-email-templates.ts`.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface, @typescript-eslint/no-empty-object-type
export interface EmailTemplateDataMap extends PlatformEmailTemplateDataMap {}

/**
 * A registered template name.
 *
 * KEYS ARE STABLE IDENTIFIERS and are persisted by #125's delivery records, so
 * a renamed key orphans the history that referenced it. Add a new key rather
 * than editing one — the same rule, for the same reason, as
 * `NotificationEventDef.key`.
 *
 * Kebab-case, matching the file name of the module that implements each one
 * (`test-email` -> `test-email.email.ts`), so a key in a log line leads
 * straight to the source.
 */
export type EmailTemplateName = keyof EmailTemplateDataMap & string;

/**
 * Name -> renderer, as a read-only view of `emailTemplateRegistry`.
 *
 * A FROZEN SNAPSHOT taken when this module loads, typed with the same mapped
 * type as before #678, so a caller that indexes it by a literal name gets that
 * name's payload type.
 */
export const EMAIL_TEMPLATES: {
  readonly [K in EmailTemplateName]: EmailTemplate<EmailTemplateDataMap[K]>;
} = Object.freeze(
  Object.fromEntries(emailTemplateRegistry.list().map((entry) => [entry.name, entry.render])),
) as { readonly [K in EmailTemplateName]: EmailTemplate<EmailTemplateDataMap[K]> };

/**
 * Every registered name, in registration order (platform first).
 *
 * For #124/#126 and for tests that need to assert something about all
 * templates at once — that each returns a non-empty `subject`, `html` AND
 * `text`, for instance, which is a test that has to be able to enumerate them
 * or it only ever checks the ones somebody remembered to list.
 */
export const EMAIL_TEMPLATE_NAMES: readonly EmailTemplateName[] = Object.freeze(
  emailTemplateRegistry.ids() as EmailTemplateName[],
);

/**
 * Is `value` a registered template name?
 *
 * The guard #125 needs at the boundary where an untyped string — from a
 * delivery record being retried, from a persisted job — re-enters the typed
 * world. Without it the only way in is a cast, and a cast is how a
 * decommissioned name becomes an `undefined` function call at runtime.
 */
export function isEmailTemplateName(value: string): value is EmailTemplateName {
  return emailTemplateRegistry.has(value);
}

/**
 * The renderer registered under `name`, or `undefined` when nothing is.
 *
 * RETURNS `undefined` RATHER THAN THROWING, matching `findEvent` in
 * notification-events.ts and for the same reason: the caller is frequently
 * holding a string that came from persisted data, written before a template
 * was removed. Epic #109's rule is that a notification failure never fails the
 * action that triggered it, and an exception thrown while looking up a
 * decommissioned template would do exactly that — take down a role change
 * because of a stale row. The caller decides whether an unknown name is "skip
 * it" or "this is a bug".
 *
 * The return type is deliberately the widest callable shape rather than a
 * per-name signature: by definition the name was not statically known at this
 * call site, so there is no `K` to pin the payload to. Callers that DO know
 * the name should use {@link renderEmailTemplate}, which does pin it.
 */
export function findEmailTemplate(
  name: string,
): EmailTemplate<never> | undefined {
  return emailTemplateRegistry.get(name)?.render;
}

/**
 * Render a template by name, with its data type checked against that name.
 *
 * The typed front door, and the one #125 should use wherever the event being
 * dispatched is known statically: passing `user.welcome`'s payload to
 * `allowlist.invitation` is a compile error here, whereas through
 * {@link findEmailTemplate} it is a runtime surprise in somebody's inbox.
 *
 * Does not catch: a template is a pure, synchronous function of its input
 * (see `EmailTemplate` in ./email-template.types.ts) and has nothing to throw
 * about. Wrapping it would only hide a genuine bug behind a message that
 * silently never sends. A name declared in {@link EmailTemplateDataMap} but
 * never registered throws the registry's `UNKNOWN_ID`, which is that same kind
 * of bug.
 *
 * @throws RegistryError `UNKNOWN_ID` when `name` is not registered.
 */
export function renderEmailTemplate<K extends EmailTemplateName>(
  name: K,
  data: EmailTemplateDataMap[K],
): RenderedEmail {
  const render = emailTemplateRegistry.require(name).render as EmailTemplate<EmailTemplateDataMap[K]>;
  return render(data);
}

// -----------------------------------------------------------------------------
// Public surface of the templates module
// -----------------------------------------------------------------------------
//
// Re-exported here so consumers write `from '../email/templates'` (or, via the
// parent barrel, `from '../email'`) and never reach into an individual file.
// That keeps the internal split — safe-html / layout / types / one file per
// template — free to change without touching call sites.

export {
  APP_NAME,
  plainText,
  renderLayout,
  // The escaping mechanism. See safe-html.ts for why it is a tagged template
  // literal and not a function everyone has to remember to call.
  SafeHtml,
  escapeHtml,
  html,
  safeUrl,
} from './layout';

export {
  TRANSACTIONAL_EMAIL_HEADERS,
  RENDERED_EMAIL_MATCHES_MESSAGE,
} from './email-template.types';

export { testEmail } from './test-email.email';

// The three real event templates (#128). Exported individually as well as
// through the registry, so a caller that knows statically which message it is
// building gets its payload type checked by name.
export { userWelcomeEmail } from './user-welcome.email';
export { allowlistInvitationEmail } from './allowlist-invitation.email';
export { roleChangedEmail } from './role-changed.email';

// The admin-composed broadcast (#322). Registered under ONE name for BOTH
// `admin.broadcast` and `admin.broadcast_critical` — the two keys differ in
// whether a recipient may mute them, not in how the message reads.
export { broadcastEmail } from './broadcast.email';

// The four operational templates (#288). Exported individually as well as
// through the registry, for the same reason as everything above: a call site
// that knows statically which message it is building gets its payload type
// checked by name.
export { jobFailedEmail } from './job-failed.email';
export { nodeOfflineEmail } from './node-offline.email';
export { backupFailedEmail } from './backup-failed.email';
export { restoreCompletedEmail } from './restore-completed.email';

// The organization invitation (#726, PP-6.7).
export { orgInvitationEmail } from './org-invitation.email';
export { groupInvitationEmail } from './group-invitation.email';

export { PLATFORM_EMAIL_TEMPLATES } from './platform-email-templates';
export type {
  PlatformEmailTemplateDataMap,
  PlatformEmailTemplateName,
} from './platform-email-templates';

export type { PlainTextOptions, RenderLayoutOptions } from './layout';
export type { EmailTemplate, RenderedEmail } from './email-template.types';
export type { TestEmailData } from './test-email.email';

// The event payload types (#128). These are the CONTRACT between a `notify()`
// call site and the template that renders it: `notify` takes `data: unknown`
// by design, so a call site that annotates its payload with one of these is
// the only place the shape gets checked at all. Every trigger point added by
// #128 does exactly that.
export type { UserWelcomeEmailData } from './user-welcome.email';
export type { AllowlistInvitationEmailData } from './allowlist-invitation.email';
export type { RoleChangedEmailData } from './role-changed.email';
export type { BroadcastEmailData } from './broadcast.email';

// The operational payload types (#288). Same contract as the ones above: the
// `notifyPermissionHolders` call site that annotates its payload with one of
// these is the only place the shape is checked at all.
export type { JobFailedEmailData } from './job-failed.email';
export type { NodeOfflineEmailData } from './node-offline.email';
export type {
  BackupFailedEmailData,
  BackupFailureOutcome,
} from './backup-failed.email';
export type { RestoreCompletedEmailData } from './restore-completed.email';
export type { OrgInvitationEmailData } from './org-invitation.email';
export type { GroupInvitationEmailData } from './group-invitation.email';

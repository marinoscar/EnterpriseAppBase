// =============================================================================
// Email template registry (issue #678, PP-1.6; templates date from #123)
// =============================================================================
//
// Name -> renderer, for every email this application can send. Until #678 this
// was the closed mapped literal `EMAIL_TEMPLATES` in `email/templates/index.ts`.
// The platform's nine templates are now the `PLATFORM_EMAIL_TEMPLATES` literal
// in `email/templates/platform-email-templates.ts` (which keeps the compile-time
// lock between a name, its data type and its renderer), an app adds its own in
// `app-registrations/notifications.ts`, and `email/templates/index.ts` reads
// this registry for `findEmailTemplate`, `renderEmailTemplate` and friends.
//
// A template is not tied to an event: `test-email` is sent by the admin test
// send with no event at all. The event -> template link is a separate registry
// (`bindings.registry.ts`), so an event may share a template (`admin.broadcast`
// and `admin.broadcast_critical` both render `broadcast`).
//
// Lives in the notifications folder for now; #737 moves it into the email
// package unchanged.
//
// FRAMEWORK-FREE: imports only the registry primitive and a type.
// =============================================================================

import { defineRegistry } from '../../common/registry';
import type { EmailTemplate } from '../../email/templates/email-template.types';

/** One registered email template. */
export interface EmailTemplateEntry {
  /**
   * Stable name: kebab-case, matching the template's file
   * (`user-welcome` -> `user-welcome.email.ts`). Persisted by delivery
   * records; never rename one, add a new name.
   */
  readonly name: string;
  /**
   * The pure renderer. Typed `EmailTemplate<never>` because the registry holds
   * templates of every payload type; `renderEmailTemplate` pins the payload by
   * name for a caller that knows it statically.
   */
  readonly render: EmailTemplate<never>;
}

/** What every template name must look like. */
export const EMAIL_TEMPLATE_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

/**
 * Every email template, in registration order (platform first). Filled by
 * `notification.manifest.ts`; frozen once the application has bootstrapped.
 */
export const emailTemplateRegistry = defineRegistry<EmailTemplateEntry>({
  name: 'email-templates',
  idOf: (entry) => entry.name,
  idPattern: EMAIL_TEMPLATE_NAME_PATTERN,
  validate: (entry) => {
    if (typeof entry.render !== 'function') {
      throw new Error('a template needs a render function');
    }
  },
  describeDuplicate: (existing) =>
    `Duplicate email template "${existing.name}". Template names are persisted; ` +
    'pick a new name instead of reusing one.',
});

/**
 * Registers email templates, all or nothing.
 *
 * @throws RegistryError `INVALID_ID`, `INVALID_ENTRY`, `DUPLICATE_ID` or `FROZEN`.
 */
export function registerEmailTemplates(entries: readonly EmailTemplateEntry[]): void {
  emailTemplateRegistry.registerAll(entries);
}

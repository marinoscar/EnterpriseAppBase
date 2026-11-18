import { registerEmailTransport } from '@marinoscar/platform-api/email';

import { logEmailTransport } from '../platform-extensions/email/log-transport';

// =============================================================================
// This app's email transports (PP-14.8)
// =============================================================================
//
// An email transport is added HERE, with `registerEmailTransport`, AT IMPORT
// TIME: the registry freezes once the application has bootstrapped, and
// `platform/email/email.config.ts` imports this file before it builds the email
// module. Like `ai.ts`, `host.ts`, `core.ts` and `storage.ts`, this file makes
// the `register` call itself.
//
// Registering is all it takes. The transport then has a `transports.<id>`
// record in the `email` settings validated by its own schema, a generated form
// on /admin/settings/email (settings and write-only secrets), a credential
// purpose for its secrets (`email_<id>`), a line in the Doctor's email check and
// its network-egress view, and, once an administrator selects it, every email
// the application sends (notifications, broadcasts, the admin "Send test email")
// goes through it. Recipe: docs/EXTENDING.md and the package README of
// `@marinoscar/platform-api/email`.
//
// The reference app registers the worked example, `log`: messages kept in
// memory and one redacted line in the application log, no mail server and no
// account. It is registered so the example is the real thing, but OFF until an
// administrator selects it and saves: a fresh install keeps whatever transport
// it had and gains a "Log (in memory)" entry in the transport list, nothing
// else. A fork that does not want it deletes the `registerEmailTransport` call
// below (and `platform-extensions/email/log-transport.ts`).
// =============================================================================

registerEmailTransport(logEmailTransport);

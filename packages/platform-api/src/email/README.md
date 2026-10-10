# @marinoscar/platform-api/email

The platform's outgoing email: pluggable transports (Amazon SES and SMTP ship; an app or package registers more with `registerEmailTransport`), the `email` settings row and its admin routes (`/api/email-settings`), the test send, the template registry with the platform's nine templates, the layout and its theme, the safe-HTML helpers and the doctor check. Moved out of the reference app's `src/email/` by issue #737 (PP-8.4). It depends on `core`, `doctor`, `identity`, `settings` (the row store, the permission strings), `credentials` (the two secrets) and `testing` of this package (`packages/platform-slices.json`), and on `@marinoscar/platform-contract/email` for the wire shapes. The conformance suite is the nested subpath `@marinoscar/platform-api/email/testing`, catalogued here.

## Purpose and scope

One place that turns "send this message" into a delivery attempt that never throws, renders every message through one escaping layout, and keeps the transport's secrets out of every response, log and audit row.

| Part | Source | What it is |
|---|---|---|
| Module | `email.module.ts`, `email.options.ts` | `EmailModule.forRoot(options)`: the providers, the controller, the doctor check; configures the render context and registers the platform templates. Not global. |
| Settings | `email-settings.service.ts`, `email-settings.schema.ts`, `email-settings-compat.ts` | `EmailSettingsService`: the `email` row of `system_settings` (`provider` plus a `transports` record, with read-compat for the flat `ses*` / `smtp*` fields), through the settings slice's `SystemSettingsRowStore` (`If-Match`, version, audit), plus every transport's secrets in `CredentialsService`. |
| Admin routes | `email-settings.controller.ts`, `email-test-send.service.ts`, `dto/` | `GET`/`PUT /api/email-settings`, `POST /api/email-settings/test` (to the caller's own address only, always HTTP 200 with `success`). |
| Transports | `transports/`, `base-email.provider.ts`, `providers/` | The `email-transport` pluggable kind (`registerEmailTransport`), `EmailTransportResolver` (the transport the settings select, built and cached), the built-ins `ses` and `smtp` registered through the same function, `BaseEmailProvider` (never throws, redacts secrets, caps errors, classifies throttles), `SesEmailProvider` (SESv2), `SmtpEmailProvider` (nodemailer). Both send inline attachments. |
| Rate limits | `email-rate-limit.ts` | `classifyEmailRateLimit`: SMTP and SES throttle rules over a generic classifier the app passes. |
| Templates | `templates/` | The registry (`registerEmailTemplate`, `findEmailTemplate`, `renderEmailTemplate`), the render context, the layout and theme, the safe-HTML helpers, the nine platform templates. Framework-free. |
| Doctor | `doctor/` | `email.config` (configured and switched on, secrets present, judged by the selected transport's own hooks) and one `email.<id>` egress entry per registered transport. |
| Test seams | `testing/` (`/email/testing`) | The `email` conformance suite and `describeEmailTransportConformance`, the kit every transport runs. |

Not here: which notification event uses which template (the notifications slice's event-to-template bindings, #738), any templating engine (MJML, React-email), and per-organization themes (deferred: no consumer).

## Install and peer dependencies

Ships inside `@marinoscar/platform-api`; import it by its subpath:

```ts
import { EmailModule, registerEmailTemplate, html, renderLayout } from '@marinoscar/platform-api/email';
```

The transports' SDKs (`nodemailer`, `@aws-sdk/client-sesv2`) are dependencies of the package. Beyond the package's own peers (`@nestjs/common`, `nestjs-zod`, `zod`), the slice needs, from the app: `SettingsModule.forRoot()` (the row store), core's `PlatformHostModule` (`PLATFORM_PRISMA` for `updatedBy`'s address, `AUDIT_SINK` for the test send's audit row), the doctor registries, and `SECRETS_ENCRYPTION_KEY` for the credential store.

## Quick start

The reference app's options ([`email.options.ts`](../../../../apps/api/src/platform/email/email.options.ts)) and binding ([`email.config.ts`](../../../../apps/api/src/platform/email/email.config.ts)):

```ts
export const EMAIL_MODULE_OPTIONS: EmailModuleOptions = {
  appName: APP_NAME,
  appUrl: () => process.env.APP_URL || 'http://localhost:3535',
  classifyRateLimit,                                    // the job queue's
  sesRegionFallback: () => process.env.SES_REGION || undefined,
};

export const EmailModule = PlatformEmailModule.forRoot(EMAIL_MODULE_OPTIONS);
```

A feature imports that one object (`imports: [EmailModule]`) and injects `EmailSettingsService` and `EmailTransportResolver` (the transport the settings select). Templates register at import time, from a manifest, never from `onModuleInit` ([`notification.manifest.ts`](../../../../apps/api/src/platform/notifications/notification.manifest.ts)):

```ts
configureEmailRendering(EMAIL_MODULE_OPTIONS);   // the same options forRoot receives
registerPlatformEmailTemplates();                // idempotent; forRoot's call is then a no-op
registerEmailTemplates(SLICE_EMAIL_TEMPLATES);   // org-invitation, group-invitation, shared-with-you
registerEmailTemplates(APP_EMAIL_TEMPLATES);
```

Rendering by name, typed: `renderEmailTemplate('user-welcome', data)`.

## Configuration

`EmailModule.forRoot(options)`. **None of these is runtime email configuration**: the transport, relay, SES identity, sender and secrets are configured at `/admin/settings/email` (the `email` row plus the credential store), never by an environment variable.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `appName` | `string` | required | The product name in subjects, the wordmark and the footer. Required: core exposes no product-identity token. |
| `appUrl` | `string \| () => string \| undefined` | none | The deployment's base URL: the test email's settings link and `EmailRenderContext.appUrl`. A function is read when needed. |
| `layout.theme.colors` | `Partial<EmailLayoutTheme['colors']>` | `background #f4f5f7`, `card #ffffff`, `border #e2e5ea`, `text #1f2937`, `muted #4b5563`, `brand #2f4f8f`, `onBrand #ffffff` | Merged colour by colour. Hex only. |
| `layout.theme.fontStack` | `string` | `Arial, Helvetica, sans-serif` | Families present on every mail client host. |
| `layout.theme.tones` | `Record<EmailTone, { color, tint, label }>` | `info #2f4f8f`, `success #1f6f43`, `warning #8a5a00`, `critical #b42318` (with tints) | The colours of `renderCallout`. |
| `layout.theme.dark` | `{ background, card, border, text, muted, accent }` | none | Emits a `prefers-color-scheme: dark` block and class hooks. Absent: no `<style>`, no class. |
| `layout.brandMark` | `EmailBrandMark` | none | An inline PNG above the product name, sent as a `Content-ID` part. |
| `layout.footerHtml` / `layout.footerText` | `SafeHtml` / `string[]` | the platform's two lines | Replace the footer of the HTML / text part. |
| `registerDefaultTemplates` | `boolean` | `true` | Register the nine platform templates (idempotent). |
| `classifyRateLimit` | `(err, now) => { rateLimited, retryAfterMs }` | none | The generic HTTP / SDK throttle classifier the email rules layer over (the reference app passes the queue's). |
| `sesRegionFallback` | `() => string \| undefined` | none | The SES region when the settings name none (the reference app reads its existing `SES_REGION`). |

With no `layout` option every platform template renders byte for byte what the pre-package layout did (`test/email/templates/templates.snapshot.spec.ts`).

## Extension-point catalog

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `EmailModule.forRoot` | option | `forRoot(options: EmailModuleOptions): DynamicModule` | Mount the slice once, with the product name, URL, look and classifier | experimental | [example](../../../../apps/api/src/platform/email/email.config.ts) |
| `configureEmailRendering` | option | `configureEmailRendering(options: EmailRenderingOptions): EmailRenderContext` | Configure rendering where templates render before Nest composes modules (a manifest, a seed), with forRoot's options | experimental | [example](../../../../apps/api/src/platform/notifications/notification.manifest.ts) |
| `registerEmailTemplate` | registry | `registerEmailTemplate<K>(name: K, template: EmailTemplate<EmailTemplateDataMap[K]>, opts?: { override?, registrant? }): void` | Add an app template; `{ override: true }` replaces an existing one on purpose | experimental | [example](../../../../apps/api/test/email/email-extension-points.spec.ts) |
| `emailTemplateRegistry` | registry | `Registry<EmailTemplateEntry>` | Register a list of templates (`registerEmailTemplates`), list them, or extend them in a test | experimental | [example](../../../../apps/api/src/platform/email/templates/index.ts) |
| `EmailTemplateDataMap` | schema | `interface EmailTemplateDataMap { [name]: Data }` | Type an app template's data by module augmentation | experimental | [example](../../../../apps/api/src/platform-extensions/email/examples/example-digest.email.ts) |
| `renderEmailTemplate` | hook | `renderEmailTemplate<K>(name: K, data: EmailTemplateDataMap[K], ctx?: EmailRenderContext): RenderedEmail` | Render a template you know statically, its data checked | experimental | [example](../../../../apps/api/test/email/email-extension-points.spec.ts) |
| `findEmailTemplate` | hook | `findEmailTemplate(name: string): EmailTemplate<unknown> \| undefined` | Render by a name from persisted data; never throws | experimental | [example](../../../../apps/api/test/email/email-extension-points.spec.ts) |
| `EmailLayoutTheme` | theme-token | `{ colors, tones?, dark?, fontStack? }` | Brand the layout without forking it | experimental | [example](../../../../apps/api/src/platform-extensions/email/examples/branded-layout.example.ts) |
| `EmailBrandMark` | slot | `{ pngBase64, cid, displaySize, alt? }` | Show a logo, inline by `cid:`, never remote | experimental | [example](../../../../apps/api/src/platform-extensions/email/examples/branded-layout.example.ts) |
| `renderLayout` | hook | `renderLayout(opts: RenderLayoutOptions, ctx?): string` | Wrap a template body in the shared HTML shell | experimental | [example](../../../../apps/api/src/platform-extensions/email/examples/example-digest.email.ts) |
| `plainText` | hook | `plainText(opts: PlainTextOptions, ctx?): string` | Write the mandatory text part | experimental | [example](../../../../apps/api/src/platform-extensions/email/examples/example-digest.email.ts) |
| `html` | hook | `` html`...${value}...`: SafeHtml `` | Build markup; every interpolation is escaped | stable | [example](../../../../apps/api/src/platform-extensions/email/examples/example-digest.email.ts) |
| `SafeHtml` | hook | `SafeHtml.unsafeFromTrustedString(markup)`, `SafeHtml.EMPTY` | The one, greppable bypass, for markup literal in the source | stable | [example](../../../../apps/api/src/platform-extensions/email/examples/example-digest.email.ts) |
| `escapeHtml` | hook | `escapeHtml(value: string): string` | Escape a value by hand inside a trusted literal | stable | [example](../../../../apps/api/src/platform-extensions/email/examples/example-digest.email.ts) |
| `safeUrl` | hook | `safeUrl(value: string): string \| null` | Admit only absolute `http(s)` / `mailto` links | stable | [example](../../../../apps/api/src/platform-extensions/email/examples/example-digest.email.ts) |
| `registerEmailTransport` | registry | `registerEmailTransport<S>(def: EmailTransportDefinition<S>): void` | Add a way of sending mail (SendGrid, Postmark, a log) with its own settings, secrets and admin form; `ses` and `smtp` register through it | experimental | [example](../../../../apps/api/src/app-registrations/email.ts) |
| `emailTransportKind` | registry | `PluggableKind<EmailTransport, EmailTransportBuildContext>` | Read or describe the registered transports (ids, labels, descriptors) | experimental | [example](../../../../apps/api/test/examples/email/log-transport.spec.ts) |
| `EmailTransport` | registry | `{ send(msg): Promise<EmailSendResult>; verify?(); destroy?() }` | The object `build` returns; extend `BaseEmailProvider` to inherit never-throw, redaction and throttle classification | experimental | [example](../../../../apps/api/src/platform-extensions/email/log-transport.ts) |
| `EmailTransportDefinition` | registry | `PluggableImplementation<EmailTransport, EmailTransportBuildContext, S> & { credentialAddress?, missing?, summary?, egressCapability?, egressHosts? }` | Declare a transport: id, label, settings schema, defaults, secrets, `build` and the Doctor hooks | experimental | [example](../../../../apps/api/src/platform-extensions/email/log-transport.ts) |
| `describeEmailTransportConformance` | registry | `describeEmailTransportConformance(transport, { describe, it, expect, settings, secrets, backend, skip? }): void` | Prove a transport keeps the contract (never throws, no secret or message content in errors, attachments passed through, throttles classified) | experimental | [example](../../../../apps/api/test/examples/email/log-transport.spec.ts) |
| `emailConformanceSuite` | registry | `ConformanceSuite<EmailConformanceOptions>` | Run the slice's invariants in the app through `runPlatformConformance({ suites: { email } })` | experimental | [example](../../../../apps/api/test/email/email-conformance.spec.ts) |

Supporting exports (experimental unless noted): the module options and `EMAIL_OPTIONS`; `EmailTransportResolver`, `emailTransportDefinitions`, `getEmailTransport`, `requireEmailTransport`, `emailTransportIds`, `labelOfEmailTransport`, `describeEmailTransports`, `missingEmailTransportFields`, `emailTransportSecretAddress`, `emailTransportCredentialPurpose`, `sesEmailTransport`, `smtpEmailTransport`, `registerBuiltinEmailTransports`; `EmailSettingsService`, `EMAIL_SETTINGS_KEY` (stable), `EmailSettingsAdminView`, `CredentialStatus`; the controller, the test-send service and `formatFromHeader`; the credential addresses `SMTP_CREDENTIAL_*` and `SES_CREDENTIAL_*` with their purpose declarations (stable); the DTO classes and the re-exported contract schemas; `BaseEmailProvider`, `SecretRedactor`, `EmailMessage`, `EmailSendResult`, `EmailProvider` (stable) and `EmailAttachment`; `classifyEmailRateLimit`; the doctor check and egress contributor; `registerEmailTemplates`, `registerPlatformEmailTemplates`, `emailTemplateOverrideRegistry`, `listEmailTemplateOverrides`, `isEmailTemplateName`, `withLayoutAttachments`; `createEmailRenderContext`, `currentEmailRenderContext`, `resolveEmailRenderContext`, `isEmailRenderingConfigured`; `resolveEmailLayout`, `DEFAULT_EMAIL_LAYOUT_THEME`, `DEFAULT_EMAIL_TONES`, `renderCallout`; `TRANSACTIONAL_EMAIL_HEADERS` (stable); the nine templates and their data types; `PLATFORM_EMAIL_TEMPLATES`.

### The three rungs, for email

1. **Option.** `forRoot({ appName, layout: { theme, brandMark, footerHtml } })`: a different look for every message, no code.
2. **Registry.** `registerEmailTemplate('coach-weekly-review', template)` plus the `EmailTemplateDataMap` augmentation adds a message; `{ override: true }` replaces a platform one (EvoPath restyles `broadcast` this way). A duplicate without `override` throws `DUPLICATE_ID` naming the template; each override is logged once at bootstrap (`Email template "broadcast" is overridden by acme.`). **Template names are stable ids** once a notification event maps to them (bindings and delivery records persist them): add a name, never rename one.
3. **A transport.** `registerEmailTransport(def)` adds a way of sending mail; see [Adding an email transport](#adding-an-email-transport). It is a registry entry, not a provider token: `EmailNotificationChannel` and `EmailTestSendService` take the `EmailTransportResolver` from `EmailModule`, which builds whichever registered transport the settings name. (Providing `SmtpEmailProvider` in an app module never reached those consumers, and no longer needs to.)

### Adding an email transport

A transport is a [pluggable kind](../core/README.md#pluggable-kinds) (`emailTransportKind`, kind id `email-transport`). The recipe, step by step, with the worked example: [docs/EXTENDING.md, Add an email transport](../../../../docs/EXTENDING.md#add-an-email-transport).

```ts
// apps/api/src/app-registrations/email.ts, imported by platform/email/email.config.ts BEFORE forRoot()
registerEmailTransport({
  id: 'sendgrid',                                   // ^[a-z][a-z0-9-]{1,47}$, permanent once a row exists
  label: 'SendGrid',
  settingsSchema: z.object({ apiBase: z.string().trim().describe('API base URL').meta({ label: 'API base URL' }) }),
  defaults: { apiBase: 'https://api.sendgrid.com' },
  secrets: [{ name: 'apiKey', label: 'API key', required: true }],   // encrypted at the credential purpose email_sendgrid
  build: ({ settings, secret, logger, classifyRateLimit }) => new SendgridTransport(settings.apiBase, () => secret('apiKey'), logger, classifyRateLimit),
  egressHosts: (settings) => [new URL(settings.apiBase).host],
});
```

| Member | Meaning |
|---|---|
| `id`, `label`, `description?` | The id is the key of `transports`, the value of `provider` and the suffix of the credential purpose. The label is what the admin page, the Doctor, the egress view and the test email call it. |
| `settingsSchema`, `defaults` | A `z.object` of the **non-secret** settings; a field named like a secret is refused at registration. The defaults parse with the schema. |
| `secrets` | `{ name, label, required, help? }[]`, stored encrypted at `email_<id>` (override with `credentialAddress(name)`, as the built-ins do). Read one with `await secret(name)` in `build`'s input, at send time. |
| `build(input)` | `{ logger, classifyRateLimit?, sesRegionFallback?, settings, secret }` in, an `EmailTransport` out. Called when the transport's settings change; the previous one is `destroy()`ed. |
| `missing`, `summary` | What the Doctor reports as unset (default: every required secret that is absent) and its phrase for a complete configuration (default: the label). |
| `egressCapability`, `egressHosts` | The capability name and hosts of the `email.<id>` network-egress entry (default: `Email (<label>)` and none). |

**What an `EmailTransport` must do.** `send(message)` never throws: every failure is `{ success: false, error }`, the error text carries no secret and no message content, attachments and headers are passed through, and a provider throttle is `rateLimited: true` (with `retryAfterMs` when the vendor named one). Extend `BaseEmailProvider` and write `deliver`; it does all four. `verify?()` is a pre-flight the admin **Send test email** runs before it sends (never the Doctor, which does not touch the network); it returns `{ ok, message }` and never throws.

**The stored shape.** `{ provider, enabled, fromAddress, fromName, transports: { <id>: settings } }`. `PUT /api/email-settings` merges `transports.<id>` over what is stored (`null` removes a transport's settings), validates it with the transport's schema, and takes write-only secrets in `secrets.<id>.<name>` (blank keeps the stored one). The flat `sesRegion`, `sesAccessKeyId`, `smtpHost`, `smtpPort`, `smtpUseTls` and `smtpUsername` of an earlier release are read into `transports.ses` and `transports.smtp`, served as a deprecated read view, and accepted on `PUT` as aliases.

**Proving it.** `describeEmailTransportConformance` of `@marinoscar/platform-api/email/testing`, run over `ses` and `smtp` ([`builtin-transports.conformance.spec.ts`](../../test/email/transports/builtin-transports.conformance.spec.ts)) and over the app's example ([`log-transport.spec.ts`](../../../../apps/api/test/examples/email/log-transport.spec.ts)).

### Writing a template

A template is `(data, ctx?) => RenderedEmail`: pure, synchronous, total. Resolve the context (`resolveEmailRenderContext(ctx)`), build the body with `html`, wrap it with `renderLayout(..., context)`, write the text part with `plainText(..., context)`, spread `TRANSACTIONAL_EMAIL_HEADERS`. The layout's inline parts (the brand mark) are added by `renderEmailTemplate` / `findEmailTemplate`; a template never has to remember them.

## Data

No model of its own. The configuration is the `email` row of `system_settings` (owned by the settings slice), read and written only through `SystemSettingsRowStore`; **the key `'email'` is permanent** (`EMAIL_SETTINGS_KEY`). The built-in secrets are credential-store rows `smtp/default` and `email_ses/default` (purposes declared by `SMTP_CREDENTIAL_PURPOSE_DEF` and `SES_CREDENTIAL_PURPOSE_DEF`, registered by the app's credential manifest); a transport an app registers keeps its secrets at the purpose `email_<id>`, registered by `registerEmailTransport`. Audit rows: `email_settings:replace` (meta: the row key and version, the new value, and whether each secret changed, by `transport.secret` name) and `email_settings:test` (provider, success, error). `updatedBy` reads `users.id` and `users.email` through `PLATFORM_PRISMA`. No migration.

## Permissions and settings

Declares no permission. Every route reuses the settings slice's: `GET /api/email-settings` needs `system_settings:read`; `PUT /api/email-settings` and `POST /api/email-settings/test` need `system_settings:write` (a test send originates mail, so reading is not enough). The `Email` admin card declares the same `system_settings:read`. Reads the `email` row; no namespace in the main settings document.

## UI

None in this slice. The page (`/admin/settings/email`) and its hook are `@marinoscar/platform-web/email`.

## Infra

None. No environment variable for SMTP or SES: they are runtime-configured. The reference app's `appUrl` and `sesRegionFallback` read its existing `APP_URL` and `SES_REGION` deployment variables (`infra/compose/.env.example`).

## Observability

Logs through Nest's `Logger`: settings saves (user id and which secrets changed, never values), invalid stored rows (field paths only), each send failure (transport, redacted and capped error, `(provider rate limit)` when throttled), each test send, and each template override at bootstrap. No metrics or spans of its own; the SDK calls are traced by the app's HTTP auto-instrumentation.

## Security notes

- **Escaping is the default.** Every interpolation in `html` is escaped; `SafeHtml.unsafeFromTrustedString` is the only bypass (grep for it in review), for markup literal in the source. Layouts take `SafeHtml`, never `string`, so concatenated markup does not compile. Subjects are plain text and never escaped.
- **Secrets live in the credential store only.** The settings schema and the response carry compile-time proofs of no secret-bearing field; the PUT body's `secrets` (and the aliases `smtpPassword` / `sesSecretAccessKey`) are write-only and blank preserves. `getSecret` (plaintext) is called only through a transport's `secret(name)`, at send time. `SecretRedactor` scrubs every registered secret from provider errors before they are logged or returned; no secret appears in any response, log or audit row (`apps/api/test/settings/email-settings.integration.spec.ts`).
- **No remote images.** Remote content is blocked by default in every major client and reads as a tracking pixel, so the brand mark ships inside the message as a `Content-ID` part and the HTML references it by `cid:`. Theme colours are hex-only and the font stack a list of names, because they land in `style` attributes and the dark-mode `<style>` block, where no HTML escaping applies.
- **The test send cannot target anyone else**: there is no recipient parameter; it goes to the caller's own address.

## Conformance suite

Importing `@marinoscar/platform-api/email/testing` registers the `email` suite with `runPlatformConformance()`. Run it after the app's manifest (or `forRoot`) has registered its templates and configured rendering:

```ts
import { runPlatformConformance } from '@marinoscar/platform-api/testing';
import '@marinoscar/platform-api/email/testing';
import '../../src/notifications/registry';

runPlatformConformance({ sourceRoots: [API_SOURCE_ROOT], suites: { email: { samples: { 'org-invitation': {...} } } } });
```

| Case | Fails when |
|---|---|
| `defaults` | A platform template is not registered (skipped with `withoutDefaultTemplates`) |
| `renders` | A sampled template (the platform's nine, plus `samples`) throws, renders an empty subject or text, no complete HTML document, or puts markup from its data into the HTML unescaped; or rendering was never configured |
| `no-secret` | The stored settings or the admin response declares a secret-bearing field |

The transport kit is separate: `describeEmailTransportConformance(transport, options)` (see [Adding an email transport](#adding-an-email-transport)). Its cases:

| Case | Fails when |
|---|---|
| definition | The id or label is malformed, the defaults do not parse, the declared secrets and the supplied ones differ, or `build` returns no `send` |
| accepts | An accepted message is not `{ success: true }` |
| neverThrows | `send` rejects for a network error, a thrown string or a thrown object, or the failed result has no error text |
| errorHygiene | The error text carries the recipient, the subject, the body or a secret the backend echoed back |
| attachments | An inline part, a plain attachment or a header is dropped or altered, or the message goes to more than its one recipient |
| rateLimit | A throttle is not `rateLimited: true`, or an ordinary failure is |
| verify | `verify`, when defined, throws or returns a message carrying a secret |

## Upgrade notes

New subpath in this version. From the reference app's local `src/email/` (#737):

- Import from `@marinoscar/platform-api/email`; mount `EmailModule.forRoot({ appName, ... })` once and import that object where `EmailModule` was imported.
- `APP_NAME` is gone from the email module: templates read `context.appName`, `renderLayout` and `plainText` take the context as a second argument (optional: the configured one is used).
- `EMAIL_TEMPLATES` and `EMAIL_TEMPLATE_NAMES` are removed: use `emailTemplateRegistry`, `findEmailTemplate`, `isEmailTemplateName`. `findEmailTemplate` returns a renderer that fills in the context and the layout's inline parts, not the registered function itself.
- `org-invitation`, `group-invitation` and `shared-with-you` are not platform defaults any more: they belong to the slices that own their words and register through the registry (the reference app's `src/platform/email/templates/`).
- `EmailTestSendService` audits through `AUDIT_SINK`; `EmailSettingsService` needs `SystemSettingsRowStore` and `PLATFORM_PRISMA`; `SesEmailProvider` takes `(settings, credentials, options?)`.
- The queue's rate-limit classifier is an option (`classifyRateLimit`); without it only the SMTP and SES wording rules apply.
- Stored secrets and audit actions are unchanged; the row key stays `'email'`. The row itself is read in either shape and rewritten as `{ provider, enabled, fromAddress, fromName, transports }` on the next save.
- Transports are pluggable (`registerEmailTransport`). `EmailNotificationChannel` and `EmailTestSendService` take an `EmailTransportResolver` instead of `SesEmailProvider` and `SmtpEmailProvider`; the two classes now take a `Pick<EmailSettingsService, 'get'>` and a `Pick<CredentialsService, 'getSecret'>`. The Doctor's egress entries are listed in registration order (`email.ses`, `email.smtp`, then the app's). `EmailProviderKind` is a `string` and `EMAIL_PROVIDER_KINDS` a deprecated alias of `BUILTIN_EMAIL_PROVIDER_KINDS`.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Email rendering is not configured` | A template rendered before `forRoot` or `configureEmailRendering` ran | Call `configureEmailRendering(options)` in the manifest that renders or registers early, with forRoot's options |
| `Duplicate email template "x" ...` at boot | Two registrations of one name | Rename the app's template, or pass `{ override: true }` on purpose |
| `... is not registered, so there is nothing to override` | An override registered before (or without) the template it replaces | Register overrides after `registerPlatformEmailTemplates()` |
| Test send: `MessageRejected: Email address is not verified` | The SES account is in the **sandbox**, or the identity is verified in another region | Verify the sender (and, in the sandbox, the recipient) in the region the settings name, or request production access |
| Test send: `No SES region is configured` | No `sesRegion` setting and no `sesRegionFallback` | Set the region on the page (or `SES_REGION` in the reference app) |
| Test send: `wrong version number`, a greeting timeout, or `Must issue a STARTTLS command first` | Port and TLS mismatch: **465 is implicit TLS**, every other port uses STARTTLS, which is REQUIRED when "Require TLS" is on | Use 465 for implicit TLS or 587 for STARTTLS; turn "Require TLS" off only for a relay that cannot upgrade, on a trusted network |
| Test send: `535 Authentication failed` | Wrong SMTP username or password | Re-enter the password (blank keeps the stored one) |
| A broken-image box where the logo should be | A message built by hand without the rendered `attachments` | Send what `renderEmailTemplate` returns, `attachments` included |
| The brand mark is missing from notification emails (but present in the test email) | A notification email channel that builds its message from `subject`, `html`, `text` and `headers` only (the platform's forwards `attachments` since #738) | Forward `rendered.attachments` in a custom channel, as `@marinoscar/platform-api/notifications`'s email channel does |
| `GET /api/email-settings` shows `settingsError` | The stored row no longer validates, or a registered transport's stored settings no longer parse with its schema (`transports.smtp.port`) | Correct the named fields and save; the page renders defaults until then |
| Test send or notification: `Email transport "x" is not registered` | `provider` names a transport that is no longer registered (a plugin removed, or the registration not imported before `forRoot`) | Choose another transport at `/admin/settings/email`, or import the module that calls `registerEmailTransport` before the email module is built |
| `PUT /api/email-settings` answers `EMAIL_UNKNOWN_TRANSPORT`, `EMAIL_TRANSPORT_SETTINGS_INVALID` or `EMAIL_UNKNOWN_SECRET` | A transport id nobody registered, a setting its schema refuses, or a secret it never declared | Fix the body; `details` names the transport and the fields |
| `registerEmailTransport` throws `FROZEN` | It ran after the application bootstrapped | Register at import time, from the app's `app-registrations/email.ts`, which the email config imports first |
| `registerEmailTransport` throws "looks like a secret" | A `settingsSchema` field is named `apiKey`, `password`, `token`, ... | Declare it in `secrets` instead |

## Links

- [Package README](../../README.md)
- [Platform packages spec](../../../../docs/specs/platform-packages.md)
- [Contract](../../../platform-contract/src/email/README.md)
- [Web counterpart](../../../platform-web/src/email/README.md)
- [Settings slice (the row store)](../settings/README.md)
- [Credentials slice (the secrets)](../credentials/README.md)
- [Notifications: write the templates](../notifications/README.md)
- [Package documentation standard](../../../../docs/PACKAGES.md)

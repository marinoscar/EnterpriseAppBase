# @marinoscar/platform-api/email

The platform's outgoing email: the Amazon SES and SMTP transports, the `email` settings row and its admin routes (`/api/email-settings`), the test send, the template registry with the platform's nine templates, the layout and its theme, the safe-HTML helpers and the doctor check. Moved out of the reference app's `src/email/` by issue #737 (PP-8.4). It depends on `core`, `doctor`, `identity`, `settings` (the row store, the permission strings), `credentials` (the two secrets) and `testing` of this package (`packages/platform-slices.json`), and on `@marinoscar/platform-contract/email` for the wire shapes. The conformance suite is the nested subpath `@marinoscar/platform-api/email/testing`, catalogued here.

## Purpose and scope

One place that turns "send this message" into a delivery attempt that never throws, renders every message through one escaping layout, and keeps the transport's secrets out of every response, log and audit row.

| Part | Source | What it is |
|---|---|---|
| Module | `email.module.ts`, `email.options.ts` | `EmailModule.forRoot(options)`: the providers, the controller, the doctor check; configures the render context and registers the platform templates. Not global. |
| Settings | `email-settings.service.ts`, `email-settings.schema.ts` | `EmailSettingsService`: the `email` row of `system_settings`, through the settings slice's `SystemSettingsRowStore` (`If-Match`, version, audit), plus the SMTP password and SES secret in `CredentialsService`. |
| Admin routes | `email-settings.controller.ts`, `email-test-send.service.ts`, `dto/` | `GET`/`PUT /api/email-settings`, `POST /api/email-settings/test` (to the caller's own address only, always HTTP 200 with `success`). |
| Transports | `base-email.provider.ts`, `providers/` | `BaseEmailProvider` (never throws, redacts secrets, caps errors, classifies throttles), `SesEmailProvider` (SESv2), `SmtpEmailProvider` (nodemailer). Both send inline attachments. |
| Rate limits | `email-rate-limit.ts` | `classifyEmailRateLimit`: SMTP and SES throttle rules over a generic classifier the app passes. |
| Templates | `templates/` | The registry (`registerEmailTemplate`, `findEmailTemplate`, `renderEmailTemplate`), the render context, the layout and theme, the safe-HTML helpers, the nine platform templates. Framework-free. |
| Doctor | `doctor/` | `email.config` (configured and switched on, secrets present) and the `email.smtp` / `email.ses` egress entries. |
| Test seams | `testing/` (`/email/testing`) | The `email` conformance suite. |

Not here: which notification event uses which template (the notifications slice's event-to-template bindings, #738), new transports (the provider kind list stays closed; see the provider-token route below), any templating engine (MJML, React-email), and per-organization themes (deferred: no consumer).

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

A feature imports that one object (`imports: [EmailModule]`) and injects `EmailSettingsService` and the two providers. Templates register at import time, from a manifest, never from `onModuleInit` ([`notification.manifest.ts`](../../../../apps/api/src/platform/notifications/notification.manifest.ts)):

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
| `emailConformanceSuite` | registry | `ConformanceSuite<EmailConformanceOptions>` | Run the slice's invariants in the app through `runPlatformConformance({ suites: { email } })` | experimental | [example](../../../../apps/api/test/email/email-conformance.spec.ts) |

Supporting exports (experimental unless noted): the module options and `EMAIL_OPTIONS`; `EmailSettingsService`, `EMAIL_SETTINGS_KEY` (stable), `EmailSettingsAdminView`, `CredentialStatus`; the controller, the test-send service and `formatFromHeader`; the credential addresses `SMTP_CREDENTIAL_*` and `SES_CREDENTIAL_*` with their purpose declarations (stable); the DTO classes and the re-exported contract schemas; `BaseEmailProvider`, `SecretRedactor`, `EmailMessage`, `EmailSendResult`, `EmailProvider` (stable) and `EmailAttachment`; `classifyEmailRateLimit`; the doctor check and egress contributor; `registerEmailTemplates`, `registerPlatformEmailTemplates`, `emailTemplateOverrideRegistry`, `listEmailTemplateOverrides`, `isEmailTemplateName`, `withLayoutAttachments`; `createEmailRenderContext`, `currentEmailRenderContext`, `resolveEmailRenderContext`, `isEmailRenderingConfigured`; `resolveEmailLayout`, `DEFAULT_EMAIL_LAYOUT_THEME`, `DEFAULT_EMAIL_TONES`, `renderCallout`; `TRANSACTIONAL_EMAIL_HEADERS` (stable); the nine templates and their data types; `PLATFORM_EMAIL_TEMPLATES`.

### The three rungs, for email

1. **Option.** `forRoot({ appName, layout: { theme, brandMark, footerHtml } })`: a different look for every message, no code.
2. **Registry.** `registerEmailTemplate('coach-weekly-review', template)` plus the `EmailTemplateDataMap` augmentation adds a message; `{ override: true }` replaces a platform one (EvoPath restyles `broadcast` this way). A duplicate without `override` throws `DUPLICATE_ID` naming the template; each override is logged once at bootstrap (`Email template "broadcast" is overridden by acme.`). **Template names are stable ids** once a notification event maps to them (bindings and delivery records persist them): add a name, never rename one.
3. **Token.** Not supported yet, see PP-14.8 (#926). A provider of `SmtpEmailProvider` (or `SesEmailProvider`) in the app's own module does not reach the package's consumers (`EmailNotificationChannel`, `EmailTestSendService`): they take the concrete classes from `EmailModule`, and Nest resolves them there first. No transport registry exists until PP-14.8 adds one; the selectable transports are `ses` and `smtp`. [EXTENDING.md](../../../../docs/EXTENDING.md#add-an-email-transport) tracks the recipe.

### Writing a template

A template is `(data, ctx?) => RenderedEmail`: pure, synchronous, total. Resolve the context (`resolveEmailRenderContext(ctx)`), build the body with `html`, wrap it with `renderLayout(..., context)`, write the text part with `plainText(..., context)`, spread `TRANSACTIONAL_EMAIL_HEADERS`. The layout's inline parts (the brand mark) are added by `renderEmailTemplate` / `findEmailTemplate`; a template never has to remember them.

## Data

No model of its own. The configuration is the `email` row of `system_settings` (owned by the settings slice), read and written only through `SystemSettingsRowStore`; **the key `'email'` is permanent** (`EMAIL_SETTINGS_KEY`). The two secrets are credential-store rows `smtp/default` and `email_ses/default` (purposes declared by `SMTP_CREDENTIAL_PURPOSE_DEF` and `SES_CREDENTIAL_PURPOSE_DEF`, registered by the app's credential manifest). Audit rows: `email_settings:replace` (meta: the row key and version, the new value, and whether each secret changed) and `email_settings:test` (provider, success, error). `updatedBy` reads `users.id` and `users.email` through `PLATFORM_PRISMA`. No migration.

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
- **Secrets live in the credential store only.** The settings schema and the response carry compile-time proofs of no secret-bearing field; the PUT body's `smtpPassword` / `sesSecretAccessKey` are write-only and blank preserves. `getSecret` (plaintext) is called only by the two providers, at send time. `SecretRedactor` scrubs every registered secret from provider errors before they are logged or returned; no secret appears in any response, log or audit row (`apps/api/test/settings/email-settings.integration.spec.ts`).
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

## Upgrade notes

New subpath in this version. From the reference app's local `src/email/` (#737):

- Import from `@marinoscar/platform-api/email`; mount `EmailModule.forRoot({ appName, ... })` once and import that object where `EmailModule` was imported.
- `APP_NAME` is gone from the email module: templates read `context.appName`, `renderLayout` and `plainText` take the context as a second argument (optional: the configured one is used).
- `EMAIL_TEMPLATES` and `EMAIL_TEMPLATE_NAMES` are removed: use `emailTemplateRegistry`, `findEmailTemplate`, `isEmailTemplateName`. `findEmailTemplate` returns a renderer that fills in the context and the layout's inline parts, not the registered function itself.
- `org-invitation`, `group-invitation` and `shared-with-you` are not platform defaults any more: they belong to the slices that own their words and register through the registry (the reference app's `src/platform/email/templates/`).
- `EmailTestSendService` audits through `AUDIT_SINK`; `EmailSettingsService` needs `SystemSettingsRowStore` and `PLATFORM_PRISMA`; `SesEmailProvider` takes `(settings, credentials, options?)`.
- The queue's rate-limit classifier is an option (`classifyRateLimit`); without it only the SMTP and SES wording rules apply.
- Stored settings, secrets and audit actions are unchanged; the row key stays `'email'`.

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
| `GET /api/email-settings` shows `settingsError` | The stored row no longer validates | Correct the named fields and save; the page renders defaults until then |

## Links

- [Package README](../../README.md)
- [Platform packages spec](../../../../docs/specs/platform-packages.md)
- [Contract](../../../platform-contract/src/email/README.md)
- [Web counterpart](../../../platform-web/src/email/README.md)
- [Settings slice (the row store)](../settings/README.md)
- [Credentials slice (the secrets)](../credentials/README.md)
- [Notifications: write the templates](../notifications/README.md)
- [Package documentation standard](../../../../docs/PACKAGES.md)

# @marinoscar/platform-web/email

The browser half of the email slice (issue #737, PP-8.4): the `/admin/settings/email` page and its hook, moved from the reference app with their behaviour unchanged. Two subpaths: `/email/headless` (`useEmailSettings` and its types, no component) and `/email/ui` (`EmailSettingsPage`, default and named export). It depends on `core` of this package (the host transport and viewer; `packages/platform-slices.json` also lists `settings` and `credentials`) and on `@marinoscar/platform-contract/email` for the wire shapes.

## Purpose and scope

The page an administrator configures outgoing mail on: the transport (SES or SMTP), its connection, the sender, the two write-only secrets, the master switch, and a test send to their own address that shows the provider's verbatim answer.

Not here: the API (`@marinoscar/platform-api/email`), the settings card (the app's `ADMIN_SECTIONS` declares the `Email` card), and the notification preferences page (the notifications slice).

## Install and peer dependencies

Ships inside `@marinoscar/platform-web`; import it by its subpaths:

```ts
import { useEmailSettings } from '@marinoscar/platform-web/email/headless';
const EmailSettingsPage = lazy(() => import('@marinoscar/platform-web/email/ui'));
```

`/ui` needs the package's MUI peers (`@mui/material`, `@mui/icons-material`, `@emotion/react`, `@emotion/styled`), React and `react-router-dom` (the page redirects a viewer without access). `/headless` needs React. Both need a `PlatformHostProvider` above them (or, for the hook, an `api` option).

## Quick start

The reference app routes the page behind the card's permission ([`App.tsx`](../../../../apps/web/src/App.tsx)):

```tsx
const EmailSettingsPage = lazy(() => import('@marinoscar/platform-web/email/ui'));

<Route
  path="/admin/settings/email"
  element={
    <RequirePermission permission="system_settings:read" fallback={<Navigate to="/" replace />}>
      <EmailSettingsPage />
    </RequirePermission>
  }
/>
```

The host's viewer supplies the permissions and, for the "sends to your own address" line, the optional `email` ([`platformHost.tsx`](../../../../apps/web/src/platform/platformHost.tsx)).

## Configuration

| Option | Type | Default | Meaning |
|---|---|---|---|
| `useEmailSettings({ api })` | `PlatformApiClient` | the host's | The transport, when the hook runs outside `PlatformHostProvider` |

The page takes no props.

## Extension-point catalog

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `useEmailSettings` | hook | `useEmailSettings(options?: { api? }): UseEmailSettingsReturn` | Build your own email settings page over the same load, save and test-send contract | experimental | [example](../../../../apps/web/src/__tests__/pages/Admin/EmailSettingsPage.test.tsx) |
| `EmailSettingsPage` | component | `EmailSettingsPage(): ReactElement` | Route `/admin/settings/email` | experimental | [example](../../../../apps/web/src/App.tsx) |

Supporting exports (experimental): the types `EmailSettings`, `EmailSettingsInput`, `EmailTestResult`, `SmtpPasswordStatus`, `EmailProviderKind`, `UseEmailSettingsOptions`, `UseEmailSettingsReturn`.

## Data

None. The page reads and writes `/api/email-settings` only.

## Permissions and settings

The page is reached with `system_settings:read` (the `Email` card's permission, the exact string `GET /api/email-settings` enforces; a viewer without it is redirected to `/`). Saving and the test send need `system_settings:write`: without it the controls are disabled with a stated reason and the subtitle says "(read-only)". No settings of its own.

## UI

`EmailSettingsPage`, an MUI page in the Console's settings layout: the provider radios, the SES and SMTP field groups, the sender, the secrets (blank keeps the stored one; the helper text names the saved hint), the enable switch, Save (with `If-Match`; a 409 reloads the form and says so) and "Send test email" (to the caller; a refused send renders as a failure with the provider's text, never as success). The app's admin registry entry (`ADMIN_SECTIONS`, title `Email`, `permission: 'system_settings:read'`) is unchanged by the move.

## Infra

None.

## Observability

None. The page emits no telemetry of its own; the API logs and audits saves and test sends.

## Security notes

- The secrets are write-only: the page never receives them (the response carries a masked status), and it sends a secret only when the admin typed one (an omitted key keeps the stored value). `EmailSettingsPage.wire.test.tsx` asserts the request body.
- The test goes to the signed-in viewer's own address; there is no recipient field.
- The provider's error is shown verbatim: it is already redacted of every credential and capped by the API.

## Conformance suite

None in the web package for this slice. The API slice's `email` suite covers the shapes; the reference app's page tests (`apps/web/src/__tests__/pages/Admin/EmailSettingsPage*.test.tsx`) render this package's page.

## Upgrade notes

New subpaths in this version. From the reference app's `pages/Admin/EmailSettingsPage.tsx` and `hooks/useEmailSettings.ts` (#737):

- Lazy-load the page from `@marinoscar/platform-web/email/ui`; import the hook and types from `/email/headless` (the app's `getEmailSettings`, `updateEmailSettings`, `sendTestEmail` and email types are gone).
- The page reads permissions from the host viewer instead of the app's `usePermissions`, and the address from the new optional `PlatformViewer.email`; set it in the app's host.
- To mock the hook in a page test, mock `@marinoscar/platform-web/email/headless`.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `useEmailSettings needs a transport` | No `PlatformHostProvider` above the page | Mount the provider (from `/core`), also in test wrappers, or pass `{ api }` |
| "Sends a real message to your own address, ." | The host's viewer has no `email` | Set `viewer.email` in the app's host |
| Save always reloads the form | Another admin saved in between (409), or the app's transport drops `ifMatch` | Review and save again; make the transport send `If-Match` |

## Links

- [Package README](../../README.md)
- [The API slice](../../../platform-api/src/email/README.md)
- [The contract](../../../platform-contract/src/email/README.md)
- [Settings UI spec](../../../../docs/specs/settings-ui.md)
- [Package documentation standard](../../../../docs/PACKAGES.md)

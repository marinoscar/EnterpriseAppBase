# @marinoscar/platform-web/email

The browser half of the email slice (issue #737, PP-8.4): the `/admin/settings/email` page and its hook, moved from the reference app, and, since the transports became pluggable (PP-14.8), the panel registry that chooses the form each transport is configured with. Three subpaths: `/email/headless` (`useEmailSettings` and its types, no component), `/email/ui` (`EmailSettingsPage`, default and named export, and the panel registry) and `/email/ui/transport-panels` (the registry alone, for an app that registers a panel from its main chunk). It depends on `core` of this package (the host transport and viewer; `packages/platform-slices.json` also lists `settings` and `credentials`) and on `@marinoscar/platform-contract/email` for the wire shapes.

## Purpose and scope

The page an administrator configures outgoing mail on: the transport (one radio per transport the API describes: SES and SMTP, and any an app registered), its connection, the sender, the write-only secrets, the master switch, and a test send to their own address that shows the provider's verbatim answer. The two built-in transports draw their own forms through the same registry an app uses; any other transport gets a form generated from its descriptor, so an app that registers a transport on the API needs no web code.

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
| `registerEmailTransportPanel` | registry | `registerEmailTransportPanel(id: string, Component: EmailTransportPanelComponent, options?: { validate?, toForm?, toInput? }): void` | Replace the generated form of one transport; call it at module scope, before the page renders | experimental | [example](../../../../apps/web/src/__tests__/examples/email/log-transport-panel.test.tsx) |
| `EmailTransportPanelProps` | slot | `{ transport, descriptor, settings, value, onChange, secrets, onSecretChange, secretStatuses, errors, canWrite }` | The props of a transport panel: it presents and collects, the page owns the state and the save | experimental | [example](../../../../apps/web/src/__tests__/examples/email/log-transport-panel.test.tsx) |
| `EmailGenericTransportPanel` | component | `EmailGenericTransportPanel(props: EmailTransportPanelProps): ReactElement` | The generated form (settings and write-only secrets from the descriptor); wrap it to add to it | experimental | [example](../../../../apps/web/src/__tests__/examples/email/log-transport-panel.test.tsx) |

Supporting exports (experimental): the types `EmailSettings`, `EmailSettingsInput`, `EmailTestResult`, `SmtpPasswordStatus`, `EmailProviderKind`, `UseEmailSettingsOptions`, `UseEmailSettingsReturn`, `EmailTransportPanelComponent`, `EmailTransportPanelOptions`; `getEmailTransportPanel`; and, from `/email/headless`, `withTransportDefaults` (completes a response from an API that predates the transports from its flat fields).

### Choosing the form of a transport

```tsx
import { EmailGenericTransportPanel, registerEmailTransportPanel } from '@marinoscar/platform-web/email/ui/transport-panels';

registerEmailTransportPanel('sendgrid', (props) => <EmailGenericTransportPanel {...props} />, {
  validate: (value, { enabled }) => (enabled && !value.apiBase ? { apiBase: 'An API base URL is required.' } : {}),
});
```

- `validate(value, { enabled })` checks the SELECTED transport's settings; a non-empty result disables Save and is handed to the panel as `errors`.
- `toForm(settings)` and `toInput(value)` convert between what the API stores and what the panel edits (the SMTP panel edits the port as text). Defaults: the identity, and a text setting nobody filled in sent as `''`.
- An app's registration wins over a built-in's, whichever module loads first. The registry is a presentation choice: the API validates every save.

## Data

None. The page reads and writes `/api/email-settings` only.

## Permissions and settings

The page is reached with `system_settings:read` (the `Email` card's permission, the exact string `GET /api/email-settings` enforces; a viewer without it is redirected to `/`). Saving and the test send need `system_settings:write`: without it the controls are disabled with a stated reason and the subtitle says "(read-only)". No settings of its own.

## UI

`EmailSettingsPage`, an MUI page in the Console's settings layout: the provider radios (one per described transport, labelled by the transport), the selected transport's form (the SES and SMTP field groups for the built-ins, a generated form for any other), the sender, the secrets (blank keeps the stored one; the helper text names the saved hint), the enable switch, Save (with `If-Match`; a 409 reloads the form and says so) and "Send test email" (to the caller; a refused send renders as a failure with the provider's text, never as success). The app's admin registry entry (`ADMIN_SECTIONS`, title `Email`, `permission: 'system_settings:read'`) is unchanged by the move.

## Infra

None.

## Observability

None. The page emits no telemetry of its own; the API logs and audits saves and test sends.

## Security notes

- The secrets are write-only: the page never receives them (the response carries a masked status per declared secret), and it sends a secret only when the admin typed one, under `secrets.<transport>.<name>` (an omitted key keeps the stored value). Only the selected transport's settings and secrets are sent. `EmailSettingsPage.wire.test.tsx` asserts the request body.
- The test goes to the signed-in viewer's own address; there is no recipient field.
- The provider's error is shown verbatim: it is already redacted of every credential and capped by the API.

## Conformance suite

None in the web package for this slice. The API slice's `email` suite covers the shapes; the reference app's page tests (`apps/web/src/__tests__/pages/Admin/EmailSettingsPage*.test.tsx`) render this package's page. The built-in forms are pinned by a DOM snapshot recorded from the page before the panels moved (`test/email/EmailSettingsPage.builtin-dom.test.tsx`); re-record it only for a deliberate change to them.

## Upgrade notes

New subpaths in this version. From the reference app's `pages/Admin/EmailSettingsPage.tsx` and `hooks/useEmailSettings.ts` (#737):

- Lazy-load the page from `@marinoscar/platform-web/email/ui`; import the hook and types from `/email/headless` (the app's `getEmailSettings`, `updateEmailSettings`, `sendTestEmail` and email types are gone).
- The page reads permissions from the host viewer instead of the app's `usePermissions`, and the address from the new optional `PlatformViewer.email`; set it in the app's host.
- To mock the hook in a page test, mock `@marinoscar/platform-web/email/headless`.
- Since the transports became pluggable the response carries `transports`, `descriptors` and `secretStatuses`, and the save sends `{ provider, enabled, fromAddress, fromName, transports: { <selected>: settings }, secrets: { <selected>: { <name>: value } } }` instead of the flat `ses*` / `smtp*` fields and `smtpPassword` / `sesSecretAccessKey`. The API still accepts the old body.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `useEmailSettings needs a transport` | No `PlatformHostProvider` above the page | Mount the provider (from `/core`), also in test wrappers, or pass `{ api }` |
| "Sends a real message to your own address, ." | The host's viewer has no `email` | Set `viewer.email` in the app's host |
| A transport registered on the API shows the generated form, not mine | `registerEmailTransportPanel` ran after the page rendered, or for another id | Register at module scope in the app's entry, with the transport's id |
| A registered transport is missing from the radios | The API does not describe it (the registration is not imported before the email module is built) | Import `app-registrations/email` from the email config on the API |
| Save always reloads the form | Another admin saved in between (409), or the app's transport drops `ifMatch` | Review and save again; make the transport send `If-Match` |

## Links

- [Package README](../../README.md)
- [The API slice](../../../platform-api/src/email/README.md)
- [The contract](../../../platform-contract/src/email/README.md)
- [Settings UI spec](../../../../docs/specs/settings-ui.md)
- [Package documentation standard](../../../../docs/PACKAGES.md)

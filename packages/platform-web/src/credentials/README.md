# @marinoscar/platform-web/credentials

The browser half of the credentials slice (issue #735, PP-8.8): the write-only secret field every settings page that stores a secret renders, and its unified wording. Two subpaths: `/credentials/headless` (`savedSecretHelperText`, `secretForSubmit`, no component) and `/credentials/ui` (`SecretField`, an MUI `TextField`). It depends on no other slice of this package beyond what `packages/platform-slices.json` lists (`core`, unused today), and on `@marinoscar/platform-contract/credentials` for the shape of a stored credential.

## Purpose and scope

Five pages of the reference app each render a password field for a stored secret with their own hint sentence (storage, e-mail, the AI provider card, the telemetry connection, a user's own AI key). This slice is the one implementation they converge on: a password input that says whether a secret is saved (its non-secret hint and last change) and that leaving it blank keeps it.

Not here: the five pages themselves, which move onto `SecretField` when their slices are extracted (#736, #737, #738, #739, the telemetry follow-up), so this story edits none of them; any API call (the owning feature's page sends the value); a credentials browser (there is none, on purpose).

## Install and peer dependencies

Ships inside `@marinoscar/platform-web`; import it by its subpaths:

```ts
import { savedSecretHelperText, secretForSubmit } from '@marinoscar/platform-web/credentials/headless';
import { SecretField } from '@marinoscar/platform-web/credentials/ui';
```

`/ui` needs the package's MUI peers (`@mui/material`, `@emotion/react`, `@emotion/styled`) and React. `/headless` needs none.

## Quick start

From the reference app's example ([`WebhookSigningKeyField.tsx`](../../../../apps/web/src/platform-extensions/credentials/examples/WebhookSigningKeyField.tsx)):

```tsx
const [value, setValue] = useState('');

<SecretField
  label="Webhook signing secret"
  noun="signing secret"
  value={value}
  onChange={setValue}
  saved={saved ? { hint: saved.hint, updatedAt: saved.updatedAt } : null}
  emptyHelp="No signing secret is saved yet."
/>
<Button onClick={() => onSave(secretForSubmit(value))}>Save</Button>
```

## Configuration

`SecretField` props:

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `label` | `string` | required | The field's label. |
| `value`, `onChange` | `string`, `(value: string) => void` | required | Controlled value; `''` keeps the stored secret. |
| `saved` | `{ hint; label?; updatedAt? } \| null` | `null` | What the API says is stored (a credential info's presentation fields). |
| `emptyHelp` | `string` | `'No <noun> is saved yet.'` | The helper text when nothing is stored. |
| `noun` | `string` | `'key'` | What the secret is called in the helper text. |
| `formatDate` | `(date: Date) => string` | `toLocaleDateString()` | The last-change date format. |
| `disabled` | `boolean` | `false` | For a viewer without the write permission. |
| `error` | `string \| null` | none | Shown instead of the helper text; sets `aria-invalid`. |
| `name`, `id` | `string` | `id` generated | The input's name and id. |
| `sx` | `SxProps<Theme>` | none | Styles for the root. |
| `slots.textField` | `Partial<TextFieldProps>` | none | Props for the `TextField`, except `type`, `value` and `onChange`. |

`savedSecretHelperText(info, { noun, emptyHelp, formatDate })` takes the same options.

## Extension-point catalog

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `SecretField` | component | `SecretField(props: SecretFieldProps): ReactElement` | Render a write-only secret input with the unified "saved" helper text | experimental | [example](../../../../apps/web/src/platform-extensions/credentials/examples/WebhookSigningKeyField.tsx) |
| `SecretFieldProps` | slot | `{ label; value; onChange; saved?; emptyHelp?; noun?; formatDate?; disabled?; error?; sx?; slots?: { textField? } }` | Restyle the field or pass extra `TextField` props | experimental | [example](../../../../apps/web/src/platform-extensions/credentials/examples/WebhookSigningKeyField.tsx) |
| `savedSecretHelperText` | hook | `savedSecretHelperText(info: SavedSecretInfo \| null, options?): string` | Render your own field with the same wording | experimental | [example](../../../../apps/web/src/__tests__/platform-extensions/credentialsExamples.test.tsx) |
| `secretForSubmit` | hook | `secretForSubmit(value: string): string \| undefined` | Send a blank field as "keep what is stored" | experimental | [example](../../../../apps/web/src/platform-extensions/credentials/examples/WebhookSigningKeyField.tsx) |

## Data

None. The slice reads the presentation fields of a stored credential (`CredentialInfoDto` and its user and org counterparts, from `@marinoscar/platform-contract/credentials`) handed in by the page; it fetches nothing.

## Permissions and settings

None. The page that renders the field gates it with the permission its API enforces (writes are disabled controls, per the settings UI pattern: pass `disabled`).

## UI

`SecretField` only. No page, no settings card, no theme token: the field inherits the app's MUI theme.

## Infra

None. Browser code.

## Observability

None. The slice emits nothing.

## Security notes

- Secrets are write-only: the API never returns one, so the field starts empty and shows only the store's non-secret hint (`••••abcd`). There is **no reveal toggle**.
- `autoComplete="new-password"`, so a browser does not fill a stored login into it.
- `secretForSubmit` sends `undefined` for a blank field (the API keeps the stored secret) and the typed value byte for byte otherwise: it never trims, because a secret's whitespace may be significant.
- The helper text is linked to the input through `aria-describedby` (MUI's `helperText` with an id).

## Conformance suite

None in the web package yet; the API's `credentials` suite checks that no credential response schema can carry a secret. The field is covered by `test/credentials/SecretField.test.tsx` and `savedSecretHelperText.test.ts`.

## Upgrade notes

New in this version. Pages that build their own "A ... is saved (hint), last changed ..." sentence can switch to `savedSecretHelperText`; the wording is unified to "updated <date>".

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| The helper text says nothing is saved although a key exists | `saved` was not passed, or was built from a response without `hint` | Pass the credential info's `hint` and `updatedAt` |
| Saving with an empty field erases the key | The page sent `''` | Send `secretForSubmit(value)`; the API treats `undefined` as "keep" |
| The date shows "Invalid Date" | It cannot: an unparsable `updatedAt` is left out of the sentence | Check the API's `updatedAt` is an ISO string |

## Links

- [Package README](../../README.md)
- [The API slice](../../../platform-api/src/credentials/README.md)
- [The contract](../../../platform-contract/src/credentials/README.md)
- [Settings UI spec](../../../../docs/specs/settings-ui.md)
- [Package documentation standard](../../../../docs/PACKAGES.md)

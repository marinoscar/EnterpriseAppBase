# @marinoscar/platform-contract/credentials

The presentation-safe wire shapes of a stored credential (issue #735, PP-8.8), as zod schemas with their inferred types, plus the zod-free tier, source and secret-bearing-key lists. A feature that presents a credential it owns (the storage page, the AI provider card, an app's own key page) embeds one of these in its response; `@marinoscar/platform-web/credentials` reads their types. It depends on no other slice (`packages/platform-slices.json`).

## Purpose and scope

One definition of "what about a credential may leave the server": `credentialInfoSchema` (the deployment's), `userCredentialInfoSchema` (a user's own, without provenance) and `orgCredentialInfoSchema` (an organization's). None has a field able to carry the secret, the ciphertext, the row id or the owner id. `constants.ts` holds `CREDENTIAL_TIERS`, `CREDENTIAL_SOURCES` and `SECRET_BEARING_KEYS`, zod-free.

Not here: the stores, the resolver and the purpose registries (the API slice, `@marinoscar/platform-api/credentials`), and the secret field (`@marinoscar/platform-web/credentials`). There is no request schema: a secret is accepted by the owning feature's own DTO.

## Install and peer dependencies

Ships inside `@marinoscar/platform-contract`; import it by its subpath:

```ts
import { credentialInfoSchema, SECRET_BEARING_KEYS } from '@marinoscar/platform-contract/credentials';
import type { CredentialInfoDto } from '@marinoscar/platform-contract/credentials';
```

None beyond the package's own peer, `zod` (`^4.4.3`).

## Quick start

The reference app's web example types the stored credential with the contract ([`WebhookSigningKeyField.tsx`](../../../../apps/web/src/platform-extensions/credentials/examples/WebhookSigningKeyField.tsx)):

```ts
import type { UserCredentialInfoDto } from '@marinoscar/platform-contract/credentials';

interface Props { saved: UserCredentialInfoDto | null }
```

## Configuration

None. Schemas and constants take no options.

## Extension-point catalog

None. The schemas are the closed presentation contract of the credential stores: an app needing more on a credential stores a new purpose rather than widening the shape, and widening it with a secret-bearing field is exactly what the credentials conformance suite fails.

## Data

No tables. The shapes mirror the public columns of the `credentials` fragment of `@marinoscar/platform-db`:

| Schema | Store | Fields |
|---|---|---|
| `credentialInfoSchema` | `credentials` | `purpose`, `name`, `hint`, `label`, `updatedByUserId`, `createdAt`, `updatedAt` |
| `userCredentialInfoSchema` | `user_credentials` | the same without `updatedByUserId` |
| `orgCredentialInfoSchema` | `org_credentials` | the same as `credentialInfoSchema` |

Always-present fields are `.nullable()`; dates are ISO strings.

## Permissions and settings

None declared here. Each feature gates the route that returns a credential with its own permission.

## UI

None. The secret field is `@marinoscar/platform-web/credentials`.

## Infra

None.

## Observability

None. The package emits nothing at run time.

## Security notes

`SECRET_BEARING_KEYS` (`secret`, `secretValue`, `plaintext`, `password`, `value`, `ciphertext`, `encrypted`, `payload`) is the list no credential response may declare; `test/credentials.test.ts` and the API's `credentials` conformance suite scan every `*InfoSchema` for it and for `id`, `userId` and `orgId`. The `hint` is the only derivative of a secret, and it is presentation-only.

## Conformance suite

The API slice's `credentials` suite (`@marinoscar/platform-api/credentials/testing`) scans these schemas; see its README.

## Upgrade notes

New in this version; nothing to migrate from.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| The conformance case `no-secret-egress` fails on an app schema | An app's credential response declares a secret-bearing or id field | Remove the field; return the hint, never the secret |

## Links

- [Package README](../../README.md)
- [The API slice](../../../platform-api/src/credentials/README.md)
- [The web slice](../../../platform-web/src/credentials/README.md)
- [Contract conventions](../../../../docs/PACKAGES.md#contract-conventions)

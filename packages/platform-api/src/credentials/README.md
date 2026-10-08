# @marinoscar/platform-api/credentials

The platform's encrypted credential store, in three tiers: the deployment's own secrets (`CredentialsService`, addressed by `(purpose, name)`), a user's own bring-your-own-key secrets (`UserCredentialsService`, `(userId, purpose, name)`) and, new with issue #735 (PP-8.8), an organization's own secrets (`OrgCredentialsService`, `(orgId, purpose, name)`), plus `UserCredentialResolver`, which answers "whose key does this request use?" by walking user, then organization, then deployment. Every purpose is declared in one of two registries (`registerCredentialPurpose`, `registerUserCredentialPurpose`). Moved out of the reference app's `src/credentials/` and `src/user-credentials/` by #735. It depends on `core` and `testing` of this package (`packages/platform-slices.json`) and on `@marinoscar/platform-contract/credentials` for the presentation schemas. The conformance suite is the nested subpath `@marinoscar/platform-api/credentials/testing`, catalogued here.

## Purpose and scope

One audited place for every secret the application configures at run time (an SMTP password, a storage secret access key, a VAPID private key, an AI provider key, the GreptimeDB passwords, an app's own keys), so no feature invents its own column, its own encrypt call or its own chance to leak.

| Part | Source | What it is |
|---|---|---|
| Deployment store | `credentials.service.ts`, `credentials.module.ts` | `CredentialsService`: `getSecret` (plaintext, server-side only), `describe`, `list`, `setSecret` (blank preserves), `deleteSecret`. Encrypted under the bare purpose. |
| User store | `user-credentials.service.ts`, `user-credentials.module.ts` | `UserCredentialsService`, the same API with `userId` first, on the user-scoped client (`forUser`), encrypted under `user:<userId>:<purpose>`. |
| Organization store | `org-credentials.service.ts`, `org-credentials.module.ts` | `OrgCredentialsService`, the same API with `orgId` first, on the org-scoped row-level-security client (`forOrg`), encrypted under `org:<orgId>:<purpose>`. `setSecret` returns the stored credential's info. |
| Resolver | `user-credential.resolver.ts` | `UserCredentialResolver.resolve(userId, purpose, name?, { orgId? })`: user, then the purpose's `fallback` (`org`, `system`), then `none`. |
| Registries | `registry.ts` | `registerCredentialPurpose` (system and org purposes), `registerUserCredentialPurpose` (user purposes), on the #675 registry primitive. |
| Shared rules | `credential-internals.ts` | The hint (`deriveHint`), "blank" and address rules all three stores share. |
| Data | `data/credentials-db.ts`, `ownership.ts` | The structural row and client types, and the model ownership and user-owned-data declarations. |
| Test seams | `testing/` (`/credentials/testing`) | The `credentials` conformance suite and `withCredentialPurposes`. |

Not here: an HTTP surface (there is no generic credentials route, on purpose; each owning feature presents its own secrets), a credentials admin UI, a user's AI provider key (`user_ai_keys`, owned by the AI slice, #739; see [user-credentials.md](../../../../docs/specs/user-credentials.md)), the org AI key policy (#739) and the secret-field component (`@marinoscar/platform-web/credentials`).

## Install and peer dependencies

Ships inside `@marinoscar/platform-api`; import it by its subpath:

```ts
import { CredentialsModule, CredentialsService, registerCredentialPurpose } from '@marinoscar/platform-api/credentials';
```

None beyond the package's own peers (`@nestjs/common`, `@nestjs/core`, `@prisma/client` for `/extension`). The slice depends on no generated Prisma client, not even its types: it declares the `credentials` fragment's tables structurally (`CredentialsPrisma`, `CredentialsDelegate` and the `*Row` types) and receives the app's own client through core's `PLATFORM_PRISMA` port, which the app binds once with `PlatformHostModule.forRoot({ prisma })`. The cipher needs `SECRETS_ENCRYPTION_KEY` (a deploy-time variable, checked at startup by core's `verifyEncryptionKeyAtStartup`).

## Quick start

The reference app's binding ([`credentials.config.ts`](../../../../apps/api/src/platform/credentials/credentials.config.ts)) registers the three modules in the root module and imports its purpose manifest:

```ts
import { CredentialsModule, OrgCredentialsModule, UserCredentialsModule } from '@marinoscar/platform-api/credentials';

import './credential-purposes.manifest';

export const credentialsModules = [CredentialsModule, UserCredentialsModule, OrgCredentialsModule] as const;
```

The manifest ([`credential-purposes.manifest.ts`](../../../../apps/api/src/platform/credentials/credential-purposes.manifest.ts)) declares every purpose before bootstrap:

```ts
registerCredentialPurpose({ purpose: 'smtp', owner: 'email', label: 'SMTP password', tiers: ['system'] });
```

A feature then imports the module it needs (none is `@Global`, so every user of a plaintext-returning service is a visible line) and injects the service:

```ts
@Module({ imports: [CredentialsModule], providers: [SmtpEmailProvider] })
export class EmailModule {}

// in SmtpEmailProvider
const password = await this.credentials.getSecret(SMTP_CREDENTIAL_PURPOSE, SMTP_CREDENTIAL_NAME);
```

## Configuration

None. The modules take no options: the database is core's `PLATFORM_PRISMA` port, and what an app configures is its purposes, declared with the two registration functions below.

### Purpose definitions

| Field | Registry | Type | Default | Meaning |
|---|---|---|---|---|
| `purpose` | both | `string` | required | The stored purpose and cipher sub-key domain. No `:`, no surrounding whitespace. Permanent once rows exist. |
| `owner` | system/org | `string` | required | The declaring slice (`email`) or the app (`app`). The conformance suite checks it. |
| `label` | both | `string` | required | Short human description. |
| `tiers` | system/org | `('system' \| 'org')[]` | required | Where it may be stored: `credentials`, `org_credentials`, or both. |
| `description` | user | `string` | required | User-facing copy: what the key is for. |
| `system` | user | `{ purpose; name } \| null` | required | The deployment's counterpart, or `null`. |
| `org` | user | `{ purpose; name } \| null` | none | The organization's counterpart in `org_credentials`. |
| `fallback` | user | `('org' \| 'system')[]` | `['system']` when `system` is set, `[]` otherwise | The resolver's order after the user's own key. The default is the behaviour before organizations existed. |

### The resolver order

`resolve(userId, purpose, name = 'default', { orgId })` returns the first of:

1. `user`: the user's own key at `(userId, purpose, name)`;
2. each tier of `fallback`, in order: `org` (the organization's key at the purpose's `org` address; skipped without an `orgId`, or when `OrgCredentialsModule` is absent) and `system` (the deployment's key at the `system` address);
3. `none`.

A stored key that will not decrypt throws; it never falls through to the next tier.

## Extension-point catalog

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `CredentialsModule` | token | `@Module` providing `CredentialsService` | Import it in a module that reads or writes a deployment credential | experimental | [example](../../../../apps/api/src/email/email.module.ts) |
| `UserCredentialsModule` | token | `@Module` providing `UserCredentialsService`, `UserCredentialResolver` | Import it where a user's own key is stored or resolved | experimental | [example](../../../../apps/api/src/platform/credentials/credentials.config.ts) |
| `OrgCredentialsModule` | token | `@Module` providing `OrgCredentialsService` | Import it where an organization's own key is stored or read | experimental | [example](../../../../apps/api/src/platform/credentials/credentials.config.ts) |
| `UserCredentialResolver` | token | `resolve(userId, purpose, name?, { orgId? }): Promise<{ source: 'user' \| 'org' \| 'system' \| 'none'; secret? }>` | Pick whose key pays for a call: user, then the purpose's fallback (org, system), then none | experimental | [example](../../../../apps/api/test/credentials/credentials-extension-points.spec.ts) |
| `registerCredentialPurpose` | registry | `registerCredentialPurpose({ purpose, owner, label, tiers }): void` | Declare a system or org purpose before writing to it; a duplicate purpose fails at boot | experimental | [example](../../../../apps/api/src/platform/credentials/credential-purposes.manifest.ts) |
| `registerUserCredentialPurpose` | registry | `registerUserCredentialPurpose({ purpose, label, description, system, org?, fallback? }): void` | Declare a kind of key users may bring, and where it falls back to | experimental | [example](../../../../apps/api/src/platform/credentials/credential-purposes.manifest.ts) |
| `CREDENTIALS_MODEL_OWNERSHIP` | registry | `readonly ModelOwnershipDef[]` | Register the slice's three models with the app's model ownership registry | experimental | [example](../../../../apps/api/src/prisma/ownership/model-ownership.manifest.ts) |
| `CREDENTIALS_USER_OWNED_MODELS` | registry | `readonly UserOwnedModelDef[]` | Register the slice's user foreign keys with the app's user-owned-data registry | experimental | [example](../../../../apps/api/src/prisma/ownership/user-owned-model.manifest.ts) |
| `credentialsConformanceSuite` | registry | `ConformanceSuite<CredentialsConformanceOptions>` | Run the slice's invariants in the app through `runPlatformConformance({ suites: { credentials } })` | experimental | [example](../../../../apps/api/test/credentials/credentials-conformance.spec.ts) |

The two worked examples of the registries are compiled in the reference app and exercised by its tests, not registered: [`webhook-signing-key.purpose.ts`](../../../../apps/api/src/platform-extensions/credentials/examples/webhook-signing-key.purpose.ts) (a user purpose with `system: null`) and [`partner-api-token.purpose.ts`](../../../../apps/api/src/platform-extensions/credentials/examples/partner-api-token.purpose.ts) (an org-tier purpose and a user purpose with `fallback: ['org', 'system']`). An app adds its own to [`app-registrations/credentials.ts`](../../../../apps/api/src/app-registrations/credentials.ts).

## Data

Three models of the `credentials` fragment of `@marinoscar/platform-db` (`schema/credentials.prisma`):

| Model (table) | Address | Ownership | Cipher domain | On delete |
|---|---|---|---|---|
| `Credential` (`credentials`) | unique `(purpose, name)` | `system` | `<purpose>` | `updated_by_user_id` SetNull |
| `UserCredential` (`user_credentials`) | unique `(user_id, purpose, name)` | `user` | `user:<userId>:<purpose>` | Cascade with the user |
| `OrgCredential` (`org_credentials`) | unique `(org_id, purpose, name)` | `org`, FORCEd row-level security (`org_credentials_org_isolation`) | `org:<orgId>:<purpose>` | Cascade with the organization; `updated_by_user_id` SetNull |

Migrations: `0003_add_credentials`, `0018_add_user_credentials` and `0028_add_org_credentials` (the table and its policy). All three unique keys are plain composite constraints (every column is NOT NULL), so no raw-SQL index is involved.

Public columns (an app may read them, through the `*Info` types): `purpose`, `name`, `hint`, `label`, `updated_by_user_id`, `created_at`, `updated_at`. Private: `id` (never published; the address is the only way to a row), `secret` (the ciphertext; read only by `getSecret`), and the owner columns as presentation (every read is already scoped by them). **Apps never add columns to these tables; a new kind of secret is a new purpose.**

`CREDENTIALS_MODEL_OWNERSHIP` and `CREDENTIALS_USER_OWNED_MODELS` declare the three models for the app's registries: a user purge deletes their `user_credentials` and detaches them from the other two.

## Permissions and settings

None. The stores declare no permission and read no setting: they have no route, and the feature that presents a credential gates it with its own permission (`storage_config:write`, `ai_config:write`, ...).

## UI

None in this slice. The write-only secret field (`SecretField`, `savedSecretHelperText`) is `@marinoscar/platform-web/credentials`. No settings card: credentials are presented by their owning feature.

## Infra

None. `SECRETS_ENCRYPTION_KEY` is the deployment's existing master key (documented in `infra/compose/.env.example`); no variable is added for any runtime-configured feature.

## Observability

Logs only, through Nest's `Logger` (`CredentialsService`, `UserCredentialsService`, `OrgCredentialsService`): "Stored/Deleted credential `<purpose>/<name>`" (plus the user or organization id for the owner stores) and an error when a stored credential will not decrypt. No log line, span attribute, metric or audit `meta` carries a secret or a hint. No metrics or spans of its own; queries are traced by the app's Prisma instrumentation.

## Security notes

- **No plaintext egress.** `getSecret` is the only method that returns plaintext; call it at the moment of use, server-side. `describe`/`list`/`setSecret` return `CredentialInfo`, `UserCredentialInfo` and `OrgCredentialInfo`, whose compile-time proofs forbid any secret-bearing field; the ciphertext is never even selected for them. Never return a `ResolvedCredential` from a controller.
- **Blank preserves.** An empty secret on write keeps the stored one; erasing is `deleteSecret`. A blank first write is a 400.
- **Writes need a declared purpose.** A write to a purpose not registered for that tier is a 500-class programming error, so a typo fails in tests, not for a user. Reads of an unknown purpose answer `null`.
- **Cipher domains.** The deployment store encrypts under the bare purpose, a user's under `user:<userId>:<purpose>` (`userCredentialPurpose`) and an organization's under `org:<orgId>:<purpose>` (`orgCredentialPurpose`, prefix `ORG_CREDENTIAL_DOMAIN_PREFIX`, both in `@marinoscar/platform-api/core`). A purpose may not contain `:`, so no system purpose can alias an owner domain, and the owner id must be a canonical UUID. A ciphertext copied into another user's or another organization's row fails GCM authentication. Owner domains are not cached.
- **The HKDF label is permanent.** Every sub-key derives from `'enterpriseappbase:secret-cipher:v1:'` (`SUBKEY_LABEL_PREFIX`, on the do-not-rename list of `scripts/rename.mjs`); changing it makes every stored credential undecryptable. `apps/api/test/credentials/credentials-upgrade.db.spec.ts` decrypts ciphertexts made by the pre-package code.
- **Tenant isolation.** `org_credentials` is under FORCEd row-level security; the organization store reaches it only through `forOrg(prisma, orgId)`, and `orgId` comes from the principal or a job payload, never from request input.
- **Key rotation** re-encrypts all three tables: [rotate-secrets-encryption-key.md](../../../../docs/runbooks/rotate-secrets-encryption-key.md).

## Conformance suite

Importing `@marinoscar/platform-api/credentials/testing` registers the `credentials` suite with `runPlatformConformance()`. Run it after the app's purpose manifest has been imported:

```ts
import { runPlatformConformance } from '@marinoscar/platform-api/testing';
import '@marinoscar/platform-api/credentials/testing';
import '../../src/platform/credentials/credentials.config';

runPlatformConformance({ sourceRoots: [API_SOURCE_ROOT], suites: { credentials: { appOwners: ['app'] } } });
```

| Case | Fails when |
|---|---|
| `owners` | A registered purpose names an owner that is neither a platform slice (`PLATFORM_CREDENTIAL_OWNERS`) nor one of `appOwners` |
| `addresses` | A user purpose's `system` or `org` address names a purpose that is not registered, or not for that tier |
| `no-secret-egress` | A credential `*Info` schema (the contract's three, plus `infoSchemas`) declares a secret-bearing property (`SECRET_BEARING_KEYS`), `id`, `userId` or `orgId` |

`withCredentialPurposes({ purposes, userPurposes }, fn)` declares purposes for one test and restores both registries afterwards.

## Upgrade notes

New subpath in this version. From the reference app's local modules (#735):

- Import `CredentialsModule`, `CredentialsService`, `UserCredentialsModule`, `UserCredentialsService`, `UserCredentialResolver`, `deriveHint` and the `*Info` types from `@marinoscar/platform-api/credentials` instead of `src/credentials/` and `src/user-credentials/`.
- `USER_CREDENTIAL_PURPOSES` is gone: declare each user purpose with `registerUserCredentialPurpose` (the `USER_CREDENTIAL_PURPOSE_REGISTRY` token remains the read side).
- Declare every system purpose you write with `registerCredentialPurpose`; an undeclared write now throws.
- `ResolvedCredential.source` gains `org`.
- Stored rows decrypt unchanged: the cipher, its label and the domains of the two existing tables did not change.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Credential purpose "x" is not registered (registerCredentialPurpose).` (500) on save | The purpose was never declared, or is a typo | Add it to the app's manifest (`app-registrations/credentials.ts`) with the right `tiers` |
| `... is not registered for the org tier` / `system tier` | Declared, but not for the store being written | Add the tier to its `tiers` |
| `Credential purpose "x" is already registered by "a"; "b" cannot claim it too.` at boot | Two slices or the app declare the same purpose | Rename the app's purpose; a purpose is permanent once rows exist |
| `Registry "credential-purposes" is frozen` | A purpose registered after bootstrap (from `onModuleInit`) | Register at import time, from the manifest; in tests use `withCredentialPurposes` |
| `Invalid user credential registry: ... not a registered credential purpose` at boot | A user purpose's `system`/`org` address names an undeclared purpose | Declare the target purpose, with that tier |
| `Credential "p/n" could not be decrypted. It must be set again.` | `SECRETS_ENCRYPTION_KEY` changed, a row was tampered with, or it was copied from another owner | Re-enter the credential, or rotate properly (runbook) |
| The resolver never answers `org` | No `orgId` passed, `fallback` lacks `org`, or `OrgCredentialsModule` is not in the graph | Pass `{ orgId: principal.activeOrgId }`, declare `fallback: ['org', ...]` |
| `Nest can't resolve dependencies of CredentialsService (Symbol(@marinoscar/platform/PLATFORM_PRISMA))` | The core host port is not bound | `PlatformHostModule.forRoot({ prisma: { useExisting: PrismaService } })` in the root module |

## Links

- [Package README](../../README.md)
- [Spec: per-user credentials (the three tiers, the registries, the chain)](../../../../docs/specs/user-credentials.md)
- [Platform packages spec](../../../../docs/specs/platform-packages.md)
- [Runbook: rotate SECRETS_ENCRYPTION_KEY](../../../../docs/runbooks/rotate-secrets-encryption-key.md)
- [Core README (the cipher)](../core/README.md)
- [Web counterpart](../../../platform-web/src/credentials/README.md)
- [Contract](../../../platform-contract/src/credentials/README.md)
- [Package documentation standard](../../../../docs/PACKAGES.md)

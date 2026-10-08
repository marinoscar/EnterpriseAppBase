# Per-User Encrypted Credentials

> **Status:** shipped (store only, no HTTP surface) · **Code:** `packages/platform-api/src/credentials/` (`@marinoscar/platform-api/credentials`, [README](../../packages/platform-api/src/credentials/README.md)), `packages/platform-api/src/core/crypto/secret-cipher.ts` (`@marinoscar/platform-api/core`), `packages/platform-web/src/credentials/` (`SecretField`) · **API:** none · **Admin UI:** none · **Runbook:** [rotate-secrets-encryption-key.md](../runbooks/rotate-secrets-encryption-key.md)

`UserCredential` stores secrets that a **user** owns (bring-your-own-key),
encrypted at rest under a cipher domain bound to that user. It is the
per-user sibling of the deployment-owned `credentials` store, and since #735
of the organization-owned `org_credentials` store (§2.7). It ships as a
foundation: the tables, the stores (`UserCredentialsService`,
`OrgCredentialsService`), two purpose registries (`registerUserCredentialPurpose`,
`registerCredentialPurpose`) and a resolver (`UserCredentialResolver`). A
feature that needs a user key type registers one purpose and adds its own
controller. Since #735 the whole slice is the package
`@marinoscar/platform-api/credentials`; the reference app only registers its
purposes.

## 1. Purpose

`CredentialsService` (`@marinoscar/platform-api/credentials`) holds secrets the
**deployment** owns: SMTP, the Web Push VAPID private key, the object-storage
secret, the AI admin/org key. It is addressed by `(purpose, name)`, one row
per address. It has no notion of a secret a user brings: a webhook signing
secret, a personal token for an integration, or the user's own key for a
service the deployment also has a key for.

`user_credentials` fills that gap, addressed by `(userId, purpose, name)`.

What it is not:

- **Not an HTTP surface.** `UserCredentialsModule` ships no controller and no
  UI. The feature that exposes a key type owns its routes, permission and
  audit.
- **Not where AI keys live.** A user's AI provider key lives in `user_ai_keys`
  with its own resolver (`AiKeyResolver`); see
  [ai-platform.md](ai-platform.md). The reference app registers no user
  purpose. An organization's AI key may live in `org_credentials` (purpose
  `ai`, tier `org`); its policy is the AI slice's (#739).
- **Not a change to `credentials`.** That table is untouched.

The design and threat model of the deployment store are in
[SECURITY-ARCHITECTURE.md](../SECURITY-ARCHITECTURE.md) (Encrypted Credential
Storage).

## 2. How it works

### 2.1 Schema

```prisma
model UserCredential {
  id        String   @id @default(uuid()) @db.Uuid
  userId    String   @map("user_id") @db.Uuid
  purpose   String
  name      String
  secret    String   @db.Text
  hint      String?
  label     String?
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz

  user User @relation("UserCredentials", fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, purpose, name])
  @@map("user_credentials")
}
```

- `secret` is ciphertext only (base64 AES-256-GCM), `@db.Text` so it is never
  truncated.
- `hint` and `label` are non-secret. `hint` is derived from the plaintext on
  write; `label` is user-entered.
- `onDelete: Cascade`: the row dies with its owner. There is no
  `updatedByUserId`; the owner is the only writer.
- `@@unique([userId, purpose, name])` is a normal Prisma index. Every column
  is `NOT NULL`, so no hand-written SQL is needed.

### 2.2 Owner-bound cipher domains

A `Credential` row is encrypted under a sub-key derived from its bare
`purpose`. A `UserCredential` row is encrypted under a domain that also binds
the owner, and an `OrgCredential` row (#735) under one that binds the
organization:

```
user:<userId>:<purpose>
org:<orgId>:<purpose>
```

The organization domain is built by `orgCredentialPurpose(orgId, purpose)`
(prefix `ORG_CREDENTIAL_DOMAIN_PREFIX`, `'org:'`) under exactly the rules
below for users: a canonical-UUID `orgId`, a colon-free purpose, no caching.
**A ciphertext copied from one organization's row into another's fails to
decrypt**, the property this section guarantees for users. The `user:` and
`org:` prefixes differ, and no system purpose may contain `:`, so the three
key spaces are disjoint.

- Built by `userCredentialPurpose(userId, purpose)` from `@marinoscar/platform-api/core` and
  passed as the `purpose` argument to the unchanged
  `encryptSecret`/`decryptSecret`.
- `userId` must be a canonical UUID: lowercase hex, hyphenated, 8-4-4-4-12
  (`isCanonicalUuid`, `CANONICAL_UUID_PATTERN`). One spelling per id, no `:`.
  `assertCredentialOwner` enforces this at every service entry point, and
  `userCredentialPurpose` enforces it again as a backstop.
- `purpose` may not contain `:`, in **both** stores (`assertCredentialPurpose`).
  So no system purpose can spell a `user:` domain, and
  `(userId, purpose) → domain` is injective.
- Owner-bound domains (prefixes `USER_CREDENTIAL_DOMAIN_PREFIX` and
  `ORG_CREDENTIAL_DOMAIN_PREFIX`) are **excluded from `deriveKey`'s cache.**
  They are one string per owner × purpose, an unbounded set. The cost is one
  HMAC-SHA256 per call.
- The HKDF label every sub-key derives from, `'enterpriseappbase:secret-cipher:v1:'`
  (`SUBKEY_LABEL_PREFIX`), is on the do-not-rename list of `scripts/rename.mjs`:
  changing it makes every stored credential undecryptable.

A ciphertext copied into another user's row, or into another purpose of the
same user, fails GCM authentication instead of decrypting (§6).

### 2.3 `UserCredentialsService`

`userId` is the first parameter of every method, and every query is scoped by
it. The address is always the full `(userId, purpose, name)` triple. Every
query goes through the user-scoped client, core's `forUser(prisma, { userId })`
on the `PLATFORM_PRISMA` port
([prisma/ownership/README.md](../../apps/api/src/prisma/ownership/README.md)),
so the database client itself confines it to that user (#688).

| Method | Returns | Behaviour |
|---|---|---|
| `getSecret(userId, purpose, name)` | `string \| null` | The only plaintext read. Server-side only, never from a controller. Throws `InternalServerErrorException` if a row exists but will not decrypt; never a silent `null`. |
| `describe(userId, purpose, name)` | `UserCredentialInfo \| null` | Presentation read. The `secret` column is not selected. |
| `list(userId, purpose?)` | `UserCredentialInfo[]` | The user's credentials, optionally for one purpose, ordered by `(purpose, name)`. |
| `setSecret(userId, purpose, name, secret, meta?)` | void | Create or update. `undefined`, `null` and `''` all mean "keep what is stored" and apply only `meta`. A blank secret with nothing stored is a `400`. `hint` is always derived, never accepted. A purpose not registered with `registerUserCredentialPurpose` is a `500` (a programming error). |
| `deleteSecret(userId, purpose, name)` | void | The only way to erase. Idempotent. |

Invariants:

- **No plaintext egress.** `UserCredentialInfo` has no field able to hold a
  secret or ciphertext, and carries neither `id` nor `userId`. Compile-time
  `AssertTrue` proofs in the package's `interfaces/user-credential-info.interface.ts`
  enforce this. `USER_CREDENTIAL_INFO_SELECT` is a
  `Record<keyof UserCredentialInfo, true>`, so selecting `secret` fails to
  compile.
- **No cross-user listing** and no lookup by `id` alone.
- **No audit events.** The feature that exposes a key type audits the act.
- **Log lines name the address** (`purpose`, `name`, `userId`), never a secret.

`UserCredentialsModule` is not `@Global()`. It exports only
`UserCredentialsService` and `UserCredentialResolver`, so every consumer is a
visible `imports: [UserCredentialsModule]` line.

### 2.4 Purpose registries

Two static registries on the #675 primitive (`defineRegistry`: string ids, a
duplicate id throws `DUPLICATE_ID`, frozen by `RegistryFreezeService` after
bootstrap), in the package's `registry.ts`. They replace #387's closed
`USER_CREDENTIAL_PURPOSES` array, which a fork had to edit in place.

**System and org purposes**, `registerCredentialPurpose(def)`:

```ts
interface CredentialPurposeDef {
  readonly purpose: string;                    // stored and the sub-key domain; permanent; no ':'
  readonly owner: string;                      // the declaring slice ('email') or 'app'
  readonly label: string;                      // human description
  readonly tiers: readonly ('system' | 'org')[]; // credentials, org_credentials, or both
}
```

Every purpose the deployment or an organization stores is declared: `ai`
(`system`, `org`), `storage`, `smtp`, `email_ses`, `push_vapid` and
`telemetry_greptime` (`system`). Until those slices are extracted the
declaration lives beside the constant in the reference app
(`ai/config/ai-credential.constants.ts`, ...) and
`apps/api/src/platform/credentials/credential-purposes.manifest.ts` registers
them; a slice registering its own purpose is the end state. Two slices or apps
claiming the same purpose fail at boot. `CredentialsService.setSecret` and
`OrgCredentialsService.setSecret` refuse a purpose that is not registered for
their tier with a 500-class error, so a typo fails in tests, not for a user.

**User purposes**, `registerUserCredentialPurpose(def)`:

```ts
interface UserCredentialPurposeDef {
  readonly purpose: string;                          // permanent once rows exist; no ':'
  readonly label: string;                            // user-facing name
  readonly description: string;                      // user-facing copy
  readonly system: SystemCredentialAddress | null;   // the deployment's counterpart, or none
  readonly org?: OrgCredentialAddress | null;        // the organization's counterpart (#735)
  readonly fallback?: readonly ('org' | 'system')[]; // default ['system'] when system is set, [] otherwise
}
```

- `system` and `org` name `(purpose, name)` addresses in `credentials` and
  `org_credentials`. `fallback` orders them (§2.5); a tier in `fallback`
  needs its address.
- `DEFAULT_USER_CREDENTIAL_NAME` is `'default'`.
- The resolver reads the registry through the `USER_CREDENTIAL_PURPOSE_REGISTRY`
  token (the read side, kept from #387), bound in `UserCredentialsModule` to
  `userCredentialPurposeRegistry.list()`, so a test can supply a fixture.
- **Validated at registration and at boot.** The registry checks each entry
  (identifiers, copy, addresses, fallback); the resolver's constructor calls
  `assertValidRegistry`, which also checks that each `system`/`org` address
  names a registered purpose of that tier. The `credentials` conformance suite
  checks the same in every consuming app.

### 2.5 `UserCredentialResolver`: user, then org, then system

```ts
async resolve(userId, purpose, name = DEFAULT_USER_CREDENTIAL_NAME, { orgId }?): Promise<ResolvedCredential>
```

The chain, for every purpose:

1. The user's own credential, if stored.
2. Then each tier of the purpose's `fallback`, in order:
   - `org`: the organization's credential at the `org` address, read through
     `OrgCredentialsService` (needs `orgId`, from the principal or a job
     payload; skipped without one, or when `OrgCredentialsModule` is absent);
   - `system`: the deployment's credential at the `system` address, read
     through `CredentialsService`.
3. Else `{ source: 'none' }`.

**The default is today's rule.** A purpose that declares no `fallback`
resolves user, then system (when it has a `system` address), then none,
exactly as before #735.

`ResolvedCredential` is a discriminated union on `source`
(`'user' | 'org' | 'system' | 'none'`), so a caller can attribute usage to
the right party. The `'user'`, `'org'` and `'system'` arms carry plaintext;
the `ResolvedCredentialSource` subset is safe to log or return. The org and
system addresses are fixed by the registry and ignore the caller's `name`.

Two failures are deliberate:

- **An unknown purpose throws** `InternalServerErrorException` before any
  store is read. It is a programming error, not "nothing configured".
- **A credential that will not decrypt throws and never falls through to the
  next tier.** Otherwise a user whose key broke would silently spend the
  organization's or the deployment's key.

### 2.6 Shared internals

`packages/platform-api/src/credentials/credential-internals.ts` holds the
rules the three stores must agree on. Every service calls it; the reference
app's `ai/keys/user-ai-keys.service.ts` uses the same `deriveHint` (exported
by `@marinoscar/platform-api/credentials`).

| Function | Rule |
|---|---|
| `deriveHint(plaintext)` | Under 8 code points: `'••••'`. Otherwise the mask plus the last 4 code points. Iterates code points, so an astral character is never split. |
| `isBlankSecret(secret)` | `undefined`, `null` and `''` are blank. No `.trim()`: whitespace-only is a real value. |
| `assertCredentialIdentifier` / `assertCredentialPurpose` / `assertCredentialAddress` | Reject empty or whitespace-padded `purpose`/`name` (rejected, not trimmed, because `purpose` feeds the cipher). `assertCredentialPurpose` also rejects `:`. |
| `assertCredentialOwner(userId)` | User store only. Rejects anything that is not `isCanonicalUuid`. The org store applies the same rule to `orgId`. |

### 2.7 Organization credentials (#735)

```prisma
model OrgCredential {
  id              String   @id @default(uuid()) @db.Uuid
  orgId           String   @map("org_id") @db.Uuid
  purpose         String
  name            String
  secret          String   @db.Text   // AES-256-GCM under orgCredentialPurpose(orgId, purpose)
  hint            String?
  label           String?
  updatedByUserId String?  @map("updated_by_user_id") @db.Uuid
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt       DateTime @updatedAt @map("updated_at") @db.Timestamptz
  org           Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  updatedByUser User?        @relation("OrgCredentialUpdatedBy", fields: [updatedByUserId], references: [id], onDelete: SetNull)
  @@unique([orgId, purpose, name])
  @@map("org_credentials")
}
```

The missing middle tier between a user's key and the deployment's: the AI
slice's per-org keys (#739) and later storage, e-mail and push per org store
into it, instead of each inventing its own org key table.

- A plain composite `@@unique`: `org_id` is NOT NULL, so no raw-SQL index.
- **Tenant data.** `org_credentials` is an `org` table under FORCEd row-level
  security (`org_credentials_org_isolation`, migration
  `0028_add_org_credentials`, listed in `RLS_POLICIES`). `OrgCredentialsService`
  reaches it only through core's `forOrg(prisma, orgId)`, so another
  organization's rows are invisible whatever a query's `where` says, and the
  database refuses a row for another organization (`WITH CHECK`).
- The same API as the user store with `orgId` first: `getSecret`, `describe`,
  `list(orgId, purpose?)`, `setSecret(orgId, purpose, name, secret, { label,
  updatedByUserId })` (blank preserves; returns the `OrgCredentialInfo`) and
  `deleteSecret`. `OrgCredentialInfo` carries neither `id` nor `orgId`
  (compile-time proofs).
- Cascade with the organization; the last editor is provenance (SetNull), as on
  `Credential`.

## 3. Configuration and permissions

- **`SECRETS_ENCRYPTION_KEY`**: base64 32-byte AES-256 master key, shared with
  the deployment store. Rotation:
  [rotate-secrets-encryption-key.md](../runbooks/rotate-secrets-encryption-key.md).
- **No settings namespace, no permissions, no routes.** The feature that adds
  a key type declares its own permission and routes.
- **Purposes are code, not configuration.** They are registered at import
  time by the app's manifest; nothing is configured at run time. The permission matrix
  lives in [ARCHITECTURE.md](../ARCHITECTURE.md).

<a id="4-extending-it-in-a-fork"></a>

## 4. Extending it in an app

Adding a user key type costs one registration and zero migrations, and no
platform file is edited.

1. **Declare the purpose** in the app's own registration file,
   `apps/api/src/app-registrations/credentials.ts` (the manifest registers it
   after every platform purpose, before bootstrap):

   ```ts
   export const APP_USER_CREDENTIAL_PURPOSES: readonly UserCredentialPurposeDef[] = [
     {
       purpose: 'webhook_signing_key', // permanent once rows exist; no ':'
       label: 'Webhook signing key',
       description: 'Used to verify webhooks this integration sends you.',
       system: null, // no deployment-wide counterpart
     },
   ];
   ```

   A key type that falls back to the organization's, then the deployment's
   key declares the org/system purpose too (`APP_CREDENTIAL_PURPOSES`, with
   `tiers: ['system', 'org']`) and `org`, `system` and
   `fallback: ['org', 'system']` on the user purpose. Both shapes are compiled
   examples in `apps/api/src/platform-extensions/credentials/examples/`.

2. **Write it** from the feature's service, with
   `imports: [UserCredentialsModule]` in the feature's module:

   ```ts
   await this.userCredentials.setSecret(
     userId,
     'webhook_signing_key',
     DEFAULT_USER_CREDENTIAL_NAME,
     submittedSecret, // blank preserves what is stored
     { label: submittedLabel },
   );
   ```

   An organization's key goes through `OrgCredentialsService.setSecret(orgId, ...)`
   (`imports: [OrgCredentialsModule]`), with `orgId` from the principal.

3. **Read it** with `UserCredentialResolver.resolve(userId, purpose, name, { orgId })`
   when the type has (or may later have) a fallback, or
   `UserCredentialsService.getSecret(...)` when it has none. Both are
   server-side plaintext reads; never call them from a controller.

4. **Add the feature's own controller and DTOs**: its auth guard, its
   permission, and an `AuditService` call if the write should be audited.

5. **Present it** with `describe`/`list`, never from a raw row.
   `UserCredentialInfo` keeps the secret out of the response by construction,
   and `@marinoscar/platform-contract/credentials` has its wire schema. On the
   web, render the field with `SecretField` (`@marinoscar/platform-web/credentials/ui`).

Nothing in the tables, the cipher, the services or the resolver changes.

## 5. Guardrails

| Invariant | Test |
|---|---|
| Two users at the same `(purpose, name)` stay apart; a row moved to another purpose fails to decrypt; no plaintext egress; blank preserves; address validation | `packages/platform-api/test/credentials/user-credentials.service.spec.ts` |
| The chain: user, then org, then system, then none; the default fallback is today's; unknown purpose throws first; no fall-through on a decrypt failure; registry validated at construction | `packages/platform-api/test/credentials/user-credential.resolver.spec.ts` |
| Duplicate purposes throw, registries freeze, a write to an unregistered purpose (or the wrong tier) throws | `packages/platform-api/test/credentials/registry.spec.ts` |
| The org store: round trip, org isolation of ciphertexts, blank preserves, no secret in logs | `packages/platform-api/test/credentials/org-credentials.service.spec.ts` |
| `userCredentialPurpose` and `orgCredentialPurpose` require a canonical UUID and a colon-free purpose; another organization's domain fails to decrypt | `packages/platform-api/test/core/secret-cipher.spec.ts` |
| A system purpose containing `:` (including a `user:` spelling) is rejected | `packages/platform-api/test/credentials/credential-internals.spec.ts` |
| `UserCredentialInfo` and `OrgCredentialInfo` cannot hold a secret | compile-time proofs in the package's `interfaces/`; the contract's `*InfoSchema` scan (`packages/platform-contract/test/credentials.test.ts`) |
| Every purpose names a known owner, every user purpose's address resolves, no `*Info` schema can carry a secret | the `credentials` conformance suite, run by `apps/api/test/credentials/credentials-conformance.spec.ts` |
| A user-scoped client never reads or changes another user's `user_credentials` rows | `apps/api/test/prisma/scoped-access.db.spec.ts`, `apps/api/test/credentials/user-credentials.db.spec.ts` |
| `org_credentials`: unique `(org_id, purpose, name)`, cascade with the organization, RLS isolation between two organizations, a ciphertext moved between organizations fails | `apps/api/test/credentials/org-credentials.db.spec.ts` |
| Rows encrypted by the pre-package code still decrypt | `apps/api/test/credentials/credentials-upgrade.db.spec.ts` |

## 6. Design decisions

- **Owner-bound cipher domain.** Without it, a bug or SQL write that copies
  user A's ciphertext into user B's row decrypts cleanly, and B silently gets
  A's key. With `user:<userId>:<purpose>` as the domain, the same ciphertext
  fails GCM authentication. The unique index and the cipher binding are two
  independent layers catching the same mistake. The canonical-UUID rule
  exists because a second spelling of the same id would derive a different
  key and strand every row.
- **Colons banned in every purpose.** A system purpose containing `:` is the
  only way to spell one that starts with `user:` and so shares a user's
  domain. One rule in both stores makes the two key spaces disjoint. No
  existing system purpose (`smtp`, `storage`, `push_vapid`, `ai`) had one.
- **A sibling table, not `ownerId` on `Credential`.** `Credential` has a
  table-wide `@@unique([purpose, name])`. Postgres treats `NULL`s as distinct,
  so `@@unique([ownerId, purpose, name])` would stop enforcing one system row
  per address. The two tables also need opposite delete behaviour
  (`SetNull` provenance vs `Cascade` ownership), which one column cannot carry.
- **Not the owner encoded in `name`.** The system store derives its key from
  `purpose` alone, so every user's row of a purpose would share one key. It
  also gives Prisma no relation to cascade on.
- **Not a JSONB blob in `user_settings`.** Settings endpoints return that
  document whole; a secret inside it is one careless response from exposure.
- **No boolean `fallbackToSystem` flag; an ordered `fallback` instead (#735).**
  A flag that decides whose key pays is a knob that gets flipped under
  pressure, invisibly to callers. The order is declared once, with the
  purpose, and the default keeps the pre-organization rule. A purpose that
  must never fall back declares `system: null` and no `org`.
- **A sibling `org_credentials` table, not a nullable `org_id` on
  `credentials` (#735).** A unique `(org_id, purpose, name)` with NULLs needs
  a raw-SQL partial index or `NULLS NOT DISTINCT` (more intentional drift), and
  it would mix deployment and tenant secrets in one row-level-security
  table. Per-slice org key tables were rejected too: the cipher, hint,
  blank-preserve and rotation logic would be copied per slice.
- **Registries, not an array (#735).** A purpose is registered by the module
  that owns it, like job handlers and Doctor checks, so a fork never edits a
  platform file to add one.
- **Decrypt failures throw.** "Cannot read" must never look like "not
  configured", or the resolver would hide the fault by falling back.
- **No user purpose ships.** Declaring `'ai'` would create a second store for
  the AI key, with two resolvers that could disagree. Migrating
  `user_ai_keys` here would have to carry its reachability bookkeeping.
- **No controller.** Store first; the controller belongs to the feature,
  which knows its actor, permission and audit semantics.

## 7. Verification

```bash
cd packages/platform-api && npx jest --config ./test/jest.config.js test/credentials test/core/secret-cipher.spec.ts
cd apps/api && npm test -- credentials && npm run test:db -- credentials
```

Expect the suites in §5 to pass. There is nothing to exercise over HTTP
until a feature declares a purpose and adds its own routes.

## History

- #115 (epic #108) added `CredentialsService`, the deployment-owned store.
- #387 added `user_credentials`, the owner-bound cipher domain,
  `UserCredentialsService`, the purpose registry and the resolver, and
  extended the colon ban to system purposes.
- #431 (epic #419) kept AI provider keys in their own `user_ai_keys` table.
- #688 moved `UserCredentialsService` onto the user-scoped Prisma client, with
  unchanged behaviour.
- #735 (PP-8.8) moved both stores into `@marinoscar/platform-api/credentials`,
  added `org_credentials` and `OrgCredentialsService` with the org-bound cipher
  domain, replaced the closed purpose array with `registerUserCredentialPurpose`
  and `registerCredentialPurpose`, and extended the resolver to user, then org,
  then system.

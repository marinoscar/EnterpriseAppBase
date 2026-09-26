# Per-User Encrypted Credentials

> Issue #387 — the foundation only: schema, an owner-bound cipher domain, a
> per-user store (`UserCredentialsService`), a purpose registry
> (`USER_CREDENTIAL_PURPOSES`), and a resolver (`UserCredentialResolver`).
> **No HTTP surface and no admin/user-facing UI ship with this issue** — the
> same "store first, controller belongs to the feature that needs it" posture
> `CredentialsModule` already takes (see
> [`docs/SECURITY-ARCHITECTURE.md` §14](../SECURITY-ARCHITECTURE.md#14-encrypted-credential-storage-runtime-configured-secrets)).
>
> Implemented in `apps/api/src/user-credentials/` (`user-credentials.module.ts`,
> `user-credentials.service.ts`, `user-credential.resolver.ts`,
> `user-credential-purposes.ts`,
> `interfaces/user-credential-info.interface.ts`), the shared
> `apps/api/src/credentials/credential-internals.ts`, and
> `apps/api/src/common/crypto/secret-cipher.ts` (`userCredentialPurpose`,
> `USER_CREDENTIAL_DOMAIN_PREFIX`, `isCanonicalUuid`). Schema:
> `apps/api/prisma/schema.prisma` (`UserCredential`), migration
> `apps/api/prisma/migrations/20260927120000_add_user_credentials/`.
>
> **On what is here.** §1 is the problem and why this is a sibling table, not
> a column on `credentials`. §2 is the schema. §3 is the owner-bound cipher
> domain. §4 is `UserCredentialsService`'s API. §5 is the purpose registry,
> and why it ships empty. §6 is `UserCredentialResolver`'s resolution rule.
> §7 is the shared internals both stores use. §8 is rejected alternatives. §9
> is the recipe for adding a user key type. §10 is verification.

## 1. What this is, and why a sibling table

`CredentialsService` (`apps/api/src/credentials/`, issue #115/epic #108)
holds secrets the **deployment** owns — SMTP, Web Push's VAPID private key,
the object-storage secret access key — addressed by `(purpose, name)`, one
row per address, encrypted under a purpose-bound sub-key. It has no concept
of a secret a **user** brings themselves (bring-your-own-key): a user's own
webhook signing secret, a personal token for an integration they connect,
their own key for a service the deployment also has an admin/org key for.

Issue #387 is the foundation for that second kind of row: `UserCredential`,
a new table addressed by `(userId, purpose, name)`, with its own owner-bound
cipher domain, its own service (`UserCredentialsService`), and a resolver
that decides whose key answers when both a user's own key and the
deployment's key exist for the same purpose. `credentials` itself is
**untouched** — not one column, not one row shape, not one consumer.

### Why not an `ownerId` column on `Credential`

The natural-looking alternative — add a nullable `ownerId` to `Credential`
and let a row be either the deployment's (`ownerId: null`) or a user's
(`ownerId: <uuid>`) — was rejected for reasons specific to what `Credential`
already guarantees, not a style preference:

- **`Credential` has `@@unique([purpose, name])`, table-wide.** That
  constraint is *deployment-wide* uniqueness on purpose: exactly one `smtp`/
  `default` row can exist, ever, in the whole table. Adding `ownerId` to the
  key (`@@unique([ownerId, purpose, name])`) would need `ownerId` to
  participate in uniqueness for a NULL-owned system row **and** be
  per-user-unique for an owned one — and SQL's NULL-uniqueness rule makes
  that unrepresentable in one index. Postgres does not treat two `NULL`s as
  equal for a unique constraint, so `(NULL, 'smtp', 'default')` could be
  inserted an unbounded number of times while `('<uuid>', 'ai', 'openai')`
  correctly stays one-per-user. The system side of the constraint would
  silently stop being enforced the moment the column existed.
- **Delete semantics diverge, and both are correct for their own rows.**
  `Credential.updatedByUserId` is `onDelete: SetNull` — deliberately: the
  admin who last typed the SMTP password is provenance, not an owner, and
  offboarding them must not delete a working SMTP configuration (see the
  model's own comment and SECURITY-ARCHITECTURE.md §14). A user's own BYOK
  row is the opposite: it must be `onDelete: Cascade`, because a credential
  with no purpose once its owner is gone is exactly the row that must not
  survive them. One column cannot carry two contradictory `onDelete`
  behaviours depending on whether it happens to be `NULL`.
- **Nothing would stop ownership from crossing a boundary it must not
  cross.** With one table, a resolver bug, a hand-written query, or a
  migration script one `WHERE` clause short of correct could read another
  user's row as the deployment's, or vice versa — indistinguishable from a
  correct row until the wrong key is used somewhere. A separate table with
  its own required, cascading foreign key makes "this row belongs to
  exactly one user, and stops existing when they do" a database-level fact,
  the identical argument `docs/specs/ai-platform.md`'s rejected-alternatives
  section already makes for not putting `user_ai_keys` inside
  `CredentialsService`.

A sibling table with the identical column shape (`purpose`, `name`,
`secret`, `hint`, `label`, timestamps), scoped by a required, cascading
`userId`, and a **separate** `@@unique([userId, purpose, name])` avoids all
three problems by construction: the system table's uniqueness is untouched,
each table's delete semantics fit the row it actually holds, and there is no
single index or column where a system row and a user row could ever be
confused.

## 2. Schema

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

- **`secret` is `@db.Text`**, for the identical reason as `Credential.secret`:
  a base64 AES-GCM payload has no meaningful length bound and must never be
  truncated.
- **`hint`/`label` are nullable and non-secret** — the display aid derived
  from the plaintext on write, and a user-entered description. Neither ever
  carries the secret or ciphertext.
- **`onDelete: Cascade`**, not `SetNull` — see §1. There is no
  `updatedByUserId` on this model at all: the owner is the only writer of
  their own credential, so there is no separate "who last touched this"
  provenance to record.
- **`@@unique([userId, purpose, name])`** is a normal Prisma-expressible
  unique index — unlike `jobs`' and `database_backup_runs`' partial unique
  indexes, this one needs no hand-written SQL: every column in it is
  `NOT NULL`, so there is no NULL-uniqueness ambiguity to work around.

## 3. The owner-bound cipher domain

`Credential` rows are encrypted under the bare purpose as the cipher's
sub-key domain — a row under `purpose: 'smtp'` can only ever be decrypted
with the `'smtp'` sub-key (`secret-cipher.ts`'s `deriveKey`). A `UserCredential`
row is encrypted under a domain that also binds the **owner**:

```
user:<userId>:<purpose>
```

built by `userCredentialPurpose(userId, purpose)`
(`common/crypto/secret-cipher.ts`), and passed as the `purpose` argument to
the unchanged `encryptSecret`/`decryptSecret` — those two functions do not
know or care that a "purpose" string can have colons in it; the owner
binding is entirely a property of what string `UserCredentialsService`
happens to pass them.

**Why this matters, concretely**: without it, a SQL write or a bug that
copies a `UserCredential` row's ciphertext from user A's row into user B's
row (or a bug that runs the update against the wrong `id`) would decrypt
successfully under B's read — B would be handed the use of A's key, silently.
With the owner bound into the domain, that same ciphertext, decrypted as if
it were `user:<B's id>:<purpose>`, fails GCM authentication instead, exactly
as a ciphertext copied across purposes already fails in the system store
(SECURITY-ARCHITECTURE.md §14). The database-level uniqueness constraint and
the cipher-level owner binding are two independent layers catching the same
class of mistake.

Two things make `(userId, purpose)` → domain a one-way-decomposable string,
so `deriveKey`'s plain concatenation is safe:

- **`userId` must be a canonical UUID**: lowercase hex, hyphenated,
  8-4-4-4-12 (`isCanonicalUuid`, `CANONICAL_UUID_PATTERN` in
  `secret-cipher.ts`). Fixed length, no `:`, and exactly **one** spelling per
  id — an uppercase or brace-wrapped rendering of the same UUID would derive
  a *different* key and strand every row written under the canonical form.
  `assertCredentialOwner` (`credential-internals.ts`) enforces this at every
  service entry point; `userCredentialPurpose` enforces it again as the
  cipher's own backstop, throwing a plain `Error` with no value in it if a
  caller ever reaches the cipher with something malformed.
- **`purpose` may not contain `:`** — **now enforced for system purposes
  too**, not only user ones. `assertCredentialPurpose`
  (`credential-internals.ts`) is the single function both
  `CredentialsService` and `UserCredentialsService` call to validate a
  purpose, and it rejects a colon unconditionally. Before #387 nothing
  stopped a system purpose from containing `:`; now, forbidding it in *both*
  stores with one rule is what makes the two key spaces disjoint by
  construction: a system purpose containing `:` is the only way to spell one
  that begins with `user:`, i.e. one whose sub-key domain **is** some user's
  domain and would be readable with that user's own ciphertext. No existing
  system purpose (`smtp`, `storage`, `push_vapid`, `ai`) contains `:`, so
  this tightening changed no stored data.

Together, `(userId, purpose) → 'user:' + userId + ':' + purpose` is
injective: two different `(userId, purpose)` pairs can never produce the
same domain string, and a domain string can never be misread as belonging to
a different owner or a different purpose.

**Per-user derived keys are deliberately NOT cached.** `deriveKey`'s
`derivedKeyCache` is a `Map` keyed by purpose string, and every owner-bound
domain (anything starting with `USER_CREDENTIAL_DOMAIN_PREFIX`) is
explicitly excluded from it (`const cacheable = !purpose.startsWith(...)`).
A per-user domain is one string per **user × purpose** — an open-ended,
user-base-sized vocabulary, exactly what the cache comment for system
purposes says the cache must never hold (system purposes are a small, fixed,
code-chosen set; user domains are not). Caching them would grow one derived
key resident in process memory per user forever. The cost of not caching is
one HMAC-SHA256 per decrypt/encrypt call — microseconds, and the module's own
comment already makes this trade-off explicit for the reason HMAC was chosen
over a slow KDF in the first place.

## 4. `UserCredentialsService`

The per-user sibling of `CredentialsService`, holding the same two
invariants plus one more:

1. **No plaintext egress.** `getSecret(userId, purpose, name)` is the only
   method that returns plaintext — server-side only, never called from a
   controller, and documented as such in its own doc comment. `describe` and
   `list` return `UserCredentialInfo`, a type with no field able to hold a
   secret or ciphertext (enforced at compile time — see
   `interfaces/user-credential-info.interface.ts`'s `AssertTrue` proofs,
   mirroring `CredentialInfo`'s). Nothing in the service ever interpolates a
   secret into a log line: log lines name the address (`purpose`, `name`,
   `userId`) only.
2. **Blank preserves.** `setSecret(userId, purpose, name, secret, meta)`
   treats `undefined`, `null` and `''` for `secret` identically — "keep what
   is stored," applying only `meta` — via the shared `isBlankSecret`. A blank
   secret with nothing stored yet is a 400 (`BadRequestException`); there is
   no way to create a row with no secret. Erasing is the separate
   `deleteSecret`, idempotent on an absent row.
3. **Owner-bound cipher domain** (§3) — the one invariant `CredentialsService`
   does not need, because it has no owner to bind.

**`userId` is the first parameter of every method**, and every Prisma query
is scoped by it:

- `getSecret(userId, purpose, name): Promise<string | null>` — plaintext.
  Throws `InternalServerErrorException` (never a silent `null`, never a
  silent fallback) if a row exists but will not decrypt — a changed master
  key, a tampered row, or a row moved from another owner. This is the same
  posture `CredentialsService.getSecret` takes, and the same reason: "this
  credential can't be read" must never be reported as "not configured,"
  because a resolver (§6) that saw `null` here would silently fall back to
  the deployment's key and hide the fault from the very user whose key
  stopped working.
- `describe(userId, purpose, name): Promise<UserCredentialInfo | null>` —
  presentation read; the `secret` column is not even selected
  (`USER_CREDENTIAL_INFO_SELECT` is a `Record<keyof UserCredentialInfo, true>`,
  so adding `secret: true` to it fails to compile as an excess property).
- `list(userId, purpose?): Promise<UserCredentialInfo[]>` — every credential
  this user has, or only those under one `purpose`; ordered by
  `(purpose, name)` for a stable listing. Unlike `CredentialsService.list`
  (which requires a `purpose`, because "every credential in the deployment"
  is not a legitimate ask), `purpose` here is optional: "every key I have
  stored" is a legitimate thing for a user to ask about **themselves** —
  the scope that matters is the owner, not the purpose.
- `setSecret(userId, purpose, name, secret, meta?)` — create or update.
  **`hint` is derived, never caller-supplied**: `UserCredentialMeta` has no
  `hint` field (enforced by the same compile-time proof that keeps secret
  fields out), and the service calls the shared `deriveHint(plaintext)` at
  the moment it already holds the plaintext for encryption — the identical
  reasoning `CredentialsService` uses, so a caller can never inject a
  misleading hint or one that doesn't match what was actually stored.
- `deleteSecret(userId, purpose, name)` — the only way to erase a row.
  Idempotent.

**No cross-user listing exists anywhere in this service** — there is no
method that takes anything but a single `userId` and returns rows for only
that user. An id-addressed lookup (find by `UserCredential.id` alone) does
not exist either: the address is always the full `(userId, purpose, name)`
triple, which is also the only shape the unique index and the cipher's
owner-bound domain are built on. `UserCredentialInfo` itself carries neither
`id` nor `userId` (§ of the interface file's own header) — every read is
already scoped by the caller's own id, so echoing it back would only make
the type *look* like something a cross-user listing could plausibly return.

**No audit events** — mirroring `CredentialsService`, which also writes
none. This is a store, not a feature surface; the feature that eventually
exposes a user credential type over HTTP (with its own actor, request
context, and reason) is what audits the act, exactly as
`CredentialsModule`'s own header states for the system store.

**No controller, on purpose.** `UserCredentialsModule` is not `@Global()`
and exports only `UserCredentialsService` and `UserCredentialResolver` — both
can yield plaintext, so every consumer must be a visible
`imports: [UserCredentialsModule]` line in a diff, and any HTTP surface is
added by whichever feature needs it, in its own module (the same reasoning
`CredentialsModule`'s header gives, restated for this store).

## 5. The purpose registry

`USER_CREDENTIAL_PURPOSES` (`user-credential-purposes.ts`) is shaped like
`notifications/notification-events.ts`: a flat array of plain data, not a
Nest provider, imported by nothing. Each entry:

```ts
interface UserCredentialPurposeDef {
  readonly purpose: string;                        // permanent once rows exist
  readonly label: string;                           // user-facing name
  readonly description: string;                     // user-facing copy
  readonly system: SystemCredentialAddress | null;   // fallback address, or none
}
```

`system` names the deployment's own `(purpose, name)` address in the
`credentials` table for the same kind of secret, or `null` when there is no
deployment-wide counterpart at all and a user's own key is the only possible
answer. **There is deliberately no per-entry "allow fallback" boolean.** The
resolution rule (§6) is fixed for every entry — user wins, else system, else
none — because a boolean that decides whose key pays for a call is exactly
the kind of knob that gets flipped under pressure and is invisible at the
call site. A purpose that must never fall back simply declares
`system: null`; a deployment that wants no fallback for a purpose that *has*
a system counterpart simply never configures that system credential (the
resolver already treats "configured but unset" the same as "no counterpart"
— see §6).

**`USER_CREDENTIAL_PURPOSES` ships empty in production.** The only
bring-your-own-key type this application has today — a user's own AI
provider key — already lives in `user_ai_keys` (epic #419, issue #431), with
its own dedicated cipher purpose (`'ai_user_key'`), its own reachability
bookkeeping (`reachable_model_ids`, `verified_at`), and its own resolver
(`AiKeyResolver`). Declaring `'ai'` here as well would create a **second**
store for the same key — two places a user's OpenAI key could live, and two
resolvers that could disagree about which one answers a given call.
Migrating `user_ai_keys` onto this store is explicitly out of scope for
#387, and would have to carry that bookkeeping with it if it ever happens.

So this issue ships as pure foundation: schema, cipher, store, resolver —
with zero production purposes declared. **Adding a type costs one entry and
zero migrations** (§9); nothing about the table, the cipher, the service or
the resolver needs to change.

The registry is injected through the `USER_CREDENTIAL_PURPOSE_REGISTRY`
token (`user-credential.resolver.ts`) rather than imported directly by
`UserCredentialResolver`, bound in `UserCredentialsModule` to
`USER_CREDENTIAL_PURPOSES`. This is what lets a test (or, in principle, a
fork) supply its own fixture registry without editing the production list —
`user-credential.resolver.spec.ts` does exactly this.

**Validated at boot, not at first use.** `UserCredentialResolver`'s
constructor calls `assertValidRegistry(registry)` before anything else,
which walks every entry and:

- runs `assertCredentialPurpose`/`assertCredentialAddress` on `purpose` and,
  if present, `system` (rejecting a malformed identifier the same way the
  stores themselves would);
- requires non-empty `label` and `description`;
- rejects a duplicate `purpose` across entries.

A malformed or duplicate entry throws at provider construction — i.e. at
Nest module init / application boot — rather than at the first call to
`resolve()`. A duplicate purpose would otherwise make `Array.find` silently
pick whichever entry happens to come first, and a malformed identifier could
never be stored under anyway; both are programming errors that should fail
the deploy, not surface as a confusing runtime resolution three weeks later.

## 6. `UserCredentialResolver`: whose key answers

One fixed rule, for every purpose in the registry:

1. the user's own credential, if they have stored one;
2. else the deployment's credential — the registry entry's `system`
   counterpart, read through the injected `CredentialsService` — if there is
   one and it is configured;
3. else `{ source: 'none' }`.

```ts
async resolve(userId, purpose, name = DEFAULT_USER_CREDENTIAL_NAME): Promise<ResolvedCredential>
```

`ResolvedCredential` is a discriminated union on `source`
(`'user' | 'system' | 'none'`), so a caller can attribute usage or billing
to the right party, or tell a user "using your key" vs. "using the
organization's key," without re-deriving the rule itself. `name` defaults to
`DEFAULT_USER_CREDENTIAL_NAME` (`'default'`) for a purpose with one key per
user; the system counterpart's address is fixed by the registry entry and
does not vary with the caller's `name`.

Two failure behaviours that are easy to get wrong, and are both deliberate:

- **An unknown purpose throws** (`InternalServerErrorException`) rather than
  resolving to `'none'`. A purpose not in `USER_CREDENTIAL_PURPOSES` is a
  programming error — a typo, or a call made before the registry entry
  landed — not a legitimate "nothing configured" outcome, and conflating the
  two would hide the bug behind a code path that looks like ordinary,
  expected behavior.
- **A user credential that exists but will not decrypt throws, and never
  falls through to the system key.** `resolve()` calls
  `UserCredentialsService.getSecret`, which itself throws rather than
  returning `null` on a decrypt failure (§4). The resolver does not catch
  that error and try the system counterpart instead — doing so would mean a
  user whose own key has become unreadable (a key rotation gone wrong, a
  tampered row) gets silently switched onto the deployment's key, and any
  billing or rate limiting that follows is charged to the organization for a
  call the user's own key was supposed to pay for. That is exactly the
  invisible-failure shape both stores in this codebase refuse to produce
  anywhere else (`getSecret` never silently reports "not configured" for a
  row that exists but can't be read).

`ResolvedCredential`'s `'user'`/`'system'` arms carry plaintext —
server-side only, same as everything else this pair of stores can return;
`ResolvedCredentialSource` (just the `source` field) is the safe-to-log/
return subset.

## 7. Shared internals

`CredentialsService` and `UserCredentialsService` must agree on three things
— what a hint looks like, what "blank" means on write, and what a valid
address is — and agreeing by copy-pasting the same logic into both files is
precisely how two stores drift apart over time. So all three live once, in
`apps/api/src/credentials/credential-internals.ts`, and both services (plus
`ai/keys/user-ai-keys.service.ts`, which re-exports `deriveHint` from
`credentials.service.ts` for its existing importers) call the same
functions:

- **`deriveHint(plaintext)`** — the non-secret display aid. Below 8 code
  points, reveals nothing (`'••••'`); at or above, the mask plus the last 4
  code points. Iterates code points, not UTF-16 units, so a secret ending in
  an emoji or other astral character can't be cut in half into an invalid
  surrogate and blow up on the way into a `text` column.
- **`isBlankSecret(secret)`** — is this write a "preserve what's stored"
  write? `undefined` and `null` both count (a JSON body omits vs. explicitly
  nulls a field; a form means the same thing by either), and so does `''`.
  Deliberately **no `.trim()`** — a whitespace-only submission is a real
  value, and trimming a secret's bytes is a presentation-layer decision, not
  a store's call to make silently.
- **`assertCredentialIdentifier`/`assertCredentialPurpose`/
  `assertCredentialAddress`** — reject an empty or whitespace-padded
  `purpose`/`name` (whitespace is **rejected**, not trimmed, because
  `purpose` is also the cipher's sub-key domain — silently trimming would
  let `'smtp '` and `'smtp'` derive two different keys and strand a row
  written under one spelling). `assertCredentialPurpose` additionally
  rejects any `:` in `purpose`, in **both** stores (§3) — this is the one
  rule change #387 made to code the system store already used.
- **`assertCredentialOwner(userId)`** — new for #387, used only by the user
  store: rejects anything that is not `isCanonicalUuid`.

## 8. Rejected alternatives

- **An `ownerId` column on `Credential`.** See §1 in full: it breaks
  table-wide `@@unique([purpose, name])` via NULL-uniqueness, cannot express
  two contradictory `onDelete` behaviours on one column, and leaves nothing
  but application-level discipline standing between a system row and a user
  row.
- **Encoding the owner into `name`** (e.g. `name: "<userId>:default"` on the
  existing `Credential` table) instead of a real column. Rejected: it would
  make `(purpose, name)` uniqueness accidentally-correct rather than
  structurally correct (nothing stops a second literal string that happens
  to collide), gives Prisma no relation to cascade-delete on, and — the
  sharper problem — the cipher's sub-key domain is derived from `purpose`
  alone in the system store, so encoding ownership only in `name` would
  leave every user's row decryptable under the *same* key as every other
  user's row of the same purpose. The owner-bound domain (§3) is the whole
  point; smuggling the owner into `name` does nothing to bind it into the
  cipher.
- **A JSONB blob in `user_settings`**, one key per BYOK credential.
  Rejected for the identical reason `docs/specs/ai-platform.md`'s own
  rejected-alternatives section gives for `user_ai_keys` and for the storage
  secret: `user_settings` is returned wholesale by the settings endpoints, so
  a secret living inside it is one careless response away from exposure. A
  dedicated table, read by explicit `select`, keeps "never returned by a
  bulk read" true by construction instead of by remembering to redact a key.
- **A purpose sub-key with no owner binding** — i.e. reusing the system
  store's plain `deriveKey(purpose)` for user rows too, relying on the
  `(userId, purpose, name)` table address alone to keep users apart.
  Rejected: the database constraint is one layer, but it is the *only*
  layer at that point — a row moved between users by a bug or a privileged
  SQL write would decrypt cleanly under the shared purpose key and hand the
  new "owner" the old owner's secret with no error at all. Binding the
  owner into the cipher domain (§3) makes that failure mode fail loudly
  (a GCM authentication error) instead of succeeding silently.
- **A per-purpose `fallbackToSystem: boolean` flag** on
  `UserCredentialPurposeDef`, instead of the fixed user-wins/else-system/
  else-none rule. Rejected: see §5 — a flag that decides whose key answers
  is a knob, and a knob gets flipped under pressure by whoever is closest to
  an incident, invisibly to every caller of `resolve()`. A purpose that must
  never fall back declares `system: null` instead, which is visible in the
  registry and cannot be toggled at runtime.

## 9. How to add a user key type

One registry entry and zero migrations — the same shape as "Adding a
Notification" and "Adding a Job Type" in `CLAUDE.md`:

1. **Add an entry to `USER_CREDENTIAL_PURPOSES`** (`user-credential-purposes.ts`):
   ```ts
   export const USER_CREDENTIAL_PURPOSES: readonly UserCredentialPurposeDef[] = [
     {
       purpose: 'webhook_signing_key',      // permanent once rows exist; no ':'
       label: 'Webhook signing key',
       description: 'Used to verify webhooks this integration sends you.',
       system: null, // no deployment-wide counterpart — the user's key is the only answer
     },
   ];
   ```
   `assertValidRegistry` validates this at boot (§5) — a bad identifier or a
   duplicate purpose fails the deploy immediately, not the first request.
2. **Write to it** from the feature's own service, injecting
   `UserCredentialsService` (`imports: [UserCredentialsModule]` in that
   feature's module):
   ```ts
   await this.userCredentials.setSecret(
     userId,
     'webhook_signing_key',
     DEFAULT_USER_CREDENTIAL_NAME,
     submittedSecret, // blank preserves what's stored
     { label: submittedLabel },
   );
   ```
3. **Read it** through `UserCredentialResolver.resolve(userId, purpose)` if
   the type has (or might later have) a system fallback, or directly through
   `UserCredentialsService.getSecret(userId, purpose, name)` if it can
   never fall back and `system: null` already says so. Either way, this is a
   server-side-only plaintext read — never call it from a controller.
4. **Add the feature's own controller and DTOs**, since
   `UserCredentialsModule` deliberately ships none (§4). This is where the
   feature's own auth guard, permission, and — if the write should be
   audited — its own `AuditService` call belong; `UserCredentialsService`
   itself writes no audit events, mirroring `CredentialsService`.
5. **Present it** with `describe`/`list`, never by hand-assembling a
   response from a raw row — `UserCredentialInfo` is what keeps a secret out
   of a response body by construction.

Nothing about the table, the cipher, the service, or the resolver needs to
change for a new purpose — the entire cost is the registry entry plus
whatever HTTP surface the feature wants, exactly as the header comment in
`user-credential-purposes.ts` states.

## 10. Verification

| Claim | Where it is asserted |
|---|---|
| Two users at the same `(purpose, name)` are stored and read back independently | `apps/api/src/user-credentials/user-credentials.service.spec.ts`, `'keeps two users at the same (purpose, name) apart'` |
| A row moved to another purpose of the same user fails to decrypt (owner-bound domain also binds purpose) | `user-credentials.service.spec.ts`, `'fails authentication when a row is moved to another purpose of the same user'` |
| `describe`/`list` never select or return the ciphertext or any secret-bearing field | `user-credentials.service.spec.ts`, `describe('no plaintext egress')`; compile-time in `interfaces/user-credential-info.interface.ts` |
| A blank secret preserves the stored value; a blank secret with nothing stored is a 400; a whitespace-only secret is a real value | `user-credentials.service.spec.ts`, `describe('blank preserves')` |
| A purpose containing `:`, or a whitespace-padded purpose/name, is rejected | `user-credentials.service.spec.ts`, `describe('address validation')` |
| The resolver answers `'none'` without consulting the system store when a purpose declares no counterpart | `apps/api/src/user-credentials/user-credential.resolver.spec.ts`, `'answers none without consulting the system store when there is no counterpart'` |
| An unknown purpose throws before any store is read | `user-credential.resolver.spec.ts`, `'throws for a purpose not in the registry, before reading anything'` |
| A malformed or duplicate registry entry fails at construction | `user-credential.resolver.spec.ts`, `describe('registry validation at construction')` |
| The production registry is empty and does not declare `'ai'` | `user-credential.resolver.spec.ts`, `describe('the production registry')` |
| `userCredentialPurpose` requires a canonical UUID and a colon-free purpose | `apps/api/src/common/crypto/secret-cipher.spec.ts` |
| A system purpose containing `:` is now rejected (not just a user purpose) | `apps/api/src/credentials/credential-internals.spec.ts` (or the shared spec covering `assertCredentialPurpose`) |

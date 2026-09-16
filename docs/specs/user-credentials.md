# Per-User Encrypted Credentials

> Issue #387. Implemented in `apps/api/prisma/schema.prisma` (model
> `UserCredential`, table `user_credentials`), `apps/api/src/common/crypto/
> secret-cipher.ts` (`userCredentialPurpose`, and the revised `derivedKeyCache`
> comment), `apps/api/src/credentials/credential-internals.ts` (hint/blank/
> address validation shared with the system store),
> `apps/api/src/credentials/user-credentials.service.ts`,
> `apps/api/src/credentials/user-credential-resolver.service.ts`,
> `apps/api/src/credentials/user-credential-purposes.ts` (the registry,
> shipped empty), `apps/api/src/credentials/interfaces/
> user-credential-info.interface.ts`, and `apps/api/src/credentials/
> user-credentials.module.ts`.
>
> **This document describes a foundation, not a feature.** There is no HTTP
> surface, no settings page, and no consumer of this store anywhere in the
> repository yet — `UserCredentialsModule` is deliberately not registered in
> `app.module.ts` (§7). Do not read anything below as describing an endpoint,
> a permission, or a UI that exists today; where a future surface is
> described, it is described as future work, in §7.

## 1. What this is

An **encrypted credential store owned by one user** — the bring-your-own-key
half of a distinction this application otherwise didn't need to draw. The
existing `credentials` table (epic #108, `CredentialsService`) holds secrets
an **administrator** configures once for the whole deployment: the SMTP
password, Web Push's VAPID private key, the object-storage secret access key.
Every user of the application shares those. `user_credentials` holds the
opposite shape: a secret **one user** supplies for themselves, because a
feature lets them substitute their own credential for the deployment's — a
personal `llm/anthropic` API key that bills their own account instead of the
shared one, a personal webhook signing secret, or anything else along those
lines that a later feature adds.

The line between the two tables is ownership, not sensitivity. Both hold
AES-256-GCM ciphertext under the same cipher, the same non-secret-metadata
discipline (a masked `hint`, an optional `label`, never the plaintext or the
ciphertext in a response), and the same "blank preserves" write contract. What
differs is *who may ever read or write the row*: exactly one administrator
role for `credentials`, exactly one specific user for `user_credentials` — see
§2 and §5 for what that difference costs in code, and §4 for the failure mode
it exists to prevent.

## 2. Why a separate table, not a nullable owner column on `credentials`

The obvious-looking alternative is one row shape for both: add an `ownerUserId
String?` to `Credential` and let `NULL` mean "system-owned." It was rejected
for three reasons, stacked in the `UserCredential` model's own block comment
in `schema.prisma`, and the first one decides the question on its own.

### 2.1 The uniqueness constraint has nowhere good to go

`Credential` carries `@@unique([purpose, name])`, **table-wide**. Adding a
nullable `ownerUserId` while keeping that constraint caps the deployment at
**one user, ever**, per purpose — the second person to save an `llm/anthropic`
key would collide with the first. That is a worse bug than the one a nullable
column was meant to solve.

The apparent fix, widening the constraint to `@@unique([purpose, name,
ownerUserId])`, does not work either. PostgreSQL's `UNIQUE` constraint does
not treat `NULL` as a value equal to itself — two `NULL`s never conflict — so
that constraint would **newly permit two system-owned `storage/default`
rows** to coexist. The exact ambiguity a unique constraint exists to prevent
would reappear, and only for the owner-less case `CredentialsService`'s own
`findUnique`/`upsert` calls already depend on being singular.

The remaining fix — drop the declarative `@@unique` and enforce the address
with hand-written partial unique indexes instead (one `WHERE owner_user_id IS
NULL`, one `WHERE owner_user_id IS NOT NULL`) — is *correct*, but it is not
free: Prisma's typed `findUnique`/`upsert` need a `@@unique` they can name.
Losing it downgrades every settled call in `CredentialsService` to
`findFirst` plus an application-level check-then-insert, which is exactly the
kind of race a database constraint exists to close.

With a second table, none of this trade-off exists. Every column of
`UserCredential`'s address (`userId`, `purpose`, `name`) is `NOT NULL`, so
`@@unique([userId, purpose, name])` is both enforced by Postgres and directly
usable by Prisma's typed accessors — the shape a nullable owner column can
never reach without giving something up.

### 2.2 The delete semantics are the exact opposite, on purpose

`Credential.updatedByUserId` is `onDelete: SetNull`, deliberately: the
administrator who last typed the SMTP password is *provenance*, not an
*owner*, and offboarding them must not delete a working SMTP configuration
that the rest of the deployment still depends on.

`UserCredential.userId` is `onDelete: Cascade` — the exact inverse, and just
as deliberate. A departed user's personal API key is not infrastructure
anyone downstream inherits; it is theirs, full stop, and for a key that bills
someone, leaving it behind after they're gone is a liability nobody agreed to
carry. One table holding two user foreign keys with contradictory delete
rules would make deletion behaviour depend on which column happened to be
under discussion — a fork's next migration is one edit away from getting it
backwards.

### 2.3 Owner-crossing becomes unrepresentable, not merely forbidden

With two tables, "hand one user's secret to a system consumer" is not a query
that can be written — there is no `WHERE owner_user_id IS NULL` clause a
future `findFirst` could forget to add, because there is no column to omit
the filter on. This is the same technique `UserCredentialInfo` uses to make
plaintext egress unrepresentable rather than merely discouraged (§5): make
the mistake have no syntax, rather than trusting every future caller to spell
the guard correctly.

## 3. The owner-bound cipher domain

Both tables encrypt under the same cipher (`secret-cipher.ts`) and the same
master key (`SECRETS_ENCRYPTION_KEY`), but a `user_credentials` row is
encrypted under a **different derived sub-key** than a `credentials` row at
the same `purpose` string. `userCredentialPurpose(userId, purpose)` builds
that sub-key's domain as:

```
user:<lowercased-uuid>:<purpose>
```

and hands it to `encryptSecret`/`decryptSecret` exactly like any other
purpose string — the cipher itself gained no new parameter and no second code
path for this; owner binding is expressed entirely as a purpose string.

### 3.1 The attack this stops

Without an owner-bound domain, every user's personal `llm` key would sit
under one shared `'llm'` sub-key — the same key `CredentialsService` would
use for a system-wide `llm` credential, if one existed. An attacker with a
SQL *write* but not the encryption key (a compromised admin console, an
injection reaching `user_credentials`, a restored backup merged in wrong)
could copy user A's ciphertext blob into user B's row. The application would
decrypt it cleanly — it genuinely is a valid `'llm'` ciphertext — and would
then spend A's API key as though it were B's: A's budget, A's rate limit,
A's provider-side audit trail, driven by B's traffic. Binding the owner into
the sub-key domain turns that same write into a blob encrypted under A's
sub-key being opened with B's — GCM authentication fails, and the row is
unreadable rather than quietly wrong.

### 3.2 The collision proof, restated

The property that must hold: **every distinct `(userId, purpose)` pair maps
to a distinct derivation label, and no user label ever equals a system
label.** `deriveKey`'s own contract needs exactly one variable field at the
end of its label (`SUBKEY_LABEL_PREFIX + purpose`) for that to be true — a
second variable field folded in carelessly would let, for instance, `(userId:
'ab', purpose: 'c')` and `(userId: 'a', purpose: 'bc')` collide onto one key.
`userCredentialPurpose` avoids that by construction, using two grammar facts
that are *enforced*, not assumed:

1. **`userId` is a canonical UUID.** `USER_ID_PATTERN` accepts either casing
   (PostgreSQL's `uuid` type compares case-insensitively, so an uppercase id
   denotes exactly the right user and refusing it would reject a caller who
   was not wrong about anything), but the function then **lowercases it**
   before building the label. A canonical UUID is always exactly 36
   characters of lowercase hex and hyphens — structurally incapable of
   containing a colon — so in `user:<userId>:<purpose>` the *first* colon
   after the fixed `user:` prefix is always the delimiter, unambiguously.
   That is length-prefixing achieved by the field's own grammar rather than
   by a written-out byte count.

   The normalisation is why the userId is lowercased at all, and it matters
   beyond the proof: without it, two spellings of the same UUID would
   silently derive **two different keys** for what is really one user's row.
   The row would still be *found* (Postgres's case-insensitive `uuid`
   comparison locates it), but decryption would fail, and the operator-facing
   error — "the payload is corrupt, was written for a different owner, or the
   encryption key has changed" — would point at a rotation or a tampering
   incident that never happened. Distinct *users* still give distinct labels,
   which is the property the attack in §3.1 actually depends on; two
   spellings of one user deliberately collapsing onto one key is the
   normalisation working as intended, not a weakening of it.

2. **`purpose` may not contain a colon.** This is enforced by
   `assertCredentialIdentifier` in `credential-internals.ts`, on the *system*
   side of the boundary — the cipher enforces the rule on the user side (by
   construction: a per-user purpose is only ever the second variable field of
   a `user:…:…` label), and the validator enforces it on the system side, so
   a system purpose can never be chosen (by a fork, by a future feature) that
   would collide with some user's real domain. A user label therefore always
   contains exactly two colons after the constant prefix; a system label's
   entire variable part is the bare purpose string and can contain none. The
   three system purposes that exist today — `'smtp'`, `'storage'`,
   `'push_vapid'` — satisfy this already, so the rule breaks nothing that
   exists; it only constrains purposes not yet written.

Together, (1) gives injectivity within the user domain, and (2) makes the
user domain and the system domain disjoint. `v1` in `SUBKEY_LABEL_PREFIX` is
untouched by any of this: user credentials are new rows carrying a new label
*shape* under the same v1 derivation, so no existing SMTP, storage, or VAPID
ciphertext changes meaning and no re-encryption migration was required to
ship this.

### 3.3 `derivedKeyCache`'s size assumption, revised

Before this feature, `secret-cipher.ts`'s in-memory cache of derived sub-keys
was documented as unbounded but safe because the purpose space was "a small,
closed vocabulary chosen by callers in code" — three system purposes, never
more. That justification no longer holds on its own: `userCredentialPurpose`
embeds a user id into the purpose string it hands to the cipher, so the key
space is now *(users × per-user purposes)* and grows with the number of
distinct pairs this process has actually touched since it started.

It stays unbounded deliberately, with the arithmetic stated rather than
assumed away: an entry is a 32-byte buffer plus a roughly 50-character key,
so on the order of 100 bytes with object overhead. The ceiling is the number
of `(user, purpose)` pairs that genuinely exist — never anything an anonymous
caller can enumerate, because a user domain can only be built from a real
user id a request was already authorised against. Ten thousand users each
holding three personal credentials is roughly 3 MB, against a user base that
is an administrator-managed allowlist, not the open internet. An eviction
policy would trade that for re-derivation cost (one HMAC — cheap, but the
only thing this cache exists to avoid) plus a second piece of state to
reason about, for no change to the worst case anyone here can reach. What
*would* change the answer — a purpose that is free-form user input rather
than a value the caller looked up, or a deployment with open registration —
is called out in the source precisely so a future change to either fact is
the trigger to revisit this, not a reason to distrust the analysis today.

## 4. The registry: `USER_CREDENTIAL_PURPOSES`

`user-credential-purposes.ts` is the single declaration of what kinds of
personal credential this application knows about — the same "one registry
entry" shape `notification-events.ts` uses for notification events and
`adminSections.tsx`/`userSettingsSections.tsx` use for settings cards (see
CLAUDE.md's Settings UI Pattern), applied one level down to per-user secrets.

A registry entry (`UserCredentialPurposeDef`) answers three questions that
would otherwise end up answered separately, and inconsistently, in three
places — a controller's validation, a React component's copy, and each
consumer's own if-statement:

1. **Does this deployment even offer a personal key for this thing?**
   (Presence in the array.)
2. **What do we call it when we show it to the person who owns it?**
   (`label`, `description` — written as user-facing copy answering "why is
   this app asking me for an API key, and what happens if I don't give it
   one?")
3. **When the user hasn't supplied one, whose key gets used instead?**
   (`systemFallback: { purpose, name } | null` — the exact `(purpose, name)`
   address in the *system* store, or `null` for a purpose that is
   bring-your-own-key-or-nothing.)

### 4.1 Why it ships empty

`USER_CREDENTIAL_PURPOSES` is `Object.freeze([])` today, and that is not an
oversight this document is apologising for. Issue #387 is the foundation —
the table, the cipher domain, the store, the resolution rule — and there is
no LLM (or other) feature in this repository yet that would consume a
personal credential. Inventing an `llm` entry now would mean shipping a
registry entry whose `systemFallback` names a system-store address that no
administrator surface can configure and no code writes to — a resolver that
would always, silently, answer `null` for a purpose the (nonexistent) UI
would be advertising. An empty registry that is honestly empty is worth more
than a populated one describing a feature that doesn't exist.

The file's own comment carries a complete, non-sketch worked example of what
the first real entry looks like, including the three things it demonstrates
on purpose: that `systemFallback` must reference the system store's own
address *constants* rather than retyped literals (a one-character mismatch
produces a fallback that silently never resolves); that the per-user
`purpose` and the system `purpose` are independent key spaces which merely
happen to share a spelling in the example; and that `name` is absent from
the per-user side of an entry because the user's own `name` is *their*
choice (they may hold two keys under one purpose and label them apart), not
the registry's to assign.

### 4.2 What adding the first entry costs

One array entry. `user_credentials.purpose` is a plain string column, exactly
like `credentials.purpose` — deliberately, so that adding a kind of personal
credential is this file plus whatever feature consumes it: **no enum, no
schema change, no migration, no backfill.** The only thing that must never
happen is editing a `purpose` string *in place* once any row exists under it
— see the field's own doc comment: the string is folded into the AES sub-key
domain, so renaming it does not rename the row's key, it *orphans* every
already-stored ciphertext under the old spelling, permanently. A changed
purpose is a new purpose plus a migration of the affected rows, never an
edit.

`findUserCredentialPurpose(purpose)` returns `undefined` for an unregistered
purpose rather than throwing — the same design `notification-events.ts`'s
`findEvent` uses, and for the identical reason: a `user_credentials` row
outlives the registry entry that created it. A purpose retired from this
array leaves every row written under it sitting in the table, owned by real
people; throwing on lookup would turn "list my credentials" into a 500 for
exactly the users who have the most stored, the moment someone deletes a
line from this file. `UserCredentialsService` treats an unknown purpose as
"still a valid row, show it" — the store addresses rows, it does not police
the registry. `UserCredentialResolver` treats it as "no fallback is
defined" — the safe direction, since an unregistered purpose must not
silently reach for a shared key it was never declared to have a relationship
with.

## 5. Resolution: the user's key wins, then the system's

`UserCredentialResolver.resolve(userId, purpose, name)` is the one place this
application's fixed rule is written down:

1. **The caller's own credential wins, whenever one exists.**
2. **If they have none, the deployment's shared credential applies** — at
   the exact `(purpose, name)` address the registry's `systemFallback` names.
3. **If the registry has no entry for that purpose, or names no
   `systemFallback`, there is no fallback, and the answer is `null`.**

It exists as a class, not three lines duplicated at each call site, precisely
because the rule is short enough that a second consumer would happily
re-derive it — and would be the one to get it slightly wrong: falling back
when the user's key exists but fails to decrypt (§5.1), or checking the
system store first "to save a query," or treating an unregistered purpose as
"just use ours." Two features would then disagree about whose money is being
spent, with neither file looking wrong in isolation. `resolve()` returns a
`ResolvedCredential { secret, source: 'user' | 'system' }` rather than a bare
string, because two things downstream genuinely depend on which one answered
and neither can be recovered from the secret bytes themselves: cost/quota
metering attributes the call to the right party, and a failure message tells
the user the right next step ("your key was rejected, check it in settings"
versus "the shared key isn't working, contact an administrator" are
different sentences pointing different people at different fixes).

### 5.1 Failure semantics: a broken user key is not a missing one

This is the subsection that matters most, because it is the one place a
seemingly reasonable shortcut produces a silent, expensive bug.

`UserCredentialsService.getSecret` **throws** when a user credential *exists*
but cannot be decrypted (`SECRETS_ENCRYPTION_KEY` rotated since it was
written, a tampered row, a bad restore). `UserCredentialResolver.resolve`
**does not catch that throw**, and it must never be made to. The comment
sitting directly on that call site says why in terms specific to a resolver,
not merely to a single store: reporting an undecryptable user credential as
"the user has none" would not merely fail silently, **it would succeed** —
the resolver would fall through to the system credential, the call would go
through, and the user would carry on believing, correctly as far as anything
on their screen shows, that they are spending their own quota and their own
rate limit. They are not. They are spending the deployment's. Nobody finds
out until a bill arrives or a shared rate limit is hit, and by then the
trail back to a decryption failure that happened weeks earlier is cold.

So the only honest behaviour is loud: an existing-but-unreadable user
credential propagates as a thrown exception, all the way out, and the answer
the user gets is "your stored credential must be set again" — which is true,
actionable, and points at exactly the person who can fix it. Only an
*absent* row (`getSecret` returning `null`) is a legitimate reason to
consult step 2. The identical argument, one level down, is why
`CredentialsService.getSecret` (the system store) already throws rather than
returning `null` on a decrypt failure — this class inherits that discipline
rather than adding a new one, and then adds the fact that the fallthrough at
its own level is a "success," which is the more dangerous of the two
failure modes.

### 5.2 What `resolve()` deliberately does not do

It does not cache. A resolution is two indexed point lookups; caching it
would need invalidation on every write to either store — including a write
made by another replica in the fleet — to avoid handing back a key the user
has already replaced or deleted, which is a real cache with real
invalidation sitting in front of an already-cheap query, holding decrypted
secrets in memory for longer than necessary. It also does not decide
*whether* a feature may fall back to the shared key at all — that is policy
(a system setting, a permission, a quota), and it belongs to whichever
feature actually has one. This class answers exactly one question: what is
the credential at this address, and whose is it.

## 6. Rejected alternatives

- **`owner_user_id` on `credentials`.** Covered in full in §2 — the
  uniqueness constraint alone decides against it, and the inverted delete
  semantics and unrepresentable owner-crossing each independently confirm
  the same conclusion.
- **Encoding the owner into `name`** (e.g. `name: "<userId>:llm"` on the
  existing `credentials` table, keeping one table and one `(purpose, name)`
  shape). Rejected: it reintroduces exactly the delete-semantics conflict of
  §2.2 with no schema-level fix available (there is no foreign key on a
  substring of `name` for `onDelete: Cascade` to attach to — cleaning up a
  departed user's rows becomes an application-level sweep that must remember
  to run, rather than a property the database enforces), and it does nothing
  for the uniqueness problem in §2.1 — a second table's whole `(userId,
  purpose, name)` triple is exactly the compound key this alternative is
  trying to fake out of a two-column one.
- **A JSONB blob on `user_settings`**, the same reason a blob on
  `system_settings` was never considered for `credentials` in epic #108:
  `GET /api/user-settings` returns that entire document wholesale to its
  owner. A secret living inside it would be one ordinary settings `GET` away
  from a browser's memory, and one settings-write audit row away from a
  permanent, unencrypted copy sitting in `audit_events.meta` — the exact
  hazard `storage-providers.md` §2 documents for why the object-storage
  secret is split out of the `storage` settings namespace, one level down at
  the per-user scope instead of the system one.
- **Reusing the bare `purpose` sub-key with no owner binding**, decrypting
  every user's credential for a given purpose under one shared derived key.
  Rejected in full in §3.1 — this is the alternative whose failure mode is
  the entire reason the owner-bound domain exists.
- **A per-purpose `fallbackToSystem: boolean` policy flag** on the registry
  entry, instead of `systemFallback: { purpose, name } | null`. Looks like
  the more flexible shape — "let each purpose decide if it participates in
  fallback" — but it isn't: the resolution *rule* (§5) is fixed and written
  down exactly once, in `UserCredentialResolver.resolve`. A boolean flag
  would encode that same rule a second time, per entry, purely to be turned
  on or off — which is how a "rule" quietly grows exceptions until it isn't
  one. `systemFallback` is not a policy knob; it is *data the fixed rule
  needs* — the address of the counterpart it would fall back to, which the
  resolver has no way to guess (a per-user purpose and a system purpose need
  not share a spelling, and the system side's `name` is its own
  discriminator). `null` means "no counterpart exists," not "fallback
  disabled" — there is no switch to disable, because with no address there
  is nothing to fall back *to*. If a deployment-wide "may users ever fall
  back to our key?" toggle is genuinely wanted later, it is a system
  *setting* the resolver reads, not a second boolean smuggled into a
  registry entry that would then be declaring two different kinds of thing.

## 7. What is deliberately not built yet

Issue #387 ships the table, the cipher domain, the store, and the resolution
rule — nothing above it. Specifically absent, on purpose, and each one a
separate future issue's job to add:

- **No HTTP surface.** `UserCredentialsModule` exports `UserCredentialsService`
  and `UserCredentialResolver` and registers no controller. Exposing
  per-user credentials over HTTP is a real feature with its own review
  surface — every route on it must scope to the *authenticated caller's own*
  user id and never accept one from a path parameter or a request body, which
  is a specific, security-relevant thing to check that the system store's
  admin-only surfaces never had to.
- **No settings page.** When one is built, it is bound by the MANDATORY
  Settings UI Pattern in `CLAUDE.md`: a registry entry in
  `apps/web/src/config/userSettingsSections.tsx`
  (`USER_SETTINGS_SECTIONS`) — never a route the hub, the Console rail, and
  the AppBar title resolver each independently have no way to know about —
  reusing the shared `SettingsHub` component rather than a fork of it, and
  **not** a new tab bolted onto an existing settings page (rule 2: a
  destination gate is about reachability, a tab gate is about content, and a
  page for managing one's own bring-your-own-key credentials is a
  destination of its own, not a parallel view of something else a user
  already configures).
- **`UserCredentialsModule` is not registered in `app.module.ts`.** This is
  the clearest signal that nothing consumes this store yet: a module wired
  into the root with no consumer would be instantiated at every boot and
  would read, to the next person, as "something uses this — go find it,"
  when nothing does. The feature that needs a personal credential adds
  `imports: [UserCredentialsModule]` to *its own* module — which is also
  where that import belongs, given the module is deliberately not
  `@Global()` (§ below) — and that one line is the visible moment this store
  acquires its first real consumer.
- **No populated registry entry.** See §4.1.

`UserCredentialsModule` is also, like `CredentialsModule` before it, not
`@Global()`. `UserCredentialsService.getSecret` and
`UserCredentialResolver.resolve` both return plaintext, so the set of
modules able to inject them should be a list someone can read in a diff
(`imports: [UserCredentialsModule]`), not an ambient capability every module
in the application quietly has.

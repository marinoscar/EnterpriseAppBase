# Runbook: Rotate `SECRETS_ENCRYPTION_KEY`

This runbook covers rotating the key that encrypts runtime-configured
credentials — **both** the administrator-configured `credentials` table
**and**, since issue #387, the per-user `user_credentials` table — and the
separate, more serious situation of losing that key entirely.

For the underlying cipher and key model, see
[`docs/SECURITY-ARCHITECTURE.md`, section 14](../SECURITY-ARCHITECTURE.md#14-encrypted-credential-storage-runtime-configured-secrets)
and [`docs/specs/user-credentials.md`](../specs/user-credentials.md) for the
per-user store specifically. Source of truth for every claim below:

- `apps/api/src/common/crypto/secret-cipher.ts` — the cipher, key derivation,
  and `userCredentialPurpose` (the per-user domain).
- `apps/api/src/common/crypto/encryption-key-startup-check.ts` — boot-time
  validation.
- `apps/api/src/credentials/credentials.service.ts` — the system-wide store.
- `apps/api/src/credentials/user-credentials.service.ts` — the per-user store.

**There is no shipped rotation script in this codebase.** Automatic
rotation/re-encryption tooling was scoped out of epic #108 as unnecessary at
this size — manual rotation, run by an operator as a one-off script, is
considered acceptable. This runbook describes how to write and run that
script safely, not a command you can copy-paste as-is.

**⚠ This key now protects credentials that most deployments cannot run
without.** When this runbook was first written, the credential store had a
single, optional consumer (SMTP). Since issue #355 (Web Push) and, notably,
epic #372 (object storage — see
[`docs/specs/storage-providers.md`](../specs/storage-providers.md)), the
rows this key protects include the **object-storage secret access key**.
The running application keeps decrypting under the OLD key throughout
Phases A–D below (nothing about the live process changes until step 12), so
storage, SMTP and Web Push all keep working normally while the rotation
script itself runs. The actual outage is Phase E's **restart** — from the
moment the deployment's `SECRETS_ENCRYPTION_KEY` env var is flipped to the
NEW key (step 12) until the application is back up and healthy (step 13) —
during which **uploads, avatar uploads, job artifacts, and database
backups are unavailable**, exactly as SMTP sending and Web Push already
are for the same window. This is an ordinary restart-bounded outage, not
something specific to storage, but it is worth saying explicitly now that a
storage-shaped failure during that window is expected, not a new incident.

**⚠ This key now also protects a table you cannot re-encrypt by only
walking `credentials`.** Since issue #387, `user_credentials` is encrypted
under the same master key, via a per-user-derived sub-key
(`userCredentialPurpose`, see the spec above) rather than the bare
`purpose` sub-key `credentials` uses — but it is still a function of the
*same* `SECRETS_ENCRYPTION_KEY`. **A rotation script that walks only
`credentials` and then cuts the deployment over to the new key leaves every
row in `user_credentials` permanently unreadable the instant the old key is
retired** — there is no partial-credit state here: those rows were never
touched by the script, they are still ciphertext under the old master key,
and the old key is gone. This is not a smaller version of the storage
warning above; it is a second, independent table this same procedure must
walk, and it is easy to miss precisely because, as of this writing,
`user_credentials` has no consumer and no admin page to notice the failure
on — nothing will 503 the way storage does. The first thing to notice would
be a user reporting "my key stopped working," pointed nowhere in particular,
long after the rotation. **Section 4 below has been rewritten to walk both
tables in the same pass; do not adapt an older, `credentials`-only version
of this script.**

**The two tables also fail differently, which is why getting this right
matters more for one of them.** Losing the `credentials` table costs an
afternoon: an administrator re-enters the SMTP password, the storage key,
and the VAPID key from the admin UI, and the deployment is whole again.
Losing `user_credentials` costs an apology — nobody but each individual
owner can re-enter their own key (`UserCredential` has no
administrator-provenance column at all; see its own comment in
`schema.prisma`, and [`docs/specs/user-credentials.md`](../specs/user-credentials.md)),
so recovery means finding every affected user and asking each of them,
separately, to come back and re-enter a credential they already gave you
once. `verifyEncryptionKeyAtStartup`'s own fatal message (section 4, step
15) reports the two counts separately for exactly this reason — "0
deployment-wide, 340 user-owned" and "340 deployment-wide, 0 user-owned" are
the same total and very different mornings.

---

## 1. Before you start

- **Generate the new key first**, so it exists before you need it:
  ```bash
  openssl rand -base64 32
  ```
  Store it in whatever secret manager or vault this deployment uses. Do not
  put it in a file inside this repository, and do not put it in the database.

- **Decide on a maintenance window.** Rotation has a real gap (see section 4)
  where a credential *written* during the rotation can be missed. The safest
  approach is to freeze credential writes (block whatever admin surface calls
  `CredentialsService.setSecret`) for the duration.

- **Confirm you have the OLD key available too.** Rotation is a
  decrypt-with-old / re-encrypt-with-new operation. You need both keys
  available to the *same process* at the same time — see section 3 for why
  this is less trivial than it sounds.

## 2. What's safe with the app running, and what isn't

| Operation | Safe during rotation? |
|---|---|
| `CredentialsService.describe` / `.list`, `UserCredentialsService.describe` / `.list` (reads that never touch `secret`, on either table) | Yes — unaffected by a rotation running elsewhere |
| Reading a credential via `getSecret` (either service) for existing, unrotated rows | Yes, as long as the app's configured key is still the OLD key |
| **Writing a new credential** (`CredentialsService.setSecret` — the SMTP settings save, the Web Push generate/rotate actions, or a storage-configuration save at `/admin/settings/storage`) | **No** — see section 4 |
| **Writing a new per-user credential** (`UserCredentialsService.setSecret` — as of this writing there is no shipped UI or endpoint that calls this, but the same hazard applies the moment one exists, and this table is included here so the rule is not forgotten when that surface ships) | **No** — for the identical reason, see section 4 |

Reads that never touch the ciphertext (`describe`, `list`, on either service)
are always safe. The dangerous operation is a **write to either table**
landing after your rotation script has already read that table but before
you've flipped the deployment's env var — that new row is encrypted under
the OLD key and your rotation script never saw it. This is why a maintenance
window or a write-freeze matters more than read-availability during
rotation, and why the freeze must cover both stores, not just whichever one
happens to have an admin page today.

## 3. The module-caching gotcha (read this before writing a script)

`secret-cipher.ts` resolves `SECRETS_ENCRYPTION_KEY` once and caches it in a
module-level variable (`cachedMasterKey`) for the life of the process; every
purpose's derived sub-key is likewise cached in a module-level `Map`
(`derivedKeyCache`). Neither cache has any invalidation path other than the
module being reloaded.

**Consequence**: inside a single running Node process, reassigning
`process.env.SECRETS_ENCRYPTION_KEY` after `secret-cipher.ts` has already
resolved a key has **zero effect** on that process. You cannot decrypt with
the old key, mutate the env var, and then encrypt with the new key in the
same `require`d instance of the module — it will keep using the key it
already cached.

The module's own comment names the fix, written for tests but equally the
literal mechanism for a rotation script:

> Use `jest.resetModules()` and re-`require` the module to exercise a
> different key.

Outside of Jest, the equivalent is deleting the module from `require.cache`
and re-requiring it:

```js
function loadCipherWithKey(key) {
  process.env.SECRETS_ENCRYPTION_KEY = key;
  const modulePath = require.resolve('../apps/api/dist/common/crypto/secret-cipher');
  delete require.cache[modulePath];
  return require(modulePath); // fresh module, fresh cachedMasterKey, fresh derivedKeyCache
}
```

(Adjust the path to wherever your script resolves the compiled — or
`ts-node`-loaded — module. The point is: a fresh `require`, not a fresh
`import` inside the same already-loaded module instance.)

## 4. The rotation procedure

Write this as a one-off Node/TypeScript script — for example, a Nest
"application context" script that constructs `PrismaService` directly, or a
small standalone script that opens its own Prisma client. It has five
phases, and **both tables are walked in the same pass** — do not run this as
two separate scripts, one per table, since that doubles the chance of
cutting the deployment over after only one has finished. **Plaintext must
never be logged or written to disk at any point** — this is the same rule
`secret-cipher.ts` itself is held to (it does not log at all), and it
applies equally to your script's own `console.log` calls, for a per-user
row's plaintext exactly as much as for a system one.

**Phase A — decrypt everything under the OLD key, from both tables.**
1. Set `SECRETS_ENCRYPTION_KEY` to the OLD key.
2. Load `secret-cipher.ts` fresh (section 3).
3. Read every system row: `prisma.credential.findMany({ select: { id: true, purpose: true, name: true, secret: true } })`.
   For each row, call `decryptSecret(row.secret, row.purpose)`.
4. Read every per-user row: `prisma.userCredential.findMany({ select: { id: true, userId: true, purpose: true, name: true, secret: true } })`.
   For each row, call `decryptSecret(row.secret, userCredentialPurpose(row.userId, row.purpose))`
   — **not** `decryptSecret(row.secret, row.purpose)`. A `user_credentials`
   row is encrypted under the owner-bound domain
   (`user:<lowercased-userId>:<purpose>`), never under the bare purpose
   string; passing the bare purpose here fails GCM authentication for every
   single row in this table. `userCredentialPurpose` is exported from the
   same `secret-cipher.ts` module you just loaded fresh — import it
   alongside `decryptSecret`/`encryptSecret`.
5. Hold the decrypted plaintexts in memory only, keyed by `('credential', id)`
   or `('userCredential', id)` so Phase D can tell the two tables' rows
   apart. Do not write them anywhere.

**Phase B — invalidate the module cache.**
6. Delete the cipher module from `require.cache` so the next `require`
   resolves a fresh instance with empty `cachedMasterKey` / `derivedKeyCache`.

**Phase C — re-encrypt everything under the NEW key, in both tables.**
7. Set `SECRETS_ENCRYPTION_KEY` to the NEW key.
8. Load `secret-cipher.ts` fresh again.
9. For each held system-row plaintext, call `encryptSecret(plaintext, purpose)`
   (same `purpose` as the row it came from — the sub-key derivation is
   purpose-bound, so getting this wrong produces a ciphertext that fails to
   decrypt later even though nothing else went wrong).
10. For each held per-user-row plaintext, call
    `encryptSecret(plaintext, userCredentialPurpose(userId, purpose))` — the
    same owner-bound domain used to decrypt it in step 4, built from the
    *same* `userId`/`purpose` pair the row was read with. Re-deriving it from
    anything else (a re-fetched, possibly-changed row; a hand-typed userId)
    risks silently producing a ciphertext bound to the wrong owner.

**Phase D — write the new ciphertext back, to both tables.**
11. For each system row, `prisma.credential.update({ where: { id }, data: { secret: newCiphertext } })`,
    addressed by `id` (not by `purpose`/`name` upsert — you are updating an
    existing row, not creating one).
12. For each per-user row, `prisma.userCredential.update({ where: { id }, data: { secret: newCiphertext } })`,
    likewise addressed by `id`.
13. Discard the in-memory plaintexts — from both tables — once every row in
    both is confirmed rewritten.

**Phase E — cut the deployment over.**
14. Only after **every row in both tables** is confirmed rewritten, update
    the deployment's actual `SECRETS_ENCRYPTION_KEY` environment variable to
    the NEW key. Cutting over after `credentials` is done but before
    `user_credentials` is finished is the exact mistake the warning at the
    top of this runbook exists to prevent — verify both counts (rows read in
    Phase A equals rows rewritten in Phase D, per table) before this step.
15. Restart the application normally. On boot,
    `verifyEncryptionKeyAtStartup` will validate the new key is
    well-formed and log that encrypted credential storage is available.
    Remember: **this check does not verify the key can decrypt existing
    rows in either table** — it only counts rows, in *both* `credentials`
    and `user_credentials` (see the decision table in
    `SECURITY-ARCHITECTURE.md` section 14). A row missed in step 3 or step 4
    (written after your read pass, still under the OLD key) will pass this
    boot check silently and only fail later, as an
    `InternalServerErrorException` from `CredentialsService.getSecret` or
    `UserCredentialsService.getSecret`, the first time something tries to
    read it. This is exactly why section 2's write-freeze / maintenance
    window matters, for both tables — there is no safety net at boot for a
    row rotation missed in either one; the check can tell you a table has
    unreadable rows, never which specific rows they are.
16. Once you've confirmed the app is healthy against the new key, securely
    discard the old key from wherever it was staged for this rotation.

## 5. Key loss (not rotation gone wrong — the key is genuinely gone)

If the key protecting stored credentials is truly lost — not a rotation
interrupted mid-way, but the key itself is gone and unrecoverable — every row
encrypted under it, **in both `credentials` and `user_credentials`**, is
**permanently unreadable**. This is expected, correct behavior of encryption
at rest, not a bug: there is no backdoor and no recovery path through the
cipher. `CredentialsService.getSecret` and `UserCredentialsService.getSecret`
will each throw for every affected row in their own table, logging that the
credential "must be re-entered" and returning a 500 (from `CredentialsService`)
or an `InternalServerErrorException` (from `UserCredentialsService`) to
whatever caller tries to use it.

The only recovery is **re-entering** each affected credential's secret from
scratch. For a system credential this is a normal `setSecret(purpose, name,
newPlaintext, meta)` call by an administrator; for a per-user credential it
is the equivalent `setSecret(userId, purpose, name, newPlaintext, meta)` call,
which only the credential's own owner can meaningfully make — there is no
column on `UserCredential` recording an administrator's provenance the way
`Credential.updatedByUserId` does (see the model's own comment in
`schema.prisma`), because nobody but the owner is ever permitted to write the
row. Either way this is a fresh secret, not a "restore," and there is
nothing to restore it from.

### Finding which credentials need re-entering

`CredentialsService.describe`/`.list` and `UserCredentialsService.describe`/
`.list` never select the `secret` column, so they keep working with no
encryption key configured at all, or with a key that cannot decrypt anything
— `purpose`, `name`, `label`, `hint`, and the timestamps remain fully
readable regardless of key state, in both tables. This makes them (and the
equivalent raw query) the correct tool for finding what needs re-entry after
key loss.

Neither service has an HTTP controller of its own — for `credentials`, each
consumer's own admin page (`/admin/settings/email`, `/admin/settings/push`,
`/admin/settings/storage`) reports whether *its* credential is configured
(via that page's own `secretStatus`/`privateKeyStatus` field); for
`user_credentials`, as of this writing, there is no admin or user-facing
page at all (see [`docs/specs/user-credentials.md`](../specs/user-credentials.md)
§7). Neither table has a single cross-purpose view that lists every row in
it, so a lookup spanning all purposes — or all users — is necessarily a
backend/database-level query, not a UI flow. Two concrete options, for
either table:

**(a) Programmatic access**, if you have a REPL or script with access to a
constructed service (e.g. a Nest application-context script):
```ts
// System store — repeat per known purpose, as of this writing: 'smtp',
// 'push_vapid', 'storage' (STORAGE_CREDENTIAL_PURPOSE in
// storage/storage-credential.constants.ts). A fork that adds a fourth
// consumer adds a fourth purpose string here.
const affected = await credentialsService.list('smtp');
// affected[i].purpose, .name, .label, .hint, .updatedAt are all populated;
// affected[i] has no field capable of holding the secret itself.

// Per-user store — purpose is optional; omit it to list one user's
// credentials across every registered purpose at once.
const userAffected = await userCredentialsService.list(userId);
// Listing across ALL users needs the raw SQL form below instead — there is
// no method that takes no userId at all (see the service's own comment on
// why `list` always requires one).
```

**(b) Direct SQL**, which needs no application code at all:
```sql
-- System store
SELECT purpose, name, label, hint, updated_at
FROM credentials
ORDER BY purpose, name;

-- Per-user store — spans every user, unlike the programmatic form above
SELECT user_id, purpose, name, label, hint, updated_at
FROM user_credentials
ORDER BY user_id, purpose, name;
```
Both queries, like `describe`/`list`, never touch interpretation of the
`secret` bytes — they are safe to run regardless of whether the encryption
key is present, absent, or wrong.

Once you have that list, contact whoever owns each `purpose`/`name` pair (for
`credentials`) or each affected user (for `user_credentials` — only that user
can meaningfully re-enter their own key) and have them re-enter the secret
through the normal write path once one exists.

## 6. Summary checklist

- [ ] New key generated with `openssl rand -base64 32` and stored outside the repo and the database
- [ ] Maintenance window scheduled or credential writes frozen, **on both `credentials` and `user_credentials`**
- [ ] Rotation script written per section 4, decrypting under OLD key and re-encrypting under NEW key **for both tables** in the same process, with an explicit module-cache reload between the two phases, and using `userCredentialPurpose(userId, purpose)` — not the bare `purpose` — as the domain for every `user_credentials` row
- [ ] No plaintext logged or written to disk at any point, for either table
- [ ] All rows in **both** `credentials` and `user_credentials` confirmed rewritten under the new key before the deployment's env var is changed
- [ ] Deployment's `SECRETS_ENCRYPTION_KEY` updated to the NEW key and app restarted
- [ ] Boot log confirms `SECRETS_ENCRYPTION_KEY is configured; encrypted credential storage is available.` (remembering this only proves the key is well-formed, not that it decrypts every row in either table — see step 15 above)
- [ ] Old key securely discarded once the app is confirmed healthy

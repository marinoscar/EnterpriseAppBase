# Runbook: Rotate `SECRETS_ENCRYPTION_KEY`

This runbook covers rotating the key that encrypts runtime-configured credentials
(the `credentials` table), the two per-user BYOK tables that also derive their
keys from it (`user_credentials`, `user_ai_keys`), and the separate, more
serious situation of losing that key entirely.

**⚠ `SECRETS_ENCRYPTION_KEY` now protects THREE tables, not one: `credentials`,
`user_credentials` (issue #387), and `user_ai_keys` (epic #419).** A rotation
script that reads only `prisma.credential.findMany(...)` — which is what
every version of this runbook described before per-user stores existed —
will re-encrypt `credentials` correctly and **silently leave every row in
`user_credentials` and `user_ai_keys` decryptable only under the OLD key**.
Nothing at boot catches this (the startup check only counts rows in
`credentials` — see `SECURITY-ARCHITECTURE.md` §14): every affected user's
key looks fine until the first read after cutover, which throws
`InternalServerErrorException` from `UserCredentialsService.getSecret` or
`UserAiKeysService`'s equivalent, telling that one user their key "must be
re-entered" — a rotation that silently orphaned every user's stored key,
discovered one support ticket at a time. **Section 4 below re-encrypts all
three tables in the same pass; do not adapt an old script that only touches
`credentials`.**

For the underlying cipher and key model, see
[`docs/SECURITY-ARCHITECTURE.md`, section 14](../SECURITY-ARCHITECTURE.md#14-encrypted-credential-storage-runtime-configured-secrets)
and [`docs/specs/user-credentials.md`](../specs/user-credentials.md).
Source of truth for every claim below:

- `apps/api/src/common/crypto/secret-cipher.ts` — the cipher, key derivation,
  and `userCredentialPurpose()` (the owner-bound domain builder).
- `apps/api/src/common/crypto/encryption-key-startup-check.ts` — boot-time validation.
- `apps/api/src/credentials/credentials.service.ts` — the deployment-owned store.
- `apps/api/src/user-credentials/user-credentials.service.ts` — the per-user
  store (issue #387).
- `apps/api/src/ai/keys/user-ai-keys.service.ts` — the AI BYOK store, which
  predates #387 and is **not** owner-bound (see step 9 below).

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
| `CredentialsService.describe` / `.list`, `UserCredentialsService.describe` / `.list` (reads that never touch `secret`) | Yes — unaffected by a rotation running elsewhere |
| Reading a credential via `getSecret` for existing, unrotated rows, in any of the three tables | Yes, as long as the app's configured key is still the OLD key |
| **Writing a new credential** — `CredentialsService.setSecret` (the SMTP settings save, Web Push generate/rotate, a storage-configuration save at `/admin/settings/storage`), `UserCredentialsService.setSecret` (any feature built on the #387 per-user store), or `UserAiKeysService`'s equivalent (a user setting/replacing their own AI provider key) | **No** — see section 4 |

Reads that never touch the ciphertext (`describe`, `list`) are always safe,
in every one of the three tables. The dangerous operation is a **write**
landing after your rotation script has already read a table but before
you've flipped the deployment's env var — that new row is encrypted under
the OLD key and your rotation script never saw it. This is why a maintenance
window or a write-freeze matters more than read-availability during
rotation, and why the freeze must cover all three write paths, not just
`CredentialsService.setSecret`.

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
phases. **Plaintext must never be logged or written to disk at any point** —
this is the same rule `secret-cipher.ts` itself is held to (it does not log
at all), and it applies equally to your script's own `console.log` calls.

**Phase A — decrypt everything under the OLD key, from ALL THREE tables.**
1. Set `SECRETS_ENCRYPTION_KEY` to the OLD key.
2. Load `secret-cipher.ts` fresh (section 3).
3. Read every row of all three tables:
   - `prisma.credential.findMany({ select: { id: true, purpose: true, name: true, secret: true } })`
   - `prisma.userCredential.findMany({ select: { id: true, userId: true, purpose: true, name: true, secret: true } })`
   - `prisma.userAiKey.findMany({ select: { id: true, secret: true } })` (or
     whatever the actual model/column names are as of this writing — check
     `user-ai-keys.service.ts` and `schema.prisma`; the field names in this
     runbook may drift from the code)
4. For each `credentials` row, call `decryptSecret(row.secret, row.purpose)`.
5. For each `user_credentials` row, call
   `decryptSecret(row.secret, userCredentialPurpose(row.userId, row.purpose))`
   — **not** `decryptSecret(row.secret, row.purpose)`. The bare purpose is
   the wrong domain for this table (§3 of
   [`docs/specs/user-credentials.md`](../specs/user-credentials.md)); using
   it will fail decryption for every row.
6. For each `user_ai_keys` row, call
   `decryptSecret(row.secret, AI_USER_KEY_PURPOSE)` — the fixed string
   `'ai_user_key'` (`ai/keys/ai-user-key.constants.ts`), **the same string
   for every user**. This table predates #387 and is **not** owner-bound:
   every user's AI key is encrypted under one shared sub-key, unlike
   `user_credentials`. Do not "fix" this by inventing a per-user domain for
   it during a rotation — that is a data-model change with its own
   migration, out of scope for a key rotation, and would make every existing
   `user_ai_keys` row unreadable on its own.
7. Hold the decrypted plaintexts in memory only, keyed by row `id` (and
   table). Do not write them anywhere.

**Phase B — invalidate the module cache.**
8. Delete the cipher module from `require.cache` so the next `require`
   resolves a fresh instance with empty `cachedMasterKey` / `derivedKeyCache`.

**Phase C — re-encrypt everything under the NEW key.**
9. Set `SECRETS_ENCRYPTION_KEY` to the NEW key.
10. Load `secret-cipher.ts` fresh again.
11. For each held `credentials` plaintext, call
    `encryptSecret(plaintext, purpose)` (same `purpose` as the row it came
    from — the sub-key derivation is purpose-bound, so getting this wrong
    produces a ciphertext that fails to decrypt later even though nothing
    else went wrong).
12. For each held `user_credentials` plaintext, call
    `encryptSecret(plaintext, userCredentialPurpose(userId, purpose))` —
    the identical owner-bound domain used to decrypt it in step 5. Passing
    the bare purpose here would silently produce a ciphertext no future
    read (which always calls `userCredentialPurpose`) can ever decrypt.
13. For each held `user_ai_keys` plaintext, call
    `encryptSecret(plaintext, AI_USER_KEY_PURPOSE)` — the same shared,
    non-owner-bound string used in step 6.

**Phase D — write the new ciphertext back.**
14. For each row in each of the three tables,
    `prisma.<model>.update({ where: { id }, data: { secret: newCiphertext } })`,
    addressed by `id` (not by a unique-key upsert — you are updating an
    existing row, not creating one).
15. Discard the in-memory plaintexts once every row, in all three tables, is
    confirmed rewritten.

**Phase E — cut the deployment over.**
16. Only after every row in all three tables is confirmed rewritten, update the deployment's
    actual `SECRETS_ENCRYPTION_KEY` environment variable to the NEW key.
17. Restart the application normally. On boot,
    `verifyEncryptionKeyAtStartup` will validate the new key is
    well-formed and log that encrypted credential storage is available.
    Remember: **this check does not verify the key can decrypt existing
    rows, and it only ever counts the `credentials` table** — it says
    nothing about `user_credentials` or `user_ai_keys` at all (see the
    decision table in `SECURITY-ARCHITECTURE.md` section 14). A row missed
    in step 3 (written after your read pass, still under the OLD key), in
    ANY of the three tables, will pass this boot check silently and only
    fail later — as an `InternalServerErrorException` from
    `CredentialsService.getSecret`, `UserCredentialsService.getSecret`, or
    `UserAiKeysService`'s equivalent, the first time something tries to read
    it. This is exactly why section 2's write-freeze / maintenance window
    matters, across all three write paths — there is no safety net at boot
    for a row rotation missed.
18. Once you've confirmed the app is healthy against the new key, securely
    discard the old key from wherever it was staged for this rotation.

## 5. Key loss (not rotation gone wrong — the key is genuinely gone)

If the key protecting stored credentials is truly lost — not a rotation
interrupted mid-way, but the key itself is gone and unrecoverable — every row
encrypted under it, in **all three tables** (`credentials`,
`user_credentials`, `user_ai_keys`), is **permanently unreadable**. This is
expected, correct behavior of encryption at rest, not a bug: there is no
backdoor and no recovery path through the cipher. `CredentialsService
.getSecret`, `UserCredentialsService.getSecret`, and `UserAiKeysService`'s
equivalent will each throw for every affected row, logging that the
credential "must be re-entered" and returning a 500 to whatever internal
caller tries to use it.

The only recovery is **re-entering** each affected credential's secret from
scratch: an administrator for a `credentials` row, or the owning user for a
`user_credentials`/`user_ai_keys` row — each through that store's normal
`setSecret` call, providing a brand-new secret. It is not a "restore," and
there is nothing to restore it from.

### Finding which credentials need re-entering

`CredentialsService.describe` and `.list` never select the `secret` column,
so they keep working with no encryption key configured at all, or with a key
that cannot decrypt anything — `purpose`, `name`, `label`, `hint`, and the
timestamps remain fully readable regardless of key state. This makes them
(and the equivalent raw query) the correct tool for finding what needs
re-entry after key loss.

`CredentialsService` itself still has **no HTTP controller of its own** —
each consumer's own admin page (`/admin/settings/email`,
`/admin/settings/push`, `/admin/settings/storage`) reports whether *its*
credential is configured (via that page's own `secretStatus`/
`privateKeyStatus` field), but there is no single cross-purpose admin view
that lists every row in the `credentials` table. So a lookup spanning all
purposes at once is necessarily a backend/database-level query, not a UI
flow. Two concrete options:

**(a) Programmatic access**, if you have a REPL or script with access to a
constructed `CredentialsService` (e.g. a Nest application-context script):
```ts
// Repeat per known purpose — as of this writing: 'smtp', 'push_vapid',
// 'storage' (STORAGE_CREDENTIAL_PURPOSE in
// storage/storage-credential.constants.ts). A fork that adds a fourth
// consumer adds a fourth purpose string here.
const affected = await credentialsService.list('smtp');
// affected[i].purpose, .name, .label, .hint, .updatedAt are all populated;
// affected[i] has no field capable of holding the secret itself.
```

**(b) Direct SQL**, which needs no application code at all:
```sql
SELECT purpose, name, label, hint, updated_at
FROM credentials
ORDER BY purpose, name;
```
This query, like `describe`/`list`, never touches interpretation of the
`secret` bytes — it is safe to run regardless of whether the encryption key
is present, absent, or wrong.

**The identical approach applies to `user_credentials` and `user_ai_keys`** —
`UserCredentialsService.list(userId)` (no cross-user listing exists; run it
per affected user, or query the table directly) and the equivalent direct
SQL:

```sql
SELECT user_id, purpose, name, label, hint, updated_at
FROM user_credentials
ORDER BY user_id, purpose, name;

SELECT user_id, provider, hint, verified_at, updated_at
FROM user_ai_keys
ORDER BY user_id, provider;
```

Neither touches `secret` either, and both remain readable regardless of key
state, for the same reason. Once you have the list, each affected user
re-enters their own key through the surface that exposes it (there is no
admin re-entry path for a user's own key — `UserCredentialsService` and
`UserAiKeysService` are both scoped to the owning user, by design).

Once you have that list, contact whoever owns each `purpose`/`name` pair and
have them re-enter the secret through the normal write path once one exists
for that purpose.

## 6. Summary checklist

- [ ] New key generated with `openssl rand -base64 32` and stored outside the repo and the database
- [ ] Maintenance window scheduled or credential writes frozen (across `credentials`, `user_credentials` AND `user_ai_keys` write paths)
- [ ] Rotation script written per section 4, decrypting under OLD key and re-encrypting under NEW key in the same process, with an explicit module-cache reload between the two phases
- [ ] Script covers **all three tables** (`credentials`, `user_credentials`, `user_ai_keys`) — not only `credentials`
- [ ] `user_credentials` rows use the owner-bound domain (`userCredentialPurpose(userId, purpose)`), not the bare purpose
- [ ] No plaintext logged or written to disk at any point
- [ ] All rows, in all three tables, confirmed rewritten under the new key before the deployment's env var is changed
- [ ] Deployment's `SECRETS_ENCRYPTION_KEY` updated to the NEW key and app restarted
- [ ] Boot log confirms `SECRETS_ENCRYPTION_KEY is configured; encrypted credential storage is available.`
- [ ] Old key securely discarded once the app is confirmed healthy

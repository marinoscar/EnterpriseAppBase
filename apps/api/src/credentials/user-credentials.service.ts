import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  decryptSecret,
  encryptSecret,
  userCredentialPurpose,
} from '../common/crypto/secret-cipher';
import {
  assertCredentialAddress,
  assertCredentialIdentifier,
  deriveHint,
  isBlankSecret,
} from './credential-internals';
import type {
  UserCredentialInfo,
  UserCredentialMeta,
} from './interfaces/user-credential-info.interface';

// =============================================================================
// UserCredentialsService — per-user encrypted credential store (issue #387)
// =============================================================================
//
// The sibling of `CredentialsService`, one ownership level down. That store
// holds a secret an ADMINISTRATOR configures once for everyone (the SMTP
// password, the object-storage key). This one holds a secret ONE USER supplies
// for themselves: a personal `llm/anthropic` key they would rather bill than
// use the deployment's, a personal webhook signing secret.
//
// Records are addressed by `(userId, purpose, name)`:
//
//   userId   the owner — a canonical UUID, and also part of the cipher domain
//   purpose  the feature domain within that user — 'llm', … (#387's registry,
//            user-credential-purposes.ts)
//   name     the discriminator within it — a provider id, 'default', …
//
// WHY A SEPARATE TABLE AND NOT A NULLABLE OWNER COLUMN ON `credentials`: three
// reasons, spelled out in the `UserCredential` block comment in
// `prisma/schema.prisma`. Read that rather than a summary of it here; the
// first reason (the table-wide `@@unique([purpose, name])`) is decisive on its
// own and the third is the one this class depends on — with two tables,
// "hand one user's secret to a system consumer" is not a query that exists.
//
// THE SAME TWO INVARIANTS AS THE SYSTEM STORE, and they are not restatements —
// each one is materially different when the secret belongs to a person:
//
//   1. NO PLAINTEXT EGRESS. `getSecret` (plaintext, server-side only) and
//      `describe`/`list` (presentation) are different methods returning
//      different types; `UserCredentialInfo` has no field able to carry a
//      secret. See interfaces/user-credential-info.interface.ts for the
//      compile-time proofs, which import the system store's own
//      `SecretBearingKey` list rather than keeping a second one.
//
//      THE EGRESS THAT MATTERS MOST HERE IS SIDEWAYS, NOT OUTWARDS. A leak
//      from `CredentialsService` exposes a secret every administrator already
//      shares; a leak from this one exposes a secret its owner supplied on the
//      understanding that nobody else — including an administrator — would
//      ever read it. Every method therefore takes `userId` FIRST and as a
//      required positional argument: there is no `describe(purpose, name)`
//      overload that could accidentally answer for whoever matches.
//
//   2. BLANK PRESERVES. A form renders the key field empty because the stored
//      value is not readable, so an empty submission means "keep what is
//      stored" and can NEVER mean "erase it". Erasing is `deleteSecret`,
//      reached from a distinct control. The definition of "blank" is shared
//      with the system store (credential-internals.ts) precisely so the two
//      cannot drift into meaning different things by the same empty field.
//
// WHAT MAY APPEAR IN A LOG LINE OR AN ERROR MESSAGE HERE: `purpose` and `name`
// ONLY. Not the secret, not the ciphertext, not the hint — and NOT THE USER
// ID, which is where this rule is stricter than the system store's.
//
//   The user id is not secret; it is in JWTs, in URLs, in audit rows. The
//   concern is a different one: a log line saying which user holds a
//   credential for which purpose is a user-tracking record, and it accumulates
//   in a pipeline sized for operational logs and retained on an operational
//   schedule rather than a privacy one. "Somebody set an llm/anthropic key"
//   is all an operator needs to debug this store; "user 4f3a… set an
//   llm/anthropic key at 14:02" is a behavioural trail about a person that
//   nobody asked for and that no code here reads back. Keeping it out is free.
//   An audit record of WHO did something, when that is genuinely wanted, is
//   `audit_events` — a place with a retention policy and a reason.
//
// THIS MODULE HAS NO CONTROLLER, ON PURPOSE — same argument as
// `CredentialsModule`; see `user-credentials.module.ts`.
// =============================================================================

/**
 * Columns that make up a `UserCredentialInfo`, as a Prisma `select`.
 *
 * Typed as `Record<keyof UserCredentialInfo, true>` so the select and the
 * presentation type cannot drift: adding a field to `UserCredentialInfo`
 * without selecting it fails to compile, and — the direction that matters —
 * selecting `secret` here fails too, because `UserCredentialInfo` has no such
 * key and object literals are checked for excess properties.
 *
 * The practical effect is that for a presentation read the ciphertext never
 * leaves Postgres at all: it is not in the SELECT list, so it is never in the
 * result set, never in a query log, and never in a heap dump of this process.
 */
const USER_CREDENTIAL_INFO_SELECT: Record<keyof UserCredentialInfo, true> = {
  userId: true,
  purpose: true,
  name: true,
  hint: true,
  label: true,
  createdAt: true,
  updatedAt: true,
};

/**
 * Canonical UUID: 8-4-4-12 hex, either casing, anchored at both ends.
 *
 * DELIBERATELY THE SAME GRAMMAR `secret-cipher.ts` ENFORCES, checked a second
 * time here rather than left to the cipher. Not defensive duplication — the
 * two checks exist for different audiences and throw different things. The
 * cipher's protects its collision proof and throws a bare `Error` carrying no
 * caller values, which reaches a client as a 500. This one is a service
 * BOUNDARY check: a caller that passes a route parameter straight through gets
 * a 400 that says what was wrong with the argument, at the call site, before
 * any query runs and before a database round trip is spent on an id that could
 * never match a row.
 *
 * Either casing is accepted for the reason the cipher accepts it: PostgreSQL's
 * `uuid` type compares case-insensitively, so an uppercase id denotes exactly
 * the right user and refusing it would reject a caller who was not wrong about
 * anything. `userCredentialPurpose` canonicalises to lowercase when it builds
 * the cipher domain, so the key and the row can never disagree.
 */
const USER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class UserCredentialsService {
  private readonly logger = new Logger(UserCredentialsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  /**
   * SERVER-SIDE ONLY. RETURNS PLAINTEXT. NEVER CALL THIS FROM A CONTROLLER.
   *
   * The only method in the store that yields a decrypted value. Use it at the
   * moment of use — opening a provider connection, signing a request — and let
   * it go out of scope immediately. Do not cache it on an instance field, do
   * not put it in a DTO, do not log it, and do not pass it to an error
   * constructor.
   *
   * For anything a user will see, use {@link describe} or {@link list}, which
   * return a type that cannot hold a secret at all.
   *
   * Most callers should not call this directly at all: a feature choosing
   * between a user's key and the deployment's wants
   * `UserCredentialResolver.resolve`, which encodes that choice once.
   *
   * @returns the plaintext, or `null` if no credential exists at this address.
   * @throws if the credential exists but cannot be decrypted (see below).
   */
  async getSecret(
    userId: string,
    purpose: string,
    name: string,
  ): Promise<string | null> {
    this.assertAddress(userId, purpose, name);

    const row = await this.prisma.userCredential.findUnique({
      where: { userId_purpose_name: { userId, purpose, name } },
      select: { secret: true },
    });

    if (!row) {
      // A missing credential is "this user has not supplied one", not an
      // error. The consumer decides what that means — the resolver reads it as
      // "fall back to the deployment's key, if the registry names one".
      return null;
    }

    try {
      // The store's address and the cipher's sub-key domain are THE SAME
      // VALUES, by construction rather than by convention: the domain is built
      // here, from the same `userId` and `purpose` the `where` clause just
      // used, so there is no second variable to keep in sync. That coupling is
      // what makes the schema comment's claim true — a ciphertext moved
      // between two users' rows by a bad UPDATE or a mis-merged restore is
      // opened under the wrong sub-key and fails GCM authentication, rather
      // than decrypting cleanly and spending one person's API key as another.
      return decryptSecret(row.secret, userCredentialPurpose(userId, purpose));
    } catch {
      // Swallow the original error rather than chaining it as `cause`, for the
      // same two reasons `CredentialsService.getSecret` does: the global
      // HttpExceptionFilter logs `exception.stack` for any 5xx and, outside
      // production, copies it into the response body, so whatever is thrown
      // here reaches both the log pipeline and possibly a client. It carries
      // the purpose and name and nothing else — no user id (see the header's
      // logging rule), no key material.
      //
      // An HttpException (rather than a bare Error) specifically to stay out
      // of that stack-in-the-response-body branch of the filter, which only
      // fires for non-HttpException errors.
      //
      // THROWING, NOT RETURNING NULL: a credential that exists but will not
      // decrypt means SECRETS_ENCRYPTION_KEY changed, a row was tampered with,
      // or a ciphertext was moved between owners. Reporting that as "the user
      // has not set one" would be a silent failure in the system store; here
      // it is worse, because the caller's next move is to use somebody else's
      // key — see `UserCredentialResolver.resolve`, which relies on this throw
      // propagating rather than becoming a fallback.
      this.logger.error(
        `Failed to decrypt user credential "${purpose}/${name}": the payload is corrupt, was written for a different owner, or SECRETS_ENCRYPTION_KEY has changed. The credential must be re-entered.`,
      );

      throw new InternalServerErrorException(
        `Your stored credential "${purpose}/${name}" could not be decrypted. It must be set again.`,
      );
    }
  }

  /**
   * Presentation read for a single credential: metadata and a masked hint.
   *
   * Safe to serialise into an API response TO ITS OWNER.
   * `UserCredentialInfo` has no field capable of holding a secret, and the
   * ciphertext is not even fetched — but the row is still one user's, and
   * `userId` is a required argument precisely so the scoping cannot be
   * omitted by a caller that only had a purpose and a name to hand.
   *
   * @returns the info, or `null` if nothing is stored at this address.
   */
  async describe(
    userId: string,
    purpose: string,
    name: string,
  ): Promise<UserCredentialInfo | null> {
    this.assertAddress(userId, purpose, name);

    const row = await this.prisma.userCredential.findUnique({
      where: { userId_purpose_name: { userId, purpose, name } },
      select: USER_CREDENTIAL_INFO_SELECT,
    });

    return row ? this.toInfo(row) : null;
  }

  /**
   * Presentation read for one user's credentials — all of them, or just those
   * under one purpose.
   *
   * `purpose` IS OPTIONAL HERE, AND THAT IS NOT A RELAXATION OF
   * `CredentialsService.list`, WHICH REQUIRES IT. That method's comment
   * refuses an unscoped listing because a global "show me every credential in
   * the deployment" is the shape that grows into an endpoint nobody meant to
   * write. The scoping that matters in THIS store is `userId`, and it is
   * always required — so the unscoped-by-purpose call is "show me my own
   * keys", which is not that shape at all. It is the natural query for a
   * user's own settings page, where the point is to see everything they have
   * stored without first knowing what to ask for. There is deliberately no
   * signature here that omits `userId`.
   *
   * Ordered by `(purpose, name)` so a list is stable across renders — and
   * grouped the way a page wants to render it, without the page sorting.
   */
  async list(userId: string, purpose?: string): Promise<UserCredentialInfo[]> {
    this.assertUserId(userId);
    if (purpose !== undefined) {
      assertCredentialIdentifier(purpose, 'purpose');
    }

    const rows = await this.prisma.userCredential.findMany({
      where: { userId, ...(purpose !== undefined ? { purpose } : {}) },
      select: USER_CREDENTIAL_INFO_SELECT,
      orderBy: [{ purpose: 'asc' }, { name: 'asc' }],
    });

    return rows.map((row) => this.toInfo(row));
  }

  // ---------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------

  /**
   * Create or update the credential at `(userId, purpose, name)`.
   *
   * BLANK PRESERVES. `undefined`, `null`, or `''` for `secret` means "the user
   * did not retype the key", so the stored ciphertext and its hint are left
   * exactly as they are while any metadata in `meta` is still applied. Getting
   * this backwards destroys a working credential the first time somebody
   * renames their key on the same form — which is exactly how it happens,
   * because the form always renders the secret field empty.
   *
   * There is no way to erase a secret through this method. That is
   * {@link deleteSecret}, deliberately separate.
   *
   * `hint` is derived here from the plaintext; callers do not supply it.
   *
   * @throws BadRequestException if a blank secret is written to an address
   *         that does not exist yet (see the first-write note inline).
   */
  async setSecret(
    userId: string,
    purpose: string,
    name: string,
    secret: string | null | undefined,
    meta: UserCredentialMeta = {},
  ): Promise<void> {
    this.assertAddress(userId, purpose, name);

    // Only the metadata keys the caller actually passed. Building this by hand
    // rather than spreading `meta` keeps an unknown property on the incoming
    // object out of the Prisma `data` — and keeps `undefined` (meaning "leave
    // it alone") from being confused with `null` (meaning "clear it").
    const metaUpdate: Prisma.UserCredentialUpdateInput = {};
    if (meta.label !== undefined) metaUpdate.label = meta.label;

    // A type guard rather than a plain boolean, so the else-branch narrows
    // `secret` to `string` on its own. No cast, and the definition of "blank"
    // is the shared one, so it cannot drift away from the system store's.
    if (isBlankSecret(secret)) {
      await this.applyMetadataOnly(userId, purpose, name, metaUpdate);
      return;
    }

    const encrypted = encryptSecret(
      secret,
      userCredentialPurpose(userId, purpose),
    );
    const hint = deriveHint(secret);

    await this.prisma.userCredential.upsert({
      where: { userId_purpose_name: { userId, purpose, name } },
      create: {
        user: { connect: { id: userId } },
        purpose,
        name,
        secret: encrypted,
        hint,
        label: meta.label ?? null,
      },
      update: {
        secret: encrypted,
        hint,
        ...metaUpdate,
      },
    });

    // Purpose and name only. `secret`, `encrypted`, `hint` AND `userId` must
    // never appear in a log line — see the header.
    this.logger.log(`Stored user credential "${purpose}/${name}"`);
  }

  /**
   * Remove the credential at `(userId, purpose, name)`.
   *
   * The ONLY way to erase a secret, and separate from {@link setSecret} so
   * that destroying a credential is always something a caller asked for by
   * name. A UI reaches this from a distinct control, not by clearing a field
   * and saving.
   *
   * Idempotent: deleting an absent credential is a no-op, not a 404. The
   * caller's goal is "there is no credential here", and that goal is already
   * met — a double-clicked delete button should not produce an error toast.
   *
   * NOTE: this is the user's own deliberate delete. The OTHER way a row here
   * disappears is the `onDelete: Cascade` on the owner FK, which is the
   * schema's job and deliberately not reproduced as application code — see
   * the `UserCredential` block comment for why a departed user's personal key
   * must not be inherited by anyone.
   */
  async deleteSecret(
    userId: string,
    purpose: string,
    name: string,
  ): Promise<void> {
    this.assertAddress(userId, purpose, name);

    // deleteMany, not delete: `delete` throws P2025 when the row is absent,
    // which would have to be caught and discarded here anyway to get the
    // idempotency above. It also takes a plain `where`, so the `userId` scope
    // is an ordinary equality filter rather than part of a compound key —
    // which is why it is written out explicitly here.
    const { count } = await this.prisma.userCredential.deleteMany({
      where: { userId, purpose, name },
    });

    if (count > 0) {
      this.logger.log(`Deleted user credential "${purpose}/${name}"`);
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * The blank-secret branch of {@link setSecret}: apply metadata, keep the
   * stored ciphertext and hint untouched.
   */
  private async applyMetadataOnly(
    userId: string,
    purpose: string,
    name: string,
    metaUpdate: Prisma.UserCredentialUpdateInput,
  ): Promise<void> {
    // FIRST-WRITE CASE — blank secret, no existing row. This is an ERROR, not
    // a no-op and not an empty credential.
    //
    // Treating it as a no-op is worse: the form reports success, the UI shows
    // a configured-looking credential that does not exist, and the failure
    // surfaces later and elsewhere — here, as the user silently spending the
    // deployment's shared key while believing they are on their own, which is
    // exactly the confusion `UserCredentialResolver` returns a `source` to
    // prevent.
    //
    // Creating the row with an empty secret is worse still: `describe` would
    // then report a credential that exists, the resolver would prefer it over
    // the system fallback, and the consumer would authenticate with an empty
    // key against a live provider.
    //
    // So: refuse, loudly and immediately, at the moment the user is looking at
    // the form. "Blank preserves" is a statement about an EXISTING value; with
    // nothing stored there is nothing to preserve, and the only honest answer
    // is that a new credential needs a secret. BadRequestException because
    // this is a caller/user input problem (400), not a fault.
    const existing = await this.prisma.userCredential.findUnique({
      where: { userId_purpose_name: { userId, purpose, name } },
      select: { id: true },
    });

    if (!existing) {
      // Purpose and name only — no hint of what was submitted, and no user id.
      throw new BadRequestException(
        `Cannot create credential "${purpose}/${name}" without a secret. A blank value preserves an existing secret, but there is none stored at this address yet.`,
      );
    }

    // Nothing to change: a blank secret and no metadata is a request to leave
    // the credential exactly as it is. Return without writing, so `updatedAt`
    // keeps meaning "when this credential last changed" rather than "when a
    // form was last submitted".
    if (Object.keys(metaUpdate).length === 0) {
      return;
    }

    await this.prisma.userCredential.update({
      where: { id: existing.id },
      // `secret` and `hint` are absent from this object, which is what
      // preserves them. Do not add them here: everything reaching this branch
      // has, by definition, no new plaintext to encrypt or hint.
      //
      // Addressing by `id` is safe despite `id` being deliberately absent from
      // `UserCredentialInfo`: this id was just read back from a `findUnique`
      // that was itself scoped by `userId`, so it is not an id that crossed a
      // trust boundary. An id arriving from a CALLER is the thing that type
      // refuses to publish.
      data: metaUpdate,
    });

    this.logger.log(
      `Updated metadata for user credential "${purpose}/${name}" (secret preserved)`,
    );
  }

  /**
   * Build a `UserCredentialInfo` field by field.
   *
   * Explicitly, NEVER by spreading the row. A spread makes the response shape
   * a consequence of whatever the query happened to select, so a later edit
   * that adds `secret: true` to a select — or swaps in a plain `findUnique`
   * with no select at all — would silently start serialising the ciphertext.
   * Naming the fields means the response shape is decided here, once, in code
   * that is about the response shape. The parameter is typed as
   * `UserCredentialInfo` rather than as the Prisma row for the same reason: a
   * row arriving with extra columns is narrowed on the way in.
   */
  private toInfo(row: UserCredentialInfo): UserCredentialInfo {
    return {
      userId: row.userId,
      purpose: row.purpose,
      name: row.name,
      hint: row.hint,
      label: row.label,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Reject an owner id that cannot address a row.
   *
   * Runtime check despite the `string` type because a route parameter, a JSON
   * round-trip, or a plain-JS caller can all deliver something else — and the
   * failure mode of letting one through is quiet: `userCredentialPurpose`
   * would throw a bare `Error` from inside the cipher, which surfaces as a 500
   * with a message about derivation labels rather than as "that is not a user
   * id". See {@link USER_ID_PATTERN} for why both casings are accepted.
   *
   * NO USER ID IN THE MESSAGE. It would be echoing a caller's value into a
   * string that a filter may log or return, for no benefit — the caller knows
   * what it passed, and the SHAPE of the failure is the whole diagnosis.
   */
  private assertUserId(userId: string): void {
    if (typeof userId !== 'string' || !USER_ID_PATTERN.test(userId)) {
      throw new BadRequestException(
        'Credential owner id must be a canonical UUID (8-4-4-12 hex).',
      );
    }
  }

  /**
   * Validate a full `(userId, purpose, name)` address.
   *
   * Owner first: it is the component whose absence or malformation means the
   * request was never about a row this caller may touch, so it is the error
   * worth surfacing when more than one component is wrong. `purpose` and
   * `name` are then held to the SHARED rules in `credential-internals.ts` —
   * including the colon rule, which the cipher enforces on this store's
   * `purpose` independently, so a mismatch between the two would be a 500
   * where this is a 400.
   */
  private assertAddress(userId: string, purpose: string, name: string): void {
    this.assertUserId(userId);
    assertCredentialAddress(purpose, name);
  }
}

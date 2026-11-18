import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';

import {
  PLATFORM_PRISMA,
  decryptSecret,
  encryptSecret,
  forUser,
  userCredentialPurpose,
} from '../core/index';
import {
  assertCredentialAddress,
  assertCredentialOwner,
  assertCredentialPurpose,
  deriveHint,
  isBlankSecret,
} from './credential-internals';
import type { CredentialsDelegate, CredentialsPrisma, CredentialsQueryArgs, UserCredentialRow } from './data/credentials-db';
import { userCredentialPurposeRegistry } from './registry';
import type {
  UserCredentialInfo,
  UserCredentialMeta,
} from './interfaces/user-credential-info.interface';

// =============================================================================
// UserCredentialsService — a user's OWN encrypted credentials (issue #387)
// =============================================================================
//
// The per-user sibling of `CredentialsService`. That store holds secrets the
// DEPLOYMENT owns, addressed by `(purpose, name)`; this one holds secrets a
// USER owns (bring-your-own-key), addressed by `(userId, purpose, name)`, in
// its own `user_credentials` table. `credentials` is untouched.
//
// `userId` IS THE FIRST PARAMETER OF EVERY METHOD, and every query is scoped
// by it. There is no id-addressed read and no cross-user listing, so no code
// path here can reach another user's row.
//
// AND THE DATABASE CLIENT ENFORCES IT (#688): every query goes through
// `forUser(prisma, { userId })` from `@marinoscar/platform-api/core`, the
// user-scoped client (it needs `UserCredential` in the app's user-owned-model
// registry: `CREDENTIALS_USER_OWNED_MODELS`), which confines `user_credentials` queries to
// that user whatever the `where` says. The explicit `userId` filters stay:
// they are the address, and the scoped client is the guarantee.
//
// THE SAME TWO INVARIANTS AS `CredentialsService` — read its header:
//
//   1. NO PLAINTEXT EGRESS. `getSecret` (plaintext, server-side only) and
//      `describe`/`list` (`UserCredentialInfo`, which has no field able to
//      carry a secret) are different methods returning different types.
//      Nothing here interpolates a secret into a log line or an error.
//
//   2. BLANK PRESERVES. A blank secret on write keeps the stored ciphertext;
//      erasing is `deleteSecret`. A blank secret with nothing stored is a 400.
//
// PLUS ONE THE SYSTEM STORE DOES NOT NEED — AN OWNER-BOUND CIPHER DOMAIN. A
// row is encrypted under `user:<userId>:<purpose>` (`userCredentialPurpose`),
// not `<purpose>`. The table's address alone would let a SQL write (or a bug
// copying rows) move user A's ciphertext into user B's row, and B's reads
// would then decrypt A's key; binding the owner into the sub-key makes that
// row fail GCM authentication instead. Hint derivation, blank detection and
// address validation are the SAME functions `CredentialsService` uses
// (`credentials/credential-internals.ts`), not copies.
//
// NO AUDIT EVENTS, mirroring `CredentialsService`, which writes none: this is
// a store, not a feature surface. The feature that exposes it (with its own
// actor and request context) audits the act; this layer logs the address.
//
// NO CONTROLLER, ON PURPOSE — the same reasoning as `CredentialsModule`.
// =============================================================================

/**
 * Columns making up a `UserCredentialInfo`, as a Prisma `select`. Typed as
 * `Record<keyof UserCredentialInfo, true>` so adding `secret: true` here fails
 * to compile (excess property), and the ciphertext never leaves Postgres on a
 * presentation read.
 */
const USER_CREDENTIAL_INFO_SELECT: Record<keyof UserCredentialInfo, true> = {
  purpose: true,
  name: true,
  hint: true,
  label: true,
  createdAt: true,
  updatedAt: true,
};

/**
 * A user's own encrypted credentials (bring your own key), addressed by
 * `(userId, purpose, name)` and encrypted under the owner-bound sub-key
 * `user:<userId>:<purpose>`. Every query runs on the user-scoped client.
 *
 * @example
 * ```ts
 * await userCredentials.setSecret(userId, 'webhook_signing_key', 'default', typed);
 * ```
 *
 * @stability experimental
 */
@Injectable()
export class UserCredentialsService {
  private readonly logger = new Logger(UserCredentialsService.name);

  /**
   * @param prisma - the app's Prisma client, through the core `PLATFORM_PRISMA` port.
   */
  constructor(@Inject(PLATFORM_PRISMA) private readonly prisma: CredentialsPrisma) {}

  /** This user's credentials, through the user-scoped client. */
  private credentialsOf(userId: string): CredentialsDelegate<UserCredentialRow> {
    return (forUser(this.prisma, { userId }) as CredentialsPrisma).userCredential;
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  /**
   * SERVER-SIDE ONLY. RETURNS PLAINTEXT. NEVER CALL THIS FROM A CONTROLLER.
   *
   * The only method in this store that yields a decrypted value. Use it at the
   * moment of use and let it go out of scope. For anything a user will see,
   * use {@link describe} or {@link list}.
   *
   * @returns the plaintext, or `null` if this user has no credential here.
   * @throws InternalServerErrorException if the row exists but will not
   *         decrypt — a changed key, a tampered row, or a row that was moved
   *         from another user (the owner-bound sub-key rejects it). Never
   *         reported as "not configured": that would silently fall back to a
   *         deployment key and hide the fault.
   */
  async getSecret(
    userId: string,
    purpose: string,
    name: string,
  ): Promise<string | null> {
    this.assertAddress(userId, purpose, name);

    const row = await this.credentialsOf(userId).findUnique<{ secret: string }>({
      where: { userId_purpose_name: { userId, purpose, name } },
      select: { secret: true },
    });

    if (!row) {
      return null;
    }

    try {
      return decryptSecret(row.secret, userCredentialPurpose(userId, purpose));
    } catch {
      // The original error is swallowed rather than chained, exactly as in
      // `CredentialsService.getSecret` — see the reasoning there. The log line
      // names the owner (an id, not a secret); the thrown message, which may
      // reach a response body, names only the address the caller asked for.
      this.logger.error(
        `Failed to decrypt user credential "${purpose}/${name}" for user ${userId}: the payload is corrupt, belongs to another owner, or SECRETS_ENCRYPTION_KEY has changed. The credential must be re-entered.`,
      );

      throw new InternalServerErrorException(
        `Credential "${purpose}/${name}" could not be decrypted. It must be set again.`,
      );
    }
  }

  /**
   * Presentation read for one of this user's credentials. Safe to serialise;
   * the ciphertext is not even fetched.
   *
   * @returns the info, or `null` if nothing is stored at this address.
   */
  async describe(
    userId: string,
    purpose: string,
    name: string,
  ): Promise<UserCredentialInfo | null> {
    this.assertAddress(userId, purpose, name);

    const row = await this.credentialsOf(userId).findUnique<UserCredentialInfo>({
      where: { userId_purpose_name: { userId, purpose, name } },
      select: USER_CREDENTIAL_INFO_SELECT,
    });

    return row ? this.toInfo(row) : null;
  }

  /**
   * Presentation read for this user's credentials — all of them, or only
   * those under `purpose` — ordered by purpose then name so a list is stable.
   *
   * Unlike the system store, `purpose` is optional: the scope that matters
   * here is the OWNER, and "every key I have stored" is a legitimate thing
   * for a user to ask about themselves. There is still no cross-user listing.
   */
  async list(userId: string, purpose?: string): Promise<UserCredentialInfo[]> {
    assertCredentialOwner(userId);
    if (purpose !== undefined) {
      assertCredentialPurpose(purpose);
    }

    const rows = await this.credentialsOf(userId).findMany<UserCredentialInfo>({
      where: purpose === undefined ? { userId } : { userId, purpose },
      select: USER_CREDENTIAL_INFO_SELECT,
      orderBy: [{ purpose: 'asc' }, { name: 'asc' }],
    });

    return rows.map((row) => this.toInfo(row));
  }

  // ---------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------

  /**
   * Create or update this user's credential at `(purpose, name)`.
   *
   * BLANK PRESERVES: `undefined`, `null` or `''` for `secret` keeps the stored
   * ciphertext and hint and applies only `meta`. `hint` is derived here from
   * the plaintext; callers do not supply it.
   *
   * @throws BadRequestException on a blank secret with nothing stored yet.
   * @throws InternalServerErrorException for a purpose not registered with
   *         `registerUserCredentialPurpose` (a programming error).
   */
  async setSecret(
    userId: string,
    purpose: string,
    name: string,
    secret: string | null | undefined,
    meta: UserCredentialMeta = {},
  ): Promise<void> {
    this.assertAddress(userId, purpose, name);
    if (!userCredentialPurposeRegistry.has(purpose)) {
      // A programming error (500), not a caller's: the purpose was never
      // declared with `registerUserCredentialPurpose`.
      throw new InternalServerErrorException(
        `User credential purpose "${purpose}" is not registered (registerUserCredentialPurpose).`,
      );
    }

    // Only the metadata keys the caller actually passed — `undefined` means
    // "leave it", `null` means "clear it".
    const metaUpdate: CredentialsQueryArgs = {};
    if (meta.label !== undefined) metaUpdate.label = meta.label;

    if (isBlankSecret(secret)) {
      await this.applyMetadataOnly(userId, purpose, name, metaUpdate);
      return;
    }

    const encrypted = encryptSecret(secret, userCredentialPurpose(userId, purpose));
    const hint = deriveHint(secret);

    await this.credentialsOf(userId).upsert({
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

    // Address only — never `secret`, `encrypted` or `hint`.
    this.logger.log(`Stored user credential "${purpose}/${name}" for user ${userId}`);
  }

  /**
   * Remove this user's credential at `(purpose, name)`. The ONLY way to erase
   * one. Idempotent: deleting an absent credential is a no-op.
   */
  async deleteSecret(userId: string, purpose: string, name: string): Promise<void> {
    this.assertAddress(userId, purpose, name);

    const { count } = await this.credentialsOf(userId).deleteMany({
      where: { userId, purpose, name },
    });

    if (count > 0) {
      this.logger.log(`Deleted user credential "${purpose}/${name}" for user ${userId}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * The blank-secret branch of {@link setSecret}. The first-write case (blank
   * secret, no row) is an error for exactly the reasons given in
   * `CredentialsService.applyMetadataOnly`.
   */
  private async applyMetadataOnly(
    userId: string,
    purpose: string,
    name: string,
    metaUpdate: CredentialsQueryArgs,
  ): Promise<void> {
    const existing = await this.credentialsOf(userId).findUnique<{ id: string }>({
      where: { userId_purpose_name: { userId, purpose, name } },
      select: { id: true },
    });

    if (!existing) {
      throw new BadRequestException(
        `Cannot create credential "${purpose}/${name}" without a secret. A blank value preserves an existing secret, but there is none stored at this address yet.`,
      );
    }

    // A blank secret and no metadata: leave the row, and `updatedAt`, alone.
    if (Object.keys(metaUpdate).length === 0) {
      return;
    }

    await this.credentialsOf(userId).update({
      // `existing.id` came from a lookup scoped by this owner, and the scoped
      // client adds the owner to this unique where too, so updating by id
      // here cannot reach another user's row.
      where: { id: existing.id },
      data: metaUpdate,
    });

    this.logger.log(
      `Updated metadata for user credential "${purpose}/${name}" for user ${userId} (secret preserved)`,
    );
  }

  /** Build a `UserCredentialInfo` field by field — never by spreading a row. */
  private toInfo(row: UserCredentialInfo): UserCredentialInfo {
    return {
      purpose: row.purpose,
      name: row.name,
      hint: row.hint,
      label: row.label,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private assertAddress(userId: string, purpose: string, name: string): void {
    assertCredentialOwner(userId);
    assertCredentialAddress(purpose, name);
  }
}

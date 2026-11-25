import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';

import { PLATFORM_PRISMA, decryptSecret, encryptSecret, forOrg, isCanonicalUuid, orgCredentialPurpose } from '../core/index';
import {
  assertCredentialAddress,
  assertCredentialPurpose,
  deriveHint,
  isBlankSecret,
} from './credential-internals';
import type { CredentialsDelegate, CredentialsPrisma, CredentialsQueryArgs, OrgCredentialRow } from './data/credentials-db';
import type { OrgCredentialInfo, OrgCredentialMeta } from './interfaces/org-credential-info.interface';
import { DEFAULT_USER_CREDENTIAL_NAME, writablePurposeProblem } from './registry';

// =============================================================================
// OrgCredentialsService — an ORGANIZATION's own encrypted credentials (#735)
// =============================================================================
//
// The third tier of the credential store, between a user's own keys and the
// deployment's: secrets an organization owns (its AI provider key, its own
// storage or mail account), addressed by `(orgId, purpose, name)` in
// `org_credentials`.
//
// THE SAME INVARIANTS AS THE OTHER TWO STORES (read `CredentialsService`):
//
//   1. NO PLAINTEXT EGRESS. `getSecret` returns plaintext and is server-side
//      only; `describe`/`list`/`setSecret` return `OrgCredentialInfo`, which
//      has no field able to carry a secret. No log line or error carries a
//      secret or a hint.
//   2. BLANK PRESERVES. A blank secret keeps the stored ciphertext; erasing is
//      `deleteSecret`. A blank secret with nothing stored is a 400.
//
// PLUS TWO OF ITS OWN:
//
//   - AN ORG-BOUND CIPHER DOMAIN, `org:<orgId>:<purpose>`
//     (`orgCredentialPurpose`): a ciphertext copied into another
//     organization's row fails GCM authentication.
//   - TENANT ISOLATION IN THE DATABASE. `org_credentials` is under FORCEd
//     row-level security; every query runs through `forOrg(prisma, orgId)`
//     (core), which sets the transaction-local `app.org_id`. A query for
//     another organization sees nothing, whatever its `where` says.
//
// `orgId` comes from the principal (`activeOrgId`) or a job payload, never
// from request input. WRITES NEED A REGISTERED PURPOSE with the `org` tier
// (`registerCredentialPurpose`); anything else is a programming error (500).
// =============================================================================

/** Columns making up an `OrgCredentialInfo`: the ciphertext is never selected. */
const ORG_CREDENTIAL_INFO_SELECT: Record<keyof OrgCredentialInfo, true> = {
  purpose: true,
  name: true,
  hint: true,
  label: true,
  updatedByUserId: true,
  createdAt: true,
  updatedAt: true,
};

/**
 * An organization's encrypted credentials, addressed by
 * `(orgId, purpose, name)`, encrypted under `org:<orgId>:<purpose>` and read
 * only inside that organization's row-level-security scope.
 *
 * @example
 * ```ts
 * await orgCredentials.setSecret(principal.activeOrgId, 'ai', 'openai', typedKey, {
 *   label: 'OpenAI key',
 *   updatedByUserId: principal.userId,
 * });
 * ```
 *
 * @stability experimental
 */
@Injectable()
export class OrgCredentialsService {
  private readonly logger = new Logger(OrgCredentialsService.name);

  /**
   * @param prisma - the app's Prisma client, through the core `PLATFORM_PRISMA` port.
   */
  constructor(@Inject(PLATFORM_PRISMA) private readonly prisma: CredentialsPrisma) {}

  /** This organization's credentials, through the org-scoped (RLS) client. */
  private credentialsOf(orgId: string): CredentialsDelegate<OrgCredentialRow> {
    return (forOrg(this.prisma, orgId) as unknown as CredentialsPrisma).orgCredential;
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  /**
   * SERVER-SIDE ONLY. RETURNS PLAINTEXT. NEVER CALL THIS FROM A CONTROLLER.
   *
   * @param orgId - the owning organization (a canonical UUID).
   * @param purpose - the purpose.
   * @param name - the name within it; defaults to `'default'`.
   * @returns the plaintext, or `null` when nothing is stored at this address.
   * @throws InternalServerErrorException when the row exists but will not
   *   decrypt (a changed key, a tampered row, or a row moved from another
   *   organization). Never reported as "not configured".
   */
  async getSecret(orgId: string, purpose: string, name: string = DEFAULT_USER_CREDENTIAL_NAME): Promise<string | null> {
    this.assertAddress(orgId, purpose, name);

    const row = await this.credentialsOf(orgId).findUnique<{ secret: string }>({
      where: { orgId_purpose_name: { orgId, purpose, name } },
      select: { secret: true },
    });
    if (!row) return null;

    try {
      return decryptSecret(row.secret, orgCredentialPurpose(orgId, purpose));
    } catch {
      // Swallowed rather than chained, as in `CredentialsService.getSecret`.
      this.logger.error(
        `Failed to decrypt org credential "${purpose}/${name}" for organization ${orgId}: the payload is corrupt, belongs to another organization, or SECRETS_ENCRYPTION_KEY has changed. The credential must be re-entered.`,
      );
      throw new InternalServerErrorException(`Credential "${purpose}/${name}" could not be decrypted. It must be set again.`);
    }
  }

  /**
   * Presentation read for one credential. Safe to serialise.
   *
   * @param orgId - the owning organization.
   * @param purpose - the purpose.
   * @param name - the name within it; defaults to `'default'`.
   * @returns the info, or `null` when nothing is stored at this address.
   */
  async describe(orgId: string, purpose: string, name: string = DEFAULT_USER_CREDENTIAL_NAME): Promise<OrgCredentialInfo | null> {
    this.assertAddress(orgId, purpose, name);
    const row = await this.credentialsOf(orgId).findUnique<OrgCredentialInfo>({
      where: { orgId_purpose_name: { orgId, purpose, name } },
      select: ORG_CREDENTIAL_INFO_SELECT,
    });
    return row ? toInfo(row) : null;
  }

  /**
   * Presentation read for this organization's credentials, all of them or
   * only those under `purpose`, ordered by purpose then name.
   *
   * @param orgId - the owning organization.
   * @param purpose - restricts the list to one purpose.
   * @returns the infos; empty when there are none.
   */
  async list(orgId: string, purpose?: string): Promise<OrgCredentialInfo[]> {
    this.assertOrg(orgId);
    if (purpose !== undefined) assertCredentialPurpose(purpose);

    const rows = await this.credentialsOf(orgId).findMany<OrgCredentialInfo>({
      where: purpose === undefined ? { orgId } : { orgId, purpose },
      select: ORG_CREDENTIAL_INFO_SELECT,
      orderBy: [{ purpose: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toInfo);
  }

  // ---------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------

  /**
   * Create or update the credential at `(orgId, purpose, name)`.
   *
   * BLANK PRESERVES: `undefined`, `null` or `''` keeps the stored ciphertext
   * and hint and applies only `meta`.
   *
   * @param orgId - the owning organization.
   * @param purpose - a purpose registered with the `org` tier.
   * @param name - the name within it.
   * @param secret - the plaintext, or blank to keep the stored one.
   * @param meta - label and provenance.
   * @returns the stored credential's info.
   * @throws InternalServerErrorException for an unregistered purpose (a
   *   programming error).
   * @throws BadRequestException on a blank secret with nothing stored yet, or
   *   a malformed address.
   */
  async setSecret(
    orgId: string,
    purpose: string,
    name: string,
    secret: string | null | undefined,
    meta: OrgCredentialMeta = {},
  ): Promise<OrgCredentialInfo> {
    this.assertAddress(orgId, purpose, name);
    const problem = writablePurposeProblem(purpose, 'org');
    if (problem) throw new InternalServerErrorException(problem);

    const metaUpdate: CredentialsQueryArgs = {};
    if (meta.label !== undefined) metaUpdate.label = meta.label;
    if (meta.updatedByUserId !== undefined) metaUpdate.updatedByUserId = meta.updatedByUserId;

    const delegate = this.credentialsOf(orgId);
    const where = { orgId_purpose_name: { orgId, purpose, name } };

    if (isBlankSecret(secret)) {
      const existing = await delegate.findUnique<{ id: string }>({ where, select: { id: true } });
      if (!existing) {
        throw new BadRequestException(
          `Cannot create credential "${purpose}/${name}" without a secret. A blank value preserves an existing secret, but there is none stored at this address yet.`,
        );
      }
      if (Object.keys(metaUpdate).length === 0) {
        return (await this.describe(orgId, purpose, name)) as OrgCredentialInfo;
      }
      const updated = await delegate.update<OrgCredentialInfo>({
        where,
        data: metaUpdate,
        select: ORG_CREDENTIAL_INFO_SELECT,
      });
      this.logger.log(`Updated metadata for org credential "${purpose}/${name}" for organization ${orgId} (secret preserved)`);
      return toInfo(updated);
    }

    const encrypted = encryptSecret(secret, orgCredentialPurpose(orgId, purpose));
    const hint = deriveHint(secret);

    const row = await delegate.upsert<OrgCredentialInfo>({
      where,
      create: {
        orgId,
        purpose,
        name,
        secret: encrypted,
        hint,
        label: meta.label ?? null,
        updatedByUserId: meta.updatedByUserId ?? null,
      },
      update: { secret: encrypted, hint, ...metaUpdate },
      select: ORG_CREDENTIAL_INFO_SELECT,
    });

    // Address only — never `secret`, `encrypted` or `hint`.
    this.logger.log(`Stored org credential "${purpose}/${name}" for organization ${orgId}`);
    return toInfo(row);
  }

  /**
   * Remove the credential at `(orgId, purpose, name)`. The ONLY way to erase
   * one. Idempotent: deleting an absent credential is a no-op.
   *
   * @param orgId - the owning organization.
   * @param purpose - the purpose.
   * @param name - the name within it.
   */
  async deleteSecret(orgId: string, purpose: string, name: string): Promise<void> {
    this.assertAddress(orgId, purpose, name);
    const { count } = await this.credentialsOf(orgId).deleteMany({ where: { orgId, purpose, name } });
    if (count > 0) this.logger.log(`Deleted org credential "${purpose}/${name}" for organization ${orgId}`);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private assertOrg(orgId: string): void {
    if (!isCanonicalUuid(orgId)) {
      throw new BadRequestException('Credential organization must be a canonical (lowercase, hyphenated) UUID.');
    }
  }

  private assertAddress(orgId: string, purpose: string, name: string): void {
    this.assertOrg(orgId);
    assertCredentialAddress(purpose, name);
  }
}

/** Build an `OrgCredentialInfo` field by field — never by spreading a row. */
function toInfo(row: OrgCredentialInfo): OrgCredentialInfo {
  return {
    purpose: row.purpose,
    name: row.name,
    hint: row.hint,
    label: row.label,
    updatedByUserId: row.updatedByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

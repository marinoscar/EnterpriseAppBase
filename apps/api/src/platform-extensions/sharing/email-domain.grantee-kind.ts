// =============================================================================
// Example grantee kind: "everyone at an email domain" (PP-14.16)
// =============================================================================
//
// Extension point: `registerGranteeKind` (rung 2 of the extension contract).
//
// A grantee kind says who a grant names. This one names every person whose
// e-mail address is at one domain (`example.com`). It supplies the whole
// contract:
//
//   validateGrantee         normalises and checks the domain a sharer typed;
//   describe                a line for lists ("Anyone at @example.com");
//   matchesPrincipal        the in-memory spelling of "does this grant name me";
//   resolvePrincipalMatch   the SQL spelling over the grants row, parameterised.
//
// `describeGranteeKindConformance` proves the two spellings agree.
//
// TRUST. `matchesPrincipal` and the SQL read `principal.email`: the domain is only
// as trustworthy as the address, so use this kind only when the identity provider
// VERIFIES the address (an unverified or user-editable e-mail lets anyone claim a
// domain's access).
//
// PERSISTED. `persisted: true` stores its grants: `POST /api/grants` with
// `{ kind: 'custom', granteeKind: 'email-domain', ref: 'example.com' }` runs
// `validateGrantee` and writes `grantee_kind = 'email-domain'`, `grantee_ref =
// 'example.com'` (the normalised domain); `principalWhere` is the Prisma spelling
// of `resolvePrincipalMatch` for the decision query. The platform pins both to
// the kind and to the caller's organization. A resource type lists the roles the
// kind may be granted with `grantable: { 'email-domain': ['viewer'] }` (none by
// default). The reference app does NOT register it at start-up; the proof,
// including the conformance kit over a real database and the per-organization
// isolation, is apps/api/test/examples/sharing/email-domain.example.db.spec.ts.
// =============================================================================

import { GranteeInputError, registerGranteeKind, type GranteeKindDef } from '@marinoscar/platform-api/sharing';

/** A lower-case host name with at least one dot: `example.com`, `eng.example.co.uk`. */
const DOMAIN = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * The domain of an e-mail address, lower-cased, or `null` when it has none.
 *
 * @param email - an address.
 *
 * @stability experimental
 */
export function emailDomainOf(email: string): string | null {
  const at = email.lastIndexOf('@');
  return at > 0 && at < email.length - 1 ? email.slice(at + 1).trim().toLowerCase() : null;
}

/**
 * The email-domain grantee kind.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const emailDomainGranteeKind: GranteeKindDef = {
  kind: 'email-domain',
  label: 'Email domain',
  description: 'Everyone whose e-mail address is at one domain.',
  input: 'text',
  persisted: true,

  validateGrantee(input) {
    const domain = typeof input === 'string' ? input.trim().replace(/^@/, '').toLowerCase() : '';
    if (!DOMAIN.test(domain)) throw new GranteeInputError('Enter a domain such as example.com.');
    return { kind: 'email-domain', id: domain };
  },

  async describe(ref) {
    return { display: `Anyone at @${ref.id}` };
  },

  matchesPrincipal: (facts, principal) => facts.kind === 'email-domain' && facts.ref !== null && facts.ref.toLowerCase() === emailDomainOf(principal.email),

  resolvePrincipalMatch(principal, columns, kit) {
    const domain = emailDomainOf(principal.email);
    if (domain === null) return null;
    return kit.sql`(${columns.kind} = 'email-domain' AND lower(${columns.ref}) = ${domain})`;
  },

  principalWhere(principal) {
    const domain = emailDomainOf(principal.email);
    // `validateGrantee` stores the domain lower-cased, so the equality is on the stored value.
    return domain === null ? null : { granteeKind: 'email-domain', granteeRef: domain };
  },
};

/**
 * Registers the kind. Call it from an app registration file when the app
 * wants the dialog to offer it.
 *
 * @stability experimental
 */
export function registerEmailDomainGranteeKind(): void {
  registerGranteeKind(emailDomainGranteeKind);
}

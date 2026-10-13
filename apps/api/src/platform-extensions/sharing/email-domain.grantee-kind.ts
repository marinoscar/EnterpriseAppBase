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
// NOT PERSISTED YET. A `grants` row can store only `user`, `group` and `link`
// until the sharing storage migration ships (the `grantee_kind` column is an
// enum), so this kind is registered WITHOUT `persisted`: `GET
// /api/sharing/grantee-kinds` lists it (`persisted: false`), `POST
// /api/grants` validates it (422 `GRANTEE_INVALID`) and then answers 422
// `GRANTEE_KIND_NOT_PERSISTABLE`, and no decision or list consults it. When the
// migration ships, `persisted: true` plus `principalWhere` is the only change
// here. The reference app therefore does NOT register it at start-up; the
// proof, including the conformance kit over a real database, is
// apps/api/test/examples/sharing/email-domain.example.db.spec.ts.
// =============================================================================

import { registerGranteeKind, type GranteeKindDef } from '@marinoscar/platform-api/sharing';

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

  validateGrantee(input) {
    const domain = typeof input === 'string' ? input.trim().replace(/^@/, '').toLowerCase() : '';
    if (!DOMAIN.test(domain)) throw new Error('Enter a domain such as example.com.');
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

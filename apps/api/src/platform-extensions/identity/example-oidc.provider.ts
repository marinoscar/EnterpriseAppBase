// =============================================================================
// DO NOT COPY THIS PROVIDER AS-IS: it is a fake, built to run without a network
// =============================================================================
//
// A real provider must add, at least:
//
//   - the full token checks the fake skips: `iss` and `aud` equal to your issuer
//     and client id, `iat`, a `jti` that is not replayed, and a BOUNDED `exp`
//     (here any future `exp` is accepted), with the issuer's own signature
//     (here an HMAC both sides know);
//   - the token OUT of the URL query: an `id_token` in `?id_token=` lands in
//     logs, history and referrers (a real flow exchanges an authorization code
//     server to server);
//   - login-CSRF protection. The slice adds NO `state` and NO PKCE, and
//     `passport-oauth2`'s `state: true` without a `store` throws "requires
//     session support" on every sign-in here (no session plugin). Pass
//     `store: createCookieStateStore({ secret })` of
//     `@marinoscar/platform-api/identity`, or a store of your own;
//   - a type check on every claim before it is used (the `groups` claim below
//     is checked with `Array.isArray` before `.includes`);
//   - `linkExistingByEmail` stays OFF unless the issuer is trusted to vouch for
//     the address; it also gates the `INITIAL_ADMIN_EMAIL` bootstrap. A
//     multi-tenant issuer needs a sign-in policy that accepts only your tenants.
//
import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  authCredentialPurpose,
  type AuthProviderDefinition,
  type AuthProviderStrategy,
  type ExternalProfile,
  type SignInDecision,
  type SignInPolicy,
} from '@marinoscar/platform-api/identity';

// =============================================================================
// The `example-oidc` sign-in provider: an app adds a login method WITHOUT
// touching a package (PP-14.9)
// =============================================================================
//
// A fake OpenID Connect provider, in the shape a real GitHub, Entra or OIDC
// provider takes, with no network. Its Passport strategy accepts an "ID token"
// the test signs itself (HS256 over a JSON payload, `signExampleIdToken`) as
// `?id_token=` on the callback; a real provider would exchange an authorization
// code at the issuer and verify the issuer's signature. Everything around that
// is the real thing:
//
//   - registered with `registerAuthProvider` from `app-registrations/identity.ts`;
//   - its secret (the signing key) is read from the encrypted credential store
//     under the purpose `auth_example-oidc`, never from an environment variable,
//     and the provider is OFF until an administrator has stored it: a fresh
//     install is unchanged;
//   - `GET /api/auth/example-oidc` and `/callback` are mounted by the identity
//     slice, the login ends in the same HttpOnly refresh cookie and redirect as
//     Google's, and the identity is stored as provider `example-oidc`;
//   - the allowlist applies, `INITIAL_ADMIN_EMAIL` bypasses it, and the account
//     is NOT merged into an existing user with the same address
//     (`linkExistingByEmail` stays off: an issuer shared by many tenants can
//     set any address, see the identity README).
//
// `ExampleOidcSignInPolicy` shows the other seam: a company-domain rule and a
// role mapped from a claim. It is NOT bound in this app (a bound policy is
// consulted for every provider, Google included); pass it to
// `IdentityModule.forRoot({ signInPolicy: { useClass: ExampleOidcSignInPolicy } })`
// to use it. Recipe: docs/EXTENDING.md, "Add a sign-in provider".
// =============================================================================

/** The provider id: the route segment, `UserIdentity.provider` and the Passport strategy name. */
export const EXAMPLE_OIDC_ID = 'example-oidc';

/** The credential purpose (`auth_example-oidc`) the signing key is stored under. */
export const EXAMPLE_OIDC_PURPOSE = authCredentialPurpose(EXAMPLE_OIDC_ID);

/** The name of the stored signing key within the purpose. */
export const EXAMPLE_OIDC_KEY_NAME = 'signing_key';

/** The only domain {@link ExampleOidcSignInPolicy} admits. */
export const EXAMPLE_OIDC_DOMAIN = 'example.test';

/** The claims the example "ID token" carries. */
export interface ExampleOidcClaims {
  /** The stable subject at the issuer. */
  sub: string;
  /** The account's address. */
  email?: string;
  /** Whether the issuer vouches for the address. Only `true` counts. */
  email_verified?: boolean;
  /** The display name. */
  name?: string;
  /** The picture URL. */
  picture?: string;
  /** Group names; the example policy maps `org-admins` to the `org_admin` role. */
  groups?: string[];
  /** Expiry, seconds since the epoch. */
  exp: number;
}

const b64 = (input: Buffer | string) => Buffer.from(input).toString('base64url');

/**
 * Signs a test "ID token": `base64url(claims).base64url(HMAC-SHA256)`.
 *
 * @param claims - the token's claims.
 * @param key - the signing key stored in the credential store.
 * @returns the token.
 */
export function signExampleIdToken(claims: ExampleOidcClaims, key: string): string {
  const payload = b64(JSON.stringify(claims));
  return `${payload}.${b64(createHmac('sha256', key).update(payload).digest())}`;
}

/** Verifies a token's signature (constant time) and expiry; `null` for anything else. */
function verifyExampleIdToken(token: string, key: string, nowSeconds: number): ExampleOidcClaims | null {
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) return null;
  const expected = createHmac('sha256', key).update(payload).digest();
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as ExampleOidcClaims;
    if (typeof claims.sub !== 'string' || typeof claims.exp !== 'number' || claims.exp <= nowSeconds) return null;
    return claims;
  } catch {
    return null;
  }
}

/**
 * The Passport strategy: no `id_token` starts the flow (a redirect to the
 * issuer's authorize endpoint, never fetched), a valid one signs the person in.
 * It reads the raw request URL so it does not depend on a query parser. A real
 * strategy also sends and checks `state` (and PKCE) to bind the callback to the
 * browser that started it.
 */
class ExampleOidcStrategy {
  readonly name = EXAMPLE_OIDC_ID;

  constructor(private readonly signingKey: string) {}

  authenticate(this: ExampleOidcStrategy & PassportCallbacks, req: { url?: string }): void {
    const idToken = new URL(req.url ?? '/', 'http://localhost').searchParams.get('id_token');
    if (!idToken) {
      this.redirect('https://idp.example.test/authorize?client_id=example&response_type=id_token');
      return;
    }
    const claims = verifyExampleIdToken(idToken, this.signingKey, Math.floor(Date.now() / 1000));
    if (!claims) {
      this.fail('invalid id_token');
      return;
    }
    this.success(claims);
  }
}

/** The callbacks Passport adds to a strategy instance for one request. */
interface PassportCallbacks {
  redirect(url: string): void;
  fail(info: string): void;
  success(user: unknown): void;
}

/**
 * The provider, as registered. Off until the signing key is stored.
 *
 * @example
 * ```ts
 * registerAuthProvider(exampleOidcProvider); // app-registrations/identity.ts
 * ```
 */
export const exampleOidcProvider: AuthProviderDefinition = {
  id: EXAMPLE_OIDC_ID,
  label: 'Example OIDC',
  isEnabled: async (_config, { credentials }) => (await credentials.getSecret(EXAMPLE_OIDC_PURPOSE, EXAMPLE_OIDC_KEY_NAME)) !== null,
  createStrategy: async ({ credentials }) => {
    const key = await credentials.getSecret(EXAMPLE_OIDC_PURPOSE, EXAMPLE_OIDC_KEY_NAME);
    if (!key) throw new Error('The example-oidc signing key is not stored');
    return new ExampleOidcStrategy(key) as unknown as AuthProviderStrategy;
  },
  mapProfile: (raw): ExternalProfile => {
    const claims = raw as ExampleOidcClaims;
    return {
      provider: EXAMPLE_OIDC_ID,
      subject: claims.sub,
      email: claims.email ?? null,
      // Only an explicit `true` from the issuer counts as verified.
      emailVerified: claims.email_verified === true,
      ...(claims.name ? { displayName: claims.name } : {}),
      ...(claims.picture ? { pictureUrl: claims.picture } : {}),
      raw: { groups: claims.groups ?? [] },
    };
  },
  egressHosts: ['idp.example.test'],
  doctorRemedy:
    'Store the signing key as the credential (purpose auth_example-oidc, name signing_key) and restart nothing: the provider turns on as soon as it exists.',
};

/**
 * A company-domain rule plus a role mapped from a claim, for this provider only
 * (every other provider is waved through, so binding it cannot change Google).
 *
 * - an address outside `example.test` is refused with `access_denied`;
 * - a member of the `org-admins` group gets the `org_admin` organization role
 *   when the account is CREATED (never re-applied, so an administrator's later
 *   role changes stick).
 */
export class ExampleOidcSignInPolicy implements SignInPolicy {
  beforeLogin(profile: ExternalProfile): SignInDecision {
    if (profile.provider !== EXAMPLE_OIDC_ID) return { allow: true };
    if (!profile.email?.toLowerCase().endsWith(`@${EXAMPLE_OIDC_DOMAIN}`)) {
      return { allow: false, reason: 'access_denied' };
    }
    // A claim is untrusted input: check its type before using it.
    const claim = profile.raw?.groups;
    const groups = Array.isArray(claim) ? claim : [];
    return groups.includes('org-admins') ? { allow: true, roles: ['org_admin'] } : { allow: true };
  }
}

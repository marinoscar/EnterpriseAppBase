import { CanActivate, ExecutionContext, Injectable, Inject, SetMetadata, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { CredentialKindDef } from '@marinoscar/platform-api/core';
import { toPrincipal, type PrincipalSource } from '@marinoscar/platform-api/identity';

// =============================================================================
// EXAMPLE: an app's own credential kind and the guard that admits it (PP-14.14)
// =============================================================================
//
// An integration authenticates with an `ak_` API key instead of a session, a
// device token or a PAT. The platform's `CredentialKind` is
// `'session' | 'device' | 'pat' | 'node'`; the app adds `api-key`:
//
//   1. compile time: `declare module '@marinoscar/platform-api/core' {
//        interface CredentialKinds { 'api-key': true } }` (below);
//   2. run time: `registerCredentialKind` (`app-registrations/core.ts`), naming
//      the principal kind it authenticates as (`user`: it acts for the key's owner).
//
// DEFAULT DENY. `toPrincipal` refuses (401) a kind that is not registered, and
// the guard below never grants a permission the key's owner does not hold. A
// registered kind starts with NO privilege: the platform's own guards decide on
// the built-in ids only (`switchOrg` accepts `session` and nothing else), so
// `api-key` cannot switch organization, reach `/api/nodes` or do anything the
// app's guard does not explicitly admit.
//
// A key never exceeds its owner or its own list: the guard rejects a route whose
// permissions the key does not list, and the principal it attaches carries the
// INTERSECTION of the owner's permissions and the key's.
//
// The guard is plain Nest: a route opts in with `@UseGuards(ApiKeyGuard)` and
// `@RequiresApiKeyPermission(...)`. The key lookup is a port (`API_KEY_VERIFIER`)
// so the example needs no table; a real app reads a hashed key row.
// Recipe: docs/EXTENDING.md, "Add a credential kind".
// =============================================================================

declare module '@marinoscar/platform-api/core' {
  interface CredentialKinds {
    'api-key': true;
  }
}

/** The credential kind id. */
export const API_KEY_CREDENTIAL_KIND = 'api-key' as const;

/** The registration `app-registrations/core.ts` makes. */
export const apiKeyCredentialKind: CredentialKindDef = {
  id: API_KEY_CREDENTIAL_KIND,
  principalKind: 'user',
  description: 'An `ak_` key a user minted for an integration; acts with the permissions the key lists.',
};

/** The loaded owner of a key: the same graph a PAT resolves to, plus the permissions the key itself lists. */
export type ApiKeyOwner = PrincipalSource & { id: string; email: string; keyPermissions: readonly string[] };

/** Looks a presented key up. Returns `null` for an unknown, revoked or expired key. */
export interface ApiKeyVerifier {
  verify(key: string): Promise<ApiKeyOwner | null>;
}

/** Injection token of {@link ApiKeyVerifier}. */
export const API_KEY_VERIFIER = Symbol('API_KEY_VERIFIER');

/** Metadata key of {@link RequiresApiKeyPermission}. */
export const API_KEY_PERMISSIONS = 'example:api-key-permissions';

/** The permissions a route needs; the key must list ALL of them. */
export const RequiresApiKeyPermission = (...permissions: string[]) => SetMetadata(API_KEY_PERMISSIONS, permissions);

/**
 * Admits a request that presents a valid `x-api-key` header and lists the
 * permissions the route declares. Sets `request.principal`.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  /** The kind this guard admits. A subclass overriding it shows what an unregistered kind does (401). */
  protected readonly kind: string = API_KEY_CREDENTIAL_KIND;

  constructor(
    @Inject(API_KEY_VERIFIER) private readonly verifier: ApiKeyVerifier,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, unknown>; principal?: unknown }>();
    const presented = request.headers['x-api-key'];
    if (typeof presented !== 'string' || !presented.startsWith('ak_')) throw new UnauthorizedException();

    const owner = await this.verifier.verify(presented);
    if (owner === null) throw new UnauthorizedException();

    const required = this.reflector.getAllAndOverride<string[] | undefined>(API_KEY_PERMISSIONS, [context.getHandler(), context.getClass()]) ?? [];
    if (!required.every((permission) => owner.keyPermissions.includes(permission))) throw new ForbiddenException();

    // Default deny lives here: an unregistered kind, or one with no principal factory, is a 401.
    const principal = toPrincipal(owner, this.kind as never);
    // A key never exceeds what it lists: the principal carries the owner's permissions
    // INTERSECTED with the key's, so code that reads `principal.permissions` sees the key.
    request.principal = { ...principal, permissions: principal.permissions.filter((p) => owner.keyPermissions.includes(p)) };
    return true;
  }
}

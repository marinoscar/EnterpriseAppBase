import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// =============================================================================
// Which credential authenticated the request
// =============================================================================
//
// `JwtAuthGuard` stamps `request.authCredential` after it admitted the caller:
// a session JWT is `{ kind: 'jwt' }`, a personal access token
// `{ kind: 'pat', tokenId }` (the `personal_access_tokens.id`, never the
// token), a worker-node credential `{ kind: 'node' }`. A route reads it with
// `@AuthCredential()`, for example to link the PAT a device registered with,
// so unlinking the device can revoke exactly that token.
//
// Absent on a `@Public()` route (the guard returns before any credential is
// looked at), so the decorator yields null there.
// =============================================================================

/**
 * Which credential family admitted the request, as `JwtAuthGuard` records it:
 * an access JWT (`jwt`, a browser session or a device-flow token), a personal
 * access token (`pat`, with its id), a worker-node credential (`node`) or an OAuth access token (`oauth`, with its ids and scopes).
 *
 * @stability stable
 */
export type AuthCredentialInfo =
  | {
      /** An access JWT. */
      kind: 'jwt';
    }
  | {
      /** A personal access token. */
      kind: 'pat';
      /** The token's id (never its value). */
      tokenId: string;
    }
  | {
      /** A worker-node credential. */
      kind: 'node';
    }
  | {
      /** An `oat_` OAuth access token a user granted to a third-party client. */
      kind: 'oauth';
      /** The `oauth_tokens.id` (never the token). */
      tokenId: string;
      /** The `oauth_grants.id` (the consent). */
      grantId: string;
      /** The `oauth_clients.id` the token was issued to. */
      clientId: string;
      /** The protected resource's registered id. */
      resourceId: string;
      /** The scope ids the token carries. */
      scopes: string[];
    };

/**
 * The request property `JwtAuthGuard` writes.
 *
 * @stability stable
 */
export interface RequestWithAuthCredential {
  /** Set by `JwtAuthGuard` on every authenticated request; absent on a public route. */
  authCredential?: AuthCredentialInfo;
}

/**
 * The credential that authenticated this request, or null on a public route.
 *
 * @param request - the request.
 * @returns what `JwtAuthGuard` recorded, or `null`.
 *
 * @stability stable
 */
export function authCredentialOf(request: RequestWithAuthCredential | undefined): AuthCredentialInfo | null {
  return request?.authCredential ?? null;
}

/**
 * Parameter decorator: `@AuthCredential() credential: AuthCredentialInfo | null`.
 *
 * @stability stable
 */
export const AuthCredential = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthCredentialInfo | null =>
    authCredentialOf(ctx.switchToHttp().getRequest<RequestWithAuthCredential>()),
);

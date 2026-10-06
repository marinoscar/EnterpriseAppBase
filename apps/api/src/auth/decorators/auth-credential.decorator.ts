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

export type AuthCredentialInfo =
  | { kind: 'jwt' }
  | { kind: 'pat'; tokenId: string }
  | { kind: 'node' };

/** The request property `JwtAuthGuard` writes. */
export interface RequestWithAuthCredential {
  authCredential?: AuthCredentialInfo;
}

/** The credential that authenticated this request, or null on a public route. */
export function authCredentialOf(request: RequestWithAuthCredential | undefined): AuthCredentialInfo | null {
  return request?.authCredential ?? null;
}

/** Parameter decorator: `@AuthCredential() credential: AuthCredentialInfo | null`. */
export const AuthCredential = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthCredentialInfo | null =>
    authCredentialOf(ctx.switchToHttp().getRequest<RequestWithAuthCredential>()),
);

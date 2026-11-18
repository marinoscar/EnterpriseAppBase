import { ForbiddenException } from '@nestjs/common';

import type { AuthCredentialInfo } from './decorators/auth-credential.decorator';

/**
 * Refuses an `oauth` credential on a route that only a person at a keyboard
 * may use: minting another credential (a PAT, a device approval), ending
 * every session, switching organization, approving a consent.
 *
 * An `oat_` token is confined to its resource's routes by the guard, but a
 * protected resource calls the app's own routes through in-process delegation
 * AS that token's principal, and a route that only needs "any signed-in user"
 * would otherwise let a third-party client turn a narrow scope into a
 * full-authority credential. Mirrors `switchOrg`, which accepts the `session`
 * kind only.
 *
 * @param credential - the request's `@AuthCredential()`.
 * @throws ForbiddenException when it is an `oauth` credential.
 *
 * @stability experimental
 */
export function refuseOAuthCredential(credential: AuthCredentialInfo | null | undefined): void {
  if (credential?.kind === 'oauth') {
    throw new ForbiddenException('This action is not available to OAuth access tokens');
  }
}

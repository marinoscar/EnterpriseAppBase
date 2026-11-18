import { ForbiddenException } from '@nestjs/common';

import type { Principal } from '../../core/index';
import type { AuthCredentialInfo } from '../auth/decorators/auth-credential.decorator';
import { refuseOAuthCredential } from '../auth/refuse-oauth';

/**
 * Refuses everything but a browser session. The consent routes are the one
 * place a person decides what a third party may do: a personal access token, a
 * device credential, a worker-node credential and an `oat_` token (which could
 * otherwise approve its own wider scope) are all refused with `403`.
 *
 * @param principal - the request's principal.
 * @param credential - the request's `@AuthCredential()`.
 * @throws ForbiddenException for any credential but `session`.
 *
 * @stability experimental
 */
export function requireSessionCredential(principal: Principal, credential: AuthCredentialInfo | null | undefined): void {
  refuseOAuthCredential(credential);
  if (principal.credential !== 'session') {
    throw new ForbiddenException('Only a signed-in browser session may do this');
  }
}

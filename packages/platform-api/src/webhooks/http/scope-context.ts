// =============================================================================
// The caller, as a webhook scope context (issue #1046)
// =============================================================================

import { ForbiddenException } from '@nestjs/common';
import type { WebhookScope } from '@marinoscar/platform-contract/webhooks';

import type { Principal } from '../../core/index';
import type { WebhookScopeContext } from '../webhook-endpoints.service';

/**
 * The request's principal as the service's context. A worker node's credential
 * manages no webhooks, and an organization-bound scope needs an active
 * organization.
 *
 * @param principal - the request principal.
 * @param scope - the scope of the controller.
 * @returns the context.
 * @throws ForbiddenException for a non-user principal or a missing active organization.
 *
 * @stability experimental
 */
export function webhookScopeContext(principal: Principal | undefined, scope: WebhookScope): WebhookScopeContext {
  if (!principal || principal.kind !== 'user') throw new ForbiddenException('Webhooks are for signed-in users');
  const orgId = principal.activeOrgId ?? null;
  if (scope !== 'system' && !orgId) throw new ForbiddenException('This credential has no active organization');
  return { scope, userId: principal.userId, orgId: scope === 'system' ? null : orgId, permissions: principal.permissions };
}

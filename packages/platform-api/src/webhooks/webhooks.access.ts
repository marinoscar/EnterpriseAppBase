// =============================================================================
// The owner's access to an endpoint's events (issue #1046)
// =============================================================================
//
// An endpoint is its owner's delegate: it may receive an event only while the
// person who set it up could read that event. The check is made at FAN-OUT time
// (not at creation), so revoking a permission, suspending the member or
// deactivating the account silences the endpoint at the next event. The owner
// is the user for a user-scope endpoint and the creator for an org or system
// endpoint; an endpoint whose creator no longer exists has no owner to check.
// =============================================================================

import { WEBHOOK_PERMISSIONS, type WebhookScope } from '@marinoscar/platform-contract/webhooks';

import { currentTenancyMode, resolveEffectiveAccess } from '../identity/index';
import type { WebhookEndpointRow, WebhookUserRow } from './data/webhooks-db';
import type { WebhookEventDef } from './registry/webhook-event.registry';

/** The permission that lets someone read their own endpoints of `scope`. @stability experimental */
export function basePermissionFor(scope: WebhookScope): string {
  return scope === 'user' ? WEBHOOK_PERMISSIONS.READ : scope === 'org' ? WEBHOOK_PERMISSIONS.ORG_READ : WEBHOOK_PERMISSIONS.SYSTEM_READ;
}

/**
 * Who owns an endpoint for the access check.
 *
 * @param endpoint - the endpoint.
 * @returns the user id, or `null` when there is no owner to check.
 *
 * @stability experimental
 */
export function ownerIdOf(endpoint: Pick<WebhookEndpointRow, 'ownerUserId' | 'createdById'>): string | null {
  return endpoint.ownerUserId ?? endpoint.createdById;
}

/**
 * Whether `owner` still holds what the endpoint needs: an active account, the
 * scope's base permission in the endpoint's organization (system permissions
 * only for a system endpoint) and the event's own permission, when it names one.
 *
 * @param owner - the owner loaded with roles and memberships; `null` when the account is gone.
 * @param endpoint - the endpoint.
 * @param event - the event being delivered.
 * @returns `true` when the event may be delivered.
 *
 * @stability experimental
 */
export function ownerMayReceive(
  owner: WebhookUserRow | null,
  endpoint: Pick<WebhookEndpointRow, 'scope' | 'orgId'>,
  event: Pick<WebhookEventDef, 'permission'>,
): boolean {
  if (!owner || !owner.isActive) return false;
  const access = resolveEffectiveAccess(
    { userRoles: owner.userRoles, memberships: owner.memberships as never, activeOrgId: endpoint.orgId ?? null },
    currentTenancyMode(),
  );
  const held = new Set(access.permissions);
  if (!held.has(basePermissionFor(endpoint.scope))) return false;
  return event.permission === undefined || held.has(event.permission);
}

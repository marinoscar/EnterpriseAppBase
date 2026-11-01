// =============================================================================
// The webhooks slice's permissions (issue #1046)
// =============================================================================
//
// Three tiers, one string each way, declared beside the controllers that
// enforce them:
//
//   webhooks:read / :write           ORG scope, every org role (a member manages
//                                    their OWN endpoints; the service scopes by owner)
//   org_webhooks:read / :write       ORG scope, `org_admin` (the organization's endpoints)
//   system_webhooks:read / :write    SYSTEM scope, `admin` (the deployment's endpoints)
// =============================================================================

import type { PermissionDeclaration } from '../core/index';

/** A permission declaration of this slice. @stability experimental */
export type WebhooksPermissionDeclaration<Id extends string = string> = PermissionDeclaration<Id>;

/**
 * `webhooks:read` and `webhooks:write`, ORG scope, granted to every org role:
 * a member manages the endpoints they own in the active organization. The
 * service pins every query to the caller, so another member's endpoint is a 404.
 *
 * @example
 * ```ts
 * registerPermissions(WEBHOOKS_PERMISSIONS);
 * ```
 *
 * @stability experimental
 */
export const WEBHOOKS_PERMISSIONS: {
  /** `webhooks:read`: list and read one's own endpoints and deliveries. */
  readonly WEBHOOKS_READ: WebhooksPermissionDeclaration<'webhooks:read'>;
  /** `webhooks:write`: create, change, delete, rotate and test one's own endpoints; redeliver. */
  readonly WEBHOOKS_WRITE: WebhooksPermissionDeclaration<'webhooks:write'>;
} = {
  WEBHOOKS_READ: {
    id: 'webhooks:read',
    description: 'View your own webhook endpoints and their deliveries',
    scope: 'org',
    defaultGrants: ['org_admin', 'contributor', 'viewer'],
  },
  WEBHOOKS_WRITE: {
    id: 'webhooks:write',
    description: 'Create, change, delete, rotate and test your own webhook endpoints',
    scope: 'org',
    defaultGrants: ['org_admin', 'contributor', 'viewer'],
  },
};

/**
 * `org_webhooks:read` and `org_webhooks:write`, ORG scope, granted to
 * `org_admin`: the active organization's shared endpoints.
 *
 * @stability experimental
 */
export const ORG_WEBHOOKS_PERMISSIONS: {
  /** `org_webhooks:read`: the organization's endpoints and deliveries. */
  readonly ORG_WEBHOOKS_READ: WebhooksPermissionDeclaration<'org_webhooks:read'>;
  /** `org_webhooks:write`: manage them. */
  readonly ORG_WEBHOOKS_WRITE: WebhooksPermissionDeclaration<'org_webhooks:write'>;
} = {
  ORG_WEBHOOKS_READ: {
    id: 'org_webhooks:read',
    description: "View the active organization's webhook endpoints and their deliveries",
    scope: 'org',
    defaultGrants: ['org_admin'],
  },
  ORG_WEBHOOKS_WRITE: {
    id: 'org_webhooks:write',
    description: "Create, change, delete, rotate and test the active organization's webhook endpoints",
    scope: 'org',
    defaultGrants: ['org_admin'],
  },
};

/**
 * `system_webhooks:read` and `system_webhooks:write`, SYSTEM scope, granted to
 * `admin`: the deployment's endpoints (platform events such as node and job
 * failures).
 *
 * @stability experimental
 */
export const SYSTEM_WEBHOOKS_PERMISSIONS: {
  /** `system_webhooks:read`: the deployment's endpoints and deliveries. */
  readonly SYSTEM_WEBHOOKS_READ: WebhooksPermissionDeclaration<'system_webhooks:read'>;
  /** `system_webhooks:write`: manage them. */
  readonly SYSTEM_WEBHOOKS_WRITE: WebhooksPermissionDeclaration<'system_webhooks:write'>;
} = {
  SYSTEM_WEBHOOKS_READ: {
    id: 'system_webhooks:read',
    description: "View the deployment's webhook endpoints and their deliveries",
    scope: 'system',
    defaultGrants: ['admin'],
  },
  SYSTEM_WEBHOOKS_WRITE: {
    id: 'system_webhooks:write',
    description: "Create, change, delete, rotate and test the deployment's webhook endpoints",
    scope: 'system',
    defaultGrants: ['admin'],
  },
};

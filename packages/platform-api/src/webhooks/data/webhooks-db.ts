// =============================================================================
// The data the webhooks slice reads and writes, structurally (issue #1046)
// =============================================================================
//
// The slice never imports a generated Prisma client (the rule of identity,
// jobs, ai and the rest: `test/no-generated-client.spec.ts`). The tenant client
// arrives through the core port `PLATFORM_PRISMA`, the bypass client through
// `WEBHOOKS_SYSTEM_PRISMA`; both are seen through the structural types below.
// The rows mirror the `webhooks` fragment of `@marinoscar/platform-db` column
// for column.
// =============================================================================

import type { JobsEnqueueTx } from '../../jobs/index';

/** Prisma's arguments for one delegate call, untyped on purpose; the app's client checks them. @stability experimental */
export type WebhooksQueryArgs = any;

/** What a batch write answers. @stability experimental */
export interface WebhooksBatchResult {
  /** Rows touched. */
  count: number;
}

/** One model delegate, as the slice calls it. @stability experimental */
export interface WebhooksDelegate<Row> {
  /** `findMany`. */
  findMany(args?: WebhooksQueryArgs): Promise<Row[]>;
  /** `findFirst`. */
  findFirst(args?: WebhooksQueryArgs): Promise<Row | null>;
  /** `create`. */
  create(args: WebhooksQueryArgs): Promise<Row>;
  /** `createManyAndReturn`: the rows actually inserted (duplicates skipped). */
  createManyAndReturn(args: WebhooksQueryArgs): Promise<Row[]>;
  /** `update`. */
  update(args: WebhooksQueryArgs): Promise<Row>;
  /** `updateMany`. */
  updateMany(args: WebhooksQueryArgs): Promise<WebhooksBatchResult>;
  /** `deleteMany`. */
  deleteMany(args?: WebhooksQueryArgs): Promise<WebhooksBatchResult>;
  /** `count`. */
  count(args?: WebhooksQueryArgs): Promise<number>;
}

/** A `webhook_endpoints` row. @stability experimental */
export interface WebhookEndpointRow {
  /** Id. */
  id: string;
  /** Org id. */
  orgId: string | null;
  /** Scope. */
  scope: 'user' | 'org' | 'system';
  /** Owner user id. */
  ownerUserId: string | null;
  /** Created by id. */
  createdById: string | null;
  /** Name. */
  name: string;
  /** Description. */
  description: string | null;
  /** Url. */
  url: string;
  /** Event keys. */
  eventKeys: string[];
  /** Enabled. */
  enabled: boolean;
  /** Secret version. */
  secretVersion: number;
  /** Previous secret until. */
  previousSecretUntil: Date | null;
  /** Consecutive failures. */
  consecutiveFailures: number;
  /** Disabled reason. */
  disabledReason: string | null;
  /** Last delivery at. */
  lastDeliveryAt: Date | null;
  /** Last success at. */
  lastSuccessAt: Date | null;
  /** Created at. */
  createdAt: Date;
  /** Updated at. */
  updatedAt: Date;
}

/** A `webhook_deliveries` row. @stability experimental */
export interface WebhookDeliveryRow {
  /** Id. */
  id: string;
  /** Org id. */
  orgId: string | null;
  /** Endpoint id. */
  endpointId: string;
  /** Event key. */
  eventKey: string;
  /** Event id. */
  eventId: string;
  /** Payload. */
  payload: unknown;
  /** Status. */
  status: 'pending' | 'delivering' | 'succeeded' | 'failed' | 'dead';
  /** Attempt. */
  attempt: number;
  /** Response status. */
  responseStatus: number | null;
  /** Response snippet. */
  responseSnippet: string | null;
  /** Error code. */
  errorCode: string | null;
  /** Duration ms. */
  durationMs: number | null;
  /** Next attempt at. */
  nextAttemptAt: Date | null;
  /** Delivered at. */
  deliveredAt: Date | null;
  /** Created at. */
  createdAt: Date;
}

/** A role with its permissions, as the owner re-check reads it. @stability experimental */
export interface WebhookUserRole {
  /** The role name. */
  name: string;
  /** The role's permission grants. */
  rolePermissions?: ReadonlyArray<WebhookRolePermission>;
}

/** A permission, by name. @stability experimental */
export interface WebhookPermissionRef {
  /** The permission string. */
  name: string;
}

/** One permission grant of a role. @stability experimental */
export interface WebhookRolePermission {
  /** The permission. */
  permission: WebhookPermissionRef;
}

/** The organization columns the current-membership rule reads. @stability experimental */
export interface WebhookUserOrg {
  /** The organization id. */
  id: string;
  /** Whether it is the single-mode default organization. */
  isDefault: boolean;
}

/** A membership with its role, as the owner re-check reads it. @stability experimental */
export interface WebhookUserMembership {
  /** The organization. */
  orgId: string;
  /** `active` or `suspended`. */
  status: 'active' | 'suspended';
  /** When the member was last active in it. */
  lastActiveAt: Date | null;
  /** When the membership was created. */
  createdAt?: Date;
  /** The organization, for the single-mode default rule. */
  org?: WebhookUserOrg | null;
  /** The org role. */
  role: WebhookUserRole;
}

/** A system role a user holds. @stability experimental */
export interface WebhookUserRoleGrant {
  /** The role. */
  role: WebhookUserRole;
}

/** The user columns the permission re-check reads. @stability experimental */
export interface WebhookUserRow {
  /** Id. */
  id: string;
  /** Email. */
  email: string;
  /** Is active. */
  isActive: boolean;
  /** System roles. */
  userRoles: ReadonlyArray<WebhookUserRoleGrant>;
  /** Organization memberships. */
  memberships?: ReadonlyArray<WebhookUserMembership>;
}

/** The one `users` call the owner re-check makes. @stability experimental */
export interface WebhooksUserDelegate {
  /** `findUnique`. */
  findUnique(args: WebhooksQueryArgs): Promise<WebhookUserRow | null>;
}

/**
 * The client inside one transaction, or a scoped client: the two webhook
 * models, `users` (the owner re-check), the jobs table (`enqueueWithin`).
 *
 * @stability experimental
 */
export interface WebhooksTx extends JobsEnqueueTx {
  /** `webhook_endpoints`. */
  webhookEndpoint: WebhooksDelegate<WebhookEndpointRow>;
  /** `webhook_deliveries`. */
  webhookDelivery: WebhooksDelegate<WebhookDeliveryRow>;
  /** `users`, for the owner's effective permissions. */
  user: WebhooksUserDelegate;
}

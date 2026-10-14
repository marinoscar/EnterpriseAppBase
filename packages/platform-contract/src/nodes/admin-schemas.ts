// =============================================================================
// Nodes: the admin fleet's response shapes (issue #881)
// =============================================================================
//
// What an administrator's browser receives about the worker fleet and its
// credentials, as zod schemas: the single definition `@marinoscar/platform-api/nodes`
// binds its Swagger classes to (`implements`, with a conformance spec) and
// `@marinoscar/platform-web/nodes` derives its types from, so a field added on
// one side reaches the other as a compile error.
//
// These are NOT the node's own view of itself (`WorkerNodeDto` in the API
// slice). The shapes here carry `owner`, which names another user by email,
// and `jobCounts`, which summarises the queue for that node; neither may ever
// reach a worker. Keeping the two apart is a deliberate friction.
//
// `health` is DERIVED at read time and has no column; `token` appears ONLY on
// `nodeCredentialCreatedSchema`, the single shape that can carry a raw secret,
// and `nodeCredentialListItemSchema` / `adminNodeCredentialSchema` do not
// declare it at all rather than declaring it nullable.
// =============================================================================

import { z } from 'zod';

import { NODE_HEALTHS, NODE_STATUSES } from './constants.js';
import { nodeVitalsSchema } from './schemas.js';

/**
 * The entries of {@link NODE_STATUSES}, as `z.enum` sees them.
 *
 * @stability experimental
 */
export type NodeStatusEnum = { [K in (typeof NODE_STATUSES)[number]]: K };

/**
 * The entries of {@link NODE_HEALTHS}, as `z.enum` sees them.
 *
 * @stability experimental
 */
export type NodeHealthEnum = { [K in (typeof NODE_HEALTHS)[number]]: K };

/**
 * Who registered a node or minted a credential.
 *
 * @stability experimental
 */
export const nodeOwnerSchema = z.object({
  /** The user's id (UUID). */
  id: z.string(),
  /** The user's email address. */
  email: z.string(),
  /** The account's display name, when it has one. */
  name: z.string().nullable(),
});

/**
 * How many jobs a node holds in each state. Every key is always present, zero
 * included; `pending` is what an operator calls CLAIMED.
 *
 * @stability experimental
 */
export const nodeJobCountsSchema = z.object({
  /** Jobs this node is running. */
  running: z.number(),
  /** Jobs assigned to this node and not yet started. */
  pending: z.number(),
  /** Jobs this node finished. */
  succeeded: z.number(),
  /** Jobs this node failed. */
  failed: z.number(),
  /** The sum of the four counts above. */
  total: z.number(),
});

/**
 * One node as `GET /api/admin/nodes` returns it (`AdminNodeDto`).
 *
 * `lastVitals` is self-reported and untrusted: display only, never a
 * scheduling input. It is typed with the request-side `nodeVitalsSchema`
 * because the server stores exactly what that schema accepted.
 *
 * @stability experimental
 */
export const adminNodeSchema = z.object({
  /** The node id (UUID). */
  id: z.string(),
  /** Operator-chosen, unique per owner. */
  name: z.string(),
  /** Self-reported host name. */
  hostname: z.string(),
  /** Self-reported platform, e.g. `linux-x64`. */
  platform: z.string(),
  /** Self-reported CLI version. */
  cliVersion: z.string(),
  /** The job types this node declared it can run. May be empty. */
  eligibleTypes: z.array(z.string()),
  /** How many jobs it runs at once. */
  concurrency: z.number(),
  /** Operator state, NOT liveness. */
  status: z.enum(NODE_STATUSES) as z.ZodEnum<NodeStatusEnum>,
  /** Server-derived liveness; nothing downstream recomputes it. */
  health: z.enum(NODE_HEALTHS) as z.ZodEnum<NodeHealthEnum>,
  /** The node's last self-reported capability summary. Opaque. */
  capabilities: z.unknown(),
  /** When it registered (ISO 8601). */
  registeredAt: z.string(),
  /** `null` when the node has never sent a heartbeat, which reads as `stale`. */
  lastHeartbeatAt: z.string().nullable(),
  /** The last vitals snapshot, or `null` when the node has never sent one. */
  lastVitals: nodeVitalsSchema.nullable(),
  /** When `lastVitals` was received, or `null` with it. */
  lastVitalsAt: z.string().nullable(),
  /** The user who registered it. */
  owner: nodeOwnerSchema,
  /** The jobs it holds, per state. */
  jobCounts: nodeJobCountsSchema,
});

/**
 * One credential as `GET /api/admin/nodes/credentials` returns it
 * (`AdminNodeCredentialDto`). No `token`, no hash; revoked credentials are
 * included and carry `revokedAt` (the audit trail).
 *
 * @stability experimental
 */
export const adminNodeCredentialSchema = z.object({
  /** The credential id (UUID). */
  id: z.string(),
  /** Its display name. */
  name: z.string(),
  /** Non-secret display prefix, e.g. `nod_1a2b`. */
  tokenPrefix: z.string(),
  /** `null` means NEVER EXPIRES, a supported, expected answer. */
  expiresAt: z.string().nullable(),
  /** `null` means it has never authenticated. */
  lastUsedAt: z.string().nullable(),
  /** When it was minted (ISO 8601). */
  createdAt: z.string(),
  /** `null` while the credential is still live. */
  revokedAt: z.string().nullable(),
  /** The user it authenticates as. */
  owner: nodeOwnerSchema,
});

/**
 * One credential as `GET /api/node-credentials` (the caller's own) returns it
 * (`NodeCredentialListItemDto`): the admin shape without `owner`.
 *
 * @stability experimental
 */
export const nodeCredentialListItemSchema = adminNodeCredentialSchema.omit({ owner: true });

/**
 * The response to `POST /api/node-credentials`, THE ONLY SHAPE THAT CARRIES
 * `token`. The server stores a hash and cannot produce the raw value again.
 *
 * @stability experimental
 */
export const nodeCredentialCreatedSchema = z.object({
  /** The raw `nod_` token: shown exactly once. */
  token: z.string(),
  /** The credential id (UUID). */
  id: z.string(),
  /** Its display name. */
  name: z.string(),
  /** Non-secret display prefix. */
  tokenPrefix: z.string(),
  /** `null` means never expires. */
  expiresAt: z.string().nullable(),
  /** When it was minted (ISO 8601). */
  createdAt: z.string(),
});

/**
 * One admin node.
 *
 * @stability experimental
 */
export type AdminNode = z.output<typeof adminNodeSchema>;
/**
 * Who registered a node or minted a credential.
 *
 * @stability experimental
 */
export type NodeOwner = z.output<typeof nodeOwnerSchema>;
/**
 * A node's job counts per state.
 *
 * @stability experimental
 */
export type NodeJobCounts = z.output<typeof nodeJobCountsSchema>;
/**
 * One credential in the admin list.
 *
 * @stability experimental
 */
export type AdminNodeCredential = z.output<typeof adminNodeCredentialSchema>;
/**
 * One credential in the caller's own list.
 *
 * @stability experimental
 */
export type NodeCredentialListItem = z.output<typeof nodeCredentialListItemSchema>;
/**
 * The create response, carrying the raw token once.
 *
 * @stability experimental
 */
export type NodeCredentialCreated = z.output<typeof nodeCredentialCreatedSchema>;
/**
 * One node status.
 *
 * @stability experimental
 */
export type NodeStatus = (typeof NODE_STATUSES)[number];
/**
 * One derived node health.
 *
 * @stability experimental
 */
export type NodeHealth = (typeof NODE_HEALTHS)[number];

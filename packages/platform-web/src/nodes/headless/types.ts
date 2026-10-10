// =============================================================================
// The nodes slice's wire types, as the browser sees them (issue #881)
// =============================================================================
//
// Every admin fleet shape is the OUTPUT type of a `@marinoscar/platform-contract/nodes`
// schema (`admin-schemas.ts`) that the API's Swagger classes `implements`, so a
// field the API adds or makes nullable reaches this slice as a compile error,
// not as a silent `undefined`. (They were structural mirrors in the jobs slice
// until #881.)
//
// `NodeCredential` HAS NO `token` FIELD, not even an optional one: the raw
// token exists on the create response (`NodeCredentialCreated`) and nowhere
// else, and a `token?: string` would let the first `credential.token ?? '-'`
// compile while asking for a value the server can never produce. Its
// `expiresAt` is `string | null`, and `null` means "never expires", a real
// answer for an unattended worker.
//
// `WorkerNode.health` is SERVER-DERIVED (`deriveNodeHealth` compares the last
// heartbeat against the `nodes.staleHeartbeatSeconds` system setting, which
// the browser does not read), so nothing in this slice recomputes it.
// =============================================================================

import type { z } from 'zod';
import type {
  AdminNode,
  AdminNodeCredential,
  NodeCredentialCreated,
  NodeHealth,
  NodeJobCounts,
  NodeOwner,
  NodeStatus,
  NodeVitals,
  NodeVitalsCounters,
  createNodeCredentialSchema,
} from '@marinoscar/platform-contract/nodes';

export {
  MAX_NODE_CREDENTIAL_DAYS,
  MAX_NODE_CREDENTIAL_NAME_LENGTH,
  NODE_HEALTHS,
  NODE_STATUSES,
} from '@marinoscar/platform-contract/nodes';
export type {
  NodeCredentialCreated,
  NodeHealth,
  NodeJobCounts,
  NodeOwner,
  NodeStatus,
  NodeVitals,
  NodeVitalsCounters,
};

/**
 * One node as `GET /api/admin/nodes` returns it (`AdminNodeDto`,
 * `adminNodeSchema`).
 *
 * @stability experimental
 */
export type WorkerNode = AdminNode;

/**
 * One credential as `GET /api/admin/nodes/credentials` returns it
 * (`AdminNodeCredentialDto`, `adminNodeCredentialSchema`). No `token`, no hash;
 * revoked credentials are included, carrying `revokedAt` (the audit trail).
 *
 * @stability experimental
 */
export type NodeCredential = AdminNodeCredential;

/**
 * The body `POST /api/node-credentials` accepts (`createNodeCredentialSchema`).
 * Omitting `expiresInDays` is a real choice meaning "never expires".
 *
 * @stability experimental
 */
export type CreateNodeCredentialInput = z.input<typeof createNodeCredentialSchema>;

/**
 * A credential's live-ness: `active`, `expired` or `revoked`.
 *
 * @stability experimental
 */
export type NodeCredentialStatus = 'active' | 'expired' | 'revoked';

/**
 * Whether a credential can still authenticate a node right now.
 *
 * A MIRROR of `validateToken`'s two checks (`node-credential.service.ts`):
 * revoked wins, then expiry, and a `null` expiry is not an expiry at all.
 *
 * @param credential - the row (its `expiresAt` and `revokedAt`).
 * @param now - the instant to judge expiry against.
 * @returns the credential's status.
 *
 * @stability experimental
 */
export function nodeCredentialStatus(
  credential: Pick<NodeCredential, 'expiresAt' | 'revokedAt'>,
  now: Date = new Date(),
): NodeCredentialStatus {
  if (credential.revokedAt) return 'revoked';
  // `null` is "never expires", so it must be checked BEFORE the comparison:
  // `new Date(null)` is the epoch, which would read as expired in 1970 and
  // mark every unattended worker credential dead.
  if (credential.expiresAt && new Date(credential.expiresAt).getTime() <= now.getTime()) {
    return 'expired';
  }
  return 'active';
}

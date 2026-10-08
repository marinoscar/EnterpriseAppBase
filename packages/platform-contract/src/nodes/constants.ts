// =============================================================================
// Nodes: plain values of the node routes' wire shapes (issue #734, PP-8.2)
// =============================================================================
//
// Zod-free bounds of the node control plane and the node credential routes.
// Moved from the API slice's dto files with their comments.
// =============================================================================

/**
 * Upper bound on `expiresInDays`: ten years, which is "effectively never" with a clock attached.
 *
 * @stability experimental
 */
export const MAX_NODE_CREDENTIAL_DAYS = 3650;

/**
 * Ceiling on a node's declared `concurrency`, and therefore on how many rows
 * one claim call can take.
 *
 * 64 is not a hardware estimate — it is the point past which "this node is
 * mis-declared" is more likely than "this node really can run that many
 * jobs at once". A real box that can genuinely run more registers as two
 * nodes, which the fleet page can then see and drain independently.
 *
 * @stability experimental
 */
export const MAX_NODE_CONCURRENCY = 64;

/**
 * Cap on how many job types one node may declare.
 *
 * @stability experimental
 */
export const MAX_NODE_ELIGIBLE_TYPES = 100;

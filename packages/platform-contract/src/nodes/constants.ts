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

/**
 * Length ceiling of a node credential's display `name`.
 *
 * @stability experimental
 */
export const MAX_NODE_CREDENTIAL_NAME_LENGTH = 100;

/**
 * `AdminNode.status`: OPERATOR state, not liveness. `online` accepts claims,
 * `draining` finishes what it holds, `offline` deregistered or was swept,
 * `disabled` is administratively refused.
 *
 * @stability experimental
 */
export const NODE_STATUSES = ['online', 'draining', 'offline', 'disabled'] as const;

/**
 * `AdminNode.health`: DERIVED liveness, computed at read time and never
 * stored. Read alongside `status`, never instead of it.
 *
 * @stability experimental
 */
export const NODE_HEALTHS = ['healthy', 'stale', 'offline'] as const;

/**
 * The phase spans a node always relays, in the order a job runs them. The set
 * is closed on purpose (a node cannot mint arbitrary span names in the trace
 * store); an executor's own spans use the `job.app.<name>` shape instead
 * ({@link NODE_APP_SPAN_NAME_PATTERN}).
 *
 * @stability experimental
 */
export const BUILTIN_NODE_SPAN_NAMES = [
  'job.download',
  'job.execute',
  'job.upload',
  'job.submit',
  'job.secret',
] as const;

/**
 * What an executor's own span name must look like: `job.app.` and then a
 * lower-case name of 2 to 48 characters. The fixed prefix is the point: an
 * app span can never collide with a built-in phase or with another attribute
 * namespace, and the trace store's span-name cardinality is bounded by the
 * executors a deployment installs, not by what a node sends.
 *
 * @stability experimental
 */
export const NODE_APP_SPAN_NAME_PATTERN = /^job\.app\.[a-z][a-z0-9_.-]{1,47}$/;

/**
 * What an `extra` vital's key must look like: a lower-case letter, then 1 to
 * 47 lower-case letters, digits, `_` or `.`.
 *
 * @stability experimental
 */
export const NODE_VITALS_EXTRA_KEY_PATTERN = /^[a-z][a-z0-9_.]{1,47}$/;

/**
 * Most keys one heartbeat's `vitals.extra` may carry.
 *
 * @stability experimental
 */
export const MAX_NODE_VITALS_EXTRA_KEYS = 16;

/**
 * Largest magnitude of an `extra` vital. Generous (a quadrillion): the ceiling
 * keeps a number that is too large to be true out of the row, it is not a
 * statement about any real reading.
 *
 * @stability experimental
 */
export const MAX_NODE_VITALS_EXTRA_VALUE = 1e15;

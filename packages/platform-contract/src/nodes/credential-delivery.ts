// =============================================================================
// Nodes: provider-credential delivery to worker nodes (issue #1083)
// =============================================================================
//
// The wire shapes of OPT-IN node credential delivery: a deployment that turns
// `nodes.credentialDelivery.enabled` on (default OFF) and allowlists a
// registered purpose (`ai:openai`, `geo:google`) lets a worker node holding a
// live lease on a job that DECLARES the purpose ask for the organization's or
// the deployment's provider key, and cache it, encrypted, for at most
// `cacheTtlMinutes`. A user's own (BYOK) key is never delivered.
//
//   - `nodeCredentialDeliverySettingsSchema` and its wire twins: the
//     `credentialDelivery` branch of the `nodes` system-settings namespace.
//   - `nodeCredentialIssueRequestSchema` / `nodeCredentialIssueResponseSchema`:
//     `POST /api/nodes/:id/credentials/:purpose`. The response is the ONLY
//     place the material ever travels.
//   - `nodeCredentialDeliveryStateSchema`: what heartbeat and claim responses
//     carry so a node can invalidate its cache (epoch, TTL, rotation versions).
//
// ⚠ The capability is gated pending the platform rule amendment proposed in
// `docs/specs/worker-nodes.md` ("Provider credential delivery"). Defaults keep
// every provider key on the server.
// =============================================================================

import { z } from 'zod';

import { claimTokenField } from './schemas.js';

/**
 * What a node-credential purpose id looks like: `<namespace>:<name>`, both
 * lower case (`ai:openai`, `geo:google`, `ai:openai-compatible`). The
 * vocabulary is OPEN: a purpose is whatever an app or slice registers with
 * `registerNodeCredentialPurpose` (`@marinoscar/platform-api/nodes`).
 *
 * @stability experimental
 */
export const NODE_CREDENTIAL_PURPOSE_ID_PATTERN = /^[a-z][a-z0-9_-]{0,31}:[a-z0-9][a-z0-9_.-]{0,63}$/;

/**
 * Shortest node cache lifetime an administrator may choose, in minutes.
 *
 * @stability experimental
 */
export const MIN_NODE_CREDENTIAL_CACHE_TTL_MINUTES = 5;

/**
 * Longest node cache lifetime an administrator may choose, in minutes (four
 * hours). The bound is part of the proposed rule amendment.
 *
 * @stability experimental
 */
export const MAX_NODE_CREDENTIAL_CACHE_TTL_MINUTES = 240;

/**
 * The shipped node cache lifetime, in minutes.
 *
 * @stability experimental
 */
export const DEFAULT_NODE_CREDENTIAL_CACHE_TTL_MINUTES = 60;

/**
 * Most purposes the allowlist may hold.
 *
 * @stability experimental
 */
export const MAX_NODE_CREDENTIAL_PURPOSES = 50;

/**
 * Length of a credential `version`: 16 lowercase hex characters (a truncated
 * HMAC-SHA256). Not a secret.
 *
 * @stability experimental
 */
export const NODE_CREDENTIAL_VERSION_LENGTH = 16;

/**
 * The `details.reason` values of the issuance route's refusals. Each is
 * documented on the route; a client branches on these, never on the message.
 *
 * @stability experimental
 */
export const NODE_CREDENTIAL_DELIVERY_REFUSALS = {
  /** 409: `nodes.credentialDelivery.enabled` is off. */
  disabled: 'CREDENTIAL_DELIVERY_DISABLED',
  /** 404: the purpose is not registered, or not on the allowlist. */
  unknownPurpose: 'UNKNOWN_PURPOSE',
  /** 403: the job's type does not declare the purpose. */
  notDeclared: 'PURPOSE_NOT_DECLARED',
  /** 429: this node asked too often. */
  rateLimited: 'CREDENTIAL_RATE_LIMITED',
  /** 424: nothing is configured that could serve the purpose (org or deployment tier). */
  unavailable: 'CREDENTIAL_UNAVAILABLE',
} as const;

/**
 * The server-side feature flag a node finds in `serverFeatures` (register and
 * heartbeat) when this server implements credential delivery. Its presence
 * says nothing about whether the deployment has ENABLED it; the
 * `credentialDelivery` state on heartbeat and claim says that.
 *
 * @stability experimental
 */
export const NODE_SERVER_CAPABILITY_CREDENTIAL_DELIVERY = 'node_credential_delivery';

const purposeIdSchema = z.string().regex(NODE_CREDENTIAL_PURPOSE_ID_PATTERN);
const purposesSchema = z.array(purposeIdSchema).max(MAX_NODE_CREDENTIAL_PURPOSES);
const ttlSchema = z.number().int().min(MIN_NODE_CREDENTIAL_CACHE_TTL_MINUTES).max(MAX_NODE_CREDENTIAL_CACHE_TTL_MINUTES);
const epochSchema = z.number().int().min(1).max(2_147_483_647);

/**
 * The `credentialDelivery` branch of the `nodes` namespace, as stored.
 *
 * `enabled` is the master switch (only a literal `true` enables it; every
 * reader fails closed). `cacheTtlMinutes` bounds how long a node may keep a
 * delivered credential on disk. `purposes` is the allowlist: a purpose not on
 * it is never issued, whatever a handler declares. `epoch` is server-written:
 * "Revoke cached keys on all nodes" advances it, and a node drops every cached
 * entry when the epoch it sees CHANGES. Optional: a row written before #1083,
 * or a PUT that omits it, reads as epoch 1.
 *
 * @stability experimental
 */
export const nodeCredentialDeliverySettingsSchema = z.object({
  /** Master switch; off means no provider key ever leaves the server. */
  enabled: z.boolean(),
  /** Node cache lifetime per entry, in minutes (5 to 240). */
  cacheTtlMinutes: ttlSchema,
  /** The purposes that may be issued. */
  purposes: purposesSchema,
  /** Server-written invalidation epoch, advanced by revoke-all. */
  epoch: epochSchema.optional(),
});

/**
 * The stored `credentialDelivery` value.
 *
 * @stability experimental
 */
export type NodeCredentialDeliverySettings = z.infer<typeof nodeCredentialDeliverySettingsSchema>;

/**
 * The `credentialDelivery` branch of a `PUT /api/system-settings` body. The
 * `epoch` is accepted so a GET-then-PUT round trip keeps it; a PUT that drops
 * it resets it to 1, which a node treats as a change (and therefore wipes).
 *
 * @stability experimental
 */
export const nodeCredentialDeliveryPutSchema = nodeCredentialDeliverySettingsSchema;

/**
 * The `credentialDelivery` branch of a `PATCH /api/system-settings` body:
 * every field optional and NO `epoch` (it is server-written; advance it with
 * `POST /api/admin/nodes/credential-delivery/revoke-all`). An `epoch` sent here
 * is stripped.
 *
 * @stability experimental
 */
export const nodeCredentialDeliveryPatchSchema = z.object({
  /** Master switch. */
  enabled: z.boolean().optional(),
  /** Node cache lifetime per entry, in minutes. */
  cacheTtlMinutes: ttlSchema.optional(),
  /** The allowlist; replaces the stored one wholesale. */
  purposes: purposesSchema.optional(),
});

/**
 * The parsed `credentialDelivery` branch of a PATCH body.
 *
 * @stability experimental
 */
export type NodeCredentialDeliveryPatchInput = z.infer<typeof nodeCredentialDeliveryPatchSchema>;

/**
 * The `credentialDelivery` branch of the `GET /api/system-settings` response.
 *
 * @stability experimental
 */
export const nodeCredentialDeliveryResponseSchema = z.object({
  /** Master switch. */
  enabled: z.boolean(),
  /** Node cache lifetime per entry, in minutes. */
  cacheTtlMinutes: z.number(),
  /** The allowlist. */
  purposes: z.array(z.string()),
  /** Server-written invalidation epoch. */
  epoch: z.number().optional(),
});

/**
 * The body of `POST /api/nodes/:id/credentials/:purpose`: which held job the
 * credential is for, and (optionally) which claim of it is asking. Strict:
 * a node may not ask for a tier, an organization or a lifetime.
 *
 * @stability experimental
 */
export const nodeCredentialIssueRequestSchema = z
  .object({
    /** The job this node holds with a live lease, whose type declares the purpose. */
    jobId: z.uuid(),
    /** WHICH CLAIM is asking (the assignment's `claimToken`); optional. */
    claimToken: claimTokenField.optional(),
  })
  .strict();

/**
 * The parsed issuance request.
 *
 * @stability experimental
 */
export type NodeCredentialIssueRequest = z.infer<typeof nodeCredentialIssueRequestSchema>;

/**
 * The response of `POST /api/nodes/:id/credentials/:purpose`.
 *
 * ⚠ `material` IS THE SECRET (`{ apiKey }`, sometimes with non-secret
 * companions such as `baseUrl`). It is in this response and nowhere else on
 * the server: not stored, not logged, not audited. A node pins it in memory
 * for one job and may cache it, encrypted, until `expiresAt`, keyed by
 * `(purpose, orgId)` — the same purpose resolves to a different key in a
 * different organization.
 *
 * @stability experimental
 */
export const nodeCredentialIssueResponseSchema = z.object({
  /** The purpose issued. */
  purpose: z.string(),
  /** The organization the credential was resolved for (the job's), or `null` for a system job. */
  orgId: z.string().nullable(),
  /** The credential. String values only. */
  material: z.record(z.string(), z.string()),
  /** Non-secret rotation marker (16 hex); changes when the credential is rotated. */
  version: z.string().length(NODE_CREDENTIAL_VERSION_LENGTH),
  /** ISO 8601 issue time. */
  issuedAt: z.string(),
  /** ISO 8601 time the node must have deleted any cached copy (issue time + TTL). */
  expiresAt: z.string(),
  /** The deployment's invalidation epoch at issue time. */
  epoch: z.number().int(),
});

/**
 * The parsed issuance response.
 *
 * @stability experimental
 */
export type NodeCredentialIssueResponse = z.infer<typeof nodeCredentialIssueResponseSchema>;

/**
 * What heartbeat and claim responses carry as `credentialDelivery`, so a node
 * can keep its cache honest without asking.
 *
 * A node wipes everything when `enabled` is false, drops every entry when
 * `epoch` CHANGED since it last looked, drops an entry whose purpose is not in
 * `purposes`, clamps its local expiry to `ttlMinutes`, and drops a
 * system-scope entry (`orgId` null) whose version differs from
 * `versions[purpose]`. Versions are reported for the system scope only: an
 * organization-scoped entry is bounded by its TTL, the epoch and the
 * auth-failure re-acquire.
 *
 * @stability experimental
 */
export const nodeCredentialDeliveryStateSchema = z.object({
  /** Whether the deployment delivers credentials at all. */
  enabled: z.boolean(),
  /** The invalidation epoch. */
  epoch: z.number().int(),
  /** Cache lifetime per entry, in minutes. */
  ttlMinutes: z.number().int(),
  /** The allowlisted, registered purposes. Empty when disabled. */
  purposes: z.array(z.string()),
  /** System-scope credential versions by purpose (omitted when none resolves). */
  versions: z.record(z.string(), z.string()),
});

/**
 * The parsed delivery state.
 *
 * @stability experimental
 */
export type NodeCredentialDeliveryState = z.infer<typeof nodeCredentialDeliveryStateSchema>;

/**
 * The response of `POST /api/admin/nodes/credential-delivery/revoke-all`.
 *
 * @stability experimental
 */
export const nodeCredentialRevokeAllResponseSchema = z.object({
  /** The epoch now in force; nodes wipe their caches on the next heartbeat. */
  epoch: z.number().int(),
});

/**
 * The parsed revoke-all response.
 *
 * @stability experimental
 */
export type NodeCredentialRevokeAllResponse = z.infer<typeof nodeCredentialRevokeAllResponseSchema>;

// =============================================================================
// Node credential purposes: what a provider credential delivered to a worker
// node is FOR (issue #1083, rung 2)
// =============================================================================
//
// Opt-in provider-credential delivery lets a worker node holding a live lease
// on a job ask for the organization's or the deployment's provider key, so a
// keyed job type (AI tagging, Google reverse geocoding) can run on the fleet
// instead of on the API host. A PURPOSE names one such credential
// (`ai:openai`, `geo:google`) and says how to resolve it. The vocabulary is
// OPEN: a slice or an app registers its own with
// `registerNodeCredentialPurpose`, and nothing lists the ids by hand.
//
// A job type opts in by declaring `JobHandler.nodeCredentialPurposes`. Three
// independent decisions must ALL say yes before anything leaves the server:
//
//   1. the deployment enabled delivery (`nodes.credentialDelivery.enabled`,
//      default OFF) and allowlisted the purpose (`...purposes`);
//   2. the purpose is registered here;
//   3. the job type declares it, and the node holds a live lease on the job.
//
// With any one missing the type is withheld from the node plane at claim time
// (`NodeOffloadService.offeredTypes`) and the server runs it, exactly as
// before #1083: server-only is the fallback, never a failure.
//
// It lives in the jobs slice (and is re-exported by
// `@marinoscar/platform-api/nodes`) because the claim-time gate, which the
// jobs slice owns, must know whether a purpose is registered; the nodes slice
// depends on jobs, never the reverse.
//
// ⚠ The capability is gated pending the platform rule amendment proposed in
// `docs/specs/worker-nodes.md` ("Provider credential delivery").
// =============================================================================

import {
  DEFAULT_NODE_CREDENTIAL_CACHE_TTL_MINUTES,
  MAX_NODE_CREDENTIAL_CACHE_TTL_MINUTES,
  MAX_NODE_CREDENTIAL_PURPOSES,
  MIN_NODE_CREDENTIAL_CACHE_TTL_MINUTES,
  NODE_CREDENTIAL_PURPOSE_ID_PATTERN,
} from '@marinoscar/platform-contract/nodes';

import { defineRegistry, type Registry } from '../core/index';
import type { Job } from './data/jobs-db';

/**
 * A node credential purpose id (`ai:openai`): `<namespace>:<name>`, matching
 * `NODE_CREDENTIAL_PURPOSE_ID_PATTERN`. Open: whatever is registered.
 *
 * @stability experimental
 */
export type NodeCredentialPurposeId = string;

/**
 * What a purpose's `resolve` (and `version`) is handed.
 *
 * @stability experimental
 */
export interface NodeCredentialResolveContext {
  /** The organization to resolve for: the job's `orgId`, or `null` for a system job (and for the heartbeat's system-scope version). */
  readonly orgId: string | null;
  /** The job the credential is for, or `null` when only a version is wanted (heartbeat). */
  readonly job: Job | null;
  /**
   * A provider from the app's container, by class or token (`ModuleRef.get`
   * with `strict: false`). How a purpose reaches `CredentialsService`,
   * `OrgCredentialsService` or `AiKeyResolver` without being an injectable.
   */
  get<T>(token: unknown): T;
}

/**
 * What a purpose's `resolve` returns.
 *
 * ⚠ `material` IS THE SECRET. It goes into exactly one HTTP response and is
 * dropped: never stored, never logged. String values only.
 *
 * @stability experimental
 */
export interface ResolvedNodeCredential {
  /** The credential (`{ apiKey }`, optionally with non-secret companions such as `baseUrl`). */
  readonly material: Readonly<Record<string, string>>;
  /**
   * A NON-SECRET identifier that changes when the credential rotates, such as
   * `<credentialRowId>:<updatedAt ISO>`. Optional: when absent the version is
   * a keyed hash of the material. Either way the node sees only an HMAC.
   */
  readonly versionSource?: string;
}

/**
 * One deliverable provider credential.
 *
 * @example
 * ```ts
 * registerNodeCredentialPurpose({
 *   id: 'geo:google',
 *   label: 'Google Maps reverse geocoding',
 *   async resolve(ctx) {
 *     const apiKey = await ctx.get<CredentialsService>(CredentialsService).getSecret('geo', 'google');
 *     return apiKey ? { material: { apiKey } } : null;
 *   },
 * });
 * ```
 *
 * @stability experimental
 */
export interface NodeCredentialPurposeDefinition {
  /** Permanent id, `<namespace>:<name>`. */
  readonly id: NodeCredentialPurposeId;
  /** What the admin page calls it. */
  readonly label: string;
  /**
   * Resolve the credential for `ctx.orgId`, or `null` when nothing is
   * configured. MUST resolve the ORGANIZATION or DEPLOYMENT tier only: a
   * user's own (BYOK) key is never delivered to a node, unless the purpose
   * sets {@link allowUserTier} (no built-in purpose does). May throw; the
   * issuer reports any failure as `424 CREDENTIAL_UNAVAILABLE` without the
   * error's text.
   */
  resolve(ctx: NodeCredentialResolveContext): Promise<ResolvedNodeCredential | null>;
  /**
   * Explicit, reviewable opt-in to delivering a user-tier key. Default false;
   * the platform's own purposes never set it.
   */
  readonly allowUserTier?: boolean;
}

/**
 * Every registered node credential purpose, in registration order.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const nodeCredentialPurposeRegistry: Registry<NodeCredentialPurposeDefinition> = defineRegistry<NodeCredentialPurposeDefinition>({
  name: 'node-credential-purposes',
  idOf: (def) => def.id,
  idPattern: NODE_CREDENTIAL_PURPOSE_ID_PATTERN,
  validate: (def) => {
    if (typeof def.label !== 'string' || def.label.trim() === '') throw new Error('label is required');
    if (typeof def.resolve !== 'function') throw new Error('resolve must be a function');
    if (def.allowUserTier !== undefined && typeof def.allowUserTier !== 'boolean') throw new Error('allowUserTier must be a boolean');
  },
});

/**
 * Declares a provider credential a worker node may be delivered. Call it at
 * import time (an app's `app-registrations/`), before bootstrap. Registering
 * delivers nothing by itself: the deployment must also enable delivery and
 * allowlist the id, and a job type must declare it.
 *
 * @param def - the id, label and resolver.
 * @throws RegistryError `INVALID_ID`, `INVALID_ENTRY`, `DUPLICATE_ID` or `FROZEN`.
 *
 * @example
 * ```ts
 * registerNodeCredentialPurpose({ id: 'geo:google', label: 'Google geocoding', resolve: async () => null });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerNodeCredentialPurpose(def: NodeCredentialPurposeDefinition): void {
  nodeCredentialPurposeRegistry.register(def);
}

/**
 * The deployment's node-credential-delivery policy, as every reader sees it.
 *
 * @stability experimental
 */
export interface NodeCredentialDeliveryPolicy {
  /** Master switch. Fail-closed: only a stored literal `true` enables it. */
  readonly enabled: boolean;
  /** Node cache lifetime per entry, clamped to 5..240 minutes. */
  readonly cacheTtlMinutes: number;
  /** The allowlist (well-formed, de-duplicated ids only). */
  readonly purposes: readonly string[];
  /** The invalidation epoch, at least 1. */
  readonly epoch: number;
}

/**
 * The shipped policy: OFF, 60 minutes, nothing allowlisted, epoch 1.
 *
 * @stability experimental
 */
export const DEFAULT_NODE_CREDENTIAL_DELIVERY: Readonly<NodeCredentialDeliveryPolicy> = Object.freeze({
  enabled: false,
  cacheTtlMinutes: DEFAULT_NODE_CREDENTIAL_CACHE_TTL_MINUTES,
  purposes: Object.freeze([]) as readonly string[],
  epoch: 1,
});

/**
 * Reads `nodes.credentialDelivery` from a stored `nodes` value, FAILING
 * CLOSED: a missing branch, a non-boolean `enabled` or an unreadable value is
 * "off"; the TTL is clamped to the allowed range; a malformed purpose id is
 * dropped. One definition for the claim gate, the issuer, the heartbeat state
 * and the Doctor check.
 *
 * @param policy - the stored `nodes` value (any shape).
 * @returns the policy.
 *
 * @stability experimental
 */
export function readNodeCredentialDeliveryPolicy(policy: unknown): NodeCredentialDeliveryPolicy {
  const branch =
    policy && typeof policy === 'object' ? (policy as { credentialDelivery?: unknown }).credentialDelivery : undefined;

  if (!branch || typeof branch !== 'object') return DEFAULT_NODE_CREDENTIAL_DELIVERY;

  const raw = branch as { enabled?: unknown; cacheTtlMinutes?: unknown; purposes?: unknown; epoch?: unknown };
  const ttl =
    typeof raw.cacheTtlMinutes === 'number' && Number.isFinite(raw.cacheTtlMinutes)
      ? Math.min(MAX_NODE_CREDENTIAL_CACHE_TTL_MINUTES, Math.max(MIN_NODE_CREDENTIAL_CACHE_TTL_MINUTES, Math.floor(raw.cacheTtlMinutes)))
      : DEFAULT_NODE_CREDENTIAL_CACHE_TTL_MINUTES;
  const purposes = Array.isArray(raw.purposes)
    ? [...new Set(raw.purposes.filter((id): id is string => typeof id === 'string' && NODE_CREDENTIAL_PURPOSE_ID_PATTERN.test(id)))].slice(
        0,
        MAX_NODE_CREDENTIAL_PURPOSES,
      )
    : [];
  const epoch = typeof raw.epoch === 'number' && Number.isInteger(raw.epoch) && raw.epoch >= 1 ? raw.epoch : 1;

  return Object.freeze({ enabled: raw.enabled === true, cacheTtlMinutes: ttl, purposes: Object.freeze(purposes), epoch });
}

/**
 * Why a type that declares purposes may not run on a node right now, or
 * `null` when every declared purpose is deliverable. Pure.
 *
 * @param declared - the handler's `nodeCredentialPurposes`.
 * @param policy - the deployment's policy.
 * @param isRegistered - whether a purpose id is registered.
 * @returns the reason, or `null`.
 *
 * @stability experimental
 */
export function undeliverableReason(
  declared: readonly string[],
  policy: NodeCredentialDeliveryPolicy,
  isRegistered: (id: string) => boolean = (id) => nodeCredentialPurposeRegistry.get(id) !== undefined,
): string | null {
  if (declared.length === 0) return null;
  if (!policy.enabled) return 'nodes.credentialDelivery.enabled is off';
  for (const id of declared) {
    if (!policy.purposes.includes(id)) return `purpose "${id}" is not on the nodes.credentialDelivery.purposes allowlist`;
    if (!isRegistered(id)) return `purpose "${id}" is not registered (registerNodeCredentialPurpose)`;
  }
  return null;
}

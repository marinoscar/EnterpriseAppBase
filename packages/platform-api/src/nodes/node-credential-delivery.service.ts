// =============================================================================
// Node credential delivery: issue a provider credential to a worker node
// (issue #1083)
// =============================================================================
//
// OPT-IN, OFF BY DEFAULT. With `nodes.credentialDelivery.enabled` false (the
// shipped value) nothing here ever returns material: the issuance route
// refuses with 409 `CREDENTIAL_DELIVERY_DISABLED`, and every type declaring a
// purpose is withheld from the node plane at claim time
// (`NodeOffloadService.offeredTypes`), so the server runs it.
//
// When enabled, `POST /api/nodes/:id/credentials/:purpose` hands the node the
// ORGANIZATION's or the DEPLOYMENT's credential for one registered,
// allowlisted purpose, for a job the node holds with a live lease and whose
// type declares the purpose. Checks, in order, each its own `details.reason`:
//
//   0. the caller owns the node (403/404, as on every node route);
//   1. delivery enabled                         (409 CREDENTIAL_DELIVERY_DISABLED)
//   2. purpose registered AND allowlisted       (404 UNKNOWN_PURPOSE)
//   3. the node holds a live lease on the job   (409, `assertJobHeldByNode`)
//   4. the job's type declares the purpose      (403 PURPOSE_NOT_DECLARED)
//   5. per-node rate limit, 30 a minute         (429 CREDENTIAL_RATE_LIMITED)
//   6. the purpose resolves                     (424 CREDENTIAL_UNAVAILABLE)
//
// ⚠ THE MATERIAL IS IN EXACTLY ONE PLACE: the HTTP response. The audit
// (`node_credential_issuances`, an `audit_events` row `node_credential:issued`)
// records the purpose and a non-secret VERSION — an HMAC that changes on
// rotation — and nothing that could reproduce the key. No log line, span
// attribute, metric label or error body carries it; a resolver's thrown error
// is reported by NAME only, because a provider SDK may echo the key back.
//
// ⚠ Gated pending the platform rule amendment proposed in
// `docs/specs/worker-nodes.md` ("Provider credential delivery").
// =============================================================================

import { createHmac } from 'node:crypto';

import { ConflictException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, InternalServerErrorException, Logger, NotFoundException, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import {
  NODE_CREDENTIAL_DELIVERY_REFUSALS,
  NODE_CREDENTIAL_VERSION_LENGTH,
  type NodeCredentialDeliveryState,
  type NodeCredentialIssueRequest,
  type NodeCredentialIssueResponse,
  type NodeCredentialRevokeAllResponse,
} from '@marinoscar/platform-contract/nodes';

import { deriveSigningKey, PLATFORM_PRISMA } from '../core/index';
import {
  JobHandlerRegistry,
  nodeCredentialPurposeRegistry,
  readNodeCredentialDeliveryPolicy,
  type Job,
  type JobsInputJsonValue,
  type JobsPrisma,
  type JobsQueryArgs,
  type JobsTx,
  type NodeCredentialDeliveryPolicy,
  type NodeCredentialPurposeDefinition,
  type ResolvedNodeCredential,
} from '../jobs/index';
import { MetricsHostService } from '../otel-core/index';
import { SystemSettingsService } from '../settings/index';
import { NodesService } from './nodes.service';

/**
 * The signing domain of a credential `version` (`deriveSigningKey`). Permanent:
 * changing it changes every version and makes every node drop its cache once.
 *
 * @stability experimental
 */
export const NODE_CREDENTIAL_VERSION_KEY_PURPOSE = 'node-credential-version';

/**
 * Issuances one node may request per minute before `429`.
 *
 * @stability experimental
 */
export const NODE_CREDENTIAL_ISSUES_PER_MINUTE = 30;

/** How long the heartbeat's system-scope versions are reused, in ms. */
const VERSION_CACHE_MS = 30_000;

/** The audit actions this service writes. */
const AUDIT_ISSUED = 'node_credential:issued';
const AUDIT_REVOKE_ALL = 'node_credential:revoke_all';

/** The client this service needs: the jobs fragment plus `audit_events.create`. */
type DeliveryTx = JobsTx & { auditEvent: { create(args: JobsQueryArgs): Promise<unknown> } };
type DeliveryPrisma = { $transaction<T>(fn: (tx: DeliveryTx) => Promise<T>): Promise<T> };

/**
 * The version of a credential: HMAC-SHA256 under
 * `deriveSigningKey('node-credential-version')` of `purpose NUL source`, as 16 lowercase hex, where `source` is the purpose's
 * non-secret `versionSource`, or the canonical JSON of the material when it
 * gives none. Changes on rotation; cannot be reversed. Pure but for the key.
 *
 * @param purpose - the purpose id.
 * @param resolved - what the purpose resolved.
 * @returns the version.
 *
 * @stability experimental
 */
export function nodeCredentialVersion(purpose: string, resolved: ResolvedNodeCredential): string {
  const source =
    resolved.versionSource ??
    JSON.stringify(Object.keys(resolved.material).sort().map((key) => [key, resolved.material[key]]));
  return createHmac('sha256', deriveSigningKey(NODE_CREDENTIAL_VERSION_KEY_PURPOSE))
    .update(`${purpose}\u0000${source}`)
    .digest('hex')
    .slice(0, NODE_CREDENTIAL_VERSION_LENGTH);
}

/**
 * A fixed-window per-node limiter: at most `limit` calls per `windowMs`.
 * Process-local, like the telemetry relay's: a fleet spread over replicas gets
 * the limit per replica, which bounds abuse without a shared store.
 *
 * @stability experimental
 */
export class NodeCredentialRateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  /**
   * @param limit - calls allowed per window.
   * @param windowMs - the window, in ms.
   */
  constructor(
    private readonly limit = NODE_CREDENTIAL_ISSUES_PER_MINUTE,
    private readonly windowMs = 60_000,
  ) {}

  /**
   * Counts one call for `nodeId`.
   *
   * @param nodeId - the node.
   * @param now - the clock, in ms.
   * @returns whether the call is within the limit.
   */
  take(nodeId: string, now: number = Date.now()): boolean {
    const window = this.windows.get(nodeId);
    if (!window || now - window.start >= this.windowMs) {
      this.windows.set(nodeId, { start: now, count: 1 });
      if (this.windows.size > 10_000) this.prune(now);
      return true;
    }
    window.count += 1;
    return window.count <= this.limit;
  }

  private prune(now: number): void {
    for (const [id, window] of this.windows) if (now - window.start >= this.windowMs) this.windows.delete(id);
  }
}

/**
 * Issues provider credentials to worker nodes (opt-in), reports the delivery
 * state heartbeat and claim responses carry, and revokes every node's cache.
 *
 * @stability experimental
 */
@Injectable()
export class NodeCredentialDeliveryService {
  private readonly logger = new Logger(NodeCredentialDeliveryService.name);
  private readonly limiter = new NodeCredentialRateLimiter();
  private readonly metrics: MetricsHostService;
  private versionCache: { key: string; at: number; versions: Record<string, string> } | null = null;

  constructor(
    @Inject(PLATFORM_PRISMA) private readonly prisma: JobsPrisma,
    private readonly nodes: NodesService,
    private readonly registry: JobHandlerRegistry,
    private readonly settings: SystemSettingsService,
    private readonly moduleRef: ModuleRef,
    @Optional() metrics?: MetricsHostService,
  ) {
    this.metrics = metrics ?? new MetricsHostService();
  }

  /** The deployment's policy, fail closed (an unreadable row is "off"). */
  async policy(): Promise<NodeCredentialDeliveryPolicy> {
    try {
      return readNodeCredentialDeliveryPolicy(await this.settings.getNodesPolicy());
    } catch (error) {
      this.logger.warn(
        `Could not read nodes.credentialDelivery; treating delivery as off: ${error instanceof Error ? error.message : String(error)}`,
      );
      return readNodeCredentialDeliveryPolicy(null);
    }
  }

  /**
   * `POST /api/nodes/:id/credentials/:purpose`: the credential, once.
   *
   * @param userId - the caller (the node's owner).
   * @param nodeId - the node.
   * @param purpose - the purpose id from the path.
   * @param dto - the held job and, optionally, its claim token.
   * @returns the credential with its version and expiry.
   */
  async issue(userId: string, nodeId: string, purpose: string, dto: NodeCredentialIssueRequest): Promise<NodeCredentialIssueResponse> {
    return trace.getTracer('@marinoscar/platform-api/nodes').startActiveSpan('node.credential.issue', async (span) => {
      span.setAttribute('purpose', purpose);
      span.setAttribute('node.id', nodeId);
      try {
        const issued = await this.issueChecked(userId, nodeId, purpose, dto);
        span.setAttribute('version', issued.version);
        return issued;
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof HttpException ? `http_${error.getStatus()}` : 'error' });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  private async issueChecked(userId: string, nodeId: string, purpose: string, dto: NodeCredentialIssueRequest): Promise<NodeCredentialIssueResponse> {
    // 0. Ownership first, so a stranger learns nothing about this deployment.
    await this.nodes.getNode(userId, nodeId);

    // 1. Delivery enabled.
    const policy = await this.policy();
    if (!policy.enabled) {
      throw new ConflictException({
        message:
          'This deployment does not deliver provider credentials to worker nodes ' +
          '(nodes.credentialDelivery.enabled is off). Run the job on the server; this will not change on a retry.',
        details: { reason: NODE_CREDENTIAL_DELIVERY_REFUSALS.disabled, setting: 'nodes.credentialDelivery.enabled' },
      });
    }

    // 2. Registered and allowlisted.
    const definition = nodeCredentialPurposeRegistry.get(purpose);
    if (definition === undefined || !policy.purposes.includes(purpose)) {
      throw new NotFoundException({
        message: `"${purpose}" is not a node credential purpose this deployment delivers.`,
        details: { reason: NODE_CREDENTIAL_DELIVERY_REFUSALS.unknownPurpose, purpose },
      });
    }

    // 3. A live lease on the job (409 otherwise, as on every job-scoped route).
    const job = await this.nodes.assertJobHeldByNode(userId, nodeId, dto.jobId, dto.claimToken);

    // 4. The job's type declares the purpose.
    const declared = this.registry.get(job.type)?.nodeCredentialPurposes ?? [];
    if (!declared.includes(purpose)) {
      throw new ForbiddenException({
        message: `Job type "${job.type}" does not declare the node credential purpose "${purpose}".`,
        details: { reason: NODE_CREDENTIAL_DELIVERY_REFUSALS.notDeclared, purpose, type: job.type },
      });
    }

    // 5. Rate limit.
    if (!this.limiter.take(nodeId)) {
      throw new HttpException(
        {
          message: `Node ${nodeId} asked for credentials more than ${NODE_CREDENTIAL_ISSUES_PER_MINUTE} times a minute. Use the node cache.`,
          details: { reason: NODE_CREDENTIAL_DELIVERY_REFUSALS.rateLimited, limitPerMinute: NODE_CREDENTIAL_ISSUES_PER_MINUTE },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 6. Resolve (organization or deployment tier only).
    const resolved = await this.resolve(definition, job, job.orgId ?? null);
    if (resolved === null) {
      throw new HttpException(
        {
          message:
            `No organization or deployment credential is configured for "${purpose}". ` +
            'Report the job failed; it retries with the normal backoff.',
          details: { reason: NODE_CREDENTIAL_DELIVERY_REFUSALS.unavailable, purpose },
        },
        HttpStatus.FAILED_DEPENDENCY,
      );
    }

    const version = nodeCredentialVersion(purpose, resolved);
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + policy.cacheTtlMinutes * 60_000);

    try {
      await (this.prisma as unknown as DeliveryPrisma).$transaction(async (tx) => {
        await tx.nodeCredentialIssuance.create({ data: { nodeId, purpose, version, jobId: job.id, issuedAt, expiresAt } });
        await tx.auditEvent.create({
          data: {
            actorUserId: userId,
            action: AUDIT_ISSUED,
            targetType: 'worker_node',
            targetId: nodeId,
            meta: { purpose, version, jobId: job.id } as unknown as JobsInputJsonValue,
          },
        });
      });
    } catch (error) {
      // No audit, no delivery: the material is dropped here and never sent.
      this.logger.error(
        `Could not record the ${purpose} delivery to node ${nodeId} for job ${job.id}; nothing was delivered: ` +
          `${error instanceof Error ? error.name : 'Error'}`,
      );
      throw new InternalServerErrorException({
        message: 'The delivery could not be recorded, so nothing was delivered. Retry.',
        details: { reason: 'issuance_not_recorded', purpose },
      });
    }

    this.metrics.add('nodesCredentialsIssued', 1, { purpose });
    this.logger.log(`Delivered ${purpose} (version ${version}) to node ${nodeId} for job ${job.id}, cacheable until ${expiresAt.toISOString()}`);

    return {
      purpose,
      orgId: job.orgId ?? null,
      material: { ...resolved.material },
      version,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      epoch: policy.epoch,
    };
  }

  /**
   * What heartbeat and claim responses carry. NEVER THROWS: an unreadable
   * policy reads as disabled (a node then wipes its cache, the safe side), and
   * a purpose whose system-scope credential cannot be resolved is simply
   * absent from `versions`.
   */
  async deliveryState(): Promise<NodeCredentialDeliveryState> {
    const policy = await this.policy();
    if (!policy.enabled) {
      return { enabled: false, epoch: policy.epoch, ttlMinutes: policy.cacheTtlMinutes, purposes: [], versions: {} };
    }
    const purposes = policy.purposes.filter((id) => nodeCredentialPurposeRegistry.get(id) !== undefined);
    return { enabled: true, epoch: policy.epoch, ttlMinutes: policy.cacheTtlMinutes, purposes, versions: await this.systemVersions(purposes, policy.epoch) };
  }

  /**
   * `POST /api/admin/nodes/credential-delivery/revoke-all`: advance the epoch,
   * so every node wipes its cache on its next heartbeat. A credential already
   * pinned in a running job stays in that process until the job ends; real
   * revocation is rotating the key at the provider.
   *
   * @param userId - the administrator.
   * @returns the epoch now in force.
   */
  async revokeAll(userId: string): Promise<NodeCredentialRevokeAllResponse> {
    const current = await this.policy();
    const epoch = current.epoch + 1;
    await this.settings.patchSettings({ nodes: { credentialDelivery: { epoch } } } as never, userId);
    this.versionCache = null;
    await (this.prisma as unknown as DeliveryPrisma).$transaction(async (tx) => {
      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          action: AUDIT_REVOKE_ALL,
          targetType: 'system_settings',
          targetId: 'nodes.credentialDelivery',
          meta: { epoch } as unknown as JobsInputJsonValue,
        },
      });
    });
    this.logger.log(`Node credential caches revoked by ${userId}: epoch is now ${epoch}`);
    return { epoch };
  }

  /**
   * Resolves one purpose, converting any failure to `null` and refusing
   * anything that is not a non-empty string map. A thrown error is logged by
   * NAME only: a provider client may echo the key in its message.
   */
  private async resolve(definition: NodeCredentialPurposeDefinition, job: Job | null, orgId: string | null): Promise<ResolvedNodeCredential | null> {
    try {
      const resolved = await definition.resolve({
        orgId,
        job,
        get: <T>(token: unknown): T => this.moduleRef.get(token as never, { strict: false }) as T,
      });
      if (!resolved || typeof resolved.material !== 'object' || resolved.material === null) return null;
      const entries = Object.entries(resolved.material);
      if (entries.length === 0 || entries.some(([, value]) => typeof value !== 'string')) return null;
      return resolved;
    } catch (error) {
      this.logger.warn(
        `Node credential purpose ${definition.id} could not be resolved${orgId ? ` for organization ${orgId}` : ''} ` +
          `(${error instanceof Error ? error.name : 'Error'}); the message is withheld because it may carry key material.`,
      );
      return null;
    }
  }

  /** The system-scope (`orgId` null) versions, reused for {@link VERSION_CACHE_MS}. */
  private async systemVersions(purposes: readonly string[], epoch: number): Promise<Record<string, string>> {
    const key = `${epoch}|${purposes.join(',')}`;
    const now = Date.now();
    if (this.versionCache && this.versionCache.key === key && now - this.versionCache.at < VERSION_CACHE_MS) {
      return { ...this.versionCache.versions };
    }
    const versions: Record<string, string> = {};
    for (const id of purposes) {
      const definition = nodeCredentialPurposeRegistry.get(id);
      if (!definition) continue;
      const resolved = await this.resolve(definition, null, null);
      if (resolved) versions[id] = nodeCredentialVersion(id, resolved);
    }
    this.versionCache = { key, at: now, versions };
    return { ...versions };
  }
}

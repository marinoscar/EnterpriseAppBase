// =============================================================================
// The admin fleet's wire shapes (issue #270, epic #254)
// =============================================================================
//
// These are NOT `WorkerNodeDto` with extra fields, and the duplication is
// deliberate. `WorkerNodeDto` is what a WORKER NODE receives about itself: it
// crosses the boundary to an unattended machine this deployment may not own,
// and issue #268 chose every field on it with that in mind. The shapes here
// cross to an administrator's browser and carry two things a node must never
// be handed:
//
//   - `owner`, which names another user by email. A node credential resolves
//     to one user; telling a remote worker who else runs nodes here is an
//     enumeration of this deployment's operators for no operational purpose.
//   - `jobCounts`, which summarises the whole queue's state for that node.
//
// Merging the two classes would mean one `@ApiProperty` added in the wrong
// place publishes an operator's email to every worker in the fleet. Two
// classes make that a thing somebody has to do on purpose.
//
// `health` appears ONLY here, and it is DERIVED at read time by
// `deriveNodeHealth` — there is no `health` column and there must not be one.
// See `node-lifecycle.service.ts` for why a stored verdict is the same bug
// this issue exists to fix, one layer up.
// =============================================================================

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  AdminNode,
  AdminNodeCredential,
  NodeHealth,
  NodeJobCounts,
  NodeOwner,
  NodeStatus,
  NodeVitals,
  NodeVitalsCounters,
} from '@marinoscar/platform-contract/nodes';

// Each class below `implements` the contract type of the same name
// (`@marinoscar/platform-contract/nodes`, `admin-schemas.ts`): the Swagger
// decorators stay here (they are what the generated OpenAPI document is made
// of, and it must not move), while a field added to or retyped in the schema
// is a compile error on the class until the two agree again.

/**
 * Who registered a node or minted a credential.
 *
 * @stability experimental
 */
export class NodeOwnerDto implements NodeOwner {
  /** User ID (UUID) */
  @ApiProperty({ description: 'User ID (UUID)' })
  id!: string;

  /** Email address */
  @ApiProperty({ description: 'Email address' })
  email!: string;

  /** Display name, when the account has one */
  @ApiPropertyOptional({ description: 'Display name, when the account has one', nullable: true })
  name!: string | null;
}

/**
 * How many jobs a node currently has in each state.
 *
 * The four keys are always present and always numbers, zero included. A sparse
 * map would make the fleet page write `counts.running ?? 0` at every use, and
 * the first place somebody forgot would render an empty cell for a node with
 * no running jobs — indistinguishable from a node whose count failed to load.
 *
 * @stability experimental
 */
export class NodeJobCountsDto implements NodeJobCounts {
  /** Jobs this node holds right now */
  @ApiProperty({ description: 'Jobs this node holds right now' })
  running!: number;

  /** Jobs assigned to this node and not yet started */
  @ApiProperty({ description: 'Jobs assigned to this node and not yet started' })
  pending!: number;

  /** Jobs this node completed successfully */
  @ApiProperty({ description: 'Jobs this node completed successfully' })
  succeeded!: number;

  /** Jobs this node failed */
  @ApiProperty({ description: 'Jobs this node failed' })
  failed!: number;

  /** The sum of the four counts above */
  @ApiProperty({ description: 'The sum of the four counts above' })
  total!: number;
}

/**
 * A node's cumulative counters since its process started (#604). Reset when
 * the node restarts, so a drop is a restart, not a correction.
 *
 * @stability experimental
 */
export class NodeVitalsCountersDto implements NodeVitalsCounters {
  /** Claim calls that returned at least one job */
  @ApiPropertyOptional({ description: 'Claim calls that returned at least one job' })
  claims?: number;

  /** Claim calls that returned no jobs */
  @ApiPropertyOptional({ description: 'Claim calls that returned no jobs' })
  emptyPolls?: number;

  /** Claim calls that failed */
  @ApiPropertyOptional({ description: 'Claim calls that failed' })
  claimFailures?: number;

  /** Jobs this process completed successfully */
  @ApiPropertyOptional({ description: 'Jobs this process completed successfully' })
  succeeded?: number;

  /** Jobs this process reported as failed */
  @ApiPropertyOptional({ description: 'Jobs this process reported as failed' })
  failed?: number;

  /** Jobs this process reported as rate-limited */
  @ApiPropertyOptional({ description: 'Jobs this process reported as rate-limited' })
  rateLimited?: number;

  /** Successful lease renewals */
  @ApiPropertyOptional({ description: 'Successful lease renewals' })
  leaseRenewals?: number;

  /** Lease renewals that failed */
  @ApiPropertyOptional({ description: 'Lease renewals that failed' })
  leaseRenewFailures?: number;

  /** Heartbeats that failed */
  @ApiPropertyOptional({ description: 'Heartbeats that failed' })
  heartbeatFailures?: number;

  /** Times the node’s job watchdog aborted a job */
  @ApiPropertyOptional({ description: 'Times the node’s job watchdog aborted a job' })
  watchdogTrips?: number;
}

/**
 * The last health snapshot a node reported on its heartbeat (#604).
 *
 * SELF-REPORTED AND UNTRUSTED: validated and bounded on the way in
 * (`nodeVitalsSchema` in `node-control-plane.dto.ts`), but never used for a
 * scheduling decision — display only. Every field is optional; a node reports
 * what it can measure.
 *
 * @stability experimental
 */
export class NodeVitalsDto implements NodeVitals {
  /** Process CPU over the last interval; 100 = one full core */
  @ApiPropertyOptional({
    description: 'Process CPU over the last interval; 100 = one full core',
    maximum: 12800,
  })
  cpuPercent?: number;

  /** Resident set size, bytes */
  @ApiPropertyOptional({ description: 'Resident set size, bytes' })
  rssBytes?: number;

  /** V8 heap in use, bytes */
  @ApiPropertyOptional({ description: 'V8 heap in use, bytes' })
  heapUsedBytes?: number;

  /** V8 heap limit, bytes */
  @ApiPropertyOptional({ description: 'V8 heap limit, bytes' })
  heapLimitBytes?: number;

  /** Event-loop delay p99 over the last interval, milliseconds */
  @ApiPropertyOptional({ description: 'Event-loop delay p99 over the last interval, milliseconds' })
  eventLoopDelayP99Ms?: number;

  /** Free bytes on the filesystem holding the node’s state directory */
  @ApiPropertyOptional({
    description: 'Free bytes on the filesystem holding the node’s state directory',
  })
  stateDirFreeBytes?: number;

  /** Total bytes on the filesystem holding the node’s state directory */
  @ApiPropertyOptional({
    description: 'Total bytes on the filesystem holding the node’s state directory',
  })
  stateDirTotalBytes?: number;

  /** Job slots in use */
  @ApiPropertyOptional({ description: 'Job slots in use', maximum: 64 })
  slotsUsed?: number;

  /** Job slots available in total */
  @ApiPropertyOptional({ description: 'Job slots available in total', maximum: 64 })
  slotsTotal?: number;

  /** Node process uptime, seconds */
  @ApiPropertyOptional({ description: 'Node process uptime, seconds' })
  uptimeSeconds?: number;

  /** Cumulative counters since the node process started */
  @ApiPropertyOptional({
    description: 'Cumulative counters since the node process started',
    type: NodeVitalsCountersDto,
  })
  counters?: NodeVitalsCountersDto;

  /** The node CLI’s version */
  @ApiPropertyOptional({ description: 'The node CLI’s version', maxLength: 64 })
  cliVersion?: string;

  /** The Node.js runtime version */
  @ApiPropertyOptional({ description: 'The Node.js runtime version', maxLength: 64 })
  nodeVersion?: string;

  /** The `pg_dump` version on the node, when it has one */
  @ApiPropertyOptional({
    description: 'The `pg_dump` version on the node, when it has one',
    maxLength: 64,
  })
  pgDumpVersion?: string;
}

/**
 * One node as the admin fleet page sees it.
 *
 * @stability experimental
 */
export class AdminNodeDto implements AdminNode {
  /** Node ID (UUID) */
  @ApiProperty({ description: 'Node ID (UUID)' })
  id!: string;

  /** Operator-chosen name, unique per owner */
  @ApiProperty({ description: 'Operator-chosen name, unique per owner' })
  name!: string;

  /** Self-reported host name */
  @ApiProperty({ description: 'Self-reported host name' })
  hostname!: string;

  /** Self-reported platform (e.g. */
  @ApiProperty({ description: 'Self-reported platform (e.g. `linux-x64`)' })
  platform!: string;

  /** Self-reported CLI version */
  @ApiProperty({ description: 'Self-reported CLI version' })
  cliVersion!: string;

  /** The job types this node declared it can run */
  @ApiProperty({ description: 'The job types this node declared it can run', type: [String] })
  eligibleTypes!: string[];

  /** The node’s declared concurrency ceiling */
  @ApiProperty({ description: 'The node’s declared concurrency ceiling' })
  concurrency!: number;

  /** Operator/administrative state — NOT liveness. */
  @ApiProperty({
    description:
      'Operator/administrative state — NOT liveness. `disabled` refuses this node’s claims; ' +
      '`draining` lets it finish what it holds and claim nothing new. A node reaches `offline` ' +
      'either by deregistering gracefully or by being swept there after it stopped heartbeating.',
    enum: ['online', 'draining', 'offline', 'disabled'],
  })
  status!: NodeStatus;

  /** DERIVED liveness, computed from `lastHeartbeatAt` at read time and never stored. */
  @ApiProperty({
    description:
      'DERIVED liveness, computed from `lastHeartbeatAt` at read time and never stored. ' +
      '`offline` when the status already says so; `healthy` when the last heartbeat is inside ' +
      'the `nodes.staleHeartbeatSeconds` window; `stale` otherwise — including a node that has ' +
      'never heartbeated at all. Read alongside `status`, not instead of it: a `disabled` node ' +
      'that is still heartbeating is both disabled and healthy.',
    enum: ['healthy', 'stale', 'offline'],
  })
  health!: NodeHealth;

  /** The node’s last self-reported capability summary, or `null` */
  @ApiPropertyOptional({
    description: 'The node’s last self-reported capability summary, or `null`',
    nullable: true,
    type: Object,
  })
  capabilities!: unknown;

  /** ISO 8601 timestamp of first registration */
  @ApiProperty({ description: 'ISO 8601 timestamp of first registration' })
  registeredAt!: string;

  /** ISO 8601 timestamp of the last heartbeat, or `null` if it has never sent one */
  @ApiPropertyOptional({
    description: 'ISO 8601 timestamp of the last heartbeat, or `null` if it has never sent one',
    nullable: true,
  })
  lastHeartbeatAt!: string | null;

  /** The last health snapshot the node reported on a heartbeat, or `null` if it has never reported one. */
  @ApiPropertyOptional({
    description:
      'The last health snapshot the node reported on a heartbeat, or `null` if it has never ' +
      'reported one. Self-reported and bounded, never trusted for scheduling; kept until the ' +
      'next heartbeat that carries vitals replaces it.',
    nullable: true,
    type: NodeVitalsDto,
  })
  lastVitals!: NodeVitalsDto | null;

  /** ISO 8601 server timestamp of the heartbeat that carried `lastVitals`, or `null`. */
  @ApiPropertyOptional({
    description:
      'ISO 8601 server timestamp of the heartbeat that carried `lastVitals`, or `null`. ' +
      'Compare with `lastHeartbeatAt`: a node that heartbeats without vitals keeps an ageing snapshot.',
    nullable: true,
  })
  lastVitalsAt!: string | null;

  /** The user who registered this node */
  @ApiProperty({ description: 'The user who registered this node', type: NodeOwnerDto })
  owner!: NodeOwnerDto;

  /** This node’s job counts by status */
  @ApiProperty({ description: 'This node’s job counts by status', type: NodeJobCountsDto })
  jobCounts!: NodeJobCountsDto;
}

/**
 * One credential as the admin credential list sees it.
 *
 * Same omissions as `NodeCredentialListItemDto` and for the same reasons —
 * never `token`, never `tokenHash` — plus `owner`, which is the entire reason
 * this surface exists: an administrator auditing long-lived worker tokens
 * needs to know whose they are.
 *
 * @stability experimental
 */
export class AdminNodeCredentialDto implements AdminNodeCredential {
  /** Credential ID (UUID) */
  @ApiProperty({ description: 'Credential ID (UUID)' })
  id!: string;

  /** Operator-chosen label for this credential */
  @ApiProperty({ description: 'Operator-chosen label for this credential' })
  name!: string;

  /** Non-secret display prefix (e.g. */
  @ApiProperty({ description: 'Non-secret display prefix (e.g. `nod_1a2b`)' })
  tokenPrefix!: string;

  /** ISO 8601 expiry timestamp, or `null` when this credential never expires */
  @ApiPropertyOptional({
    description: 'ISO 8601 expiry timestamp, or `null` when this credential never expires',
    nullable: true,
  })
  expiresAt!: string | null;

  /** ISO 8601 timestamp of the last successful authentication, or `null` */
  @ApiPropertyOptional({
    description: 'ISO 8601 timestamp of the last successful authentication, or `null`',
    nullable: true,
  })
  lastUsedAt!: string | null;

  /** ISO 8601 creation timestamp */
  @ApiProperty({ description: 'ISO 8601 creation timestamp' })
  createdAt!: string;

  /** ISO 8601 revocation timestamp, or `null` while the credential is active */
  @ApiPropertyOptional({
    description: 'ISO 8601 revocation timestamp, or `null` while the credential is active',
    nullable: true,
  })
  revokedAt!: string | null;

  /** The user this credential authenticates as */
  @ApiProperty({ description: 'The user this credential authenticates as', type: NodeOwnerDto })
  owner!: NodeOwnerDto;
}

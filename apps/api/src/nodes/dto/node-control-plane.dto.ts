// =============================================================================
// The node control plane's request bodies (issue #268, epic #254)
// =============================================================================
//
// SIX BODIES IN ONE FILE, deliberately, where `create-node-credential.dto.ts`
// beside it is one body in one file. These six are not six independent
// shapes; they are one CONVERSATION between a worker node and this server —
// register, heartbeat, claim, renew, result, failure — and every one of the
// limits below (`MAX_NODE_CONCURRENCY`, the type-list caps, the error length)
// has to be the same number in more than one of them or the conversation
// develops a step that accepts what an earlier step refused. Split across six
// files, those shared constants become six imports nobody keeps aligned;
// together, a change to the concurrency ceiling is one line that every body
// sees — and `claimToken` below is the same argument in its strongest form:
// ONE field definition reaching the three bodies that end an assignment, so
// "renew accepts a token but failure silently ignores it" is unwritable.
//
// -----------------------------------------------------------------------------
// EVERY FIELD HERE ARRIVES FROM A MACHINE THIS DEPLOYMENT MAY NOT OWN
// -----------------------------------------------------------------------------
//
// That is the whole reason these schemas are as tight as they are. A node is
// authenticated (a `nod_` credential resolves to its owner) but it is not
// TRUSTED in the sense a first-party service is: it runs unattended on
// somebody's spare box, its config file is editable by whoever has that box,
// and the numbers it reports about itself go straight into a row this server
// then makes scheduling decisions from. So:
//
//   - `concurrency` is bounded because it becomes the CLAIM LIMIT. An
//     unbounded value is a node that asks for every runnable row in the queue
//     in one call and holds all of them under one lease — a fleet-wide denial
//     of service written as a config typo.
//   - `eligibleTypes` is bounded in both length and element size because it
//     is stored as an array column and then used as a `text[]` parameter in
//     the claim's `type = ANY(...)`.
//   - `error` is bounded because it lands in `Job.lastError`, which the admin
//     job list renders. `JobTerminalService` truncates too, at 2000 — the
//     same number on purpose, so the wire limit and the storage limit cannot
//     disagree about what "too long" means.
//
// -----------------------------------------------------------------------------
// WHAT IS DELIBERATELY *NOT* IN ANY OF THESE BODIES
// -----------------------------------------------------------------------------
//
// REJECTED: a node-supplied `leaseMs` on claim or renew. It reads as
// courteous — the node knows how long its work takes — and it hands the one
// safety property the lease exists for to the least trustworthy participant.
// A node that asks for a 24-hour lease parks every row it claims for a day:
// the reaper (#263) will not touch a live lease, so a node that then dies
// takes its jobs with it until tomorrow, and nothing in the fleet looks
// broken while it happens. The lease is DERIVED on the server from
// `JOBS_JOB_TIMEOUT_MS` (`resolveJobLeaseMs`), identically for both
// executors, and a node cannot influence it.
//
// REJECTED: a node-supplied `status: 'disabled' | 'draining'` on heartbeat.
// Those two are operator decisions — see `WorkerNode.status` in
// `schema.prisma` — and a node that could report them could also report its
// way out of them. The union below is the two states a node may claim about
// itself, and `NodesService.heartbeat` additionally refuses to let even those
// overwrite an operator's `disabled`/`draining`.
//
// REJECTED: `willRetry` being anything but advisory. It is accepted (a node
// that has just read a provider's response often does know) and it is never
// acted on: the server's attempt budget decides, in `JobTerminalService`,
// because a node that could dictate "retry me" could retry itself forever
// past a budget that exists precisely to bound a job nobody is watching.
// =============================================================================

import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Ceiling on a node's declared `concurrency`, and therefore on how many rows
 * one claim call can take.
 *
 * 64 is not a hardware estimate — it is the point past which "this node is
 * mis-declared" is more likely than "this node really can run that many
 * jobs at once". A real box that can genuinely run more registers as two
 * nodes, which the fleet page can then see and drain independently.
 */
export const MAX_NODE_CONCURRENCY = 64;

/** Cap on how many job types one node may declare. */
export const MAX_NODE_ELIGIBLE_TYPES = 100;

/** Cap on one job-type string, matching what a handler `type` key ever is. */
const MAX_TYPE_LENGTH = 200;

/**
 * Cap on a node-reported failure message.
 *
 * The same 2000 as `MAX_LAST_ERROR_LENGTH` in `job-terminal.service.ts`, and
 * that is the point: the terminal service truncates whatever it is given, so
 * a larger limit here would only mean accepting bytes that are guaranteed to
 * be thrown away, and a smaller one would reject messages the storage layer
 * would have kept.
 */
const MAX_ERROR_LENGTH = 2000;

/** A non-empty, bounded job-type key. */
const jobType = z.string().trim().min(1).max(MAX_TYPE_LENGTH);

/**
 * THE CLAIM THIS MESSAGE IS ABOUT — `jobs.claim_token`, handed to the node in
 * the claim response and quoted back here (#364).
 *
 * WHY A NODE ID IS NOT ENOUGH, which is the whole of this field. Every guard
 * on the three endpoints that end an assignment — renew, result, failure —
 * used to identify the caller by `claimedByNodeId` alone, which tells one node
 * from another and NOT ONE NODE FROM ITSELF. A node that claims job J, stalls
 * past its lease, is reaped, and then claims J again in a second worker slot
 * has two live tickers quoting the same node id: the first slot's renewal
 * extends the SECOND slot's lease (so a dead second slot is reaped late, for
 * as long as the first keeps ticking), and worse, the first slot's result or
 * failure settles a job its own later claim is still running. The token is
 * minted per row by the claim statement, so those two claims carry different
 * tokens and the stale one is refused.
 *
 * ⚠ OPTIONAL ON THE WIRE, AND THAT IS LOAD-BEARING, not politeness. A fleet
 * is upgraded one machine at a time; a node running older CLI code omits this
 * field, and the server must then behave EXACTLY as it did before — the node
 * id and the lease alone — rather than 400 the request or 409 the job. Same
 * posture as `renewIntervalMs` in #347: additive, ignorable, strictly better
 * when present. The residual ambiguity above stays open for that node until
 * it is upgraded, which is a rolling-upgrade window rather than a new hole.
 *
 * ⚠ OMITTED MUST STAY `undefined` AND MUST NOT BECOME `null`. Downstream this
 * value reaches `heldLeaseWhere`, where the two mean opposite things:
 * `undefined` drops the clause entirely ("I am not asserting a claim"), while
 * `null` matches `claim_token IS NULL` ("I assert this row carries no token").
 * `.optional()` with no `.nullable()` is what keeps them apart — a body that
 * spells the key as `null` is refused rather than silently reinterpreted as
 * the other statement.
 *
 * Validated as a uuid rather than as any bounded string because the column is
 * `uuid`: a garbage value reaching a `where` clause is a Postgres cast error
 * (a 500 about "inconsistent column data"), and a clean 400 naming the field
 * is a better answer to a malformed token than a 500 is.
 */
const claimToken = z.uuid();

/**
 * The node's self-reported capability bag.
 *
 * `Record<string, unknown>` and nothing narrower, mirroring
 * `WorkerNode.capabilities` being JSONB: the shape is the FLEET PAGE's
 * business (#276), not this server's, and pinning it here would mean a node
 * that learns to report one new fact needs an API deploy before it may say
 * so. Depth and size are bounded by the global body-size limit, not by this
 * schema.
 */
const capabilities = z.record(z.string(), z.unknown());

// =============================================================================
// POST /nodes/register
// =============================================================================

export const registerNodeSchema = z.object({
  /**
   * THE IDENTITY HALF OF `@@unique([createdById, name])`. Two registrations
   * with the same name from the same owner are the SAME node — see
   * `NodesService.register`. This is why a node's name belongs in its config
   * file rather than being generated at startup: a generated name makes every
   * container restart a new node row.
   */
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name must be 100 characters or less'),

  hostname: z.string().trim().min(1).max(255),
  platform: z.string().trim().min(1).max(100),
  cliVersion: z.string().trim().min(1).max(50),

  /**
   * The job types this node can run. An EMPTY LIST IS LEGAL and means "I can
   * run nothing yet" — a node that registers before its handlers are
   * configured is a real state, and refusing it would push the operator
   * toward declaring a type the node cannot actually execute.
   */
  eligibleTypes: z.array(jobType).max(MAX_NODE_ELIGIBLE_TYPES).default([]),

  concurrency: z
    .number()
    .int('Concurrency must be a whole number')
    .min(1, 'Concurrency must be at least 1')
    .max(MAX_NODE_CONCURRENCY, `Concurrency must be at most ${MAX_NODE_CONCURRENCY}`),

  capabilities: capabilities.optional(),
});

export class RegisterNodeDto extends createZodDto(registerNodeSchema) {}

// =============================================================================
// POST /nodes/:id/heartbeat
// =============================================================================

export const heartbeatNodeSchema = z.object({
  /**
   * The two states a node may report ABOUT ITSELF. `draining` and `disabled`
   * are absent on purpose — see the file header.
   */
  status: z.enum(['online', 'offline']).optional(),

  /**
   * A runtime concurrency change (`appctl node set-concurrency`), which the
   * NEXT claim reads live off the row. This is the whole reason the claim
   * endpoint re-reads the node rather than trusting a value captured at
   * registration.
   */
  concurrency: z.number().int().min(1).max(MAX_NODE_CONCURRENCY).optional(),

  capabilities: capabilities.optional(),
});

export class HeartbeatNodeDto extends createZodDto(heartbeatNodeSchema) {}

// =============================================================================
// POST /nodes/:id/claim
// =============================================================================

export const claimJobsSchema = z.object({
  /**
   * Which of the node's own types it wants right now — a node with free
   * slots for one type and none for another. OMITTED means "anything I
   * declared", which is the common case.
   *
   * NARROWING ONLY. `NodesService.claimJobs` intersects this with the row's
   * `eligibleTypes`; a type here that the node never registered is dropped,
   * not honoured.
   */
  types: z.array(jobType).max(MAX_NODE_ELIGIBLE_TYPES).optional(),

  /**
   * How many rows to take. CLAMPED DOWN to the node's declared
   * `concurrency`; a larger number is not an error, it is simply capped —
   * a node asking for more than it declared is describing free slots it does
   * not have, and refusing the whole call would stall a fleet over an
   * arithmetic disagreement.
   */
  limit: z.number().int().min(1).max(MAX_NODE_CONCURRENCY).optional(),
});

export class ClaimJobsDto extends createZodDto(claimJobsSchema) {}

// =============================================================================
// POST /nodes/:id/jobs/:jobId/renew
// =============================================================================

/**
 * ⚠ THIS BODY EXISTS TO CARRY ONE OPTIONAL FIELD, AND IT MUST SURVIVE HAVING
 * NO BODY AT ALL (#364).
 *
 * Until this change the renew route took no body, so every node in every fleet
 * posts to it with no payload and no `Content-Type` — Fastify hands Nest
 * `undefined`, and a bare `z.object({...})` would reject that outright and
 * fail every renewal from every node that has not been upgraded yet. `.default({})`
 * is what makes "no body" parse to "no assertion", which is the pre-#364
 * behaviour spelled as data. It is the only reason this is a `ZodDefault` and
 * not a plain object schema; do not unwrap it.
 *
 * REJECTED: coercing a `null` body to `{}` as well. That would quietly turn
 * "I assert this row has no token" into "I assert nothing", and those are
 * different statements at the `where` clause (see `claimToken` above).
 */
export const renewLeaseSchema = z
  .object({
    claimToken: claimToken.optional(),
  })
  .default({});

export class RenewLeaseDto extends createZodDto(renewLeaseSchema) {}

// =============================================================================
// POST /nodes/:id/jobs/:jobId/result
// =============================================================================

export const nodeJobResultSchema = z.object({
  /**
   * The job type this result is FOR, checked against the row's own `type`
   * before anything is parsed or persisted.
   *
   * It is redundant with the row — which is the point. A node holding two
   * jobs at once and crossing their ids would otherwise post job A's result
   * against job B, and the only thing standing between that and a persisted,
   * plausible, permanently wrong row would be whether B's schema happened to
   * reject A's payload. Two IDs agreeing is a coincidence; an id and a type
   * agreeing is a statement.
   */
  type: jobType,

  /**
   * The computed result, UNVALIDATED at this layer on purpose.
   *
   * The real validation is `handler.nodeResultSchema`, resolved per job type
   * at runtime and applied manually in `NodesService.submitResult` — the
   * global Zod pipe cannot do it, because which schema applies is not known
   * until the job row has been read. Typing it `unknown` here rather than
   * `Record<string, unknown>` also keeps a handler free to accept a bare
   * array or scalar result if that is what its work produces.
   */
  result: z.unknown(),

  /**
   * WHICH CLAIM computed this result — see `claimToken` above.
   *
   * It matters MORE here than on renew, not less: a stale slot's renewal only
   * delays the reaper, while a stale slot's RESULT settles a job its own later
   * claim is still running, persisting output computed against an earlier
   * attempt over a newer run. Optional for the same rolling-upgrade reason.
   */
  claimToken: claimToken.optional(),
});

export class NodeJobResultDto extends createZodDto(nodeJobResultSchema) {}

// =============================================================================
// POST /nodes/:id/jobs/:jobId/failure
// =============================================================================

export const nodeJobFailureSchema = z.object({
  /** What went wrong, in the words that will appear in `Job.lastError`. */
  error: z.string().trim().min(1, 'An error message is required').max(MAX_ERROR_LENGTH),

  /**
   * "A provider throttled me." Treated IDENTICALLY to a `RateLimitError`
   * thrown by an in-process handler — see `job-terminal.service.ts`'s header
   * on why a flag and a throw must reach the same conclusion.
   */
  rateLimited: z.boolean().optional(),

  /** A provider-requested delay in milliseconds; a FLOOR on the backoff, not an override. */
  retryAfterMs: z
    .number()
    .int()
    .min(0)
    // One day. Past this, a "retry after" is a bug in whatever produced it,
    // and honouring it would park a job for longer than most deployments
    // keep their history.
    .max(86_400_000)
    .optional(),

  /**
   * ADVISORY ONLY, and accepted only so a node can say what it believes.
   * The server's attempt budget decides; see the file header.
   */
  willRetry: z.boolean().optional(),

  /**
   * WHICH CLAIM failed — see `claimToken` above.
   *
   * Threaded here as well as on `result` because a failure is just as terminal:
   * an old slot reporting "boom" settles the row (or charges an attempt against
   * it) while a newer claim of the same job is still running fine. Optional for
   * the same rolling-upgrade reason.
   */
  claimToken: claimToken.optional(),
});

export class NodeJobFailureDto extends createZodDto(nodeJobFailureSchema) {}

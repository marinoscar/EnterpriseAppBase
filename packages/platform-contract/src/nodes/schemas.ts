// =============================================================================
// Nodes: the node routes' request shapes (issue #734, PP-8.2)
// =============================================================================
//
// The node control plane (`register`, `heartbeat`, `claim`, `renew`, `result`,
// `fail`), the data plane's two URL mints, the per-job secret request and the
// node credential mint, as zod schemas. Moved verbatim (comments included)
// from `@marinoscar/platform-api/nodes`'s dto files, which wrap these with
// `createZodDto`; the response shapes stay there as Swagger classes. The
// node runner of `@marinoscar/platform-cli` sends exactly these bodies.
// =============================================================================

import { z } from 'zod';

import { MAX_NODE_CONCURRENCY, MAX_NODE_CREDENTIAL_DAYS, MAX_NODE_ELIGIBLE_TYPES } from './constants.js';

/**
 * The entries of the status a node may report about itself.
 *
 * @stability experimental
 */
export type NodeReportedStatusEnum = { [K in 'online' | 'offline']: K };

// -----------------------------------------------------------------------------
// From claim-token.field.ts: The claim token, as a node quotes it back (issue #364, epic #254)
// -----------------------------------------------------------------------------
// =============================================================================
// The claim token, as a node quotes it back (issue #364, epic #254)
// =============================================================================
//
// ONE FIELD IN ONE FILE, which in this folder needs a reason — the file beside
// it argues at length for keeping SIX request bodies together. The reason is
// that this field is not part of any one of those conversations: it is the
// same sentence spoken on SIX ROUTES ACROSS THREE DTO FILES — renew, result
// and failure (`node-control-plane.dto.ts`), download-url and upload-url
// (`node-data-plane.dto.ts`), and secret (`node-job-secret.dto.ts`) — and the
// one thing that must never differ between them is what that sentence means.
// Copied six times it drifts exactly once, in the direction that costs the
// most: somebody makes it `.nullable()` on one route to accommodate a client
// that serialises absent fields as `null`, and on that route alone a node
// asserting "no token" starts matching `claim_token IS NULL` instead of being
// refused.
//
// The alternative was exporting it from `node-control-plane.dto.ts`, and it is
// rejected for what it would say rather than what it would do: it would make
// the data plane's and the broker's guards look like borrowings from the
// control plane, when in fact all six are the same guard. Nothing here is
// control plane or data plane; it is the identity of a CLAIM.
// =============================================================================

/**
 * THE CLAIM THIS MESSAGE IS ABOUT — `jobs.claim_token`, handed to the node in
 * the claim response and quoted back on every route that speaks for a held
 * job (#364).
 *
 * WHY A NODE ID IS NOT ENOUGH, which is the whole of this field. Every guard
 * on the six routes above identified the caller by `claimedByNodeId` alone,
 * which tells one node from another and NOT ONE NODE FROM ITSELF. A node that
 * claims job J, stalls past its lease, is reaped, and then claims J again in a
 * second worker slot has two live slots quoting the same node id, and every
 * one of those six routes will believe the older one:
 *
 *   - `renew` — the stale slot extends the lease its OWN newer claim is
 *     running under, so a second slot that dies is reaped late, for as long as
 *     the first keeps ticking.
 *   - `result` / `failure` — the stale slot SETTLES a job its newer claim is
 *     still executing, persisting output computed against an earlier attempt
 *     or charging a failure against a run that is going fine.
 *   - `upload-url` — the sharpest of the six, and the quietest. With
 *     `deriveOutputKey` (#348) the key is a function of the JOB, not of the
 *     claim, so a stale slot is handed a signed PUT for the exact output key
 *     its own later claim is currently writing. Both PUTs "succeed"; the
 *     bytes that survive are whichever finished last, and nothing anywhere
 *     records that two ran.
 *   - `download-url` — a bearer capability for the job's input, minted for a
 *     slot that no longer holds the row.
 *   - `secret` — a LIVE DATABASE CREDENTIAL handed to a slot that lost the
 *     job, valid for the lease of a claim that is not its own.
 *
 * The token is minted per row by the claim statement
 * (`job-claim.service.ts`, `gen_random_uuid()`), so those two claims carry
 * different tokens and the stale one is refused.
 *
 * ⚠ OPTIONAL ON THE WIRE EVERYWHERE, AND THAT IS LOAD-BEARING, not politeness.
 * A fleet is upgraded one machine at a time; a node running older CLI code
 * omits this field, and the server must then behave EXACTLY as it did before —
 * the node id and the lease alone — rather than 400 the request or 409 the
 * job. Same posture as `renewIntervalMs` in #347: additive, ignorable,
 * strictly better when present. The ambiguity above stays open for that node
 * until it is upgraded, which is a rolling-upgrade window rather than a new
 * hole; nothing the server can do closes it earlier, because the only value
 * able to tell two slots of one node apart is one only they hold.
 *
 * ⚠ OMITTED MUST STAY `undefined` AND MUST NOT BECOME `null`. Downstream this
 * value reaches `heldLeaseWhere`, where the two mean opposite things:
 * `undefined` drops the clause entirely ("I am not asserting a claim"), while
 * `null` matches `claim_token IS NULL` ("I assert this row carries no token",
 * which is what a claim taken before the column existed looks like).
 * `.optional()` with no `.nullable()` is what keeps them apart — a body that
 * spells the key as `null` is refused rather than silently reinterpreted as
 * the other statement. Apply `.optional()` at each use site rather than baking
 * it in here, so every body says out loud that the field may be absent.
 *
 * Validated as a uuid rather than as any bounded string because the column is
 * `uuid`: a garbage value reaching a `where` clause is a Postgres cast error
 * (a 500 about "inconsistent column data"), and a clean 400 naming the field
 * is a better answer to a malformed token than a 500 is.
 *
 * @stability experimental
 */
export const claimTokenField = z.uuid().describe(
  // ⚠ THE PUBLISHED DESCRIPTION IS PART OF THE ONE DEFINITION, and it is here
  // for the reason the schema is: six routes describing one grant six ways is
  // six chances to describe it differently, and a node's author reads
  // whichever one they happened to open. `.describe()` rides through
  // `.optional()` into every generated body, so `openapi.json` says the same
  // sentence six times by construction.
  'The `claimToken` this assignment was handed in the claim response, quoted back so the ' +
    'server can tell THIS claim of the job from a later one by the same node — the difference ' +
    'between renewing, settling, signing or crediting your own run and one your node started ' +
    'later. Optional: omit it and the request is identified by node id alone, exactly as ' +
    'before, so an older client is refused nothing and stays exactly as ambiguous as it was. ' +
    'Omit the key rather than sending `null`; `null` is a different assertion and is refused.'
);

// -----------------------------------------------------------------------------
// From create-node-credential.dto.ts: The create-credential request body (issue #267, epic #254)
// -----------------------------------------------------------------------------
// =============================================================================
// The create-credential request body (issue #267, epic #254)
// =============================================================================
//
// Deliberately NOT `CreatePatDto`'s `{ durationValue, durationUnit }` pair.
// That pair exists on a PAT because a PAT MUST expire — `PersonalAccessToken
// .expiresAt` is a required column — so its request body has to make the
// caller say when, and the two-field shape ("30" + "days") is friendlier than
// a raw timestamp for a human filling in a form.
//
// A node credential's expiry is OPTIONAL, and the reason is written out in
// full above `NodeCredential.expiresAt` in `prisma/schema.prisma`: a worker
// node runs unattended for months, and a mandatory expiry turns a fleet going
// dark at 3am into the DEFAULT behaviour rather than an incident. So the
// field is optional here, and its absence is a real, supported answer —
// "never expires, authenticate indefinitely until revoked" — not a validation
// hole and not an unset value some later code has to fill in.
//
// WHY `expiresInDays` AND NOT AN ISO TIMESTAMP. A caller-supplied absolute
// `expiresAt` would have to be validated against the server's clock (is it in
// the past? is it absurdly far in the future?) and would silently encode the
// CALLER's idea of "now" — a CLI on a box with a skewed clock could mint a
// credential that is already expired, or one that outlives the deployment. A
// relative duration is interpreted by the server against the server's own
// clock, which is the same clock `validateToken` compares against, so the two
// can never disagree. Days rather than a unit enum because a node credential
// measured in minutes is not a use case anybody has: this credential exists
// precisely for the long-lived, unattended case.
// =============================================================================

/**
 * The body that mints a node credential (`nod_` token).
 *
 * @stability experimental
 */
export const createNodeCredentialSchema = z.object({
  /** The credential's display name, 1 to 100 characters. */
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(100, 'Name must be 100 characters or less'),

  // Optional ON PURPOSE — see the file header. Omitted means `expiresAt: null`
  // in the row, which `validateToken` treats as "no expiry to check", not as
  // "expired" and not as "not configured yet".
  /** Days until it expires, at most `MAX_NODE_CREDENTIAL_DAYS`; omitted, it never expires. */
  expiresInDays: z
    .number()
    .int('Expiry must be a whole number of days')
    .min(1, 'Expiry must be at least 1 day')
    .max(
      MAX_NODE_CREDENTIAL_DAYS,
      `Expiry must be at most ${MAX_NODE_CREDENTIAL_DAYS} days`,
    )
    .optional(),
});

// -----------------------------------------------------------------------------
// From node-control-plane.dto.ts: The node control plane's request bodies (issue #268, epic #254)
// -----------------------------------------------------------------------------
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
// sees — and `claimToken` below is the same argument one level up: the three
// bodies here that speak for a held job share ONE field definition with the
// three outside this file that do the same (`node-data-plane.dto.ts`,
// `node-job-secret.dto.ts`), so "renew accepts a token but failure silently
// ignores it" is unwritable. That definition lives in `claim-token.field.ts`,
// which carries its own note on why one field earned a file of its own.
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
 * `jobs.claim_token`, as the node quotes it back — the field three of the
 * bodies below carry, and three more outside this file (the two data-plane
 * mints and the secret broker) carry for the same reason.
 *
 * SHARED, NOT REDECLARED: `claim-token.field.ts` holds the field and the whole
 * argument for it, including why `undefined` and `null` must stay different
 * statements. Six copies of a uuid would drift exactly once, and on one route
 * only, which is the worst shape that drift can take.
 */
const claimToken = claimTokenField;

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
// Vitals (issue #604) — carried on the heartbeat
// =============================================================================
//
// WHAT A NODE SAYS ABOUT ITS OWN HEALTH, and the file header's argument
// applies to every field: these numbers come from a machine this deployment
// may not own, they are stored verbatim (`WorkerNode.lastVitals`, JSONB) and
// rendered on the admin fleet page. So the shape is CLOSED and every value is
// BOUNDED:
//
//   - `.strict()` at both levels, unlike `capabilities` above. Capabilities
//     are an open bag on purpose (the fleet page's business, free to grow);
//     vitals are a CONTRACT the fleet page reads field by field, and an open
//     bag here would be an unbounded JSONB write on a route every node hits
//     every few seconds. A node that learns a new vital needs an API change
//     first, which is the review this surface should get.
//   - Every number is finite and non-negative with an explicit ceiling, so
//     `NaN`/`Infinity`/negative garbage never reaches the row, and a number
//     too large to be true is refused rather than charted.
//   - Every string is short and version-shaped, because the three it carries
//     are version banners rendered as text — never a free-form message.
//   - Every field is optional. A node reports what it can measure (a node
//     without `pg_dump` has no `pgDumpVersion`), and an old node sends no
//     `vitals` key at all, which leaves the stored snapshot untouched.
//
// ⚠ THE CEILINGS ARE GENEROUS ON PURPOSE. A vitals value out of range fails
// the WHOLE heartbeat with a 400, and a node whose heartbeats fail goes stale
// on the fleet page and is swept offline — a far worse outcome than one odd
// number. So each ceiling is "physically implausible", not "unusual": disk
// sizes in particular allow a network filesystem that reports exabytes free
// (some do), which is why they are not required to be safe integers.
//
// REJECTED: a node-supplied timestamp for the snapshot. `lastVitalsAt` is
// stamped by the SERVER when the heartbeat lands, for the same reason
// `lastHeartbeatAt` is — a node's clock is one more thing it could get wrong.
// =============================================================================

/** Ceiling on a counter: a trillion events is past any node's plausible lifetime. */
const MAX_VITALS_COUNTER = 1e12;

/** Ceiling on a process memory figure (RSS, heap): 1 PiB. */
const MAX_VITALS_MEMORY_BYTES = 2 ** 50;

/**
 * Ceiling on a filesystem figure: 2^64 bytes. Not an integer check — a
 * `statfs` total past 2^53 arrives as a (still finite) double.
 */
const MAX_VITALS_DISK_BYTES = 2 ** 64;

/** Ceiling on `cpuPercent`: 100% per core, for up to 128 cores. */
const MAX_VITALS_CPU_PERCENT = 12_800;

/** Ceiling on event-loop delay: one hour. A loop blocked longer is not sending heartbeats. */
const MAX_VITALS_EVENT_LOOP_DELAY_MS = 3_600_000;

/** Ceiling on uptime: ten years. */
const MAX_VITALS_UPTIME_SECONDS = 10 * 365 * 24 * 60 * 60;

/** Cap on a reported version banner (`v24.3.0`, `pg_dump (PostgreSQL) 16.4`). */
const MAX_VITALS_VERSION_LENGTH = 64;

/**
 * A finite, non-negative number no larger than `max`. (Zod 4's `z.number()`
 * already refuses `NaN` and `Infinity`; JSON cannot carry them anyway.)
 */
const boundedNumber = (max: number) => z.number().nonnegative().max(max);

/**
 * A non-negative integer no larger than `max`. `.int()` comes FIRST: Zod 4's
 * integer check carries its own safe-integer range, and applied after `.max()`
 * it is that range, not ours, that reaches the generated OpenAPI schema.
 */
const boundedInt = (max: number) => z.number().int().nonnegative().max(max);

/** A non-negative integer counter since the node process started. */
const vitalsCounter = boundedInt(MAX_VITALS_COUNTER);

/** A short, version-shaped string: letters, digits, spaces and `. + - _ ( ) ~`. */
const vitalsVersion = z
  .string()
  .trim()
  .min(1)
  .max(MAX_VITALS_VERSION_LENGTH)
  .regex(/^[0-9A-Za-z .+\-_()~]+$/, 'Must be a version string');

/**
 * Cumulative counters since the node process started; reset on restart.
 *
 * @stability experimental
 */
export const nodeVitalsCountersSchema = z
  .object({
    /** Claim calls that returned at least one job. */
    claims: vitalsCounter.optional(),
    /** Claim calls that returned none. */
    emptyPolls: vitalsCounter.optional(),
    /** Claim calls that failed. */
    claimFailures: vitalsCounter.optional(),
    /** Jobs this process completed. */
    succeeded: vitalsCounter.optional(),
    /** Jobs this process reported failed. */
    failed: vitalsCounter.optional(),
    /** Jobs this process reported rate-limited. */
    rateLimited: vitalsCounter.optional(),
    /** Lease renewals that succeeded. */
    leaseRenewals: vitalsCounter.optional(),
    /** Lease renewals that failed. */
    leaseRenewFailures: vitalsCounter.optional(),
    /** Heartbeats that failed. */
    heartbeatFailures: vitalsCounter.optional(),
    /** Times the job watchdog killed a stuck job. */
    watchdogTrips: vitalsCounter.optional(),
  })
  .strict();

/**
 * A node's health snapshot, carried on its heartbeat; closed and bounded.
 *
 * @stability experimental
 */
export const nodeVitalsSchema = z
  .object({
    /** Process CPU over the last interval; 100 = one full core. */
    cpuPercent: boundedNumber(MAX_VITALS_CPU_PERCENT).optional(),
    /** Resident set size of the node process, in bytes. */
    rssBytes: boundedInt(MAX_VITALS_MEMORY_BYTES).optional(),
    /** V8 heap in use, in bytes. */
    heapUsedBytes: boundedInt(MAX_VITALS_MEMORY_BYTES).optional(),
    /** V8 heap limit, in bytes. */
    heapLimitBytes: boundedInt(MAX_VITALS_MEMORY_BYTES).optional(),
    /** p99 event-loop delay over the last interval, in milliseconds. */
    eventLoopDelayP99Ms: boundedNumber(MAX_VITALS_EVENT_LOOP_DELAY_MS).optional(),
    /** Free/total bytes on the filesystem holding the node's state directory. */
    stateDirFreeBytes: boundedNumber(MAX_VITALS_DISK_BYTES).optional(),
    /** Total bytes of that filesystem. */
    stateDirTotalBytes: boundedNumber(MAX_VITALS_DISK_BYTES).optional(),
    /** Job slots in use / available. Bounded by the same ceiling as `concurrency`. */
    slotsUsed: boundedInt(MAX_NODE_CONCURRENCY).optional(),
    /** Job slots available. */
    slotsTotal: boundedInt(MAX_NODE_CONCURRENCY).optional(),
    /** Seconds since the node process started. */
    uptimeSeconds: boundedNumber(MAX_VITALS_UPTIME_SECONDS).optional(),
    /** Cumulative counters since the process started. */
    counters: nodeVitalsCountersSchema.optional(),
    /** The node CLI's version. */
    cliVersion: vitalsVersion.optional(),
    /** The Node.js runtime version. */
    nodeVersion: vitalsVersion.optional(),
    /** The `pg_dump` version banner, when the node has one. */
    pgDumpVersion: vitalsVersion.optional(),
  })
  .strict();

/**
 * The parsed vitals snapshot.
 *
 * @stability experimental
 */
export type NodeVitals = z.infer<typeof nodeVitalsSchema>;
/**
 * The parsed vitals counters.
 *
 * @stability experimental
 */
export type NodeVitalsCounters = z.infer<typeof nodeVitalsCountersSchema>;

// =============================================================================
// POST /nodes/register
// =============================================================================

/**
 * The body of `POST /api/nodes/register`.
 *
 * @stability experimental
 */
export const registerNodeSchema = z.object({
  /**
   * THE IDENTITY HALF OF `@@unique([createdById, name])`. Two registrations
   * with the same name from the same owner are the SAME node — see
   * `NodesService.register`. This is why a node's name belongs in its config
   * file rather than being generated at startup: a generated name makes every
   * container restart a new node row.
   */
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name must be 100 characters or less'),

  /** The machine's hostname, as the node reports it. */
  hostname: z.string().trim().min(1).max(255),
  /** The OS and architecture (`linux-x64`). */
  platform: z.string().trim().min(1).max(100),
  /** The node CLI's version. */
  cliVersion: z.string().trim().min(1).max(50),

  /**
   * The job types this node can run. An EMPTY LIST IS LEGAL and means "I can
   * run nothing yet" — a node that registers before its handlers are
   * configured is a real state, and refusing it would push the operator
   * toward declaring a type the node cannot actually execute.
   */
  eligibleTypes: z.array(jobType).max(MAX_NODE_ELIGIBLE_TYPES).default([]),

  /** How many jobs the node runs at once, 1 to `MAX_NODE_CONCURRENCY`. */
  concurrency: z
    .number()
    .int('Concurrency must be a whole number')
    .min(1, 'Concurrency must be at least 1')
    .max(MAX_NODE_CONCURRENCY, `Concurrency must be at most ${MAX_NODE_CONCURRENCY}`),

  /** The node's self-reported capability bag (open JSON, shown on the fleet page). */
  capabilities: capabilities.optional(),
});

// =============================================================================
// POST /nodes/:id/heartbeat
// =============================================================================

/**
 * The body of `POST /api/nodes/:id/heartbeat`.
 *
 * @stability experimental
 */
export const heartbeatNodeSchema = z.object({
  /**
   * The two states a node may report ABOUT ITSELF. `draining` and `disabled`
   * are absent on purpose — see the file header.
   */
  status: (z.enum(['online', 'offline']) as z.ZodEnum<NodeReportedStatusEnum>).optional(),

  /**
   * A runtime concurrency change (`appctl node set-concurrency`), which the
   * NEXT claim reads live off the row. This is the whole reason the claim
   * endpoint re-reads the node rather than trusting a value captured at
   * registration.
   */
  concurrency: z.number().int().min(1).max(MAX_NODE_CONCURRENCY).optional(),

  /** A replacement capability bag, when it changed. */
  capabilities: capabilities.optional(),

  /**
   * A health snapshot (#604), stored as `lastVitals` with a server-stamped
   * `lastVitalsAt`. OMITTED leaves the stored snapshot untouched, which is
   * what every node that predates vitals sends. See "Vitals" above.
   */
  vitals: nodeVitalsSchema.optional(),
});

// =============================================================================
// POST /nodes/:id/claim
// =============================================================================

/**
 * The body of `POST /api/nodes/:id/claim`.
 *
 * @stability experimental
 */
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
 *
 * @stability experimental
 */
export const renewLeaseSchema = z
  .object({
    /** Which claim of the job is asking (`claimTokenField`). */
    claimToken: claimToken.optional(),
  })
  .default({});

// =============================================================================
// POST /nodes/:id/jobs/:jobId/result
// =============================================================================

/**
 * The body of `POST /api/nodes/:id/jobs/:jobId/result`.
 *
 * @stability experimental
 */
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

// =============================================================================
// POST /nodes/:id/jobs/:jobId/failure
// =============================================================================

/**
 * The body of `POST /api/nodes/:id/jobs/:jobId/failure`.
 *
 * @stability experimental
 */
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

// -----------------------------------------------------------------------------
// From node-data-plane.dto.ts: The data plane's request and response bodies (issue #269, epic #254)
// -----------------------------------------------------------------------------
// =============================================================================
// The data plane's request and response bodies (issue #269, epic #254)
// =============================================================================
//
// #268 gave a node a CONTROL plane: claim a job, renew its lease, report an
// outcome. What it could not do was read a single byte or write one, because
// a node holds no storage credentials — by design, and permanently. These
// bodies are the whole of the answer.
//
// -----------------------------------------------------------------------------
// THE SHAPE OF THE SOLUTION, AND THE TWO ALTERNATIVES IT BEATS
// -----------------------------------------------------------------------------
//
// The server mints a SHORT-LIVED, SINGLE-OBJECT signed URL and the node talks
// to the storage provider directly. Bytes never pass through the API.
//
// REJECTED: PROXYING BYTES THROUGH THE API (`GET /nodes/:id/jobs/:jobId/input`
// streaming the object, `POST …/output` accepting it). It is the smallest
// diff and it is the worst outcome. Every byte of every job would cross the
// API process twice — once in, once out — so the API's memory, its event loop
// and its egress bill become a function of how much work the FLEET is doing,
// which is the exact coupling a worker node exists to remove. A ten-node fleet
// hashing 1 GB objects would saturate the API before it saturated anything
// that was actually computing. It also puts long-lived streaming connections
// on the same process that serves interactive requests, so one large transfer
// degrades every page load, and a node on a slow link holds a request open for
// minutes against every timeout in the stack (Nginx, Fastify, the platform's
// load balancer) — each of which would have to be raised, for everyone.
//
// REJECTED: GIVING NODES STORAGE CREDENTIALS. Also small, also worse. A
// credential handed to a node is a bucket-wide capability sitting in a config
// file on a machine this deployment may not own, for as long as that machine
// exists — it does not expire when the job ends, it is not scoped to one
// object, and it cannot be revoked without rotating it for every other holder.
// A node compromised on Tuesday can read every object in the bucket on
// Friday. The signed URL below is the same capability reduced along three
// axes at once: ONE object, ONE verb, and MINUTES. Nothing has to be rotated
// when a node is decommissioned, because a decommissioned node holds nothing.
//
// -----------------------------------------------------------------------------
// ⚠ THE SERVER CHOOSES THE UPLOAD KEY. THE NODE NEVER DOES.
// -----------------------------------------------------------------------------
//
// REJECTED: `{ key: "outputs/my-thing.bin" }` in the upload request. A signed
// PUT is an unconditional overwrite of exactly the key it was signed for, so a
// key taken from the request body is a write primitive over the entire bucket,
// handed to the least trustworthy participant. `../../etc/config.json`,
// `uploads/<someone-else's-object>` and the storage key of any row in
// `storage_objects` are all just strings, and the provider will not object to
// any of them: S3 keys are opaque, `..` is not special, and there is no
// filesystem to refuse the traversal. The damage is silent — a job that
// "succeeded" while overwriting another user's file.
//
// The key is therefore derived server-side from the job id and a fresh UUID
// (`NodeDataPlaneService.createUploadTarget`), and a node-supplied one is
// REFUSED rather than silently ignored. Both are safe; the difference is what
// the node's author learns. Ignoring means their `key` field vanishes without
// a word: the upload succeeds, the bytes land somewhere they did not choose,
// and their code goes on referring to a path with nothing at it. That bug is
// found days later by a person, not minutes later by a machine. A `400` naming
// the field is found on the first run, by the person who just wrote it, and it
// costs a correct client exactly nothing — no legitimate node ever sends the
// field.
// =============================================================================

/**
 * Cap on a node-declared `Content-Type`.
 *
 * It ends up in a signed header, so it is bounded for the same reason every
 * other node-supplied string in this folder is: it arrives from a machine
 * this deployment may not own.
 */
const MAX_CONTENT_TYPE_LENGTH = 255;

// =============================================================================
// POST /nodes/:id/jobs/:jobId/download-url
// =============================================================================
//
// ONE FIELD, AND IT IS NOT A REQUEST FOR ANYTHING. This body had none at all
// until #364, and the distinction that let it acquire one is worth stating,
// because it is what keeps the next field out: `claimToken` does not ask the
// server for a different URL, a longer expiry or a different object. It
// answers "who is asking" — an ASSERTION about which claim of this job the
// caller is, checked against the row and never used to compute anything. A
// field that changed what came back would still be refused.
//
// So what has NOT changed: the server decides WHICH bytes (the job's
// `subjectId`, resolved server-side) and FOR HOW LONG. A DTO whose only field
// was `expiresIn` was considered and dropped for the same reason a
// node-supplied lease was dropped in #268 — the bound exists to limit the
// blast radius of a leaked URL, so the party the bound protects against does
// not get to set it.
//
// It is a POST rather than a GET even though it reads nothing, because it
// MINTS A CREDENTIAL. A GET's URL is the thing every layer between here and
// the node writes down — proxy access logs, browser history, a CDN cache key,
// an APM trace's endpoint label — and a response body containing a bearer URL
// has no business being cacheable by anything. POST is uncacheable by default
// and carries no such expectation.

/**
 * What a node may say when asking to read its input: which claim is asking,
 * and nothing else.
 *
 * ⚠ `.default({})` IS THE BACKWARD-COMPATIBILITY GUARANTEE, not a convenience.
 * This route took no body at all until #364, so every node in every fleet
 * posts to it with no payload and no `Content-Type` — Fastify hands Nest
 * `undefined`, and a bare `z.object({...})` would reject that outright and
 * fail every download from every node that has not been upgraded yet. The
 * default is what makes "no body" parse to "no assertion", which is the
 * pre-#364 behaviour spelled as data. Do not unwrap it. `nodeUploadUrlSchema`
 * below and `nodeJobSecretRequestSchema` carry it for the milder version of
 * the same reason — there, an empty body was always legal.
 *
 * A plain object rather than the `z.looseObject` its sibling uses: unknown
 * keys here are stripped, exactly as they were ignored before this body
 * existed. The loose-then-refuse-by-name treatment next door exists for `key`,
 * a field whose silent omission would send a node's bytes somewhere it did not
 * choose; nothing a node can put in THIS body has ever had an effect, so there
 * is no misunderstanding to name.
 *
 * @stability experimental
 */
export const nodeDownloadUrlSchema = z
  .object({
    /** Which claim of the job is asking (`claimTokenField`). */
    claimToken: claimTokenField.optional(),
  })
  .default({});

// =============================================================================
// POST /nodes/:id/jobs/:jobId/upload-url
// =============================================================================

/**
 * What a node may say when asking for somewhere to write.
 *
 * ⚠ `z.looseObject` RATHER THAN `z.strictObject`, AND THE REASON IS THE ERROR
 * MESSAGE. Strict mode rejects an unknown key with a perfectly good Zod issue
 * naming it — and that issue is then DESTROYED on the way out, because
 * `http-exception.filter.ts` rebuilds every error body from a fixed key
 * allowlist (`message`, `code`, `details`) and the validation pipe puts its
 * issues under `errors`. The node would receive a bare
 * `400 "Validation failed"`, which for the one field this endpoint most needs
 * to talk about — `key` — is the least useful answer available.
 *
 * So unknown keys are CAPTURED here and refused in
 * `NodeDataPlaneService.createUploadTarget`, which can raise a
 * `BadRequestException` carrying a message that names the field, explains that
 * the server chooses the key, and survives the filter intact. The security
 * outcome is identical either way (the key is never read); what differs is
 * whether the node's author is told why.
 *
 * `.default({})` so a node with nothing to declare may send an EMPTY BODY
 * rather than being required to send `{}` to satisfy a parser.
 *
 * @stability experimental
 */
export const nodeUploadUrlSchema = z
  .looseObject({
    /**
     * The `Content-Type` the node will send on its PUT.
     *
     * ⚠ IT BECOMES PART OF THE SIGNATURE. A node that declares it MUST send
     * exactly this header, or the provider answers `SignatureDoesNotMatch` —
     * an error that names the signature and not the header that broke it. A
     * node that is unsure should omit it and send whatever it likes.
     */
    contentType: z
      .string()
      .trim()
      .min(1)
      .max(MAX_CONTENT_TYPE_LENGTH)
      .optional(),

    /**
     * WHICH CLAIM is asking for somewhere to write — see
     * `claim-token.field.ts`.
     *
     * ⚠ THE SHARPEST OF THE SIX ROUTES THAT CARRY THIS, and the quietest if it
     * is missing. Since #348 a type may derive its output key from the JOB
     * (`deriveOutputKey`), so the key is a function of the row and not of the
     * claim — which means a node's stale worker slot asking here is handed a
     * signed PUT for the EXACT key its own later claim is currently writing.
     * Both PUTs answer 200, the surviving bytes are whichever landed last, and
     * nothing in any log ties the two together. The token is what refuses the
     * first slot before the URL is minted.
     *
     * ⚠ IT IS ALSO A PERMITTED FIELD, which is not automatic here:
     * `NodeDataPlaneService.rejectCallerSuppliedFields` refuses anything
     * outside its allowlist by name, so adding a field to this schema without
     * adding it there would 400 every upgraded node. The allowlist is the
     * authority; this schema only describes.
     */
    claimToken: claimTokenField.optional(),
  })
  .default({});


// -----------------------------------------------------------------------------
// From node-job-secret.dto.ts: The per-job secret request and response bodies (issue #349, epic #345)
// -----------------------------------------------------------------------------
// =============================================================================
// The per-job secret request and response bodies (issue #349, epic #345)
// =============================================================================
//
// #269 gave a node a way to move BYTES with no storage credentials. This gives
// it a way to hold a CREDENTIAL for exactly one job, for exactly as long as it
// holds that job's lease. `job-secret-broker.ts` carries the argument for why
// the credential is brokered per job at all, and what the three rejected
// alternatives were; this file is about the wire shape, which has two
// properties worth stating on their own.
//
// -----------------------------------------------------------------------------
// ⚠ THE REQUEST BODY ASKS FOR NOTHING, AND ANY FIELD THAT DOES IS A 400
// -----------------------------------------------------------------------------
//
// Everything the server needs is already on the path (which node) and in the
// row (which job, which type, which broker, which lease). There is nothing a
// node could usefully ASK FOR — and, far more importantly, nothing it is
// ALLOWED to ask for: A NODE MAY NOT REQUEST A SECRET IT WAS NOT ASSIGNED. A
// `kind`, a `scope`, a `database`, a `ttl` in the body would each be a node
// choosing some part of a credential's shape, and every one of those is the
// server's choice derived from the job the node is holding.
//
// ⚠ `claimToken` (#364) IS THE ONE PERMITTED FIELD, AND IT IS NOT AN EXCEPTION
// TO THAT RULE — it is the rule applied to a different question. Every field
// above asks the server for something; this one ANSWERS something: which claim
// of this job is asking. It changes nothing about the credential — not its
// kind, not its scope, not its lifetime, all of which are still derived from
// the row — and the only thing it can do is get the request REFUSED, which is
// the whole point. Without it, the ambiguity this route is most exposed to is
// also its worst: `claimedByNodeId` cannot tell a node's stalled, reaped slot
// from the slot that re-claimed the job, so the stale one is handed a LIVE
// DATABASE CREDENTIAL, bounded by a lease belonging to a claim that is not its
// own. A field that can only ever narrow who may be answered is the one shape
// of field this body can safely grow.
//
// So the refusal is the same one `NodeUploadUrlDto` makes about `key`, applied
// to a body that permits nothing a node could ask for — including the `ttl`
// case, which
// is the one somebody will genuinely want. A node-chosen lifetime is refused
// for the reason #268 refused a node-chosen lease: the bound exists to limit
// the blast radius of a leaked credential, so the party the bound protects
// against does not get to set it. The credential is bounded by the job's lease,
// which the node is already renewing (#347), and there is deliberately no
// second clock.
//
// `z.looseObject`, NOT `z.strictObject`, and the reason is the error message —
// the identical reasoning `node-data-plane.dto.ts` records. Strict mode's
// perfectly good Zod issue is DESTROYED on the way out, because
// `http-exception.filter.ts` rebuilds every error body from a fixed key
// allowlist and the validation pipe files its issues under `errors`; the node
// would receive a bare `400 "Validation failed"` naming nothing. Unknown keys
// are therefore CAPTURED here and refused in `NodeSecretBrokerService`, which
// can raise a message that names the field and survives the filter intact. The
// security outcome is identical either way — no field a node ASKS with is ever
// read, and the one field that is read (`claimToken`) is declared in the schema
// rather than swept up as an unknown key — and what differs is whether the
// node's author is told why.
//
// -----------------------------------------------------------------------------
// POST, NOT GET, AND `Cache-Control: no-store`
// -----------------------------------------------------------------------------
//
// The same reason `worker-nodes.md`, "Data plane", gives for the two data-plane
// routes, and it applies harder here because what comes back is not a scoped,
// minutes-long URL but a credential. A `GET`'s URL is what every layer between
// the server and the node writes down — proxy access logs, a CDN cache key, an
// APM trace's endpoint label — and a response body containing a credential has
// no business being cacheable by anything. `POST` is uncacheable by default;
// `no-store` says so out loud for the intermediary that decides to be clever
// anyway.
// =============================================================================

/**
 * What a node may say when asking for its job's credential: which claim is
 * asking, and nothing else.
 *
 * `.default({})` so a node with nothing to declare may send an empty body
 * rather than being made to send `{}` to satisfy a parser — an empty body is
 * still a correct request, and is what every node sent before #364. Anything
 * beyond `claimToken` is captured by the loose object and refused by name in
 * the service, whose allowlist — not this schema — is the authority on what
 * may be sent; adding a field here without adding it there would 400 the
 * clients that send it.
 *
 * @stability experimental
 */
export const nodeJobSecretRequestSchema = z
  .looseObject({
    /** WHICH CLAIM is asking — see `claim-token.field.ts` and the header above. */
    claimToken: claimTokenField.optional(),
  })
  .default({});

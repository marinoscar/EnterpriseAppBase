import { z } from 'zod';

// =============================================================================
// The `.appctl-deploy.json` wire contract (issue #392, epic #388)
// =============================================================================
//
// ⚠ EVERYTHING THIS FILE DESCRIBES IS UNTRUSTED INPUT, AND THAT IS THE ENTIRE
// REASON IT EXISTS.
//
// This API did not write the deployment state file. `appctl deploy` did, on the
// VPS, minutes or months ago, possibly at a different version of itself — and
// what the API reads is a host path bind-mounted into the container, which any
// process on that host with write access to the deploy root can replace. So the
// bytes are parsed the way a request body is parsed: schema first, unknown keys
// stripped (Zod's default for `z.object`, relied on deliberately here), and a
// failure answered as data rather than raised as an exception. Nothing that
// comes out of this schema is ever interpolated into a command, a path, a query
// or a log line; it is serialised into a JSON response and nowhere else.
//
// -----------------------------------------------------------------------------
// TWO VERSIONS, AS A DISCRIMINATED UNION AND NOT AS "v2 WITH OPTIONAL FIELDS"
// -----------------------------------------------------------------------------
//
// v1 is what `appctl` has written since #173: the identity of the deployment
// and nothing about the machine. v2 adds `host`, `proxy` and `history`, all
// captured at deploy time.
//
// The union member for v1 does not mention those three sections at all, so a v1
// file that somehow carries a `host` key has it STRIPPED rather than served. A
// single schema with three optional sections would serve it instead, and would
// therefore present fields whose meaning no writer ever promised — a v1 writer
// that used `host` for something else entirely would be rendered on an admin
// page as though it were a v2 host record. Version numbers exist precisely so
// that a reader can decline to guess; collapsing the union throws that away for
// the sake of a few lines.
//
// AN UNKNOWN VERSION (0, 3, "2", absent) FAILS THE UNION and is reported as
// `reason: 'invalid'`. That is the same refusal `readState` in the CLI makes,
// and for the same reason: misreading a state file means reporting the wrong
// commit as deployed, which is worse than reporting nothing.
// =============================================================================

/**
 * Longest string accepted in any single field.
 *
 * Not a validation rule so much as a bound on what a hostile file can make this
 * process hold and echo back. Every real field here is a hostname, a SHA, a
 * path or a version string; 512 is generous for all of them.
 */
const MAX_FIELD = 512;

/**
 * A bounded free-text field.
 *
 * ⚠ `repoUrl`, `ref` AND `commitSha` USE THIS RATHER THAN `.url()` OR A 40-HEX
 * `.regex()`, ON PURPOSE. `runInstall` writes `context.target?.url ?? ''` and
 * `context.commitSha ?? ''`, so an interrupted or partially-resolved install
 * legitimately produces EMPTY strings in those fields. A stricter rule would
 * turn that ordinary file into `configured: false, reason: 'invalid'`, and the
 * admin page would report "no deployment recorded" about a deployment that
 * plainly exists — the exact failure this endpoint was added to end. Validation
 * here bounds size and type; it does not audit the CLI's output.
 */
const text = z.string().max(MAX_FIELD);

/**
 * ISO 8601, `Z`-terminated, which is what `Date.prototype.toISOString` emits and
 * the only thing `appctl` ever writes.
 *
 * Strict rather than `text` because these values are rendered as dates by the
 * client: a field that is a date everywhere except on one deployment is a
 * client-side crash, and answering `invalid` for the whole file is both louder
 * and safer than shipping `"yesterday"` into a `new Date()`.
 */
const timestamp = z.iso.datetime();


const hostSchema = z.object({
  hostname: text,
  os: text,
  kernel: text,
  arch: text,
  cpus: z.number().int().nonnegative(),
  memoryBytes: z.number().nonnegative(),
  dockerVersion: text,
  composeVersion: text,
  /**
   * Absent behind NAT — not an error, and not a gap to fill in.
   *
   * The writer resolves this from the local routing table only and never from
   * an external IP-echo service, so a machine with no routable address of its
   * own simply has none to record. It omits the key rather than storing a LAN
   * address in a field called `publicIp`, which is the honest choice and the
   * one this schema has to accommodate.
   *
   * Its three neighbours (`os`, `dockerVersion`, `composeVersion`) are
   * deliberately NOT optional for the same reason inverted: the writer emits
   * the literal string `"unknown"` when their probe fails, so the SHAPE does
   * not vary with how much of the machine was readable.
   */
  publicIp: text.optional(),
});

const proxySchema = z.object({
  domain: text,
  bindPort: z.number().int(),

  /**
   * The proxy container's name — ABSENT, NOT EMPTY, when `mode` is `host`.
   *
   * ⚠ OPTIONAL, AND GETTING THIS WRONG IS NOT COSMETIC. A host-mode proxy is
   * nginx running as a system service; there is no container, so the writer
   * omits the key rather than recording `""` for a thing that does not exist.
   * Requiring it here would fail the parse for every host-mode deployment, and
   * this reader turns a failed parse into `configured: false` with
   * `reason: 'invalid'` — so a perfectly healthy server would render as "not
   * configured", and the reason shown would be a lie about its own state file.
   *
   * Absence is therefore MEANINGFUL (there is no container to name) rather than
   * missing data, and `mode` is the field that says which world you are in.
   */
  container: text.optional(),

  mode: z.enum(['container', 'host']),

  /**
   * When the certificate in front of this deployment expires.
   *
   * Optional and, as of today, NEVER WRITTEN: reading a notAfter cheaply is not
   * something the publish step's existing helpers do, and probing with openssl
   * was out of scope for the writer. It stays in the contract because it is the
   * field a later probe fills in, and a reader that already accepts it needs no
   * change on the day it appears — but nothing may treat its absence as an
   * error, and no client should render an empty "expires" row because of it.
   */
  certNotAfter: timestamp.optional(),
});

const historyEntrySchema = z.object({
  at: timestamp,
  command: z.enum(['install', 'update']),
  commitSha: text,
  /** Absent on a first install — nothing preceded it. */
  previousSha: text.optional(),
  ref: text,
  durationMs: z.number().nonnegative(),
  appctlVersion: text,
  outcome: z.enum(['success', 'failed']),
});

/**
 * How many history entries this API will serve, newest first.
 *
 * Enforced by `DeploymentService` AFTER parsing, not by the schema — see
 * `HISTORY_HARD_CAP` below for why refusing is the wrong answer here, and
 * `deployment-info.dto.ts` for why this schema must stay free of `.transform()`
 * (a transform is not representable in JSON Schema, and an unrepresentable
 * response DTO takes `/api/docs` down for the whole API at boot).
 */
export const DEPLOY_HISTORY_MAX_ENTRIES = 20;

/**
 * How many entries the file may contain before it is judged not to be a state
 * file at all.
 *
 * ⚠ DELIBERATELY NOT `.max(DEPLOY_HISTORY_MAX_ENTRIES)`. The contract says the
 * CLI keeps at most 20, but a future `appctl` that keeps 30 is a trivially
 * benign change, and `.max(20)` would answer it by declaring the whole file
 * invalid — blanking the deployment page over a longer list. Over-long input is
 * TRUNCATED by the service instead, which is strictly better than refused: this
 * reader enforces what it will serve, not what the writer should have written.
 * The hard cap remains, because an unbounded array in an untrusted file is a
 * memory question rather than a compatibility one.
 */
const HISTORY_HARD_CAP = 200;

const historySchema = z.array(historyEntrySchema).max(HISTORY_HARD_CAP);

/** Fields present in every version of the file. */
const commonFields = {
  repoUrl: text,
  ref: text,
  commitSha: text,
  previousSha: text.optional(),
  domain: text.optional(),
  bindPort: z.number().int(),
  deployRoot: text,
  installedAt: timestamp,
  lastDeployedAt: timestamp,
  lastCommand: z.enum(['install', 'update']),
  appctlVersion: text,
  completedSteps: z.array(text).max(64).optional(),
};

const deployStateV1Schema = z.object({
  version: z.literal(1),
  ...commonFields,
});

const deployStateV2Schema = z.object({
  version: z.literal(2),
  ...commonFields,
  host: hostSchema.optional(),
  proxy: proxySchema.optional(),
  history: historySchema.optional(),
});

/**
 * The parsed deployment record, in whichever version the file declared.
 *
 * `z.discriminatedUnion` rather than `z.union` so a v2 file with one bad field
 * reports THAT field rather than "no union member matched" — the difference
 * between a diagnosable `reason: 'invalid'` and a mystery.
 */
export const deployStateSchema = z.discriminatedUnion('version', [
  deployStateV1Schema,
  deployStateV2Schema,
]);

export type DeployState = z.infer<typeof deployStateSchema>;

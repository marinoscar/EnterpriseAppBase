// =============================================================================
// The restore and rollback wire contract (issue #286, epic #254)
// =============================================================================
//
// ⚠ THIS IS THE ONE PLACE IN THIS APPLICATION WHERE A MIS-FIRED OR RETRIED
// REQUEST IS AN OUTAGE RATHER THAN A DUPLICATE ROW. Every other POST in this
// API, sent twice, costs at worst a wasted row: a second backup is refused by
// the single-active index, a second job is a second job, a second broadcast is
// embarrassing. A second restore replaces the production database. So the
// request body is shaped to be IMPOSSIBLE TO RECONSTRUCT BY ACCIDENT, and that
// is what the two `confirmation` literals below are for.
//
// -----------------------------------------------------------------------------
// WHY A TYPED LITERAL AND NOT `confirm: true`
// -----------------------------------------------------------------------------
//
// ⚠ REJECTED: `{ "confirm": true }`. It is the obvious shape and it is worth
// naming so it is not proposed again. A boolean is reproduced by:
//
//   - a browser or proxy replaying a POST it believes idempotent;
//   - a `curl` line copied out of a runbook, a terminal history or a chat;
//   - a client library retrying on a socket timeout — which is exactly when a
//     restore is in flight and answering slowly;
//   - a double-click on a button whose first response has not arrived.
//
// In all four the body is `{"confirm":true}` and the server cannot tell the
// second request from the first. `{"confirmation":"RESTORE"}` is reproduced by
// none of them ACCIDENTALLY — it can still be replayed deliberately, which is
// the point: a replay of this body is a decision somebody made, and a request
// that carries the wrong word (or no word) is refused with a 400 having started
// NOTHING. Not a 409, not a queued attempt, not a partially-run pre-flight.
//
// The two words differ (`RESTORE` and `ROLLBACK`) so that a body copied from
// one route to the other is refused too. They are UPPERCASE and matched
// exactly: a case-insensitive compare would accept `restore`, which is a word
// somebody types by habit.
//
// -----------------------------------------------------------------------------
// THREE NORMAL OUTCOMES PER ROUTE, KEYED BY `mode` — AND `mode` IS THE ANSWER,
// NOT THE STATUS CODE
// -----------------------------------------------------------------------------
//
// Both routes answer `200` on every one of their three outcomes, and the
// discriminator is the `mode` field. This is the same contract
// `CancelBackupResultDto` states for its `outcome`, and it is forced by the
// same fact: THE HONEST ANSWER HAS MORE THAN ONE SHAPE AND A STATUS CODE CANNOT
// CARRY THE DIFFERENCE.
//
// ⚠ `guided` IS NOT AN ERROR STATUS, and this is the single most important
// decision in this file. A `guided` result means a CAPABILITY gate failed —
// nearly always `CREATEDB`, which managed PostgreSQL routinely denies — and the
// body carries a complete, paste-ready command block plus a runbook link so the
// operator can perform the same restore by hand with a superuser. Answering
// `4xx` would tell them, in the middle of an incident, that their platform is
// unsupported. It is not: it is a platform this design PLANNED for. See
// `docs/specs/database-restore.md`, "Outcomes and precedence".
//
// `blocked` is likewise a 200: the schema gate found a migration mismatch, and
// the caller's next move is to re-send with `overrideSchemaCheck: true`. That
// is an answer, not a failure.
//
// What IS an error is anything that means the request could not be answered at
// all: no such run (404), a run that is not a restorable archive (400), a
// missing or wrong confirmation (400), and another restore already in flight
// (409). See the controller for that mapping and why it lives there.
//
// -----------------------------------------------------------------------------
// ⚠ `overrideSchemaCheck` UNBLOCKS EXACTLY ONE GATE
// -----------------------------------------------------------------------------
//
// It clears the SCHEMA COMPATIBILITY gate and nothing else. It can never
// unblock a capability gate, and the difference is not a policy choice:
//
//   - A schema mismatch is a JUDGEMENT. "This archive predates two migrations;
//     I accept that and will run `prisma migrate deploy` afterwards" is a
//     sentence an operator is entitled to say.
//   - A capability failure is a STATEMENT OF FACT. No amount of accepting makes
//     a role without `CREATEDB` able to create a database. An override that
//     silenced it would not enable a restore; it would start one that fails at
//     `CREATE DATABASE`, having already downloaded the archive.
//
// There is an explicit negative test for that, in both the colocated service
// spec and the integration spec.
//
// -----------------------------------------------------------------------------
// THE FIELD NAME IS PUBLISHED BY THE PRE-FLIGHT, NOT INVENTED HERE
// -----------------------------------------------------------------------------
//
// A `blocked` body carries `block.overrideParameter`, whose whole purpose is to
// tell the client WHICH REQUEST FIELD to set. It must therefore be this DTO's
// field name, so `restore-preflight.service.ts` exports
// {@link RESTORE_SCHEMA_OVERRIDE_FIELD} and this file ties its schema to it —
// once at compile time ({@link RestoreOverrideFieldIsReal}) and once at run time
// in the spec. The two cannot drift into naming different things.
// =============================================================================

import { createZodDto } from 'nestjs-zod';

import { RESTORE_SCHEMA_OVERRIDE_FIELD, type RestorePreflightResult } from '../restore-preflight.service';
import type { RestoreRollbackResult, StartRestoreResult } from '../database-restore.service';

import {
  rollbackRenamedSchema,
  rollbackRestoreRequestSchema,
  rollbackRestoreStartedSchema,
  rollbackUnavailableSchema,
  startRestoreBlockedSchema,
  startRestoreGuidedSchema,
  startRestoreRequestSchema,
  startRestoreRunningSchema,
  type RestorePreflightView,
  type RollbackRestoreResponse,
  type StartRestoreRequest,
  type StartRestoreResponse,
} from '@marinoscar/platform-contract/db-backup';

// The wire shapes live in `@marinoscar/platform-contract/db-backup` (#740);
// re-exported so every importer of this file keeps its import.
export {
  RESTORE_CONFIRMATION,
  RESTORE_MODES,
  ROLLBACK_CONFIRMATION,
  ROLLBACK_MODES,
  restoreGateSchema,
  restorePreflightSchema,
  restoreRollbackPlanSchema,
  rollbackRenamedSchema,
  rollbackRestoreRequestSchema,
  rollbackRestoreResponseSchema,
  rollbackRestoreStartedSchema,
  rollbackUnavailableSchema,
  startRestoreBlockedSchema,
  startRestoreGuidedSchema,
  startRestoreRequestSchema,
  startRestoreResponseSchema,
  startRestoreRunningSchema,
} from '@marinoscar/platform-contract/db-backup';
/** @stability experimental */
export type {
  RestoreMode,
  RestorePreflightView,
  RollbackMode,
  RollbackRestoreRequest,
  RollbackRestoreResponse,
  StartRestoreRequest,
  StartRestoreResponse,
} from '@marinoscar/platform-contract/db-backup';

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** @stability experimental */
export class StartRestoreRequestDto extends createZodDto(startRestoreRequestSchema) {}

/**
 * Compile-time proof that the field the pre-flight NAMES is a field this DTO
 * HAS.
 *
 * Resolves to `never` — and so fails to compile at its use site below — if
 * `RESTORE_SCHEMA_OVERRIDE_FIELD` is ever changed to something
 * {@link startRestoreRequestSchema} does not accept. Without it, a rename on
 * either side would produce a `blocked` response telling the client to set a
 * parameter the API rejects, which is the most frustrating possible failure:
 * the server has told you exactly what to do and refuses when you do it.
 *
 * @stability experimental
 */
export type RestoreOverrideFieldIsReal =
  typeof RESTORE_SCHEMA_OVERRIDE_FIELD extends keyof StartRestoreRequest
    ? true
    : { error: 'The pre-flight names an override parameter this DTO does not accept' };

/**
 * Fails to compile if the tie above is broken. No runtime form, so it costs
 * nothing at import time.
 *
 * The false branch is an OBJECT rather than `never` on purpose: `never extends
 * true` is `true`, so a `never` false-branch would make this assertion pass in
 * exactly the case it exists to catch.
 */
type AssertTrue<T extends true> = T;
/** @stability experimental */
export type RestoreOverrideFieldTie = AssertTrue<RestoreOverrideFieldIsReal>;

/** @stability experimental */
export class RollbackRestoreRequestDto extends createZodDto(rollbackRestoreRequestSchema) {}

// ---------------------------------------------------------------------------
// The pre-flight verdict, on the wire
// ---------------------------------------------------------------------------

/**
 * The pre-flight result as the API publishes it. Drops nothing but the union member.
 *
 * @stability experimental
 */
export function toPreflightView(preflight: RestorePreflightResult): RestorePreflightView {
  return {
    outcome: preflight.outcome,
    runId: preflight.runId,
    targetDatabase: preflight.targetDatabase,
    scratchDatabase: preflight.scratchDatabase,
    oldDatabase: preflight.oldDatabase,
    // Copied element-wise rather than passed through, so a field added to
    // `RestoreGateResult` for internal use cannot reach the wire unreviewed.
    gates: preflight.gates.map((gate) => ({
      id: gate.id,
      kind: gate.kind,
      verdict: gate.verdict,
      title: gate.title,
      detail: gate.detail,
      action: gate.action,
    })),
    rollback: {
      configured: preflight.rollback.configured,
      effective: preflight.rollback.effective,
      downgraded: preflight.rollback.downgraded,
      reason: preflight.rollback.reason,
    },
    archiveMigration: preflight.archiveMigration,
    liveMigration: preflight.liveMigration,
    databaseSizeBytes: preflight.databaseSizeBytes,
    freeDiskBytes: preflight.freeDiskBytes,
  };
}

// ---------------------------------------------------------------------------
// POST runs/:id/restore
// ---------------------------------------------------------------------------

/**
 * `mode: "running"` on the wire. Registered for `oneOf`; see the union above.
 *
 * @stability experimental
 */
export class StartRestoreRunningDto extends createZodDto(startRestoreRunningSchema) {}

/**
 * `mode: "guided"` on the wire. NOT an error — see this file's header.
 *
 * @stability experimental
 */
export class StartRestoreGuidedDto extends createZodDto(startRestoreGuidedSchema) {}

/**
 * `mode: "blocked"` on the wire. Re-send with `overrideSchemaCheck: true`.
 *
 * @stability experimental
 */
export class StartRestoreBlockedDto extends createZodDto(startRestoreBlockedSchema) {}

/**
 * The three, in the order the controller publishes them.
 *
 * @stability experimental
 */
export const START_RESTORE_RESPONSE_DTOS = [
  StartRestoreRunningDto,
  StartRestoreGuidedDto,
  StartRestoreBlockedDto,
] as const;

/**
 * {@link StartRestoreResult} as the API publishes it.
 *
 * `already_running` is DELIBERATELY NOT REPRESENTED HERE. It is not a mode; it
 * is a 409, because unlike the three above it means the request could not be
 * answered at all. The controller maps it — see there for why the mapping is
 * not in the service.
 *
 * @stability experimental
 */
export function toStartRestoreResponse(
  result: Extract<StartRestoreResult, { outcome: 'started' | 'refused' }>
): StartRestoreResponse {
  if (result.outcome === 'started') {
    return {
      mode: 'running',
      runId: result.runId,
      scratchDatabase: result.scratchDatabase,
      oldDatabase: result.oldDatabase,
      preflight: toPreflightView(result.preflight),
    };
  }

  const { preflight } = result;

  if (preflight.outcome === 'guided') {
    return {
      mode: 'guided',
      runId: preflight.runId,
      guidance: {
        reason: preflight.guidance.reason,
        commands: preflight.guidance.commands,
        runbook: preflight.guidance.runbook,
      },
      preflight: toPreflightView(preflight),
    };
  }

  if (preflight.outcome === 'blocked') {
    return {
      mode: 'blocked',
      runId: preflight.runId,
      block: {
        gateId: preflight.block.gateId,
        message: preflight.block.message,
        overridable: preflight.block.overridable,
        overrideParameter: preflight.block.overrideParameter,
      },
      preflight: toPreflightView(preflight),
    };
  }

  // ⚠ UNREACHABLE BY CONSTRUCTION, and thrown rather than defaulted. `refused`
  // exists only because the pre-flight was not `ok`, so an `ok` verdict here
  // means the restore service returned "refused" about a verdict that permits
  // the restore. Quietly answering `blocked` would hide a contradiction between
  // two files in the one subsystem where a wrong answer is destructive.
  throw new Error(
    `A restore of backup run ${preflight.runId} was refused with an "ok" pre-flight, which ` +
      'is a contradiction. Nothing was started.'
  );
}

// ---------------------------------------------------------------------------
// POST runs/:id/rollback
// ---------------------------------------------------------------------------

/**
 * `mode: "renamed"` on the wire. Seconds.
 *
 * @stability experimental
 */
export class RollbackRenamedDto extends createZodDto(rollbackRenamedSchema) {}

/**
 * `mode: "restore_started"` on the wire. Hours.
 *
 * @stability experimental
 */
export class RollbackRestoreStartedDto extends createZodDto(rollbackRestoreStartedSchema) {}

/**
 * `mode: "unavailable"` on the wire. A `200`, and honest.
 *
 * @stability experimental
 */
export class RollbackUnavailableDto extends createZodDto(rollbackUnavailableSchema) {}

/**
 * The three, in the order the controller publishes them.
 *
 * @stability experimental
 */
export const ROLLBACK_RESPONSE_DTOS = [
  RollbackRenamedDto,
  RollbackRestoreStartedDto,
  RollbackUnavailableDto,
] as const;

/**
 * {@link RestoreRollbackResult} as the API publishes it.
 *
 * @stability experimental
 */
export function toRollbackResponse(result: RestoreRollbackResult): RollbackRestoreResponse {
  switch (result.outcome) {
    case 'renamed':
      return {
        mode: 'renamed',
        runId: result.runId,
        promoted: result.promoted,
        parked: result.parked,
        detail:
          `The database displaced by this restore ("${result.promoted}") has been renamed ` +
          `back into place and the restored one parked as "${result.parked}". This process ` +
          'is exiting so its connection pool can be rebuilt; the service returns on its own ' +
          'once the supervisor restarts it.',
      };

    case 'restore_started':
      return {
        mode: 'restore_started',
        runId: result.runId,
        preRestoreRunId: result.preRestoreRunId,
        detail:
          'There was no retained database to rename, so the safety backup taken immediately ' +
          `before the restore (run ${result.preRestoreRunId}) is being restored instead, ` +
          'with the schema check overridden. This takes as long as the original restore ' +
          `did — poll GET runs/${result.preRestoreRunId} for progress, not this run.`,
      };

    case 'unavailable':
      // The service's own sentence, unedited. It is the only thing that knows
      // whether the retained database expired or never existed, and rewriting
      // it here would put a second, vaguer explanation on the wire.
      return { mode: 'unavailable', runId: result.runId, detail: result.reason };
  }
}

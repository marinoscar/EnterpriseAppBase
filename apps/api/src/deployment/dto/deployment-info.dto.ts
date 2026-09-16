import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { deployStateSchema } from '../deploy-state.schema';

// =============================================================================
// GET /api/admin/deployment — response body (issue #392, epic #388)
// =============================================================================
//
// ⚠ THE INVARIANT THIS FILE HOLDS: `configured` IS THE ONLY THING A CLIENT MAY
// BRANCH ON, AND `deployment` IS NULLABLE BECAUSE IT IS GENUINELY OFTEN NULL.
//
// This endpoint answers `200` whether or not a deployment record exists — see
// `deployment.service.ts` for the argument — so the status code carries no
// information about whether there is anything to show. A client that renders
// `deployment.commitSha` without checking `configured` first crashes on every
// developer machine in the project, which is precisely the audience most likely
// to hit it.
//
// `runtime` IS NEVER NULL, and that is the reason it is a separate object
// rather than fields folded into `deployment`. The process can always say what
// version it is, when it started and what Node it is on; a merged shape would
// make those unavailable exactly when a broken state file makes them most
// useful ("the file is unreadable, but the API says it started four minutes
// ago at version 1.4.2").
//
// -----------------------------------------------------------------------------
// ⚠ NO `.transform()`, `.pipe()` OR `.refine()`-WITH-OUTPUT-CHANGE ANYWHERE
// BELOW, NOR IN `deploy-state.schema.ts` WHICH THIS EMBEDS
// -----------------------------------------------------------------------------
//
// `createZodDto` renders this schema to JSON Schema for the OpenAPI document at
// BOOT. A transform has no JSON Schema representation, so `nestjs-zod` throws
// rather than degrading — and it throws while building the document for the
// WHOLE API, taking `/api/docs` and `/api/openapi.json` down over one field on
// one admin endpoint. Serving policy (history truncation) therefore lives in
// `DeploymentService`, not in the schema. The same rule is why every timestamp
// in this repository's response DTOs is `z.iso.datetime()` rather than
// `z.date()`; see `storage/config/dto/storage-config-response.dto.ts`.
// =============================================================================

/**
 * Why there is no deployment record. `null` when there is one.
 *
 * Three values rather than a single boolean because the remedies differ and an
 * operator needs to know which one they are looking at: `not-found` is usually
 * correct and needs nothing, `unreadable` is a mount or permission problem on
 * the host, `invalid` means the file is there and is wrong.
 */
export const deploymentSourceReasonSchema = z.enum([
  'not-found',
  'unreadable',
  'invalid',
]);

/**
 * Facts the container can answer about itself, with no state file involved.
 *
 * Present on every response, including — especially — the ones where nothing
 * else is.
 */
export const deploymentRuntimeSchema = z.object({
  /**
   * The same string `/api/docs` stamps into `info.version`, from the same
   * `resolveApiVersion()`. Not a second resolver: two version numbers that can
   * disagree are worse than one that is occasionally `'0.0.0'`.
   */
  apiVersion: z.string(),

  /**
   * When THIS PROCESS started, ISO 8601.
   *
   * Reconstructed from `process.uptime()` and frozen at construction, so it
   * does not jitter between polls. Note what it is NOT: it is not when the
   * deployment happened. A container restarted by the Docker daemon at 3am
   * moves this and leaves `deployment.lastDeployedAt` alone, and the gap
   * between the two is itself the useful signal.
   */
  startedAt: z.iso.datetime(),

  /** `process.version`, e.g. `v24.4.1`. */
  nodeVersion: z.string(),

  /** `NODE_ENV`, defaulted to `development` when unset — as the app does. */
  nodeEnv: z.string(),

  /**
   * ⚠ THE CONTAINER'S hostname (on Docker, the container id) — NOT the
   * machine's, and the single most misreadable field in this response.
   *
   * The host's own hostname is `deployment.host.hostname`, captured by the
   * installer outside any container. The two sit in the same body and name two
   * different machines. What tells them apart is the OBJECT each lives in:
   * `runtime` is the process answering the request, `deployment.host` is the
   * server it was installed on. That is why this field must never be hoisted to
   * the top level, where the grouping — and with it the only thing
   * distinguishing them — disappears.
   */
  hostname: z.string(),
});

/** Where the record was looked for, and what came of looking. */
export const deploymentSourceSchema = z.object({
  /**
   * The resolved path that was read, or `null` when `DEPLOY_STATE_FILE` is
   * unset — i.e. when nothing was looked for at all.
   *
   * ⚠ Null is NOT "we looked in the default place and found nothing": there is
   * no default place. See `DEPLOY_STATE_FILE_ENV` in the service for why
   * guessing one would have every dev machine stat a production path.
   */
  path: z.string().nullable(),

  /** Null when `configured` is true. */
  reason: deploymentSourceReasonSchema.nullable(),
});

export const deploymentInfoSchema = z.object({
  /**
   * Whether a deployment record was found AND parsed. The only field a client
   * may branch on; see this file's header.
   */
  configured: z.boolean(),

  /**
   * The parsed state file, stripped of unknown keys, or `null`.
   *
   * A `version: 1` record carries no `host`, `proxy` or `history` — those
   * sections were added by v2 and a v1 file is served without them rather than
   * refused. See `deploy-state.schema.ts`.
   */
  deployment: deployStateSchema.nullable(),

  runtime: deploymentRuntimeSchema,
  source: deploymentSourceSchema,
});

export class DeploymentInfoDto extends createZodDto(deploymentInfoSchema) {}

export type DeploymentInfoResponse = z.infer<typeof deploymentInfoSchema>;

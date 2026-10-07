// =============================================================================
// /api/admin/telemetry/stack (issue #567; moved here from the API's
// `telemetry/stack/dto/telemetry-stack.dto.ts` by #702)
// =============================================================================
//
// A diagnosis, never an error: a deployment without a stack-agent (every
// development machine) is `agent: 'not_configured'` with a 200, so the admin
// page can say so instead of rendering a failure.
// =============================================================================

import { z } from 'zod';

import {
  TELEMETRY_STACK_AGENT_STATES,
  TELEMETRY_STACK_DEPLOY_STATUSES,
  TELEMETRY_STACK_SERVICE_HEALTH,
  TELEMETRY_STACK_SERVICE_STATES,
} from './constants.js';

/**
 * One telemetry service's container: `name` (`greptimedb`,
 * `otel-collector`), `state` and `health` (or `null`).
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetryStackServiceSchema = z.object({
  /** The compose service, e.g. `greptimedb` or `otel-collector`. */
  name: z.string(),
  /** The container's state; `missing` when it has never been created. */
  state: z.enum(TELEMETRY_STACK_SERVICE_STATES),
  /** The container's health check, or null when it has none (or is not running). */
  health: z.enum(TELEMETRY_STACK_SERVICE_HEALTH).nullable(),
});

/**
 * One telemetry service's container.
 *
 * @stability stable
 */
export type TelemetryStackService = z.infer<typeof telemetryStackServiceSchema>;

/**
 * The most recent `telemetry.stack.deploy` job: `jobId`, `status`,
 * `createdAt`, `finishedAt`, `error` and `output` (a tail of at most 4 KB).
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetryStackDeploySchema = z.object({
  jobId: z.string(),
  status: z.enum(TELEMETRY_STACK_DEPLOY_STATUSES),
  createdAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  /** Why the deploy failed (`Job.lastError`), or null. */
  error: z.string().nullable(),
  /** The agent's command output (tail, at most 4 KB), or null before it answered. */
  output: z.string().nullable(),
});

/**
 * The most recent stack deploy job.
 *
 * @stability stable
 */
export type TelemetryStackDeploy = z.infer<typeof telemetryStackDeploySchema>;

/**
 * `GET /api/admin/telemetry/stack`: `agent`, `agentError`, `services` and
 * the latest `deploy`.
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetryStackStatusSchema = z.object({
  /**
   * `available` — the stack-agent answered; `unavailable` — it is configured but
   * could not be reached (or answered unexpectedly); `unauthorized` — it refused
   * the API's token; `not_configured` — this deployment has no stack-agent.
   */
  agent: z.enum(TELEMETRY_STACK_AGENT_STATES),
  /**
   * Why the stack-agent is `unavailable` or `unauthorized`: the client's
   * message (the agent's origin and the failure, never the token). Null when
   * `agent` is `available` or `not_configured`.
   */
  agentError: z
    .string()
    .nullable()
    .describe(
      'Why the stack agent is `unavailable` or `unauthorized`: the agent origin and the failure ' +
        '(for example a timeout, a connection error or the HTTP status). Never carries the token. ' +
        'Null when `agent` is `available` or `not_configured`.',
    ),
  /** Each telemetry service's container. Empty unless `agent` is `available`. */
  services: z.array(telemetryStackServiceSchema),
  /** The most recent `telemetry.stack.deploy` job, or null when there has never been one. */
  deploy: telemetryStackDeploySchema.nullable(),
});

/**
 * `GET /api/admin/telemetry/stack`.
 *
 * @stability stable
 */
export type TelemetryStackStatus = z.infer<typeof telemetryStackStatusSchema>;

/**
 * `POST /api/admin/telemetry/stack/deploy` response (202): the deploy
 * `jobId`, a new one or the one already pending or running.
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetryStackDeployStartedSchema = z.object({
  /** The deploy job — a new one, or the one already pending/running. */
  jobId: z.string(),
});

/**
 * `POST /api/admin/telemetry/stack/deploy` response.
 *
 * @stability stable
 */
export type TelemetryStackDeployStarted = z.infer<typeof telemetryStackDeployStartedSchema>;

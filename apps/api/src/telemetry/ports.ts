// =============================================================================
// The telemetry slice's host ports (issue #703, PP-4.2)
// =============================================================================
//
// Every capability telemetry needs from the application, as ONE injection
// token per capability. The slice injects these and never imports an app
// service; the app binds each token to an adapter of its own
// (`apps/api/src/platform/telemetry/`). Each interface is derived from the
// exact calls telemetry makes; nothing wider.
//
// The core host ports (`AUDIT_SINK`, `SYSTEM_SETTINGS_STORE`, issue #696) are
// NOT reused for audit and settings, on purpose:
//
//   - `AuditSink` takes scalar `meta` only; telemetry's audit rows carry the
//     changed field NAMES (arrays) and the dashboard's request parameters (an
//     object), exactly as they did before the move.
//   - `SystemSettingsStore` reads one namespace; telemetry also needs the
//     row's provenance (who saved it, when) and its own keyed row
//     (`telemetry_connection`), which is not a namespace.
//
// Logging, metrics and spans need no port: `new Logger(Context)` and
// `@opentelemetry/api`, as the core README says.
//
// The tokens are `Symbol.for(...)` keys, so two copies of this file (two
// bundles, a test that loads the source next to the built package) agree.
// =============================================================================

import type { Logger } from '@nestjs/common';
import type { TelemetrySettings } from '@marinoscar/platform-contract/telemetry';
import type { z } from 'zod';

// ---- audit ------------------------------------------------------------------------

/**
 * Injection token of the app's {@link TelemetryAuditSink}.
 *
 * @extensionPoint token
 * @stability experimental
 */
export const TELEMETRY_AUDIT_SINK: unique symbol = Symbol.for('@marinoscar/platform/telemetry/AUDIT_SINK');

/**
 * One telemetry audit event. `meta` never carries secret material: SQL text,
 * field names, counts and request parameters only.
 *
 * @stability experimental
 */
export interface TelemetryAuditEvent {
  /** Who did it; `null` for the system itself. */
  actorUserId: string | null;
  /** What happened (`telemetry:query`, `telemetry:config_update`, ...). */
  action: string;
  /** The kind of thing it happened to (`telemetry_store`, `telemetry_config`, `job`, ...). */
  targetType: string;
  /** Which one. */
  targetId: string;
  /** JSON-serialisable facts about the event. Never secret material. */
  meta?: Record<string, unknown>;
}

/**
 * Where telemetry records its audit events. The reference app writes them to
 * `audit_events`, with the same columns as before the move.
 *
 * @stability experimental
 */
export interface TelemetryAuditSink {
  /**
   * Persists one audit event. Called after the triggering write committed.
   *
   * @param event - the event; its `meta` is stored as JSON.
   */
  record(event: TelemetryAuditEvent): Promise<void>;
}

// ---- settings -----------------------------------------------------------------------

/**
 * Injection token of the app's {@link TelemetrySettingsStore}.
 *
 * @extensionPoint token
 * @stability experimental
 */
export const TELEMETRY_SETTINGS_STORE: unique symbol = Symbol.for('@marinoscar/platform/telemetry/SETTINGS_STORE');

/**
 * Who saved a settings row last, and when.
 *
 * @stability experimental
 */
export interface TelemetrySettingsProvenance {
  /** The row version, for `If-Match` optimistic concurrency. */
  version: number;
  /** When the row was last written. */
  updatedAt: Date;
  /** Who wrote it last, or `null` (seeded, or the user was deleted). */
  updatedBy: { id: string; email: string } | null;
}

/**
 * One keyed system-settings row telemetry owns (`telemetry_connection`): its
 * raw stored value plus its provenance.
 *
 * @stability experimental
 */
export interface TelemetrySettingsRow extends TelemetrySettingsProvenance {
  /** The stored JSON, unvalidated; telemetry validates it itself. */
  value: unknown;
}

/**
 * The platform features `get_app_context` reports to the assistant, as
 * booleans. An explicit allowlist: the settings are never serialised wholesale.
 *
 * @stability experimental
 */
export type TelemetryFeatureFlag = 'ai' | 'maintenanceMode' | 'databaseBackup' | 'browserNotifications' | 'nodeJobSecretBroker';

/**
 * The app's system settings, as telemetry uses them: the `telemetry`
 * namespace, its provenance, telemetry's own keyed row and an allowlist of
 * feature flags.
 *
 * @stability experimental
 */
export interface TelemetrySettingsStore {
  /** The validated `telemetry` namespace (defaults applied). Uncached: telemetry caches it itself. */
  getTelemetryPolicy(): Promise<TelemetrySettings>;
  /**
   * Replaces the `telemetry` namespace through the app's own settings write
   * (its validation, its `If-Match` re-check and its settings audit row).
   *
   * @param next - the full namespace value.
   * @param actorUserId - who saves it.
   * @param expectedVersion - the `If-Match` version, re-checked by the write; `undefined` skips the check.
   */
  replaceTelemetryPolicy(next: TelemetrySettings, actorUserId: string, expectedVersion?: number): Promise<void>;
  /** The provenance of the row the `telemetry` namespace lives in, WITHOUT creating it; `null` when absent. */
  readPolicyProvenance(): Promise<TelemetrySettingsProvenance | null>;
  /**
   * One keyed row telemetry owns, or `null` when absent.
   *
   * @param key - the row key (`telemetry_connection`).
   */
  readRow(key: string): Promise<TelemetrySettingsRow | null>;
  /**
   * Creates or replaces one keyed row, incrementing its version.
   *
   * @param key - the row key.
   * @param value - the JSON to store; never secret material.
   * @param actorUserId - who saves it.
   */
  writeRow(key: string, value: unknown, actorUserId: string): Promise<void>;
  /**
   * Deletes one keyed row; a no-op when it is absent.
   *
   * @param key - the row key.
   */
  deleteRow(key: string): Promise<void>;
  /**
   * One allowlisted platform feature switch.
   *
   * @param flag - which switch.
   */
  readFeatureFlag(flag: TelemetryFeatureFlag): Promise<boolean>;
}

// ---- credentials --------------------------------------------------------------------

/**
 * Injection token of the app's {@link TelemetryCredentialStore}.
 *
 * @extensionPoint token
 * @stability experimental
 */
export const TELEMETRY_CREDENTIAL_STORE: unique symbol = Symbol.for('@marinoscar/platform/telemetry/CREDENTIAL_STORE');

/**
 * A stored credential's metadata. Never the secret.
 *
 * @stability experimental
 */
export interface TelemetryCredentialInfo {
  /** The credential's purpose (`telemetry_greptime`). */
  readonly purpose: string;
  /** Its name within the purpose (`reader`, `admin`). */
  readonly name: string;
  /** A short non-secret hint (the last characters), or `null`. */
  readonly hint: string | null;
  /** A human label, or `null`. */
  readonly label: string | null;
  /** Who stored it last, or `null`. */
  readonly updatedByUserId: string | null;
  /** When it was first stored. */
  readonly createdAt: Date;
  /** When it was last stored. */
  readonly updatedAt: Date;
}

/**
 * The app's encrypted credential store, addressed by `(purpose, name)`.
 * Telemetry uses one purpose: `telemetry_greptime` (`reader`, `admin`).
 *
 * @stability experimental
 */
export interface TelemetryCredentialStore {
  /**
   * The decrypted secret, or `null` when none is stored. Held only for the call that needs it.
   *
   * @param purpose - the purpose.
   * @param name - the name.
   */
  getSecret(purpose: string, name: string): Promise<string | null>;
  /**
   * Stores (encrypts) a secret; a blank one deletes it.
   *
   * @param purpose - the purpose.
   * @param name - the name.
   * @param secret - the plaintext.
   * @param meta - non-secret metadata.
   */
  setSecret(
    purpose: string,
    name: string,
    secret: string | null | undefined,
    meta?: { readonly label?: string | null; readonly updatedByUserId?: string | null },
  ): Promise<void>;
  /**
   * Deletes a secret; a no-op when none is stored.
   *
   * @param purpose - the purpose.
   * @param name - the name.
   */
  deleteSecret(purpose: string, name: string): Promise<void>;
  /**
   * A secret's metadata, or `null` when none is stored.
   *
   * @param purpose - the purpose.
   * @param name - the name.
   */
  describe(purpose: string, name: string): Promise<TelemetryCredentialInfo | null>;
}

// ---- jobs ---------------------------------------------------------------------------

/**
 * Injection token of the app's {@link TelemetryJobsPort}.
 *
 * @extensionPoint token
 * @stability experimental
 */
export const TELEMETRY_JOBS: unique symbol = Symbol.for('@marinoscar/platform/telemetry/JOBS');

/**
 * The columns of one queue job telemetry reads.
 *
 * @stability experimental
 */
export interface TelemetryJobRecord {
  /** The job id. */
  id: string;
  /** Its handler type (`telemetry.stack.deploy`). */
  type: string;
  /** `pending`, `running`, `succeeded`, `failed`, ... */
  status: string;
  /** The handler-defined payload (JSON). */
  payload: unknown;
  /** When it was queued. */
  createdAt: Date;
  /** When it settled, or `null`. */
  finishedAt: Date | null;
  /** The last attempt's error, or `null`. */
  lastError: string | null;
}

/**
 * A job type's execution profile: the lease and the reaper's patience are
 * derived from `maxRuntimeMs`.
 *
 * @stability experimental
 */
export interface TelemetryJobExecutionProfile {
  /** The longest one attempt may run. */
  maxRuntimeMs: number;
  /** Attempts before the job fails for good. */
  maxAttempts: number;
}

/**
 * A telemetry job type's handler, structurally the app's `JobHandler`. Both
 * telemetry job types are SERVER-ONLY: they declare no `nodeResultSchema` and
 * no `persistNodeResult`, because they hold the GreptimeDB admin login and the
 * stack-agent token, privileges a worker node must never hold.
 *
 * @stability experimental
 */
export interface TelemetryJobHandler {
  /** The job type. Permanent once jobs of it exist. */
  readonly type: string;
  /** The execution profile (`maxRuntimeMs`, `maxAttempts`). */
  readonly profile?: TelemetryJobExecutionProfile;
  /**
   * Runs one job; throws to fail it.
   *
   * @param job - the claimed job.
   */
  process(job: TelemetryJobRecord): Promise<void>;
}

/**
 * The app's job queue, as telemetry uses it.
 *
 * @stability experimental
 */
export interface TelemetryJobsPort {
  /**
   * Queues a job (or returns the active one with the same dedup key).
   *
   * @param input - the type, why it exists, and its payload.
   */
  enqueue(input: {
    type: string;
    reason: 'upload' | 'rerun' | 'backfill';
    payload?: Record<string, unknown>;
  }): Promise<{ id: string; status: string }>;
  /**
   * Queues one global housekeeping job of `type` unless one is pending or
   * running. Never throws: a failure is logged on `logger`.
   *
   * @param options - the type, a lower-case phrase for the log line, and the caller's logger.
   */
  enqueueHousekeepingJob(options: { type: string; what: string; logger: Logger }): Promise<void>;
  /**
   * Registers a handler with the queue's dispatcher. Call it from `onModuleInit`.
   *
   * @param handler - the handler.
   */
  registerHandler(handler: TelemetryJobHandler): void;
  /**
   * The most recently queued job of `type`, or `null`.
   *
   * @param type - the job type.
   */
  findLatest(type: string): Promise<TelemetryJobRecord | null>;
  /**
   * Replaces one job's payload.
   *
   * @param jobId - the job.
   * @param payload - the new payload (JSON).
   */
  updatePayload(jobId: string, payload: Record<string, unknown>): Promise<void>;
}

// ---- AI -----------------------------------------------------------------------------

/**
 * Injection token of the app's {@link TelemetryAiPort}.
 *
 * @extensionPoint token
 * @stability experimental
 */
export const TELEMETRY_AI: unique symbol = Symbol.for('@marinoscar/platform/telemetry/AI');

/**
 * A failure of the AI platform (key missing, model not reachable, AI off, ...).
 *
 * @stability experimental
 */
export interface TelemetryAiError {
  /** The platform's `AI_*` code. */
  readonly code: string;
  /** A message safe to show. Never key material. */
  readonly message: string;
  /** For `AI_RATE_LIMITED`: how long to wait, when the provider said. */
  readonly retryAfterMs?: number | null;
}

/**
 * One input message of the conversation.
 *
 * @stability experimental
 */
export interface TelemetryAiInputMessage {
  /** Always `message`. */
  type: 'message';
  /** Who said it. */
  role: 'user' | 'assistant';
  /** Its text parts. */
  content: { type: 'text'; text: string }[];
}

/**
 * What a tool's `execute` receives besides its arguments.
 *
 * @stability experimental
 */
export interface TelemetryAiToolContext {
  /** Aborted when the turn is cancelled or the tool times out. */
  signal?: AbortSignal;
}

/**
 * A tool, as the assistant declares it.
 *
 * @typeParam P - the arguments schema (an object schema).
 * @typeParam R - what `execute` returns (serialised to JSON for the model).
 *
 * @stability experimental
 */
export interface TelemetryAiToolDefinition<P extends z.ZodType, R> {
  /** `[a-zA-Z0-9_-]{1,64}`. */
  name: string;
  /** What the tool does, for the model. */
  description: string;
  /** The arguments schema. */
  parameters: P;
  /**
   * Runs the tool.
   *
   * @param args - the validated arguments.
   * @param ctx - the abort signal.
   */
  execute(args: z.output<P>, ctx: TelemetryAiToolContext): Promise<R> | R;
}

/**
 * A tool as the AI platform defined it. Opaque to telemetry: handed back to
 * {@link TelemetryAiSession.runTools} unchanged.
 *
 * @stability experimental
 */
export interface TelemetryAiTool {
  /** Brand; the value belongs to the AI platform. */
  readonly __telemetryAiTool?: never;
}

/**
 * One function call the model made, and what came of it.
 *
 * @stability experimental
 */
export interface TelemetryAiToolCallRecord {
  /** The provider's call id. */
  callId: string;
  /** The tool name the model asked for. */
  name: string;
  /** The raw arguments string the model produced. */
  arguments: string;
  /** `ok`, `invalid_arguments`, `unknown_tool`, `error` or `timeout`. */
  status: 'ok' | 'invalid_arguments' | 'unknown_tool' | 'error' | 'timeout';
  /** What was fed back to the model. */
  output: string;
  /** The tool's error message on `error` or `timeout`. */
  error?: string;
  /** How long the call took. */
  durationMs: number;
}

/**
 * The part of a model response telemetry reads.
 *
 * @stability experimental
 */
export interface TelemetryAiResponse {
  /** The response's text, if any. */
  outputText?: string | null;
}

/**
 * One provider round-trip of the tool loop.
 *
 * @stability experimental
 */
export interface TelemetryAiToolStep {
  /** 1-based round-trip index. */
  step: number;
  /** The provider's response. */
  response: TelemetryAiResponse;
  /** The calls it produced; empty on the final step. */
  calls: TelemetryAiToolCallRecord[];
}

/**
 * What a tool loop returns.
 *
 * @stability experimental
 */
export interface TelemetryAiToolLoopResult {
  /** The last provider response. */
  final: TelemetryAiResponse;
  /** Every round-trip. */
  steps: TelemetryAiToolStep[];
  /** Whether the model finished or the step budget ran out. */
  stopReason: 'completed' | 'steps_exhausted';
}

/**
 * One tool loop, as the assistant asks for it.
 *
 * @stability experimental
 */
export interface TelemetryAiToolLoopRequest {
  /** The provider id. */
  provider: string;
  /** The model id. */
  model: string;
  /** The system prompt. */
  instructions: string;
  /** The conversation. */
  input: TelemetryAiInputMessage[];
  /** Tools from {@link TelemetryAiPort.defineTool}. */
  tools: TelemetryAiTool[];
  /** Round-trips allowed. */
  maxSteps: number;
  /** Per-tool timeout. */
  toolTimeoutMs: number;
  /**
   * Called after every round-trip, in order.
   *
   * @param step - the round-trip.
   */
  onStep(step: TelemetryAiToolStep): void;
}

/**
 * The AI platform on behalf of one user: their key policy, their usage rows.
 *
 * @stability experimental
 */
export interface TelemetryAiSession {
  /**
   * Runs a tool loop.
   *
   * @param request - the loop.
   * @param options - an abort signal.
   */
  runTools(request: TelemetryAiToolLoopRequest, options: { signal?: AbortSignal }): Promise<TelemetryAiToolLoopResult>;
}

/**
 * The app's AI platform, as the telemetry assistant uses it. Every model call
 * goes through `forUser(userId)` (the platform's gate, key resolution and usage
 * accounting); no provider SDK and no key ever reaches telemetry.
 *
 * @stability experimental
 */
export interface TelemetryAiPort {
  /**
   * The facade for one user.
   *
   * @param userId - the caller.
   */
  forUser(userId: string): TelemetryAiSession;
  /**
   * Declares a tool.
   *
   * @param definition - the tool.
   */
  defineTool<P extends z.ZodType, R>(definition: TelemetryAiToolDefinition<P, R>): TelemetryAiTool;
  /**
   * Whether `error` is the AI platform's own failure.
   *
   * @param error - anything thrown.
   */
  isAiError(error: unknown): error is TelemetryAiError;
  /** Throws the app's "AI is off" error (403 `AI_DISABLED`) while the AI platform is switched off. */
  assertEnabled(): Promise<void>;
}

// ---- app identity -------------------------------------------------------------------

/**
 * Injection token of the app's {@link TelemetryAppInfo}.
 *
 * @extensionPoint token
 * @stability experimental
 */
export const TELEMETRY_APP_INFO: unique symbol = Symbol.for('@marinoscar/platform/telemetry/APP_INFO');

/**
 * The deploy document's fields the assistant reports (`get_app_context`).
 *
 * @stability experimental
 */
export interface TelemetryDeployInfo {
  /** `ok`, `absent` or `invalid`. */
  status: string;
  /** Present exactly when `status` is `ok`. */
  document: {
    /** The deployed version and commit. */
    app: { version: string | null; commitSha: string | null };
    /** When the deployment was first installed. */
    installedAt: string | null;
    /** When it was last updated. */
    updatedAt: string | null;
    /** The last deploy command. */
    lastCommand: string | null;
    /** The last deploy run. */
    run: { outcome: string | null } | null;
  } | null;
}

/**
 * Who the application is: its slug (the default telemetry instance id), its
 * OpenTelemetry service name, its version and its deploy document.
 *
 * @stability experimental
 */
export interface TelemetryAppInfo {
  /** The app's slug: the instance id when `telemetry.instanceId` is unset. */
  readonly slug: string;
  /** The service name this process reports to OpenTelemetry. */
  serviceName(): string;
  /** The API's version. */
  apiVersion(): string;
  /** The deploy document (read from disk on every call). */
  readDeployInfo(): Promise<TelemetryDeployInfo>;
}

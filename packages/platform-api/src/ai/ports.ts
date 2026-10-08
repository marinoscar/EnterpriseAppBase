// =============================================================================
// The AI slice's host ports (issue #739, PP-8.6)
// =============================================================================
//
// Every capability the AI platform needs from the application, as ONE
// injection token per capability. The slice injects these and never imports
// an app service; the app binds each token in a module of its own (the
// reference app: `apps/api/src/platform/ai/ai-host.module.ts`), passed to
// `AiModule.forRoot({ imports })`. Each interface is derived from the exact
// calls the slice makes; nothing wider.
//
// The request-path database is the core port `PLATFORM_PRISMA`, seen as
// `AiPrisma` (`data/ai-db.ts`).
//
// The tokens are `Symbol.for(...)` keys, so two copies of this file agree.
// =============================================================================

import type { Readable } from 'node:stream';

import type { AiSystemPrisma } from './data/ai-db';

// ---- the bypass client -------------------------------------------------------------------

/**
 * Injection token of the app's {@link AiSystemPrisma}: the bypass client, for
 * the two retention purges, the deployment-wide usage report and the
 * catalogue sync's organization-less usage row. Required.
 *
 * @example
 * ```ts
 * // AiHostModule: { provide: AI_SYSTEM_PRISMA, useExisting: PrismaSystemService }
 * ```
 *
 * @extensionPoint token
 * @stability experimental
 */
export const AI_SYSTEM_PRISMA: unique symbol = Symbol.for('@marinoscar/platform/ai/SYSTEM_PRISMA');

// ---- object storage ----------------------------------------------------------------------

/**
 * Injection token of the app's {@link AiObjectStore}. Required: image, audio
 * and file-input runs read and write storage objects through it.
 *
 * @example
 * ```ts
 * // AiHostModule: { provide: AI_OBJECT_STORE, useClass: AiObjectStoreAdapter }
 * ```
 *
 * @extensionPoint token
 * @stability experimental
 */
export const AI_OBJECT_STORE: unique symbol = Symbol.for('@marinoscar/platform/ai/OBJECT_STORE');

/**
 * The object store, as the AI output writer and the storage-input resolver
 * use it: exactly the provider calls (`upload`, `delete`, `download`,
 * `getSignedDownloadUrl`) and the configuration questions (`assertWritable`,
 * `activeProvider`, `notConfiguredReason`) those two files make. The
 * reference app binds an adapter over its `STORAGE_PROVIDER` and
 * `StorageConfigService`.
 *
 * The `storage_objects` rows themselves are written through the AI slice's
 * own structural view of the table (`AiDb.storageObject`), in the caller's
 * organization scope.
 *
 * @stability experimental
 */
export interface AiObjectStore {
  /**
   * Uploads one object.
   *
   * @param key - the object key (`ai-outputs/<userId>/<runId>/...`).
   * @param body - the bytes.
   * @param opts - MIME type and exact length.
   * @returns the bucket the object landed in.
   */
  upload(
    key: string,
    body: Readable,
    opts: { mimeType: string; contentLength: number },
  ): Promise<{
    /** The bucket the object landed in. */
    bucket: string;
  }>;
  /**
   * Deletes one object. A missing object is not an error.
   *
   * @param key - the object key.
   */
  delete(key: string): Promise<void>;
  /**
   * Opens one object for reading.
   *
   * @param key - the object key.
   */
  download(key: string): Promise<Readable>;
  /**
   * A short-lived download URL for one object (a provider fetches a file
   * input from it).
   *
   * @param key - the object key.
   * @param opts - `expiresIn` seconds.
   */
  getSignedDownloadUrl(key: string, opts: { expiresIn: number }): Promise<string>;
  /**
   * Resolves when this deployment has usable object storage; otherwise
   * throws the app's own "storage not configured" error (a 503 with its
   * remedy). Writes nothing.
   */
  assertWritable(): Promise<void>;
  /** The provider id recorded on a new `storage_objects` row (`s3`). */
  activeProvider(): Promise<string>;
  /**
   * When `err` is the app's "storage not configured" error, its reason
   * (`storage_not_configured`, `missing_credentials`, ...); otherwise `null`.
   * A background run records `AI_STORAGE_UNAVAILABLE` for it.
   *
   * @param err - anything a storage call threw.
   */
  notConfiguredReason(err: unknown): string | null;
  /** The admin path where storage is configured (`/admin/settings/storage`), for messages. */
  readonly settingsPath: string;
}

// ---- metrics -----------------------------------------------------------------------------

/**
 * Injection token of the app's {@link AiMetrics}. Optional: without it the
 * slice records no `app.ai.*` metric.
 *
 * @example
 * ```ts
 * // AiHostModule: { provide: AI_METRICS, useExisting: AppMetricsService }
 * ```
 *
 * @extensionPoint token
 * @stability experimental
 */
export const AI_METRICS: unique symbol = Symbol.for('@marinoscar/platform/ai/METRICS');

/**
 * One inference, as the usage recorder reports it to the app's metrics. No
 * user, no organization, no key: every label is bounded.
 *
 * @stability experimental
 */
export interface AiUsageMetricEvent {
  /** Provider id. */
  provider: string;
  /** Model id. */
  model: string;
  /** `AiOperation`. */
  operation: string;
  /** `ok` or `error`. */
  status: string;
  /** `user`, `org` or `none`. */
  keySource?: string;
  /** Wall-clock latency. */
  latencyMs: number;
  /** Input tokens. */
  inputTokens?: number | null;
  /** Output tokens. */
  outputTokens?: number | null;
  /**
   * The registered feature the call was made for (`registerAiFeature`), when
   * the caller named one. Bounded by the feature registry.
   */
  feature?: string;
}

/**
 * The app's AI instruments (`app.ai.*`). The reference app binds its
 * `AppMetricsService` (same instruments, same labels as before the move).
 *
 * @stability experimental
 */
export interface AiMetrics {
  /**
   * Records one inference.
   *
   * @param event - the call.
   */
  aiUsage(event: AiUsageMetricEvent): void;
}

/**
 * The metrics used when the app binds none: a no-op.
 *
 * @stability experimental
 */
export const NOOP_AI_METRICS: AiMetrics = Object.freeze({ aiUsage: () => undefined });

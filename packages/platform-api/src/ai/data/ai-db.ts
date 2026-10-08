// =============================================================================
// The data the AI slice reads and writes, structurally (issue #739, PP-8.6)
// =============================================================================
//
// The slice never imports a generated Prisma client, not even its types (the
// rule of identity, jobs, settings and sharing: `test/no-generated-client.spec.ts`).
// The package is built, type-checked and tested before any app's `prisma
// generate`, and works with any app that composed the `ai` fragment of
// `@marinoscar/platform-db` (`AiModel`, `UserAiKey`, `AiRun`, `AiUsageEvent`).
//
// THE CLIENT ARRIVES THROUGH THE CORE PORT `PLATFORM_PRISMA` and is seen as
// {@link AiPrisma}; the bypass client through `AI_SYSTEM_PRISMA` (./ports.ts)
// and is seen as {@link AiSystemPrisma}. Every delegate method takes Prisma's
// arguments untyped (`AiQueryArgs`) and returns the model's row: a call that
// `select`s fewer columns reads a subset of the row it is typed as.
//
// The rows mirror the fragment column for column. A column added to the
// fragment is added here in the same change.
// =============================================================================

/**
 * Prisma's arguments for one delegate call (`where`, `data`, `select`, ...),
 * untyped on purpose: the app's client checks them at run time.
 *
 * @stability experimental
 */
export type AiQueryArgs = any;

/**
 * A JSON column's value, as Prisma reads it (`Prisma.JsonValue`).
 *
 * @stability experimental
 */
export type AiJsonValue = string | number | boolean | AiJsonObject | AiJsonArray | null;

/**
 * A JSON object, as Prisma reads it.
 *
 * @stability experimental
 */
export type AiJsonObject = { [Key in string]?: AiJsonValue };

/**
 * A JSON array, as Prisma reads it.
 *
 * @stability experimental
 */
export interface AiJsonArray extends Array<AiJsonValue> {}

/**
 * A JSON value a write accepts (`Prisma.InputJsonValue`).
 *
 * @stability experimental
 */
export type AiInputJsonValue =
  | string
  | number
  | boolean
  | { readonly [Key in string]?: AiInputJsonValue | null }
  | ReadonlyArray<AiInputJsonValue | null>;

/**
 * One model delegate, as the slice calls it. Results are the model's row.
 *
 * @typeParam Row - the model's row.
 *
 * @stability experimental
 */
export interface AiDelegate<Row> {
  /** `findMany`. */
  findMany(args?: AiQueryArgs): Promise<Row[]>;
  /** `findFirst`. */
  findFirst(args?: AiQueryArgs): Promise<Row | null>;
  /** `findUnique`. */
  findUnique(args: AiQueryArgs): Promise<Row | null>;
  /** `create`. */
  create(args: AiQueryArgs): Promise<Row>;
  /** `createMany`. */
  createMany(args: AiQueryArgs): Promise<{ count: number }>;
  /** `update`. */
  update(args: AiQueryArgs): Promise<Row>;
  /** `updateMany`. */
  updateMany(args: AiQueryArgs): Promise<{ count: number }>;
  /** `upsert`. */
  upsert(args: AiQueryArgs): Promise<Row>;
  /** `delete`. */
  delete(args: AiQueryArgs): Promise<Row>;
  /** `deleteMany`. */
  deleteMany(args?: AiQueryArgs): Promise<{ count: number }>;
  /** `count`; a number unless the arguments `select` per-field counts. */
  count(args?: AiQueryArgs): Promise<any>;
  /** `aggregate`; the result's shape follows the arguments. */
  aggregate(args: AiQueryArgs): Promise<any>;
}

/**
 * An `ai_models` row: one model of one provider, as the catalogue sync and
 * the administrator left it.
 *
 * @stability experimental
 */
export interface AiModelRow {
  /** Row id. */
  id: string;
  /** Provider id (`openai`). */
  provider: string;
  /** The provider's model id. */
  modelId: string;
  /** A display name, when the provider or an administrator gave one. */
  displayName: string | null;
  /** The capability set (`AiCapability[]`), as JSON. */
  capabilities: AiJsonValue;
  /** Where the capabilities came from (`classifier`, `override`, `unclassified`). */
  capabilitySource: string;
  /** Whether an administrator enabled the model. */
  enabled: boolean;
  /** The context window in tokens, when known. */
  contextWindow: number | null;
  /** The output-token ceiling, when known. */
  maxOutputTokens: number | null;
  /** First seen by the catalogue sync. */
  discoveredAt: Date;
  /** Last seen by the catalogue sync. */
  lastSeenAt: Date;
  /** When the provider stopped listing it. */
  deprecatedAt: Date | null;
  /** The administrator who last changed it. */
  updatedByUserId: string | null;
  /** Last change. */
  updatedAt: Date;
}

/**
 * A `user_ai_keys` row: one user's own key for one provider (ciphertext).
 *
 * @stability experimental
 */
export interface UserAiKeyRow {
  /** Row id. */
  id: string;
  /** The owner. */
  userId: string;
  /** Provider id. */
  provider: string;
  /** Ciphertext. Never leaves the server; never selected for a response. */
  secret: string;
  /** The last characters of the key, for display. */
  hint: string | null;
  /** When the key last passed the provider's test call. */
  verifiedAt: Date | null;
  /** The last verification failure's `AiErrorCode`. */
  lastErrorCode: string | null;
  /** The model ids the key could reach at the last check. */
  reachableModelIds: string[];
  /** When `reachableModelIds` was computed. */
  reachableCheckedAt: Date | null;
  /** Created. */
  createdAt: Date;
  /** Last change. */
  updatedAt: Date;
}

/**
 * An `ai_runs` row: one background AI run.
 *
 * @stability experimental
 */
export interface AiRunRow {
  /** Row id. */
  id: string;
  /** The user the run belongs to. */
  userId: string | null;
  /** The queue job running it. */
  jobId: string | null;
  /** `pending`, `running`, `succeeded`, `failed`, `cancelled`. */
  status: string;
  /** Provider id. */
  provider: string;
  /** Model id. */
  modelId: string;
  /** The stored request (never a key). */
  request: AiJsonValue;
  /** The stored output. */
  output: AiJsonValue | null;
  /** The failure's `AiErrorCode`. */
  errorCode: string | null;
  /** The failure's message. */
  errorMessage: string | null;
  /** Created. */
  createdAt: Date;
  /** Last change. */
  updatedAt: Date;
  /** When it settled. */
  completedAt: Date | null;
  /** The organization the run belongs to. */
  orgId: string;
}

/**
 * An `ai_usage_events` row: one inference's accounting.
 *
 * @stability experimental
 */
export interface AiUsageEventRow {
  /** Row id. */
  id: string;
  /** The caller; null for an organization-less admin discovery row. */
  userId: string | null;
  /** Provider id. */
  provider: string;
  /** Model id. */
  modelId: string;
  /** `AiOperation`. */
  operation: string;
  /** `user`, `org` or `none`. `org` means an administrator-managed key paid (org tier or deployment). */
  keySource: string;
  /** Input tokens. */
  inputTokens: number | null;
  /** Output tokens. */
  outputTokens: number | null;
  /** Reasoning tokens. */
  reasoningTokens: number | null;
  /** Cached input tokens. */
  cachedInputTokens: number | null;
  /** Non-token units (images, seconds), as JSON. */
  units: AiJsonValue | null;
  /** Wall-clock latency. */
  latencyMs: number;
  /** `ok` or `error`. */
  status: string;
  /** The failure's `AiErrorCode`. */
  errorCode: string | null;
  /** The provider's request id. */
  providerRequestId: string | null;
  /** The queue job, for a background call. */
  jobId: string | null;
  /** Created. */
  createdAt: Date;
  /** The organization the call was made for; null for `admin_discovery`. */
  orgId: string | null;
}

/**
 * A `storage_objects` row, the columns the AI output writer and input
 * resolver read and write (the storage slice owns the model).
 *
 * @stability experimental
 */
export interface AiStorageObjectRow {
  /** Row id. */
  id: string;
  /** Display name. */
  name: string;
  /** Size in bytes. */
  size: bigint;
  /** MIME type. */
  mimeType: string;
  /** Object key. */
  storageKey: string;
  /** `pending`, `ready`, ... */
  status: string;
  /** Owner. */
  uploadedById: string | null;
}

/**
 * The models the slice reaches in one scope (an organization's, or the
 * bypass client's), plus the raw-query entry points.
 *
 * @stability experimental
 */
export interface AiDb {
  /** `ai_models`. */
  aiModel: AiDelegate<AiModelRow>;
  /** `user_ai_keys`. */
  userAiKey: AiDelegate<UserAiKeyRow>;
  /** `ai_runs`. */
  aiRun: AiDelegate<AiRunRow>;
  /** `ai_usage_events`. */
  aiUsageEvent: AiDelegate<AiUsageEventRow>;
  /** `storage_objects` (owned by the storage slice). */
  storageObject: AiDelegate<AiStorageObjectRow>;
  /** `users` (owned by identity): display names on the usage report. */
  user: AiDelegate<{ id: string; email: string; displayName: string | null }>;
  /** `user_roles` (owned by identity): the system `ai_config:write` lookup. */
  userRole: AiDelegate<{ userId: string; roleId: string }>;
  /** `memberships` (owned by identity): the org `org_ai_config:write` lookup. */
  membership: AiDelegate<{ id: string; orgId: string; userId: string; roleId: string; status: string }>;
  /** `organizations` (owned by identity): the single-org default. */
  organization: AiDelegate<{ id: string; name: string; isDefault: boolean }>;
  /** `user_settings` (owned by settings): the raw `ai.defaultModel` read. */
  userSettings: AiDelegate<{ userId: string; value: AiJsonValue }>;
  /** `audit_events` (owned by identity): the slice's audit rows, written after their write commits. */
  auditEvent: AiDelegate<{ id: string }>;
  /** `system_settings` (owned by settings): the `ai` row's version. */
  systemSettings: AiDelegate<{ id: string; key: string; value: AiJsonValue; version: number; updatedAt: Date }>;
  /** A tagged-template raw query. */
  $queryRaw<T = unknown>(query: TemplateStringsArray | unknown, ...values: unknown[]): Promise<T>;
}

/**
 * The app's request-path Prisma client, as the AI slice sees it: the models
 * plus the organization scope of identity (#725) and interactive
 * transactions. The reference app's `PrismaService` satisfies it.
 *
 * @stability experimental
 */
export interface AiPrisma extends AiDb {
  /**
   * A client whose every operation runs inside the organization's row-level
   * security scope (`app.org_id`).
   *
   * @param orgId - the organization; never request input.
   * @param opts - `userId`: the acting user.
   */
  forOrg(orgId: string, opts?: { userId?: string }): AiDb;
  /**
   * One interactive transaction in an organization's scope; `fn` receives
   * the plain transaction client.
   *
   * @param orgId - the organization; never request input.
   * @param fn - the unit of work.
   * @param opts - `userId`: the acting user.
   */
  runInOrg<R>(orgId: string, fn: (tx: AiDb) => Promise<R>, opts?: { userId?: string }): Promise<R>;
  /** An interactive transaction; `tx` is the plain transaction client. */
  $transaction<T>(fn: (tx: AiDb) => Promise<T>, options?: { timeout?: number }): Promise<T>;
}

/**
 * Why the slice reads or writes across organizations. A subset of core's
 * `SystemAccessReason`.
 *
 * @stability experimental
 */
export type AiSystemReason = 'retention' | 'admin-aggregate';

/**
 * The app's bypass (system) Prisma client, as the AI slice sees it. The
 * reference app binds its `PrismaSystemService`.
 *
 * @stability experimental
 */
export interface AiSystemPrisma {
  /**
   * A client whose every operation lifts row-level security for its own
   * transaction. The reason is recorded on the active span.
   *
   * @param reason - why.
   */
  asSystem(reason: AiSystemReason): AiDb;
}

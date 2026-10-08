import {
  TELEMETRY_INSTANCE_ID_PATTERN,
  telemetryInstanceIdSchema,
  telemetrySettingsSchema,
} from '@marinoscar/platform-contract/telemetry';
import { z } from 'zod';

// =============================================================================
// User Settings Schema
// =============================================================================
//
// The core user fields (`theme`, `profile`) are the settings slice's: since
// #733 their schemas live in `@marinoscar/platform-contract/settings` and are
// re-exported here, unchanged, for the code that imported them from this file.
export {
  PROFILE_IMAGE_SOURCES,
  profileImageSourceSchema,
  userProfileSettingsPatchSchema,
  userProfileSettingsSchema,
} from '@marinoscar/platform-contract/settings';
export type {
  ProfileImageSource,
  UserProfileSettingsPatchValue,
  UserProfileSettingsValue,
} from '@marinoscar/platform-contract/settings';

// The per-user `ai` namespace's schemas are the AI slice's: since #739 they
// live in `@marinoscar/platform-contract/ai` and are re-exported (with the
// system namespace's, below) for the code that imported them from this file.

// `userSettingsSchema`, `userSettingsPatchSchema` and `UserSettingsDto` are
// COMPOSED from the user settings namespace registry (#677) and live in
// `settings/registry/composed.ts`: `theme` and `profile` (core fields, above),
// then every registered optional namespace.

// =============================================================================
// System Settings Schema
// =============================================================================

// The `notifications` system namespace's schemas (`systemNotificationsSchema`,
// its PATCH form and `MAX_DISABLED_NOTIFICATION_EVENTS`) are the wire contract
// of the notifications slice since #738 (`@marinoscar/platform-contract/notifications`);
// re-exported here under their old names. The declaration, including the
// org layer that may only tighten them, is `NOTIFICATIONS_SYSTEM_SETTINGS` of
// `@marinoscar/platform-api/notifications`.
export {
  MAX_DISABLED_NOTIFICATION_EVENTS,
  systemNotificationsPatchSchema,
  systemNotificationsSchema,
} from '@marinoscar/platform-contract/notifications';
export type { SystemNotificationsValue } from '@marinoscar/platform-contract/notifications';

// =============================================================================
// Operations namespaces (epic #254, issue #256)
// =============================================================================
//
// Four blocks — the job queue, the worker fleet, database backup/restore and
// the maintenance window — declared here BEFORE the code that reads them
// exists. Every consumer arrives in a later issue of the epic; today nothing
// in this build looks at a single one of these values.
//
// WHY DECLARE THEM FIRST, WHICH LOOKS LIKE DEAD CODE. A namespace on this row
// used to be written down in SIX places that nothing linked together:
//
//   1. `systemSettingsSchema`            (now composed: settings/registry/composed.ts)
//   2. `systemSettingsPatchSchema`       (now composed: same file)
//   3. `updateSystemSettingsSchema`      (settings/dto/update-system-settings.dto.ts)
//   4. `patchSystemSettingsSchema`       (same file — the WIRE bodies)
//   5. `SystemSettingsValue` + `DEFAULT_SYSTEM_SETTINGS`
//                                        (common/types/settings.types.ts)
//   6. the hand-written merge in settings/system-settings/system-settings.service.ts
//
// Since #677 all six are DERIVED from one `SystemSettingsNamespace` declaration
// per namespace (`<module>.system-settings.ts`, registered by
// `settings/registry/system-settings.manifest.ts`). The per-namespace schemas
// stay here; the argument below is why each place exists at all.
//
// Miss 3 or 4 and the namespace validates perfectly in every unit test in this
// file while every real PATCH silently no-ops: the request body is parsed by
// the wire DTO first, zod strips the key it does not know, and the service is
// handed a body with the caller's change already deleted. No error, no log
// line, no audit entry — the same class of silent loss #130 fixed one layer
// down. Adding all four namespaces in one pass, with one test that fails when
// the six drift (`common/schemas/settings-parity.spec.ts`), is what keeps the
// later issues from each rediscovering that trap under time pressure.
//
// REQUIRED HERE, OPTIONAL ON THE WIRE — and that asymmetry is deliberate; see
// `updateSystemSettingsSchema` for the argument. In short: this schema
// describes the STORED value, which is always complete because
// `readKnownSettings` fills every block from `DEFAULT_SYSTEM_SETTINGS`; the
// PUT body is what an existing client sends, and no existing client knows
// these blocks exist yet.
//
// NO `.default()` ANYWHERE IN THIS SECTION, on purpose. A `.default()` here
// would make `systemSettingsSchema.parse()` mint values silently, which moves
// the defaults out of `DEFAULT_SYSTEM_SETTINGS` (where they are visible,
// documented and seeded) and into whichever parse happened to run first. Every
// default below lives in `settings.types.ts` and nowhere else.
// =============================================================================

/**
 * Job-queue policy (`jobs`).
 *
 * `history` is nested rather than flattened to `historyRetentionDays` because
 * retention and the purge switch are one decision — an operator who turns the
 * purge off does not care what the retention number says — and grouping them
 * is what lets a later UI render them as one control without inventing a
 * grouping the API does not have.
 *
 * `stuckThresholdMinutes` is how long a claimed job may go without progress
 * before the queue treats it as abandoned. Bounded at a week: a threshold
 * longer than that is indistinguishable from "never reap", which is what
 * disabling the reaper is for.
 */
export const systemJobsSchema = z.object({
  history: z.object({
    retentionDays: z.number().int().min(1).max(3650),
    purgeEnabled: z.boolean(),
  }),
  stuckThresholdMinutes: z.number().int().min(1).max(10080),
});

export type SystemJobsValue = z.infer<typeof systemJobsSchema>;

/**
 * Worker-fleet policy (`nodes`).
 *
 * `staleHeartbeatSeconds` is when a node stops counting as healthy;
 * `offlineStaleMultiplier` is how many stale intervals it takes before it is
 * declared offline rather than merely late (a multiplier, not a second
 * duration, so the two cannot be configured into contradicting each other);
 * `offlineRetentionDays` is how long an offline node's record is kept before
 * it is forgotten.
 *
 * `jobSecretBrokerEnabled` (#349, epic #345) is the trust-boundary switch: may
 * a node in this deployment be handed a short-lived credential for the job it
 * is running? DEFAULT FALSE, and it is a SYSTEM SETTING rather than an
 * environment variable on purpose — whether a machine the deployment may not
 * own may hold a credential to this deployment's database is a decision an
 * administrator makes on the page where the fleet is managed, not one that
 * hides in a container's env file where nobody reviewing the fleet can see it.
 * Off means the endpoint refuses with a named reason AND every type carrying a
 * broker is filtered out of the node claim, so a node never sees the job.
 */
export const systemNodesSchema = z.object({
  staleHeartbeatSeconds: z.number().int().min(5).max(86400),
  offlineStaleMultiplier: z.number().int().min(1).max(100),
  offlineRetentionDays: z.number().int().min(1).max(3650),
  jobSecretBrokerEnabled: z.boolean(),
});

export type SystemNodesValue = z.infer<typeof systemNodesSchema>;

/**
 * `databaseBackup.timeOfDay`: 24-hour `HH:MM`, zero-padded.
 *
 * A string rather than two numbers because it is one field on one form and one
 * value in one cron-ish schedule; the regex is what stops `"2:00"`, `"25:00"`
 * and `"02:60"` from reaching a scheduler that would have to guess.
 */
export const BACKUP_TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Database backup and restore policy (`databaseBackup`).
 *
 * `dayOfWeek` and `dayOfMonth` are BOTH always present and both always valid,
 * whatever `frequency` says. The alternative — a discriminated union keyed on
 * `frequency` — would mean switching a schedule from weekly to monthly and
 * back loses the day the operator had chosen, and would make a PATCH that
 * changes only `frequency` invalid unless it also carried the other field.
 * Storing an inert-but-remembered value is the cheaper mistake.
 *
 * `dayOfMonth` stops at 28 rather than 31 so that "monthly" means every month:
 * a schedule pinned to the 30th silently skips February.
 *
 * `restoreRollbackMode` decides what happens to the database a restore
 * displaced — `retain_database` keeps it (renamed, reachable, deleted later by
 * `oldDatabaseRetentionHours`), `drop_database` does not. The default is to
 * retain, because the failure mode of retaining is disk and the failure mode
 * of dropping is a restore from the wrong dump with nothing to go back to.
 *
 * `nodeOffloadEnabled` (#352, epic #345) decides whether `db.backup.run` may be
 * claimed by a WORKER NODE at all. DEFAULT FALSE, and it is deliberately a
 * SECOND switch rather than a reuse of `nodes.jobSecretBrokerEnabled`, because
 * the two answer different questions and a deployment can genuinely want one
 * without the other:
 *
 *   - `nodes.jobSecretBrokerEnabled` — MAY THE BROKER ISSUE ANYTHING AT ALL?
 *     A statement about the fleet: are these machines inside the trust
 *     boundary for short-lived credentials of any kind?
 *   - `databaseBackup.nodeOffloadEnabled` — MAY *THIS* TYPE LEAVE THE SERVER?
 *     A statement about one workload: is dumping the whole database on a
 *     machine that is not the API server what this deployment wants, given
 *     that the node needs a network route to PostgreSQL and the archive's
 *     bytes will cross whatever network sits between them?
 *
 * Collapsing them would mean enabling brokering for any future type — a
 * fork's own `nodeSecretBroker` — silently enables shipping the database
 * dump off-box too, which is not a decision anybody made. Both must be true,
 * AND the broker must report itself usable, before the type is offered to a
 * node; see `NodesService.nodeEligibleTypes`. Off (either one) means the type
 * is withheld from the claim and the in-process worker takes the backup, which
 * is exactly what happened before node offload existed.
 *
 * `storageProvider` CARRIES NO `.min(1)`, AND ITS DEFAULT IS THE EMPTY STRING
 * (#373, epic #372). Empty is the one spelling of "unset" — the same decision
 * the `storage` namespace below makes and for the same reason; it is not
 * nullable and not optional-in-storage, so no consumer ever has to ask "absent,
 * or empty?" and get two answers. Empty means "whatever provider is active",
 * which is the only default a template repository can ship honestly: a literal
 * would have to be a guess at somebody else's deployment, and `isUsableStorage
 * Provider` (`db-backup/db-backup-storage.ts`) turns a disagreement with the
 * live `storage.provider` into a loud 400. Shipping `'s3'` here meant every
 * deployment that selected R2 failed EVERY backup on a value nobody chose —
 * a default the operator never typed must not be able to redirect or block
 * their backups. What did NOT change is the check: a value an operator DID
 * type must still equal the active provider exactly, because a backup landing
 * somewhere other than where the settings page says it lands is only ever
 * discovered during a restore. The bound stays 64 — a provider id, not prose —
 * and the comparison trims, so stored whitespace is still "unset".
 */
export const systemDatabaseBackupSchema = z.object({
  enabled: z.boolean(),
  frequency: z.enum(['daily', 'weekly', 'monthly']),
  dayOfWeek: z.number().int().min(0).max(6),
  dayOfMonth: z.number().int().min(1).max(28),
  timeOfDay: z
    .string()
    .regex(BACKUP_TIME_OF_DAY_PATTERN, 'Expected a 24-hour HH:MM time'),
  timezone: z.string().min(1).max(64),
  retentionCount: z.number().int().min(1).max(365),
  // NO `.min(1)`: the empty string is the one spelling of "unset", and it is
  // the SHIPPED DEFAULT. See the block comment above.
  storageProvider: z.string().max(64),
  runStaleMinutes: z.number().int().min(1).max(10080),
  compressionLevel: z.number().int().min(0).max(9),
  restoreRollbackMode: z.enum(['retain_database', 'drop_database']),
  oldDatabaseRetentionHours: z.number().int().min(1).max(8760),
  nodeOffloadEnabled: z.boolean(),
});

export type SystemDatabaseBackupValue = z.infer<
  typeof systemDatabaseBackupSchema
>;

/**
 * The maintenance banner's default text.
 *
 * Deliberately names no product, no company and no repository: this is a
 * template repo, and a hard-coded name here would be a string a fork has to
 * find and change in a place nobody thinks to look. Anything that genuinely
 * needs the application's name reads `APP_NAME` from `@app/shared`; this copy
 * does not need it, so it does not take the dependency.
 */
export const DEFAULT_MAINTENANCE_MESSAGE =
  'This service is temporarily unavailable for scheduled maintenance. Please try again shortly.';

/**
 * Maintenance-window state (`maintenance`).
 *
 * Half policy, half live state, in one block on purpose: `enabled` +
 * `message` + `allowAdmins` are what an operator sets, and `startedAt` +
 * `startedById` are what the act of enabling records. Splitting them across
 * two rows would let the flag and the provenance of the flag disagree.
 *
 * `startedAt`/`startedById` are NULLABLE rather than absent when no window is
 * open, so the key set of this namespace is the same whether maintenance is on
 * or off — a shape that changes with the value is a shape every consumer has
 * to special-case, and it is what `settings-parity.spec.ts` would have no way
 * to check.
 *
 * `allowAdmins` defaults to true because the person most likely to need the
 * application during maintenance is the person who turned maintenance on.
 */
export const systemMaintenanceSchema = z.object({
  enabled: z.boolean(),
  message: z.string().min(1).max(1000),
  allowAdmins: z.boolean(),
  startedAt: z.iso.datetime().nullable(),
  startedById: z.string().uuid().nullable(),
});

export type SystemMaintenanceValue = z.infer<typeof systemMaintenanceSchema>;

// =============================================================================
// Storage provider namespace (issue #373, epic #372)
// =============================================================================
//
// Where this deployment's objects live, configured at runtime instead of only
// at deploy time. Declared here on the same terms as the operations namespaces
// above — all six places in one pass, ahead of the consumers.
//
// THE CONSUMERS HAVE SINCE ARRIVED, and this namespace is now the authority it
// was declared to become: `storage/config/storage-config.ts` decides what these
// values mean and whether they are complete, `StorageConfigService` reads them
// per call, `ResolvingStorageProvider` builds its S3 client from the result,
// and `provider` is what `storage_objects` and `database_backup_runs` record
// about where their bytes went. `S3_BUCKET`/`S3_REGION` and friends in
// `configuration.ts` no longer reach the storage client at all; the only
// `storage.*` key it still takes from the environment is `partSize`, which is
// deploy-time tuning about this process's memory rather than about which bucket
// is in use. (`databaseBackup`'s own `storageProvider` is a different field
// with a different job — see the note on `STORAGE_PROVIDER_KINDS` below.)
//
// THE SECRET ACCESS KEY IS NOT HERE, AND MUST NEVER BE ADDED. It lives in the
// encrypted credential store (#115, epic #108) at
// `(purpose 'storage', name 'default')` — see
// `storage/storage-credential.constants.ts`. The reason is mechanical and
// identical to the one `email/email-settings.schema.ts` and
// `notifications/push-config.schema.ts` both give: this object is persisted as
// part of the `system_settings` blob and returned WHOLESALE by
// `GET /api/system-settings` (see `toResponse` in `system-settings.service.ts`),
// so a secret in it is one admin GET away from being on the wire, in a browser's
// memory, and in the audit row every write of this document already records
// (`newValue`/`resultingValue` carry the full merged value). "Blank preserves"
// on an admin form would also have to be reimplemented here, badly, instead of
// being inherited from `CredentialsService`, which already enforces it. There is
// a compile-time proof of the absence at the bottom of this file.
//
// `accessKeyId` IS HERE, AND THAT IS NOT AN INCONSISTENCY. It is an
// IDENTIFIER, not a credential: it names which key is being used, it is sent in
// the clear in the `Authorization` header of every SigV4 request, and it
// authorises nothing on its own. It is the exact counterpart of `smtpUsername`
// in `email-settings.schema.ts` — stored, shown, and editable — while its
// secret half goes to the credential store. An admin who cannot see which key
// id is configured cannot tell a rotated key from a mistyped one, which is the
// diagnosis this field exists to make possible.
//
// Note that `email-settings.schema.ts`'s own secret-name list includes
// `accessKeyId`, because that blob has no business carrying AWS identity at
// all; ours deliberately does not. Two schemas, two different questions.
// =============================================================================

// Moved to `@marinoscar/platform-contract/storage` (#736) with the rest of the
// namespace's schemas; re-exported so every import of this file is unchanged.
export {
  STORAGE_PROVIDER_KINDS,
  STORAGE_SETTINGS_CARRIES_NO_SECRET,
  systemStoragePatchSchema,
  systemStorageSchema,
} from '@marinoscar/platform-contract/storage';
export type {
  StorageProviderKind,
  StorageSettingsCarriesNoSecret,
  SystemStorageValue,
} from '@marinoscar/platform-contract/storage';



// -----------------------------------------------------------------------------
// PATCH (deep-partial) counterparts
// -----------------------------------------------------------------------------
//
// Hand-written, one level deep, exactly like `systemSettingsPatchSchema` above
// them: zod v4 removed `deepPartial`, and a generated partial would in any case
// get `maintenance.startedAt` wrong — `.nullable().optional()` there means two
// different things (`null` clears the window's start, absent leaves it alone)
// and the service's merge distinguishes them with `!== undefined`, never `??`.

export const systemJobsPatchSchema = z.object({
  history: z
    .object({
      retentionDays: z.number().int().min(1).max(3650).optional(),
      purgeEnabled: z.boolean().optional(),
    })
    .optional(),
  stuckThresholdMinutes: z.number().int().min(1).max(10080).optional(),
});

export const systemNodesPatchSchema = z.object({
  staleHeartbeatSeconds: z.number().int().min(5).max(86400).optional(),
  offlineStaleMultiplier: z.number().int().min(1).max(100).optional(),
  offlineRetentionDays: z.number().int().min(1).max(3650).optional(),
  jobSecretBrokerEnabled: z.boolean().optional(),
});

export const systemDatabaseBackupPatchSchema = z.object({
  enabled: z.boolean().optional(),
  frequency: z.enum(['daily', 'weekly', 'monthly']).optional(),
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  dayOfMonth: z.number().int().min(1).max(28).optional(),
  timeOfDay: z
    .string()
    .regex(BACKUP_TIME_OF_DAY_PATTERN, 'Expected a 24-hour HH:MM time')
    .optional(),
  timezone: z.string().min(1).max(64).optional(),
  retentionCount: z.number().int().min(1).max(365).optional(),
  // No `.min(1)`, matching `systemDatabaseBackupSchema`: `""` CLEARS the pin
  // back to "whatever provider is active" (absent is how a caller says "leave
  // it alone"), which is the only way an operator can un-pin through the API.
  // Rejecting `""` here would make the shipped default unreachable by the very
  // endpoint that edits it.
  storageProvider: z.string().max(64).optional(),
  runStaleMinutes: z.number().int().min(1).max(10080).optional(),
  compressionLevel: z.number().int().min(0).max(9).optional(),
  restoreRollbackMode: z
    .enum(['retain_database', 'drop_database'])
    .optional(),
  oldDatabaseRetentionHours: z.number().int().min(1).max(8760).optional(),
  nodeOffloadEnabled: z.boolean().optional(),
});


export const systemMaintenancePatchSchema = z.object({
  enabled: z.boolean().optional(),
  message: z.string().min(1).max(1000).optional(),
  allowAdmins: z.boolean().optional(),
  startedAt: z.iso.datetime().nullable().optional(),
  startedById: z.string().uuid().nullable().optional(),
});

// =============================================================================
// AI platform namespace (issue #423, epic #419; packaged by #739)
// =============================================================================
//
// THE SCHEMAS LIVE IN `@marinoscar/platform-contract/ai` since #739 (stored
// shape, PATCH partial, the compile-time no-secret proof and the per-user
// namespace), next to the namespace declaration of
// `@marinoscar/platform-api/ai`. Re-exported here, unchanged, for the code that
// imported them from this file.
export {
  AI_PROVIDER_IDS,
  AI_KEY_POLICIES,
  AI_USAGE_RETENTION_MAX_DAYS,
  AI_MCP_ALLOWED_HOST_PATTERN,
  AI_MCP_ALLOWED_HOSTS_MAX,
  AI_LIMIT_MODEL_KEY_PATTERN,
  AI_LIMIT_MODEL_KEY_MAX,
  AI_LIMITS_PER_MODEL_MAX,
  AI_LIMIT_VALUE_MAX,
  systemAiLimitsSchema,
  systemAiProviderSchema,
  AI_ENDPOINT_URL_MAX,
  aiEndpointUrlProblem,
  aiEndpointUrlSchema,
  AI_AZURE_ENDPOINT_SCHEMES,
  AI_COMPATIBLE_ENDPOINT_SCHEMES,
  AI_OPENAI_API_STYLES,
  AI_AZURE_API_VERSION_PATTERN,
  AI_AZURE_DEPLOYMENT_PATTERN,
  AI_AZURE_DEPLOYMENTS_MAX,
  AI_AZURE_MODEL_ID_MAX,
  aiAzureDeploymentsSchema,
  systemAiAzureProviderSchema,
  systemAiCompatibleProviderSchema,
  systemAiSchema,
  systemAiPatchSchema,
  AI_SETTINGS_CARRIES_NO_SECRET,
  userAiSettingsSchema,
  userAiSettingsPatchSchema,
} from '@marinoscar/platform-contract/ai';
export type {
  AiProviderId,
  SystemAiLimitsValue,
  AiKeyPolicy,
  AiOpenAiApiStyle,
  SystemAiValue,
  AiSettingsCarriesNoSecret,
  UserAiSettingsValue,
  UserAiSettingsPatchValue,
} from '@marinoscar/platform-contract/ai';

// =============================================================================
// Telemetry namespace (epic #528, story #533)
// =============================================================================
//
// Deployment-wide observability policy — declared on the same terms as `ai`
// above: all six places in one pass (this file's two schemas, the wire DTOs'
// two schemas, `DEFAULT_SYSTEM_SETTINGS`, and the hand-written merge in
// `system-settings.service.ts`), ahead of every consumer.
//
// `enabled` gates whether telemetry is collected at all — OFF by default,
// matching every other feature namespace that ships ahead of its own UI
// (`databaseBackup.enabled`, `ai.enabled`): a fresh deployment does not start
// collecting or retaining observability data nobody asked for merely because
// this namespace exists.
//
// `retentionDays` bounds how long telemetry data is kept, mirroring
// `jobs.history.retentionDays` and `ai.usageRetentionDays` in shape.
//
// `query` bounds an ad-hoc SQL query run against telemetry data: `maxRows`
// caps how much a single query may return, `timeoutSeconds` caps how long the
// database is allowed to spend running it — both are safety valves against a
// query that would otherwise return or hold the database for an unbounded
// amount of time.
//
// `assistant` is a SECOND switch, nested inside this namespace rather than a
// standalone one, because it answers a narrower question than `enabled`
// alone: `assistant.enabled` decides whether an AI assistant may be pointed
// at telemetry data at all, on top of telemetry being enabled in the first
// place. `provider`/`modelId` name which AI provider/model the assistant
// uses — both nullable, matching the "not yet configured" contract
// `databaseBackup.storageProvider`'s empty string and `ai.defaults
// .maxOutputTokensCap`'s absence both establish, spelled with `null` here
// because these are optional identifiers rather than strings where empty is
// itself a meaningful value. `shareResults` decides whether the rows a query
// returns are sent to the model (as opposed to only the query and its
// metadata) — ON by default, because an assistant that cannot see results
// cannot explain them, and an administrator who wants the narrower behavior
// turns it off deliberately. `maxResultRowsToModel` bounds how many of those
// rows reach the model per call, independent of `query.maxRows`, which bounds
// the query itself — a query may return more rows than should be handed to a
// model in one call. `maxSteps` bounds how many tool-call round trips one
// assistant turn may take, the same kind of safety valve `query
// .timeoutSeconds` is for a single query. Its ceiling (20) is the AI
// runtime's own `AI_TOOL_LOOP_MAX_STEPS`: a troubleshooting investigation
// (orient, baseline, drill down, correlate, verify, report) needs the room
// (#571); the default is 15.
//
// `instanceId` (#565) is the label stamped as the OTel resource attribute
// `app.instance.id` on everything this deployment exports, so several
// deployments can share one telemetry store and still be told apart. NULLABLE,
// and `null` is the default: it means "follow `APP_SLUG`"
// (`common/otel/telemetry-identity.ts`), so a renamed fork follows its new name until
// an administrator overrides it. The pattern keeps it a lowercase, label-safe
// token of at most 63 characters (a DNS label's bound), valid unquoted in a
// PromQL matcher and a SQL literal alike.
//
// NO API KEY OR CREDENTIAL IS PART OF THIS NAMESPACE, and none may be added:
// exactly the same rule `ai`'s own block comment states, and enforced the
// same way — see the compile-time proof below.
//
// THE SCHEMA ITSELF LIVES IN `@marinoscar/platform-contract/telemetry` (#702)
// as `telemetrySettingsSchema`: the namespace is also the body of
// `PUT /api/admin/telemetry/config`, so the web form validates with the same
// bounds (`TELEMETRY_LIMITS`). It is re-exported here under its historic name,
// so the namespace registration (`platform/telemetry/telemetry.system-settings.ts`) and
// the compile-time proof below are unchanged.
export { TELEMETRY_INSTANCE_ID_PATTERN };

export const systemTelemetrySchema = telemetrySettingsSchema;

export type SystemTelemetryValue = z.infer<typeof systemTelemetrySchema>;

/**
 * `telemetry`, one level deep, hand-written like every other PATCH schema in
 * this file (zod v4 removed `deepPartial`). `instanceId` and `provider`/`modelId` use
 * `.nullable().optional()`: absent leaves the stored value alone, an explicit
 * `null` clears it back to "not configured" — the same tri-state
 * `storage.forcePathStyle` and `ai.defaults.maxOutputTokensCap` both need,
 * and for the identical reason: with plain `??` a caller could set one of
 * these but never clear it again.
 */
export const systemTelemetryPatchSchema = z.object({
  enabled: z.boolean().optional(),
  retentionDays: z.number().int().min(1).max(3650).optional(),
  // Same tri-state as `assistant.provider`: absent = unchanged, `null` = back
  // to the `APP_SLUG` default (#565).
  instanceId: telemetryInstanceIdSchema.nullable().optional(),
  query: z
    .object({
      maxRows: z.number().int().min(1).max(100000).optional(),
      timeoutSeconds: z.number().int().min(1).max(120).optional(),
    })
    .optional(),
  assistant: z
    .object({
      enabled: z.boolean().optional(),
      provider: z.string().nullable().optional(),
      modelId: z.string().nullable().optional(),
      shareResults: z.boolean().optional(),
      maxResultRowsToModel: z.number().int().min(1).max(100).optional(),
      maxSteps: z.number().int().min(1).max(20).optional(),
    })
    .optional(),
});

// -----------------------------------------------------------------------------
// Compile-time proof that the `telemetry` namespace carries no secret
// -----------------------------------------------------------------------------
//
// Identical technique to `AiSettingsCarriesNoSecret` above, one namespace
// over. Adding an `apiKey`/`secretKey`/… field (or any of the names below) to
// `systemTelemetrySchema` makes `TelemetrySettingsCarriesNoSecret` resolve to
// `never`, and this file stops compiling.
//
// If you are here because this line went red: the AI assistant's provider
// credential is resolved the same way every other AI call resolves one —
// through `AiKeyResolver` — never stored on this document, which
// `GET /api/system-settings` returns wholesale and every settings audit row
// copies verbatim.

type TelemetrySecretFieldNames =
  | 'secretAccessKey'
  | 'secretKey'
  | 'sessionToken'
  | 'secret'
  | 'password'
  | 'apiKey'
  | 'apiKeys'
  | 'key'
  | 'token';

export type TelemetrySettingsCarriesNoSecret =
  Extract<keyof SystemTelemetryValue, TelemetrySecretFieldNames> extends never
    ? true
    : never;

export const TELEMETRY_SETTINGS_CARRIES_NO_SECRET: TelemetrySettingsCarriesNoSecret =
  true;

// =============================================================================
// Retention policy (`retention`) — #681, platform-packages PP-1.10
// =============================================================================
//
// One `{ enabled, days }` policy per table that grows with every user action
// and had no retention at all: the in-app inbox (`notifications`), the
// delivery log (`notification_deliveries`), the admin audit trail
// (`audit_events`) and background AI runs (`ai_runs`, whose `request` column
// holds the user's full prompt — a privacy concern, not only a size one).
//
// ONE NAMESPACE RATHER THAN A FIELD IN EACH OWNER'S NAMESPACE. `audit` has no
// namespace of its own, and one block lets a later settings card render the
// four controls together. The older retention controls (`jobs.history`,
// `ai.usageRetentionDays`, `nodes.offlineRetentionDays`, …) stay where they
// are: moving them would be a breaking settings change.
//
// `enabled` and `days` are one decision per table, grouped for the reason
// `jobs.history` groups `retentionDays` with `purgeEnabled`. The bound matches
// every other retention field here (1–3650 days). Defaults live in
// `DEFAULT_SYSTEM_SETTINGS`, never in a `.default()` here.
//
// Enforced by four server-only, batched purge jobs and one enqueue-only cron:
// see `common/retention/` and `docs/runbooks/data-retention.md`.

/** Upper bound on any `retention.*.days`: ten years, as for every retention field. */
export const RETENTION_MAX_DAYS = 3650;

export const retentionPolicySchema = z.object({
  enabled: z.boolean(),
  days: z.number().int().min(1).max(RETENTION_MAX_DAYS),
});

export type RetentionPolicyValue = z.infer<typeof retentionPolicySchema>;

export const systemRetentionSchema = z.object({
  notifications: retentionPolicySchema,
  notificationDeliveries: retentionPolicySchema,
  auditEvents: retentionPolicySchema,
  aiRuns: retentionPolicySchema,
});

export type SystemRetentionValue = z.infer<typeof systemRetentionSchema>;

/** The keys of `retention`, one per governed table. */
export type RetentionPolicyKey = keyof SystemRetentionValue;

const retentionPolicyPatchSchema = z.object({
  enabled: z.boolean().optional(),
  days: z.number().int().min(1).max(RETENTION_MAX_DAYS).optional(),
});

/**
 * `retention`, one level deep and field by field, mirroring
 * `systemJobsPatchSchema`: `{ "retention": { "auditEvents": { "enabled": true } } }`
 * changes that one leaf.
 */
export const systemRetentionPatchSchema = z.object({
  notifications: retentionPolicyPatchSchema.optional(),
  notificationDeliveries: retentionPolicyPatchSchema.optional(),
  auditEvents: retentionPolicyPatchSchema.optional(),
  aiRuns: retentionPolicyPatchSchema.optional(),
});

// `systemSettingsSchema`, `systemSettingsPatchSchema` and `SystemSettingsDto`
// are COMPOSED from the system settings namespace registry (#677) and live in
// `settings/registry/composed.ts`. This file keeps only the per-namespace
// leaves, and must never import a composed object (see the import-cycle rule
// there).

// The `storage` namespace's compile-time no-secret proof
// (`StorageSettingsCarriesNoSecret`) lives with its schema in
// `@marinoscar/platform-contract/storage` since #736, re-exported above.

/**
 * Field names no system settings namespace may declare (#373, generalised by
 * #677). The settings namespace registries check every registered namespace
 * against this list at import time (`settings/registry/schema-walk.ts`), at
 * any depth and ignoring case, so an app namespace is held to the same rule as
 * `storage`, `ai` and `telemetry` without a proof of its own.
 */
// The list itself is the settings slice's since #733 (it gained `privateKey`):
// one source for the registries, the row store and the conformance suite.
import { SETTINGS_SECRET_FIELD_NAMES } from '@marinoscar/platform-api/settings';
export { SETTINGS_SECRET_FIELD_NAMES };



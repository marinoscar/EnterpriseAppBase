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

// `jobs` and `nodes` (#256, epic #254): moved to
// `@marinoscar/platform-contract/jobs` and `/nodes` (#865) with the rest of the
// two namespaces' wire shapes, design comments included; re-exported here
// unchanged. The declarations are `JOBS_SYSTEM_SETTINGS` and
// `NODES_SYSTEM_SETTINGS` of `@marinoscar/platform-api/jobs` and `/nodes`.
export { systemJobsPatchSchema, systemJobsSchema } from '@marinoscar/platform-contract/jobs';
export type { SystemJobsValue } from '@marinoscar/platform-contract/jobs';
export { systemNodesPatchSchema, systemNodesSchema } from '@marinoscar/platform-contract/nodes';
export type { SystemNodesValue } from '@marinoscar/platform-contract/nodes';

// `databaseBackup` (#256, epic #254): moved to
// `@marinoscar/platform-contract/db-backup` (#740) with the rest of the
// db-backup slice's wire shapes, design comments included; re-exported here
// unchanged.
export {
  BACKUP_TIME_OF_DAY_PATTERN,
  systemDatabaseBackupPatchSchema,
  systemDatabaseBackupSchema,
} from '@marinoscar/platform-contract/db-backup';
export type { SystemDatabaseBackupValue } from '@marinoscar/platform-contract/db-backup';

// The `maintenance` namespace's schemas (the maintenance window: `enabled`,
// `message`, `allowAdmins`, and the provenance `startedAt`/`startedById`) are
// the host slice's since #867 (`@marinoscar/platform-api/host`, with the
// namespace declaration `MAINTENANCE_SYSTEM_SETTINGS`); re-exported here
// under their old names. The PATCH form is re-exported below.
export {
  DEFAULT_MAINTENANCE_MESSAGE,
  systemMaintenancePatchSchema,
  systemMaintenanceSchema,
} from '@marinoscar/platform-api/host';
export type { SystemMaintenanceValue } from '@marinoscar/platform-api/host';

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

// `systemJobsPatchSchema`, `systemNodesPatchSchema`: re-exported above from the contract (#865).

// `systemDatabaseBackupPatchSchema`: re-exported above from the contract (#740).

// `systemMaintenancePatchSchema`: re-exported above from the host slice (#867).

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



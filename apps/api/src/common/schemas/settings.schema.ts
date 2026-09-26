import { z } from 'zod';
import {
  dataTablesSchema,
  dataTablesPatchSchema,
  navigationSchema,
  navigationPatchSchema,
  notificationsSchema,
  notificationsPatchSchema,
  notificationEventKeySchema,
  NOTIFICATION_MAX_EVENTS_PER_CHANNEL,
} from './user-settings-namespaces.schema';

// =============================================================================
// User Settings Schema
// =============================================================================

/**
 * Which picture represents the user (#367).
 *
 *  - `none`     — no picture; clients render initials.
 *  - `provider` — the OAuth provider's picture (`users.provider_profile_image_url`).
 *  - `upload`   — the avatar the user uploaded, `profile.imageObjectId`.
 */
export const PROFILE_IMAGE_SOURCES = ['none', 'provider', 'upload'] as const;

export const profileImageSourceSchema = z.enum(PROFILE_IMAGE_SOURCES);

export type ProfileImageSource = z.infer<typeof profileImageSourceSchema>;

/**
 * `profile` as stored. `imageObjectId` is nullable (no avatar uploaded, or it
 * was removed) and optional only so a PUT body may omit it — the service then
 * keeps the stored id rather than orphaning the uploaded object. Whether the id
 * names an avatar the caller owns is checked by `UserSettingsService`, not
 * here: it needs the database.
 */
export const userProfileSettingsSchema = z.object({
  displayName: z.string().max(100).optional(),
  imageSource: profileImageSourceSchema,
  imageObjectId: z.string().uuid().nullable().optional(),
});

export type UserProfileSettingsValue = z.infer<typeof userProfileSettingsSchema>;

export const userProfileSettingsPatchSchema = z.object({
  displayName: z.string().max(100).optional(),
  imageSource: profileImageSourceSchema.optional(),
  // `null` clears the reference; absent leaves it alone.
  imageObjectId: z.string().uuid().nullable().optional(),
});

export type UserProfileSettingsPatchValue = z.infer<
  typeof userProfileSettingsPatchSchema
>;

/**
 * Per-user AI preferences (`ai`) — issue #423, epic #419, umbrella #418.
 *
 * `defaultModel` is the ONLY field this issue adds: which (provider, model)
 * a caller's AI surface should pre-select, so a user who has settled on one
 * model does not re-pick it every time. Nullable, and the namespace itself
 * optional — see below for why both.
 *
 * NON-SECRET ONLY, and this is the whole namespace, not a policy exception:
 * a user's own provider key is `UserAiKey.secret`, ciphertext in its own
 * table (`apps/api/prisma/schema.prisma`), never in `user_settings.value`,
 * which — like `system_settings.value` — is returned wholesale by
 * `GET /api/user-settings` and copied verbatim into whatever audit trail
 * later issues add. `provider`/`modelId` here are the same kind of
 * IDENTIFIER `systemStorageSchema.accessKeyId` is: they name a selection,
 * they authorise nothing.
 *
 * `provider`/`modelId` are plain strings, not `z.enum(AI_PROVIDER_IDS)` /
 * a foreign key into `AiModel`: this schema has no access to the database to
 * validate a model still exists, and — matching `Job.type`'s and `AiModel
 * .provider`'s own "a row must outlive the registry that produced it"
 * reasoning throughout this codebase — a user's saved preference for a model
 * later disabled or removed by an admin must remain a value this schema can
 * represent, even though nothing routes to it any more.
 */
export const userAiSettingsSchema = z.object({
  defaultModel: z
    .object({
      provider: z.string(),
      modelId: z.string(),
    })
    .nullable(),
});

export type UserAiSettingsValue = z.infer<typeof userAiSettingsSchema>;

/**
 * `ai`, PATCH counterpart. `defaultModel` stays required-but-nullable inside
 * the object (an explicit `{ "ai": { "defaultModel": null } }` clears the
 * selection back to "none chosen"; the whole `ai` object itself is optional
 * to send at all, matching `dataTables`/`navigation` above).
 */
export const userAiSettingsPatchSchema = z.object({
  defaultModel: z
    .object({
      provider: z.string(),
      modelId: z.string(),
    })
    .nullable(),
});

export type UserAiSettingsPatchValue = z.infer<typeof userAiSettingsPatchSchema>;

export const userSettingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']),
  profile: userProfileSettingsSchema,
  // Optional namespaces. Absent means "use built-in defaults" — see
  // user-settings-namespaces.schema.ts for why these must never get `.default()`.
  dataTables: dataTablesSchema.optional(),
  navigation: navigationSchema.optional(),
  // `notifications` (#126) is optional for the reason the other two are, only
  // more so: absent means "use each event's registry default", and every
  // existing account is absent. Making it required — or defaulting it — would
  // materialise a preference blob for the whole user base at the first PUT
  // and freeze them at today's defaults. See notification-preferences.ts.
  notifications: notificationsSchema.optional(),
  // AI preferences (#423, epic #419). Optional for the same reason as the
  // three namespaces above: absent means "no default model chosen", and
  // every existing account is absent until this ships an AI settings UI.
  ai: userAiSettingsSchema.optional(),
});

export type UserSettingsDto = z.infer<typeof userSettingsSchema>;

// Partial schema for PATCH operations (zod v4: deepPartial removed, use manual deep partial)
export const userSettingsPatchSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).optional(),
  profile: userProfileSettingsPatchSchema.optional(),
  // The outer `.nullable()` is what lets `{ "dataTables": null }` clear the
  // whole namespace; the inner nullability (in dataTablesPatchSchema) is what
  // lets `{ "dataTables": { "jobs": null } }` delete a single entry.
  dataTables: dataTablesPatchSchema.nullable().optional(),
  navigation: navigationPatchSchema.nullable().optional(),
  // Three nullable levels, three different deletes: the namespace, one
  // channel, one event key. See notificationsPatchSchema.
  notifications: notificationsPatchSchema.nullable().optional(),
  // The outer `.nullable()` clears the whole `ai` namespace (back to "no
  // default model, no other AI preference set"); the inner nullability on
  // `defaultModel` (see `userAiSettingsPatchSchema`) is what lets
  // `{ "ai": { "defaultModel": null } }` clear just the selection while
  // leaving the namespace itself present. Same two-level shape
  // `dataTablesPatchSchema` uses.
  ai: userAiSettingsPatchSchema.nullable().optional(),
});

// =============================================================================
// System Settings Schema
// =============================================================================

/**
 * Upper bound on `notifications.disabledEvents` (#225, epic #215).
 *
 * Reuses the user-preferences bound rather than inventing a second number:
 * both lists are indexed by the SAME registry (`NOTIFICATION_EVENTS`), so
 * whatever count is considered a sane ceiling for one event-keyed collection is
 * the ceiling for the other. A cap is required at all because this array is
 * caller-supplied and lands in JSONB — unbounded growth in a row every request
 * reads is the failure `notificationChannelPreferencesSchema` already bounds on
 * its own axis.
 */
export const MAX_DISABLED_NOTIFICATION_EVENTS =
  NOTIFICATION_MAX_EVENTS_PER_CHANNEL;

/**
 * Deployment-wide browser-notification policy.
 *
 * WHY THIS IS A MODELLED BLOCK (#225). This gate is framework-level and
 * security-adjacent (an operator turning off a delivery channel for everyone,
 * or silencing one noisy event), so it gets a real type, a real default, and
 * somewhere for its semantics to live — not an untyped flag in an open map.
 *
 * WHAT ENFORCES IT (#226). Three consumers, all reading through
 * `notifications/notification-policy.ts`, which is the only place these two
 * fields are interpreted:
 *
 *   * `resolveChannels` — the dispatcher's gate. A `browser` channel this
 *     policy disallows is not delivered over.
 *   * `GET /api/notifications/events` — the same filter, so the preferences
 *     matrix cannot offer a channel the dispatcher would refuse.
 *   * the SSE payload's `toast` flag, and `GET /api/notifications/config`,
 *     which is how a non-admin client learns the capability is off without
 *     being granted `system_settings:read`.
 *
 * WHAT IT DELIBERATELY DOES NOT SWITCH OFF: the `notifications` row itself for
 * a `mandatory` event. Muting a toast must not mute an audit-relevant inbox
 * entry — see notification-policy.ts, which carries the full argument.
 *
 * Web Push (#229/#230) will read the same block when it lands.
 *
 * `disabledEvents` holds `NOTIFICATION_EVENTS` keys and is validated with
 * `notificationEventKeySchema` — the same syntactic bound the per-user
 * preference keys use. A second, hand-rolled pattern here would be a second
 * place for the `<area>.<event>` convention to be wrong, and the wrong direction
 * is an event key an operator cannot suppress because the admin page 400s.
 * It is a syntactic bound, NOT a registry check: an entry naming an event this
 * build does not declare is stored and simply never matches, which is what keeps
 * a rollback across the addition of an event uneventful.
 */
export const systemNotificationsSchema = z.object({
  browserEnabled: z.boolean(),
  disabledEvents: z
    .array(notificationEventKeySchema)
    .max(MAX_DISABLED_NOTIFICATION_EVENTS),
});

export type SystemNotificationsValue = z.infer<typeof systemNotificationsSchema>;

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
// has to be written down in SIX places that nothing links together:
//
//   1. `systemSettingsSchema`            (this file)
//   2. `systemSettingsPatchSchema`       (this file)
//   3. `updateSystemSettingsSchema`      (settings/dto/update-system-settings.dto.ts)
//   4. `patchSystemSettingsSchema`       (same file — the WIRE bodies)
//   5. `SystemSettingsValue` + `DEFAULT_SYSTEM_SETTINGS`
//                                        (common/types/settings.types.ts)
//   6. the hand-written merge in settings/system-settings/system-settings.service.ts
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

/**
 * S3-compatible providers this app can be pointed at.
 *
 * A closed enum rather than a free string (unlike `databaseBackup
 * .storageProvider`, which names a provider REGISTRATION and is deliberately
 * open for forks) because this value selects which set of the fields below is
 * meaningful and how an endpoint is derived. Derived type below rather than a
 * hand-written union, so adding one widens every `switch` in the same edit
 * instead of silently falling through.
 *
 *  - `s3`           — AWS S3 proper. `region` is required by the SDK;
 *                     `endpoint` is left empty and the SDK derives it.
 *  - `r2`           — Cloudflare R2, which is S3-compatible but addresses
 *                     buckets through an account-scoped host. Its `region` is
 *                     literally `auto`, and its endpoint is DERIVED from
 *                     `accountId` rather than typed by hand — which is why
 *                     `accountId` is a modelled field and not a note in a URL.
 *  - `s3compatible` — MinIO, Backblaze B2, Wasabi, Ceph RGW and anything else
 *                     speaking the same protocol at an operator-supplied
 *                     `endpoint`. This is the bucket the other two are NOT, so
 *                     a new vendor needs no schema change to be usable.
 */
export const STORAGE_PROVIDER_KINDS = ['s3', 'r2', 's3compatible'] as const;

/** A configured object-storage provider. See {@link STORAGE_PROVIDER_KINDS}. */
export type StorageProviderKind = (typeof STORAGE_PROVIDER_KINDS)[number];

/**
 * Object-storage provider configuration (`storage`).
 *
 * EVERY FIELD HAS A DEFAULT, and every string default is the EMPTY STRING
 * rather than `null` or an absent key. That is what lets this namespace degrade
 * field by field like its neighbours: `readNamespace` in
 * `system-settings.service.ts` validates each field on its own and substitutes
 * that field's default when storage holds something unusable, so a row with a
 * corrupt `region` keeps the bucket an operator typed. A `null`-or-string union
 * would make every consumer ask the same question twice ("absent, or empty?")
 * and get a different answer in different places.
 *
 * EMPTY MEANS "NOT CONFIGURED", and it is a legal, expected, persisted state —
 * it is what a fresh deployment reads, and it is why `bucket` carries no
 * `.min(1)`. Refusing to store an empty bucket would mean the only way to reach
 * a valid configuration is to type every field correctly in one request, and
 * would make the very first save of a half-filled form a 400. Whether the
 * configuration is COMPLETE ENOUGH TO USE is a question for the consumer that
 * builds a client from it, not for the shape of the document — and that
 * consumer is `storage/config/storage-config.ts` (`resolveStorageConfig`),
 * which holds every completeness rule in one place and is the ONLY place that
 * answers it.
 *
 * `region` defaults to empty rather than to `us-east-1`: a wrong region is a
 * confusing runtime failure ("bucket is in another region"), and inheriting one
 * silently from a schema default is how a deployment ends up with a value
 * nobody chose. R2 wants the literal `auto` here.
 *
 * `endpoint` empty means "derive it or use none" — the SDK's own host for `s3`,
 * the account-scoped host for `r2`. An explicit value always wins, which is
 * what makes pointing `s3` at a local MinIO for development possible without
 * changing `provider`.
 *
 * `forcePathStyle` selects `https://host/bucket/key` over
 * `https://bucket.host/key`, and is TRI-STATE — `true`, `false` or `null`.
 * `null` IS THE SHIPPED DEFAULT AND MEANS "USE THIS VENDOR'S CONVENTION":
 * path style for `s3compatible`, virtual-host style for `s3` and `r2`, applied
 * in exactly one place (`buildS3ClientConfig`, storage/providers/s3). It is not
 * inferred from `provider` HERE because an explicit value must be able to beat
 * the convention for every provider: MinIO needs path style, R2 does not, and
 * an S3-compatible appliance behind a TLS certificate that does not cover
 * wildcard subdomains needs it regardless of who made it.
 *
 * WHY NULLABLE RATHER THAN A PLAIN BOOLEAN, which is the same argument the
 * string fields above make. Empty string is how a string here says "the
 * operator has not said"; `null` is a boolean's only spelling of that, since
 * both `true` and `false` are answers an operator can mean. A plain
 * `z.boolean()` defaulting to `false` cannot express "unset", so every saved
 * configuration carried an explicit `false` into the driver and the
 * per-vendor default below it could never fire — which is precisely how
 * selecting `s3compatible`, typing a MinIO endpoint and saving produced a
 * deployment MinIO rejects (it requires path style). Consumers ask the same
 * one question the strings do ("did the operator state a value?"), and get
 * the same answer everywhere.
 *
 * NO `.default()` ON ANY FIELD, exactly as in the operations section above. The
 * defaults live in `DEFAULT_SYSTEM_SETTINGS` (settings.types.ts) and nowhere
 * else; a `.default()` here would mint values in whichever `parse` happened to
 * run first, and move "what does a fresh deployment do?" out of the one object
 * that is supposed to answer it.
 */
export const systemStorageSchema = z.object({
  provider: z.enum(STORAGE_PROVIDER_KINDS),
  // No `.min(1)`: empty is "not configured yet". See the block comment above.
  bucket: z.string().trim().max(255),
  region: z.string().trim().max(255),
  // Longer bound than the rest: an endpoint is a URL, and a self-hosted one
  // behind a path prefix is routinely longer than a bucket name.
  endpoint: z.string().trim().max(512),
  accountId: z.string().trim().max(255),
  // An IDENTIFIER, not a secret — see the block comment above, and the
  // compile-time proof at the bottom of this file.
  accessKeyId: z.string().trim().max(255),
  // TRI-STATE. `null` is "use this vendor's convention", and is the default in
  // `DEFAULT_SYSTEM_SETTINGS`; `true`/`false` are an operator overriding it.
  // See the block comment above for why a plain boolean cannot say "unset".
  forcePathStyle: z.boolean().nullable(),
});

export type SystemStorageValue = z.infer<typeof systemStorageSchema>;

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

/**
 * `storage`, one level deep (#373, epic #372).
 *
 * Every field optional, INCLUDING the strings, and an empty string is a
 * meaningful value here rather than a way of saying "leave it alone" — absent
 * is how a caller says that. `{ "storage": { "bucket": "" } }` therefore CLEARS
 * the bucket, which is the only way an operator can un-configure storage
 * through the API without hand-editing JSONB. The service's merge uses `??`
 * against the stored value, and `??` treats `''` as present, so this works
 * without the `!== undefined` dance `maintenance.startedAt` needs (no field
 * here is nullable, so there is no `null`-versus-absent distinction to lose).
 */
export const systemStoragePatchSchema = z.object({
  provider: z.enum(STORAGE_PROVIDER_KINDS).optional(),
  bucket: z.string().trim().max(255).optional(),
  region: z.string().trim().max(255).optional(),
  endpoint: z.string().trim().max(512).optional(),
  accountId: z.string().trim().max(255).optional(),
  accessKeyId: z.string().trim().max(255).optional(),
  // `.nullable().optional()` means two different things here, and both are
  // wanted: absent is "leave it alone", explicit `null` is "go back to this
  // vendor's convention". See the block comment on `systemStorageSchema`.
  forcePathStyle: z.boolean().nullable().optional(),
});

export const systemMaintenancePatchSchema = z.object({
  enabled: z.boolean().optional(),
  message: z.string().min(1).max(1000).optional(),
  allowAdmins: z.boolean().optional(),
  startedAt: z.iso.datetime().nullable().optional(),
  startedById: z.string().uuid().nullable().optional(),
});

// =============================================================================
// AI platform namespace (issue #423, epic #419, umbrella #418)
// =============================================================================
//
// Deployment-wide AI policy — declared on the same terms as `storage` above:
// all six places in one pass (this file's two schemas, the wire DTOs' two
// schemas, `DEFAULT_SYSTEM_SETTINGS`, and the hand-written merge in
// `system-settings.service.ts`), ahead of every consumer. THIS ISSUE OWNS
// SCHEMA ONLY — nothing in this build reads `ai.enabled` to gate a route, and
// no controller exists yet that lets a caller actually run a model (#427,
// #428, #431, #432).
//
// `AI_PROVIDER_IDS` NAMES A REGISTRATION, NOT A CLOSED SET FOREVER — `as const`
// listed `'openai'` alone through Phase 1, and Phase 3 appends to the array
// rather than replacing it (`'anthropic'`, #446; `'gemini'`, #447). A fork adding its own
// provider extends this array; nothing about the shape below assumes a fixed
// number of members. Append only: the order is the admin UI's order.
export const AI_PROVIDER_IDS = ['openai', 'anthropic', 'gemini'] as const;

/** A registered AI provider id. See {@link AI_PROVIDER_IDS}. */
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

/**
 * How this deployment sources the API key a call actually authenticates
 * with.
 *
 *  - `byok`                    — every call uses the CALLING USER's own key
 *    (`UserAiKey`). No call succeeds for a user who has not saved one.
 *  - `byok_with_org_fallback`  — a user's own key is preferred; a user with
 *    none falls back to a deployment-wide org key. What that org key is, and
 *    where it lives, is deliberately not modelled here: like the object
 *    storage secret access key, an org-wide AI key is CREDENTIAL material and
 *    belongs in the encrypted credential store, never in this JSONB blob that
 *    `GET /api/system-settings` returns wholesale — see the block comment
 *    on `systemAiSchema` below.
 */
export const AI_KEY_POLICIES = ['byok', 'byok_with_org_fallback'] as const;

/** Upper bound on `ai.usageRetentionDays` — ten years; anything longer is "forever" in practice. */
export const AI_USAGE_RETENTION_MAX_DAYS = 3650;

/**
 * One `ai.hostedTools.mcpAllowedHosts` entry: a hostname (`mcp.example.com`)
 * or a subdomain wildcard (`*.example.com`). No scheme, port or path — the
 * scheme is always `https`, and the entry is compared with the URL's host.
 */
export const AI_MCP_ALLOWED_HOST_PATTERN =
  /^(\*\.)?[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/** Most entries `ai.hostedTools.mcpAllowedHosts` may hold. */
export const AI_MCP_ALLOWED_HOSTS_MAX = 100;

const mcpAllowedHostSchema = z.string().max(253).regex(AI_MCP_ALLOWED_HOST_PATTERN);

/** How the deployment sources a call's API key. See {@link AI_KEY_POLICIES}. */
export type AiKeyPolicy = (typeof AI_KEY_POLICIES)[number];

/**
 * Deployment-wide AI platform policy (`ai`).
 *
 * `enabled` is the master switch: OFF by default, matching every other
 * feature namespace in this file that ships ahead of its own UI
 * (`databaseBackup.enabled`, `nodes.jobSecretBrokerEnabled`) — a capability
 * this deployment did not ask for must not turn itself on by existing in the
 * schema.
 *
 * `providers.openai.baseUrl` IS AN ENDPOINT OVERRIDE, NOT A CREDENTIAL — the
 * exact counterpart of `systemStorageSchema.endpoint`. It exists for
 * OpenAI-compatible proxies and self-hosted gateways, and is optional because
 * absent means "use the provider's own default host". `providers` is closed
 * to `AI_PROVIDER_IDS` (`openai`, `anthropic`, `gemini`) rather than an open
 * `z.record`, for the same reason `STORAGE_PROVIDER_KINDS` is a closed enum
 * and not a free string: this value is read by name at the consuming layer, a
 * `z.record` cannot be validated field-by-field by `readNamespace` below (it
 * has no fixed `.shape` to iterate), and an operator-supplied provider id
 * would be a namespace with no fixed key set to keep parity with across the
 * six places a namespace must be declared.
 *
 * `defaults.maxOutputTokensCap` bounds every call regardless of what the
 * caller (or the model's own `maxOutputTokens`) requests, and is optional:
 * absent means "no deployment-wide cap", not zero. `defaults
 * .allowBackgroundRuns` decides whether a call may be queued as an `AiRun`
 * job at all rather than only served synchronously; ON by default, since the
 * job queue is this application's normal way of doing anything that takes a
 * while (see the "Every Long-Running Activity Is a Queue Job" rules) and a
 * deployment that has not thought about AI at all should not have quietly
 * disabled the queue path the moment this namespace materialises.
 *
 * `logPromptContent` is OFF by default and is a deliberate, named privacy
 * decision: whether this deployment's own logs/telemetry may capture prompt
 * text at all, independent of `enabled`. A deployment can turn AI on while
 * still refusing to let prompts (which may carry a user's own sensitive
 * input) land in a log line nobody scoped for that.
 *
 * ⚠ THERE IS NO API KEY FIELD ANYWHERE IN THIS NAMESPACE, AND THERE MUST
 * NEVER BE ONE — see the compile-time proof at the bottom of this file. A
 * user's own key is `UserAiKey.secret`, ciphertext in its own table, never
 * in this JSONB blob; an org-wide fallback key (`AI_KEY_POLICIES
 * .byok_with_org_fallback`) is credential material for the same reason
 * `systemStorageSchema`'s own header gives for the storage secret access
 * key: this object is returned WHOLESALE by `GET /api/system-settings` and
 * copied verbatim into every settings audit row, so a secret here is one
 * admin GET away from being on the wire.
 *
 * `usageRetentionDays` (#443) is how long `ai_usage_events` rows are kept
 * before the daily `ai.usage.purge` job deletes them — 180 days by default,
 * comfortably past the 90-day window the usage report can show. It is a data
 * retention decision, so it applies whether or not AI is currently enabled.
 *
 * `hostedTools` (#442) switches each provider-hosted tool type on for the
 * deployment — web search, file search, code interpreter, image generation
 * and remote MCP. ALL OFF BY DEFAULT: each one reaches outside this
 * deployment (the open web, a third-party MCP server) and bills per use, so
 * it is an administrator's decision, never a side effect of upgrading.
 * `mcpAllowedHosts` optionally narrows which hosts an MCP `serverUrl` may
 * name (`*.example.com` for subdomains); empty means any `https` host. It is
 * a list of HOSTNAMES — MCP credentials travel per request, in the tool's
 * `headers`, and are never stored here or anywhere else.
 *
 * NO `.default()` ON ANY FIELD, matching every namespace above it in this
 * file. The defaults live in `DEFAULT_SYSTEM_SETTINGS` (settings.types.ts)
 * and nowhere else.
 */
/**
 * One provider's slot in `ai.providers`: its switch and optional endpoint
 * override. Every provider id has exactly this shape.
 */
export const systemAiProviderSchema = z.object({
  enabled: z.boolean(),
  baseUrl: z.string().url().optional(),
});

export const systemAiSchema = z.object({
  enabled: z.boolean(),
  keyPolicy: z.enum(AI_KEY_POLICIES),
  providers: z.object({
    openai: systemAiProviderSchema,
    // #446. Appended; a stored row written before this slot existed is
    // salvaged per provider by `SystemSettingsService`, never reset.
    anthropic: systemAiProviderSchema,
    // #447. Appended, and salvaged per provider exactly like `anthropic`.
    gemini: systemAiProviderSchema,
  }),
  defaults: z.object({
    maxOutputTokensCap: z.number().int().positive().optional(),
    allowBackgroundRuns: z.boolean(),
  }),
  logPromptContent: z.boolean(),
  usageRetentionDays: z.number().int().min(1).max(AI_USAGE_RETENTION_MAX_DAYS),
  hostedTools: z.object({
    web_search: z.boolean(),
    file_search: z.boolean(),
    code_interpreter: z.boolean(),
    image_generation: z.boolean(),
    mcp: z.boolean(),
    mcpAllowedHosts: z.array(mcpAllowedHostSchema).max(AI_MCP_ALLOWED_HOSTS_MAX),
  }),
});

export type SystemAiValue = z.infer<typeof systemAiSchema>;

/**
 * `ai`, one level deep — matching `systemStoragePatchSchema`'s own shape one
 * level further in: `providers` and `defaults` are each optional as a whole
 * AND optional field by field inside, so `{ "ai": { "providers": { "openai":
 * { "enabled": true } } } }` is a legal body that leaves `defaults` and
 * `logPromptContent` untouched. See `SystemSettingsService.patchSettings`
 * for the merge this shape is built to support.
 */
//
// `baseUrl` and `maxOutputTokensCap` are the two OPTIONAL fields of the stored
// value, so they are the two a PATCH must be able to REMOVE: absent leaves the
// stored value alone, explicit `null` deletes it (back to "provider default
// host" / "no cap"). The same absent-vs-null distinction
// `storage.forcePathStyle` and `maintenance.startedAt` already draw; without
// it an override, once set, could be changed but never cleared (#428).
/** One provider's slot in a PATCH: each field optional, `baseUrl: null` removes the override. */
const systemAiProviderPatchSchema = z.object({
  enabled: z.boolean().optional(),
  baseUrl: z.string().url().nullable().optional(),
});

export const systemAiPatchSchema = z.object({
  enabled: z.boolean().optional(),
  keyPolicy: z.enum(AI_KEY_POLICIES).optional(),
  providers: z
    .object({
      openai: systemAiProviderPatchSchema.optional(),
      anthropic: systemAiProviderPatchSchema.optional(),
      gemini: systemAiProviderPatchSchema.optional(),
    })
    .optional(),
  defaults: z
    .object({
      maxOutputTokensCap: z.number().int().positive().nullable().optional(),
      allowBackgroundRuns: z.boolean().optional(),
    })
    .optional(),
  logPromptContent: z.boolean().optional(),
  usageRetentionDays: z.number().int().min(1).max(AI_USAGE_RETENTION_MAX_DAYS).optional(),
  // Field by field; `mcpAllowedHosts` REPLACES wholesale (RFC 7396's rule
  // for arrays, and `notifications.disabledEvents`' precedent).
  hostedTools: z
    .object({
      web_search: z.boolean().optional(),
      file_search: z.boolean().optional(),
      code_interpreter: z.boolean().optional(),
      image_generation: z.boolean().optional(),
      mcp: z.boolean().optional(),
      mcpAllowedHosts: z.array(mcpAllowedHostSchema).max(AI_MCP_ALLOWED_HOSTS_MAX).optional(),
    })
    .optional(),
});

export const systemSettingsSchema = z.object({
  notifications: systemNotificationsSchema,
  // Operations namespaces (#256, epic #254). REQUIRED, because this schema
  // describes the value as STORED and the stored value is always complete:
  // every write path runs the row through `readKnownSettings`, which fills any
  // missing block from `DEFAULT_SYSTEM_SETTINGS`. What a CLIENT may omit is a
  // separate question, answered by `updateSystemSettingsSchema`.
  jobs: systemJobsSchema,
  nodes: systemNodesSchema,
  databaseBackup: systemDatabaseBackupSchema,
  maintenance: systemMaintenanceSchema,
  // Storage provider configuration (#373, epic #372). REQUIRED here for the
  // same reason the four above are: this schema describes the STORED value, and
  // `readKnownSettings` completes every block from `DEFAULT_SYSTEM_SETTINGS`
  // before anything parses it. What a CLIENT may omit is `updateSystemSettingsSchema`'s
  // question, and there it is optional — no client sends this block yet.
  storage: systemStorageSchema,
  // AI platform policy (#423, epic #419). REQUIRED for the identical reason:
  // this schema describes the STORED value, always completed by
  // `readKnownSettings` before anything parses it. Optional on the wire, in
  // `updateSystemSettingsSchema` — no client sends this block yet either.
  ai: systemAiSchema,
});

export type SystemSettingsDto = z.infer<typeof systemSettingsSchema>;

// Partial schema for PATCH operations (zod v4: deepPartial removed, use manual deep partial)
export const systemSettingsPatchSchema = z.object({
  // `disabledEvents` REPLACES wholesale rather than merging, which is both RFC
  // 7396's rule for arrays and the only sane one here: a merge has no way to
  // express "re-enable this event", so a patch that could only ever add would
  // make the admin page's uncheck a no-op.
  notifications: z
    .object({
      browserEnabled: z.boolean().optional(),
      disabledEvents: z
        .array(notificationEventKeySchema)
        .max(MAX_DISABLED_NOTIFICATION_EVENTS)
        .optional(),
    })
    .optional(),
  // Operations namespaces (#256, epic #254). Optional at the namespace level
  // like every other branch of a PATCH, and optional field by field inside —
  // `{ "databaseBackup": { "enabled": true } }` must be a legal body, or the
  // admin page has to send twelve fields to change one.
  jobs: systemJobsPatchSchema.optional(),
  nodes: systemNodesPatchSchema.optional(),
  databaseBackup: systemDatabaseBackupPatchSchema.optional(),
  maintenance: systemMaintenancePatchSchema.optional(),
  // #373, epic #372. Optional at the namespace level and field by field inside,
  // so `{ "storage": { "bucket": "my-bucket" } }` is a legal body — an admin
  // page must not have to send seven fields to change one.
  storage: systemStoragePatchSchema.optional(),
  // #423, epic #419. Optional at the namespace level and field by field
  // inside, so `{ "ai": { "enabled": true } }` is a legal body — an admin
  // page must not have to send the whole namespace to flip one switch.
  ai: systemAiPatchSchema.optional(),
});

// -----------------------------------------------------------------------------
// Compile-time proof that the `storage` namespace carries no secret (#373)
// -----------------------------------------------------------------------------
//
// Mirrors the technique in `../../notifications/push-config.schema.ts` and
// `../../email/email-settings.schema.ts`. Adding `secretAccessKey` (or any of
// the other names below) to `systemStorageSchema` makes
// `StorageSettingsCarriesNoSecret` resolve to `never`, and this file stops
// compiling — a build break at the moment of the mistake, rather than a security
// review that has to notice one new optional string in a schema file this long.
//
// If you are here because this line went red: you are trying to put a secret
// into a settings blob that `GET /api/system-settings` returns wholesale and
// that every settings audit row copies verbatim. Use `CredentialsService`
// instead, at `(purpose 'storage', name 'default')` — see
// `../../storage/storage-credential.constants.ts`.
//
// `accessKeyId` IS DELIBERATELY ABSENT FROM THIS LIST, unlike in
// `email-settings.schema.ts` where it is forbidden. It is an identifier that
// travels in the clear in every SigV4 `Authorization` header and authorises
// nothing by itself — the counterpart of `smtpUsername`, not of
// `smtpPassword`. The email blob bans it because that blob has no business
// carrying AWS identity at all; this one is where AWS identity belongs.

type StorageSecretFieldNames =
  | 'secretAccessKey'
  | 'secretKey'
  | 'sessionToken'
  | 'secret'
  | 'password'
  | 'apiKey'
  | 'token';

export type StorageSettingsCarriesNoSecret =
  Extract<keyof SystemStorageValue, StorageSecretFieldNames> extends never
    ? true
    : never;

export const STORAGE_SETTINGS_CARRIES_NO_SECRET: StorageSettingsCarriesNoSecret =
  true;

// -----------------------------------------------------------------------------
// Compile-time proof that the `ai` namespace carries no secret (#423)
// -----------------------------------------------------------------------------
//
// Identical technique, one namespace over. Adding an `apiKey`/`secretKey`/…
// field (or any of the names below) to `systemAiSchema` makes
// `AiSettingsCarriesNoSecret` resolve to `never`, and this file stops
// compiling.
//
// If you are here because this line went red: a user's own provider key is
// `UserAiKey.secret` (ciphertext, in its own table — see
// `apps/api/prisma/schema.prisma`'s block comment on that model); an org-wide
// fallback key for `AI_KEY_POLICIES.byok_with_org_fallback` belongs in the
// encrypted credential store (`CredentialsService`), exactly as the storage
// secret access key does. Neither belongs in a document
// `GET /api/system-settings` returns wholesale and every settings audit row
// copies verbatim.

type AiSecretFieldNames =
  | 'secretAccessKey'
  | 'secretKey'
  | 'sessionToken'
  | 'secret'
  | 'password'
  | 'apiKey'
  | 'apiKeys'
  | 'key'
  | 'token';

export type AiSettingsCarriesNoSecret =
  Extract<keyof SystemAiValue, AiSecretFieldNames> extends never ? true : never;

export const AI_SETTINGS_CARRIES_NO_SECRET: AiSettingsCarriesNoSecret = true;

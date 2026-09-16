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
  storageProvider: z.string().min(1).max(64),
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
// above — all six places in one pass, ahead of the consumers, which arrive in
// part 2 of #373. Nothing in this build reads a single one of these values yet:
// `STORAGE_PROVIDER`/`S3_BUCKET`/`S3_REGION` and friends are still what
// `configuration.ts` and `storage-providers.module.ts` use.
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
 * builds a client from it (part 2), not for the shape of the document.
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
 * `https://bucket.host/key`. It is a modelled boolean rather than something
 * inferred from `provider` because the split does not follow the provider: MinIO
 * needs it, R2 does not, and an S3-compatible appliance behind a TLS certificate
 * that does not cover wildcard subdomains needs it regardless of who made it.
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
  forcePathStyle: z.boolean(),
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
  storageProvider: z.string().min(1).max(64).optional(),
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
  forcePathStyle: z.boolean().optional(),
});

export const systemMaintenancePatchSchema = z.object({
  enabled: z.boolean().optional(),
  message: z.string().min(1).max(1000).optional(),
  allowAdmins: z.boolean().optional(),
  startedAt: z.iso.datetime().nullable().optional(),
  startedById: z.string().uuid().nullable().optional(),
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

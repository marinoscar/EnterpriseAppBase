import type {
  DataTablesValue,
  NavigationValue,
  NotificationsValue,
} from '../schemas/user-settings-namespaces.schema';
import {
  DEFAULT_MAINTENANCE_MESSAGE,
  type UserProfileSettingsValue,
  type SystemNotificationsValue,
  type SystemJobsValue,
  type SystemNodesValue,
  type SystemDatabaseBackupValue,
  type SystemMaintenanceValue,
  type SystemStorageValue,
} from '../schemas/settings.schema';

// =============================================================================
// Settings Type Definitions
// =============================================================================

/**
 * User settings schema - stored in user_settings.value JSONB
 */
export interface UserSettingsValue {
  theme: 'light' | 'dark' | 'system';
  /**
   * Profile preferences (#367). `imageSource` chooses which picture represents
   * the user: none, the OAuth provider's picture, or one they uploaded.
   * `imageObjectId` is the uploaded avatar's `storage_objects` id and is kept
   * when the source is switched away from `upload`, so switching back does not
   * need a second upload. Derived from the zod schema so the two cannot drift.
   *
   * Rows written before #367 carry `useProviderImage`/`customImageUrl` instead;
   * they are normalised on read by `normalizeProfileSettings`
   * (common/profile-image/profile-image.ts), never migrated.
   */
  profile: UserProfileSettingsValue;
  /**
   * Per-table view preferences, keyed by table id.
   *
   * Optional on purpose, and derived from the zod schema so the two can never
   * drift. Absent means "the user has expressed no table preferences yet" —
   * NOT "empty preferences". See user-settings-namespaces.schema.ts.
   */
  dataTables?: DataTablesValue;
  /**
   * Navigation chrome preferences. Absent means "use built-in defaults".
   */
  navigation?: NavigationValue;
  /**
   * Per-channel, per-event notification preferences (#126), channel-outer:
   * `{ email: { 'user.welcome': false } }`.
   *
   * SPARSE AND OPTIONAL AT EVERY LEVEL. Absent namespace, absent channel and
   * absent event key all mean the same thing — "use the event's
   * `defaultEnabled` from the registry" — which is what lets this feature ship
   * with no migration and no backfill, and is why an untouched account is not
   * muted. The dispatcher resolves it; see
   * notifications/notification-preferences.ts.
   */
  notifications?: NotificationsValue;
}

/**
 * System settings schema - stored in system_settings.value JSONB
 */
export interface SystemSettingsValue {
  /**
   * Deployment-wide browser-notification policy (#225, epic #215).
   *
   * REQUIRED, not optional, and modelled rather than an untyped flag — see
   * `systemNotificationsSchema` in schemas/settings.schema.ts for the full
   * argument. Required is what makes a PUT that omits the block a loud 400
   * instead of a silent reset: the value being reset would be an operator's
   * decision to turn a delivery channel OFF, and silently turning it back on is
   * the one failure mode a security-adjacent gate must not have.
   *
   * Derived from the zod schema so the two cannot drift, exactly as the user
   * settings namespaces above are.
   */
  notifications: SystemNotificationsValue;
  /**
   * Operations namespaces (#256, epic #254): the job queue, the worker fleet,
   * database backup/restore and the maintenance window.
   *
   * REQUIRED, exactly like `notifications` above and for the same reason: this
   * type describes the value this code works with, and every read of the column
   * goes through `readKnownSettings`, which fills each block from
   * `DEFAULT_SYSTEM_SETTINGS` when storage has nothing. A consumer therefore
   * never has to ask whether a block is there, which is the whole point of
   * declaring them before the consumers exist — an optional field would push a
   * `?? DEFAULT` into every future call site, and one of those would be
   * forgotten.
   *
   * A row written before this issue genuinely lacks these keys on disk. That is
   * not a contradiction: `readKnownSettings` is the boundary where "what is on
   * disk" becomes "what this type promises", and the first write after this
   * ships materialises the blocks with their defaults.
   *
   * Derived from the zod schemas so the two cannot drift, as everything else
   * here is.
   */
  jobs: SystemJobsValue;
  nodes: SystemNodesValue;
  databaseBackup: SystemDatabaseBackupValue;
  maintenance: SystemMaintenanceValue;
  /**
   * Object-storage provider configuration (#373, epic #372): which provider,
   * which bucket, and the non-secret half of the credential.
   *
   * REQUIRED, like every namespace above it and for the same reason —
   * `readKnownSettings` completes it from `DEFAULT_SYSTEM_SETTINGS` on every
   * read, so no consumer has to write `?? DEFAULT` and none of them can forget
   * to. "Not configured" is expressed by empty strings INSIDE the block, never
   * by the block being absent; see `systemStorageSchema`.
   *
   * THE SECRET ACCESS KEY IS NOT PART OF THIS TYPE and must not be added to it:
   * it lives in the encrypted credential store at
   * `(purpose 'storage', name 'default')`. `accessKeyId` is here because it is
   * an identifier, not a credential. Both points are argued in full, and proved
   * at compile time, in `schemas/settings.schema.ts`.
   *
   * Derived from the zod schema so the two cannot drift, as everything else
   * here is.
   */
  storage: SystemStorageValue;
}

/**
 * Default user settings
 */
// NOTE: `dataTables`, `navigation` and `notifications` are intentionally NOT
// listed here.
// Seeding them would turn "absent" into "explicitly empty", which is exactly
// the failure mode the namespaces are designed to avoid (a frozen column set
// that silently hides every column added later, or a notification preference
// map that freezes a user at the defaults of the day they first saved).
export const DEFAULT_USER_SETTINGS: UserSettingsValue = {
  theme: 'system',
  profile: {
    imageSource: 'provider',
    imageObjectId: null,
  },
};

/**
 * Default system settings
 */
export const DEFAULT_SYSTEM_SETTINGS: SystemSettingsValue = {
  // ON by default, suppressing nothing. The opposite default would mean a fresh
  // deployment ships with a delivery channel silently off and no indication
  // anywhere that it was ever available — an operator opts OUT of browser
  // notifications, never into them.
  notifications: {
    browserEnabled: true,
    disabledEvents: [],
  },
  // ---------------------------------------------------------------------------
  // Operations namespaces (#256, epic #254)
  // ---------------------------------------------------------------------------
  //
  // THE ONE PLACE THESE NUMBERS LIVE. None of the schemas carries a
  // `.default()`, deliberately: a default in zod is applied by whichever
  // `parse` runs first, which makes "what does a fresh deployment do?" a
  // question you answer by reading parse call sites. Here it is a question you
  // answer by reading this object.
  //
  // Every value below is also chosen to be INERT. `jobs.history.purgeEnabled`
  // is the only one that is on, and it only bounds a table nothing writes to
  // yet; backups ship disabled, and so does the maintenance window. A default
  // that started doing something on upgrade would be a behaviour change smuggled
  // in by a schema-only issue.
  jobs: {
    history: {
      retentionDays: 30,
      purgeEnabled: true,
    },
    stuckThresholdMinutes: 30,
  },
  nodes: {
    staleHeartbeatSeconds: 90,
    offlineStaleMultiplier: 4,
    offlineRetentionDays: 30,
    // ⚠ OFF, AND THE DEFAULT IS THE POINT (#349, epic #345). A fresh
    // deployment does not hand its worker fleet credentials to its own
    // database because somebody registered a node; an administrator turns
    // this on deliberately, having decided that those machines are inside the
    // trust boundary. Fail-closed also means a settings row that cannot be
    // read degrades to "no credentials for anyone", which is the safe
    // direction — unlike the fleet's other three values, where degrading to
    // the shipped policy is the safe direction.
    jobSecretBrokerEnabled: false,
  },
  databaseBackup: {
    enabled: false,
    frequency: 'daily',
    dayOfWeek: 0,
    dayOfMonth: 1,
    timeOfDay: '02:00',
    timezone: 'UTC',
    retentionCount: 7,
    // EMPTY MEANS "WHATEVER PROVIDER IS ACTIVE", and that is the only honest
    // default (#373, epic #372). This field is a PIN: a non-empty value must
    // equal `storage.provider` or every backup is a loud 400
    // (`db-backup/db-backup-storage.ts`), which is exactly what should happen
    // to a value an operator typed and then contradicted. It is exactly what
    // should NOT happen to a value they never typed — and shipping the literal
    // `'s3'` here did precisely that: once `storage.provider` became a live
    // setting, every deployment that selected R2 inherited a pin on `s3` and
    // failed EVERY backup, from `queueBackup`, `startBackup`, `runQueuedBackup`
    // and `PUT config` alike, on nobody's decision. Empty is inert in the same
    // sense as the rest of this block: it defers, it does not choose.
    storageProvider: '',
    runStaleMinutes: 120,
    compressionLevel: 6,
    restoreRollbackMode: 'retain_database',
    oldDatabaseRetentionHours: 48,
    // OFF, like `nodes.jobSecretBrokerEnabled` and for a related-but-distinct
    // reason (#352, epic #345): a fresh deployment does not ship its entire
    // database off the API server because somebody registered a worker node.
    // Both switches must be on, and the credential broker must report itself
    // usable, before `db.backup.run` is offered to a node at all.
    nodeOffloadEnabled: false,
  },
  maintenance: {
    enabled: false,
    // Shared with the schema so the banner's copy and its validation cannot
    // disagree, and so a fork renaming its product finds no product name here
    // to rename.
    message: DEFAULT_MAINTENANCE_MESSAGE,
    allowAdmins: true,
    startedAt: null,
    startedById: null,
  },
  // ---------------------------------------------------------------------------
  // Storage provider configuration (#373, epic #372)
  // ---------------------------------------------------------------------------
  //
  // UNCONFIGURED, and inert in exactly the sense the operations defaults above
  // are: `provider: 's3'` names the shape the empty fields would be filled in
  // for, and every field that would actually make a request go somewhere is
  // empty. Nothing in this build reads these values — the storage provider is
  // still built from `STORAGE_PROVIDER`/`S3_*` environment variables — so this
  // block changes no behaviour on upgrade, which is the whole point of landing
  // the six declaration sites before the consumer.
  //
  // `'s3'` rather than `null` because `provider` is a closed enum with no "none"
  // member: "no storage configured" is `bucket === ''`, one question with one
  // answer, instead of a second way to spell the same state that every consumer
  // would then have to check for separately.
  storage: {
    provider: 's3',
    bucket: '',
    // Empty, not 'us-east-1'. Inheriting a region nobody chose is how a
    // deployment gets "the bucket you are attempting to access must be
    // addressed using the specified endpoint" from a settings page that looks
    // filled in. R2 wants the literal 'auto' here.
    region: '',
    // Empty means "derive it, or let the SDK use its own host".
    endpoint: '',
    // R2 only; the account-scoped endpoint is derived from it.
    accountId: '',
    // The IDENTIFIER half of the credential. Its secret half is never here —
    // it goes to the credential store at `(purpose 'storage', name 'default')`.
    accessKeyId: '',
    forcePathStyle: false,
  },
};

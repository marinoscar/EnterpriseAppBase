// =============================================================================
// The data the settings slice reads and writes, structurally (issue #733)
// =============================================================================
//
// The slice never imports a generated Prisma client, not even its types (the
// rule of identity, `identity/data/identity-db.ts`, and sharing): the package
// is built, type-checked and tested before any app's `prisma generate`, and
// works with any app that composed the `settings` fragment of
// `@marinoscar/platform-db`.
//
// The tables: `system_settings` (deployment-level, outside RLS: one row per
// key, `global` plus the rows slices own, such as `email` and
// `telemetry_connection`), `user_settings` (one row per user) and
// `org_settings` (one row per organization, FORCEd row-level security on
// `org_id`, reached only inside a transaction the host's `SETTINGS_DATA` port
// opened in that organization's scope). `users` (the display-name sync) and
// `audit_events` (the settings audit trail) are written as they always were.
//
// Every delegate method is generic in its result (`findUnique<T = Row>`): a
// call that `include`s or `select`s names the shape it reads, and the app's
// client checks the arguments at run time.
// =============================================================================

/**
 * Query arguments, as the app's client accepts them.
 *
 * @stability experimental
 */
export type SettingsQueryArgs = Record<string, unknown>;

/**
 * One model delegate of the app's client, structurally.
 *
 * @typeParam Row - the model's row type.
 *
 * @stability experimental
 */
export interface SettingsDelegate<Row> {
  /** `findUnique`. */
  findUnique<T = Row>(args: SettingsQueryArgs): Promise<T | null>;
  /** `findFirst`. */
  findFirst<T = Row>(args: SettingsQueryArgs): Promise<T | null>;
  /** `create`. */
  create<T = Row>(args: SettingsQueryArgs): Promise<T>;
  /** `update`. */
  update<T = Row>(args: SettingsQueryArgs): Promise<T>;
  /** `upsert`. */
  upsert<T = Row>(args: SettingsQueryArgs): Promise<T>;
  /** `updateMany`. */
  updateMany(args: SettingsQueryArgs): Promise<SettingsBatchResult>;
  /** `deleteMany`. */
  deleteMany(args?: SettingsQueryArgs): Promise<SettingsBatchResult>;
}

/**
 * What a batch write returns.
 *
 * @stability experimental
 */
export interface SettingsBatchResult {
  /** How many rows it changed. */
  count: number;
}

/**
 * A row identified by its id (the users and audit delegates' default shape).
 *
 * @stability experimental
 */
export interface SettingsIdRow {
  /** The row's id. */
  id: string;
}

/**
 * The `users` columns the display-name sync writes.
 *
 * @stability experimental
 */
export interface SettingsUserRow {
  /** The user's id. */
  id: string;
  /** The display name, or `null`. */
  displayName: string | null;
}

/**
 * A `system_settings` row.
 *
 * @stability experimental
 */
export interface SettingsSystemSettingsRow {
  /** The row's id. */
  id: string;
  /** The row's key: `global` (the namespaces document) or a slice's own row (`email`, ...). */
  key: string;
  /** The JSON value. */
  value: unknown;
  /** The optimistic-concurrency version. */
  version: number;
  /** Who last changed it, or `null`. */
  updatedByUserId: string | null;
  /** When it last changed. */
  updatedAt: Date;
}

/**
 * A `user_settings` row.
 *
 * @stability experimental
 */
export interface SettingsUserSettingsRow {
  /** The row's id. */
  id: string;
  /** The user. */
  userId: string;
  /** The JSON value. */
  value: unknown;
  /** The optimistic-concurrency version. */
  version: number;
  /** When it last changed. */
  updatedAt: Date;
}

/**
 * An `org_settings` row: one organization's overrides, namespace by namespace
 * (only the fields each namespace's `org.schema` allows).
 *
 * @stability experimental
 */
export interface SettingsOrgSettingsRow {
  /** The row's id. */
  id: string;
  /** The organization. */
  orgId: string;
  /** The JSON value: namespace key to the org's stored fields. */
  value: unknown;
  /** The optimistic-concurrency version. */
  version: number;
  /** Who last changed it, or `null`. */
  updatedByUserId: string | null;
  /** When it last changed. */
  updatedAt: Date;
}

/**
 * The app's client, as the settings slice uses it outside an organization's
 * scope (bound to the core port `PLATFORM_PRISMA`).
 *
 * @stability experimental
 */
export interface SettingsPrisma {
  /** `system_settings`. */
  systemSettings: SettingsDelegate<SettingsSystemSettingsRow>;
  /** `user_settings`. */
  userSettings: SettingsDelegate<SettingsUserSettingsRow>;
  /** `users`: the display-name sync. */
  user: SettingsDelegate<SettingsUserRow>;
  /** `audit_events`: the settings audit trail. */
  auditEvent: SettingsDelegate<SettingsIdRow>;
}

/**
 * The transaction client the host hands to an org-scoped callback: the
 * `org_settings` delegate under that organization's row-level-security scope,
 * plus `audit_events` (written in the same transaction, after the write).
 *
 * @stability experimental
 */
export interface SettingsOrgTx {
  /** `org_settings`, confined to the scope's organization. */
  orgSettings: SettingsDelegate<SettingsOrgSettingsRow>;
  /** `audit_events`. */
  auditEvent: SettingsDelegate<SettingsIdRow>;
}

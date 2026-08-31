export interface Role {
  name: string;
}

export interface User {
  id: string;
  email: string;
  displayName: string | null;
  profileImageUrl: string | null;
  roles: Role[];
  permissions: string[];
  isActive: boolean;
  createdAt: string;
}

export type DataTableDensity = 'compact' | 'standard' | 'comfortable';

/**
 * Navigation preferences. Every field is optional and an ABSENT field means
 * "use the built-in default" — absence is meaningful, not incidental, so never
 * backfill these with literal defaults when reading settings.
 */
export interface NavigationSettings {
  railCollapsed?: boolean;
}

/**
 * Per-table preferences, keyed by table id. As with navigation, every field is
 * optional and an ABSENT field means "use the built-in default" for that table
 * (an absent `visibleColumns` is not an empty column set).
 */
export interface DataTableSettings {
  visibleColumns?: string[];
  density?: DataTableDensity;
  sort?: { field: string; direction: 'asc' | 'desc' };
  pageSize?: number;
}

export interface UserSettings {
  theme: 'light' | 'dark' | 'system';
  profile: {
    displayName?: string;
    useProviderImage: boolean;
    customImageUrl?: string | null;
  };
  navigation?: NavigationSettings;
  dataTables?: Record<string, DataTableSettings>;
  updatedAt: string;
  version: number;
}

/**
 * PATCH form of `navigation`: each field may additionally be `null`, meaning
 * "delete this field and fall back to the built-in default".
 */
export type NavigationSettingsPatch = {
  [K in keyof NavigationSettings]?: NavigationSettings[K] | null;
};

/**
 * PATCH form of `dataTables`: the per-table VALUE may be `null` to delete that
 * table's entry. Note the asymmetry with navigation — a non-null entry REPLACES
 * the stored entry wholesale rather than being deep-merged, so its fields are
 * plain optionals and are NOT individually nullable. The server rejects
 * `{ [id]: { sort: null } }`; omit the field or replace the whole entry.
 */
export type DataTablesPatch = Record<string, DataTableSettings | null>;

/**
 * Payload accepted by `PATCH /api/user-settings`.
 *
 * This deliberately is NOT `Partial<UserSettings>`: the endpoint uses JSON
 * Merge Patch semantics, where `null` is a DELETE signal rather than a value.
 *   - `{ navigation: null }`                    clears the whole namespace
 *   - `{ navigation: { railCollapsed: null } }` deletes just that field
 *   - `{ dataTables: null }`                    clears the whole namespace
 *   - `{ dataTables: { [id]: null } }`          deletes just that table's entry
 * Omitting a key leaves the stored value untouched. Server-owned fields
 * (`updatedAt`, `version`) are not patchable and so are absent here.
 */
export interface UserSettingsUpdate {
  theme?: UserSettings['theme'];
  profile?: Partial<UserSettings['profile']>;
  navigation?: NavigationSettingsPatch | null;
  dataTables?: DataTablesPatch | null;
}

export interface SystemSettings {
  ui: {
    allowUserThemeOverride: boolean;
  };
  features: Record<string, boolean>;
  updatedAt: string;
  updatedBy: { id: string; email: string } | null;
  version: number;
}

export interface AuthProvider {
  name: string;
  authUrl: string;
}

export interface AllowedEmailEntry {
  id: string;
  email: string;
  addedBy: { id: string; email: string } | null;
  addedAt: string;
  claimedBy: { id: string; email: string } | null;
  claimedAt: string | null;
  notes: string | null;
}

export interface AllowlistResponse {
  items: AllowedEmailEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface UserListItem {
  id: string;
  email: string;
  displayName: string | null;
  providerDisplayName: string | null;
  profileImageUrl: string | null;
  providerProfileImageUrl?: string | null;
  isActive: boolean;
  roles: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UsersResponse {
  items: UserListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface DeviceActivationInfo {
  userCode: string;
  clientInfo: {
    deviceName?: string;
    userAgent?: string;
    ipAddress?: string;
  };
  expiresAt: string;
}

export interface DeviceAuthorizationResponse {
  success: boolean;
  message: string;
}

// Personal Access Tokens
export type PatDurationUnit = 'minutes' | 'days' | 'months';

export interface PersonalAccessToken {
  id: string;
  name: string;
  tokenPrefix: string;
  durationValue: number;
  durationUnit: PatDurationUnit;
  expiresAt: string;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface PatCreatedResponse {
  token: string;
  id: string;
  name: string;
  tokenPrefix: string;
  expiresAt: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Email settings — issue #124, epic #109.
//
// These mirror the payloads of `/api/email-settings`, which are NOT part of the
// system settings document: email is its own controller writing its own
// `system_settings` row, with its own version counter and its own save
// semantics (see `EmailSettingsInput` below), so it gets its own types rather
// than another branch of `SystemSettings`. Everything the web app knows about
// the wire format lives here and in `services/api.ts`'s email block — if the
// API's field names move, those two files are the whole reconciliation.
//
// THE SHAPE IS FLAT, because the API's is. `emailSettingsSchema`
// (`apps/api/src/email/email-settings.schema.ts`) is one object whose
// `sesRegion` / `smtpHost` / `smtpPort` / `smtpUsername` are siblings of
// `fromAddress` and `provider`, and both DTOs derive from it rather than
// restating it. An earlier draft of this file grouped them into `ses: {…}` and
// `smtp: {…}` sub-objects. That typechecked perfectly and was wrong on the
// wire in both directions: every read came back `undefined`, and every write
// was dropped by zod, which strips unknown keys. Do not re-nest — the types
// here are not free to be tidier than the payload they describe.
// ---------------------------------------------------------------------------

/**
 * Which transport sends mail. Mirrors `EMAIL_PROVIDER_KINDS` in the API's
 * `email-settings.schema.ts`.
 *
 * There is deliberately no `'disabled'` member. "Off" is not a transport, it is
 * `EmailSettings.enabled === false` — see the note there. The absence of a
 * chosen transport is `provider: null`, which is why every use of this type on
 * the wire is written `EmailProviderKind | null` rather than made optional.
 */
export type EmailProviderKind = 'ses' | 'smtp';

/**
 * What the API will tell us about the stored SMTP password — which is
 * everything except the password.
 *
 * The password itself is written into the encrypted credential store (epic
 * #108) and is unreadable through the API by construction: the response DTO
 * carries a compile-time proof that it has no field able to hold one. This
 * status object is what makes the blank password box honest; without it the UI
 * would render an empty field with no way to say whether submitting it keeps
 * something or keeps nothing.
 */
export interface SmtpPasswordStatus {
  /** Is a password stored at all? */
  configured: boolean;

  /**
   * The credential store's OWN mask — `••••` plus at most the last four
   * characters — derived once on write by the code that held the plaintext.
   *
   * Null when nothing is stored, and also null for a secret too short to mask
   * safely, so the UI must read correctly without it. Better than a fixed
   * placeholder: an admin who has just rotated a credential can see WHICH one
   * is live rather than only that one exists.
   */
  hint: string | null;

  /** When the stored password was last written. Null when nothing is stored. */
  updatedAt: string | null;

  /** Who last wrote it. Null when nothing is stored, or that user was deleted. */
  updatedByUserId: string | null;
}

/**
 * `GET /api/email-settings`, and the body of a successful `PUT`.
 *
 * The optional fields are optional in the same sense the API means: the key is
 * ABSENT when nothing is configured (`stripUnsetSettingFields` removes empty
 * values before the row is written), never present-and-empty. Read them with
 * `?? ''` and do not test them for `''`.
 */
export interface EmailSettings {
  /**
   * `null` means "no transport chosen", the state of every fresh install. It
   * is a persisted value, not a missing key.
   */
  provider: EmailProviderKind | null;

  /**
   * The master switch, a SEPARATE AXIS from `provider`. Nothing is sent while
   * this is false.
   *
   * Two fields rather than one because the pair carries something a single
   * three-way choice cannot: an admin who switches mail off for a maintenance
   * window keeps the transport and every field belonging to it, and turning it
   * back on costs no retyping. `provider: null, enabled: false` (never
   * configured) and `provider: 'smtp', enabled: false` (deliberately off) are
   * genuinely different states, and collapsing them would lose the second one.
   */
  enabled: boolean;

  /** SES region override, e.g. `us-east-1`. Absent means the deployment's `S3_REGION`. */
  sesRegion?: string;

  smtpHost?: string;
  smtpPort?: number;

  /**
   * REQUIRE TLS — not nodemailer's `secure` flag, which the API derives itself
   * from the port (465 is TLS from the first byte; everything else gets
   * required STARTTLS). Absent is treated as `true` by the provider, so the UI
   * must default it to on rather than to off.
   */
  smtpUseTls?: boolean;

  /** Absent means unauthenticated submission — a real configuration for an IP-authorised relay. */
  smtpUsername?: string;

  fromAddress?: string;
  fromName?: string;

  /** Everything the UI may know about the stored password. See {@link SmtpPasswordStatus}. */
  smtpPasswordStatus: SmtpPasswordStatus;

  /**
   * Why the STORED configuration could not be read, when it could not be. Null
   * on the normal path.
   *
   * The read endpoint degrades instead of throwing: a hand-edited row or a bad
   * migration would otherwise take down the one screen capable of repairing
   * it. When this is set, every settings field above is a DEFAULT rather than
   * the deployment's real configuration — which is why the page has to say so.
   * An admin who is not told is editing a form that does not describe their
   * system, and "saving" it overwrites the row they came to fix.
   *
   * Field paths only, never stored values.
   */
  settingsError: string | null;

  /** Bumped on every write. Pass back as `If-Match` on the next PUT. */
  version: number;

  updatedAt: string | null;
  updatedBy: { id: string; email: string } | null;
}

/**
 * A settings field an admin left empty.
 *
 * An HTML form cannot express "absent": a cleared text input submits `''` and a
 * reset controlled component submits `null`. The API's
 * `updateEmailSettingsSchema` wraps every optional field in a `blankable`
 * union that accepts both, and converts them to "absent" exactly once, in
 * `EmailSettingsService.update`. So the web app sends what the admin did —
 * they cleared the box — instead of reimplementing that conversion here and
 * getting a seventh copy of it slightly wrong.
 */
export type Blankable<T> = T | '' | null;

/**
 * `PUT /api/email-settings`.
 *
 * A full replacement, not a patch, plus the version the caller believed it was
 * replacing (sent as `If-Match` — see `updateEmailSettings` in
 * `services/api.ts`, not carried in this body).
 *
 * `provider` and `enabled` are REQUIRED and are NOT blankable: `null` is a real
 * persisted value for `provider`, so the API keeps it distinct from an emptied
 * box, and stripping it would drop a required key and fail the parse.
 *
 * BLANK PRESERVES (the #115 contract, restated by #124). `smtpPassword`
 * omitted — or sent as an empty string — leaves the stored password exactly as
 * it is; a non-empty value replaces it. There is deliberately NO way to erase a
 * password by clearing the field, because "I left the box alone" and "I want no
 * password" are the same gesture, and guessing wrong in the destructive
 * direction silently breaks mail for everyone. Note it is the ONE field this
 * app omits rather than sending as `''`: for every other field `''` means "not
 * configured", and for this one it means "unchanged".
 */
export interface EmailSettingsInput {
  provider: EmailProviderKind | null;
  enabled: boolean;
  sesRegion?: Blankable<string>;
  smtpHost?: Blankable<string>;
  smtpPort?: Blankable<number>;
  smtpUseTls?: Blankable<boolean>;
  smtpUsername?: Blankable<string>;
  fromAddress?: Blankable<string>;
  fromName?: Blankable<string>;
  smtpPassword?: string;
}

/**
 * `POST /api/email-settings/test` — the result of a real send attempt.
 *
 * A FAILED SEND IS A 200 WITH `success: false`, not a rejected promise: the
 * request succeeded, the mail did not. That is why the page branches on this
 * field and never on "did the call throw" — the single most likely way this
 * page could end up claiming success while the provider refused the message.
 *
 * Every field is present on a real response (nullable rather than optional in
 * the API's DTO). They are optional HERE because the hook also builds this
 * shape locally when the CALL itself fails — a 403, a 500, a dropped
 * connection — which is still a failed test and belongs in the same red
 * region, but has no recipient, no provider and no timestamp to report.
 */
export interface EmailTestResult {
  success: boolean;

  /**
   * Where it went — the caller's own address, taken from the session. Echoed
   * back so the UI states the destination as fact rather than assuming it.
   */
  sentTo?: string;

  /**
   * Which transport carried, or refused, the message. Null when nothing was
   * attempted because no provider was configured. Worth showing: an admin who
   * has just switched from SMTP to SES needs to know which one produced the
   * error in front of them.
   */
  providerKind?: EmailProviderKind | null;

  /** Provider message id on success — the string that correlates this attempt with a provider-side log. */
  messageId?: string | null;

  /**
   * The provider's VERBATIM error on failure — `535 Authentication failed`,
   * `MessageRejected: Email address is not verified`. Diagnosing mail
   * configuration is this page's entire job (#124), so this string is rendered
   * as-is and never replaced with a friendlier summary. Already redacted and
   * length-capped by the API's `SecretRedactor`.
   */
  error?: string | null;

  /** When the attempt was made. */
  attemptedAt?: string;
}

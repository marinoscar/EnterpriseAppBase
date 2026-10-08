// The shared shapes of the sharing hooks (issue #731, PP-7.4).

/**
 * One record of a registered resource type: what a share dialog shares and
 * what a grant points at. The same shape as the API's `ResourceRef`.
 *
 * @stability experimental
 */
export interface ResourceRef {
  /** The registered resource type id (`transcript`, `media_item`). */
  type: string;
  /** The record's id. */
  id: string;
}

/**
 * One role a share dialog offers: the wire value and its label.
 *
 * @stability experimental
 */
export interface SharingRoleOption {
  /** The role as the API takes it (`viewer`). */
  value: string;
  /** What the person reads (`Can view`). */
  label: string;
}

/**
 * A failed sharing call, normalised from the app transport's error so a
 * component can show it without knowing the transport.
 *
 * @stability experimental
 */
export interface SharingError {
  /** A sentence safe to show: the API's own message, or a plain-language one for a known reason. */
  message: string;
  /** The HTTP status, or `null` when no response arrived (a network failure). */
  status: number | null;
  /**
   * The API's machine-readable reason (`details.reason`, else the envelope's
   * `code`): `LAST_GROUP_ADMIN`, `GROUP_OWNS_RESOURCES`, `VERSION_CONFLICT`,
   * `LOOKUP_THROTTLED`, `ROLE_NOT_GRANTABLE`, ... or `null`.
   */
  reason: string | null;
  /** For a `429`: how long to wait, in whole seconds (from `details.retryAfterMs`), else `null`. */
  retryAfterSeconds: number | null;
  /** The error envelope's `details`, untouched (e.g. `counts` of `GROUP_OWNS_RESOURCES`). */
  details: unknown;
}

/**
 * What every sharing read hook returns.
 *
 * @typeParam T - the loaded data.
 *
 * @stability experimental
 */
export interface SharingResource<T> {
  /** The last successful load, or `null` before the first one. It stays while a refresh runs. */
  data: T | null;
  /** A load is in flight. */
  loading: boolean;
  /** The last load failed; `null` once a load succeeds. */
  error: SharingError | null;
  /** Load again. Resolves when done; never rejects (the failure lands in `error`). */
  refresh: () => Promise<void>;
}

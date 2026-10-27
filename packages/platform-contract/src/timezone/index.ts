/**
 * Pure IANA time zone math shared by the API and the web: the offset of a zone
 * at an instant, the calendar day an instant falls on, local midnight as an
 * instant, and DST-correct calendar arithmetic. Framework-free (no zod, no
 * Node or DOM API beyond `Intl`), so both sides run the same code.
 *
 * Every function expects a valid IANA id (see `isValidTimeZone` in
 * `@marinoscar/platform-contract/settings`) and throws a `RangeError` for an
 * unknown one, exactly like `Intl.DateTimeFormat`.
 *
 * @packageDocumentation
 */

export { DEFAULT_SERVER_TIME_ZONE, TIME_ZONE_HEADER } from './constants.js';
export * from './schemas.js';

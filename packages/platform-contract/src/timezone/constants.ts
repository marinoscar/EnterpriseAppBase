/** Zod-free constants of the timezone slice. */

/**
 * The zone the server uses when a user has stored none.
 *
 * @stability experimental
 */
export const DEFAULT_SERVER_TIME_ZONE = 'UTC';

/**
 * The request header a client sends with the device's IANA zone, for a user
 * who has not stored `profile.timezone` ("Automatic"). The server prefers the
 * stored zone, then a valid header, then {@link DEFAULT_SERVER_TIME_ZONE}.
 *
 * @stability experimental
 */
export const TIME_ZONE_HEADER = 'x-time-zone';

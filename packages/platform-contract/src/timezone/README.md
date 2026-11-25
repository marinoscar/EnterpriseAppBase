# @marinoscar/platform-contract/timezone

Pure IANA time zone math shared by the API and the web, so both sides compute the same answer: the offset of a zone at an instant, the calendar day an instant falls on, local midnight as an instant, and DST-correct calendar arithmetic. Framework-free (no zod, only `Intl`). It depends on no other slice (`packages/platform-slices.json`).

## Purpose and scope

All date operations follow the user's `profile.timezone` ([settings](../settings/README.md)). This slice holds the arithmetic and the two constants that connect a request to a zone.

| Export | Does |
|---|---|
| `getTimeZoneOffsetMinutes(instant, tz)` | minutes ahead of UTC at that instant (DST-aware; `America/Costa_Rica` is `-360`) |
| `getZonedParts(instant, tz)` | wall-clock year, month, day, hour, minute, second |
| `zonedDateKey(instant, tz)` | the `YYYY-MM-DD` day the instant falls on in `tz` |
| `zonedDayStart('YYYY-MM-DD', tz)` | the instant of local midnight (a skipped midnight resolves to the first instant after the gap) |
| `addCalendarInZone(instant, { days } or { months }, tz)` | calendar arithmetic on the wall clock: time of day kept across DST, month ends clamped (Jan 31 plus one month is Feb 28, or 29 in a leap year) |
| `addDaysToDateKey(day, n)`, `isDateKey(v)` | zone-free day-key helpers |
| `DEFAULT_SERVER_TIME_ZONE` | `'UTC'`, the fallback when nothing is stored |
| `TIME_ZONE_HEADER` | `'x-time-zone'`, the header a client sends with the device zone for a user on "Automatic" |

An invalid zone id throws `RangeError`; validate with `isValidTimeZone` / `timeZoneIdSchema` from `/settings`. The server resolution order for a request is the stored `profile.timezone`, then a valid `X-Time-Zone` header, then `UTC` (`SettingsResolver.resolveRequestTimeZone` in `@marinoscar/platform-api/settings`).

Layout: `constants.ts` (zod-free), `schemas.ts` (the pure functions; the slice has no schemas, the file keeps the contract's three-file layout) and `index.ts`.

## Install and peer dependencies

Ships inside `@marinoscar/platform-contract`; import it by its subpath:

```ts
import { addCalendarInZone, zonedDayStart } from '@marinoscar/platform-contract/timezone';
```

No peers, not even `zod`.

## Quick start

The PAT service computes an expiry in the requester's zone, and the web preview calls the same function:

```ts
import { addCalendarInZone } from '@marinoscar/platform-contract/timezone';

const expires = addCalendarInZone(new Date(), { months: 1 }, 'America/Costa_Rica');
const from = zonedDayStart('2026-10-27', 'America/Chicago'); // 2026-10-27T05:00:00.000Z
```

## Configuration

None. Pure functions.

## Extension-point catalog

None. The functions are pure; the contract declares no registry here.

## Data

None.

## Permissions and settings

Declares none. The zone itself is `profile.timezone` of the settings slice.

## UI

None.

## Infra

None. `X-Time-Zone` is an ordinary request header: the platform's nginx forwards it and the CORS plugin reflects the preflight's requested headers.

## Observability

None.

## Security notes

The zone is presentation and bucketing input, never an authorization input. The AI daily limits deliberately ignore it (UTC midnight), so a user cannot move their own reset by changing their zone.

## Conformance suite

None; proven by `packages/platform-contract/test/timezone.test.ts` (DST, month clamps, skipped midnight).

## Upgrade notes

Added in the zone-date-operations change; nothing to migrate.

## Troubleshooting

`RangeError: Invalid time zone specified` means the id is not an IANA zone the runtime knows; check it with `isValidTimeZone` first.

## Links

- [`@marinoscar/platform-contract/settings`](../settings/README.md) for `isValidTimeZone` and `readProfileTimeZone`.
- [`@marinoscar/platform-web/timezone`](../../../platform-web/src/timezone/README.md) for the display formatters and picker.

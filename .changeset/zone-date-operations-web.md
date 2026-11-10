---
"@marinoscar/platform-web": minor
---

Date operations in the packaged UI follow the user's profile time zone, not only display.

- `PlatformHttpClient`, `connectSse` and `postSse` send `X-Time-Zone` with the display zone on every request (new `timeZoneHeader()` in `/core` for a raw `fetch`). `zonedDateKey` and `getTimeZoneOffsetMinutes` now delegate to `@marinoscar/platform-contract/timezone` (same results; an unknown zone still reads as UTC).
- AI usage: `aiUsageRangeForDays` takes today in the display zone (new `timeZone` argument); the usage hooks send `tz`; `AiUsageReport.timeZone` is read, the day series is zero-filled by day keys, and the usage page labels the range with the report's zone. `AI_RATE_LIMITED` copy says when a limit resets (`details.resetsAt`, new `AiErrorInfo.resetsAt`) in the user's zone.
- The PAT dialog's expiry preview steps days and months with the contract's `addCalendarInZone` in the display zone, matching the API.
- DataTable: the `date` filter compares an instant by its day in the display zone; new `zonedDayRangeToInstants` maps a day filter onto server instants; `exportFilename` dates the file in the display zone.
- Database backup: the schedule's Timezone field is a free-text picker over the runtime's IANA zones (still the deployment setting, still validated by the API).

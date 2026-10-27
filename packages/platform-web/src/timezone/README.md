# @marinoscar/platform-web/timezone

The time zone slice of the web package, in two entries: `/timezone/headless` (the display-zone store, the formatters that render in it, the zone catalog, the map geometry and `UserTimeZoneSync`) and `/timezone/ui` (`TimeZoneMap`, the world map; `TimeZonePickerDialog`, the picker built on it; `TimeZoneField`, the compact read-out with a "Change time zone" link). It depends on `core` (the transport, and the display-zone store and formatters themselves) and `identity` (the optional auth context, to clear the choice on sign-out) (`packages/platform-slices.json`). The settings slice depends on it: the profile card draws `TimeZoneField` and `useUserSettings` keeps the store on `profile.timezone`.

## Purpose and scope

Every time the packaged UI shows is rendered in one zone: the zone the user chose on their profile (`profile.timezone`, an IANA id), else the device's zone, else UTC. The slice owns that decision and the picker that changes it.

- **One store, outside React, in `core`.** The store and the formatters live in `src/core/time-zone/` and are exported by `@marinoscar/platform-web/core`, because every slice renders dates and the slice graph lets every slice import `core` (identity, which this slice depends on, included: importing this slice from it would be a cycle). `/timezone/headless` re-exports the same functions, one instance. `getDisplayTimeZone()` answers for a pure formatter, a hook or any code; `setPreferredTimeZone(id | null)` changes it and notifies `subscribeDisplayTimeZone` listeners; `useDisplayTimeZone()` re-renders a component on change. The choice is cached in `localStorage` (`platform.timezone`) so a reload renders in the right zone before the settings fetch lands.
- **Formatters with a default zone.** `formatDateTime`, `formatDate` and `formatTime` take `Intl.DateTimeFormatOptions` plus `locale` and `fallback` (default `—`), and default `timeZone` to the display zone. A server fact defined in one zone (a backup schedule in UTC) passes `timeZone` explicitly. `zonedDateKey` gives the `YYYY-MM-DD` day of a moment in the zone, for "Today" and grouping.
- **A picker people enjoy.** A dot-matrix world map with the selected zone's UTC-offset band, a pin per zone and a pulsing ring on the selection, a search by city, country, id or offset (`UTC+5:30`, `GMT-6`), and a summary with the live local time. Full screen on a phone.

Every date the packaged pages show renders in this zone: each slice formats through the core formatters (with `NUMERIC_DATE_TIME`, `NUMERIC_DATE` or `NUMERIC_TIME` where the page used `toLocaleString()` and its kin) and subscribes with `useDisplayTimeZone()`. Deliberate UTC renderings stay UTC (the AI usage days, the telemetry assistant's prompt, a `… UTC` label beside a local one), and the broadcast composer's `datetime-local` field is read and written in the display zone.

Not here: the server's validation of `profile.timezone` (`isValidTimeZone` and `timeZoneIdSchema` of `@marinoscar/platform-contract/settings`; the settings API).

## Install and peer dependencies

Ships inside `@marinoscar/platform-web`; import it by its subpaths:

```ts
import { formatDateTime, useDisplayTimeZone, UserTimeZoneSync } from '@marinoscar/platform-web/timezone/headless';
import { TimeZoneField, TimeZonePickerDialog } from '@marinoscar/platform-web/timezone/ui';
```

Peers: `react` (the headless entry), `@mui/material` and `@mui/icons-material` (the UI entry), with what MUI needs (`@emotion/react`, `@emotion/styled`, `react-dom`). No `react-router-dom`.

## Quick start

Mount the sync once inside the auth provider; the reference app does it in [`App.tsx`](../../../../apps/web/src/App.tsx), with its transport because the platform host is mounted further in:

```tsx
<AuthProvider client={api} onBeforeLogout={removePushSubscription}>
  <UserTimeZoneSync api={appPlatformApi} />
  <AppRoutes />
</AuthProvider>
```

Format with the slice's functions; in a component, read the zone with the hook so a saved profile re-renders it:

```tsx
function CreatedAt({ value }: { value: string }) {
  useDisplayTimeZone();
  return <span>{formatDateTime(value)}</span>;
}
```

The profile page needs nothing: `UserProfilePage` draws the time zone row and saves it. A form of your own uses the field:

```tsx
<TimeZoneField value={draft.timezone ?? null} onChange={(id) => setDraft({ ...draft, timezone: id })} />
```

## Configuration

- `TimeZoneFormatOptions`: every `Intl.DateTimeFormatOptions` field, `locale` (default the runtime's) and `fallback` (default `—`). With no date or time field, `formatDateTime` uses `{ dateStyle: 'medium', timeStyle: 'short' }`, `formatDate` `{ dateStyle: 'medium' }`, `formatTime` `{ timeStyle: 'short' }`; any field option (`weekday`, `hour`, `dateStyle`, ...) replaces the defaults. An unknown `timeZone` renders in UTC. Formatters are cached per locale, options and zone.
- `UserTimeZoneSyncProps`: `api` (default the `PlatformHostProvider`'s transport) and `children` (rendered as is, so it can sit in a `ShellProviders` list).
- `TimeZoneFieldProps`: `value` (`null` or `undefined`: automatic), `onChange(id | null)`, `disabled`, `label` (default `Time zone`).
- `TimeZonePickerDialogProps`: `open`, `value`, `onClose`, `onSelect(id | null)`; the dialog keeps the pending choice and reports it only on Save.
- `TimeZoneMapProps`: `value`, `onChange(id)` (omit it for a map that only shows), `zones` (default `listTimeZones()`), `aria-label`, `sx`.

## Extension-point catalog

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `useDisplayTimeZone` | hook | `useDisplayTimeZone(): string` | Re-render a component that shows times when the user's zone changes | experimental | [example](../../../../apps/web/src/__tests__/examples/timezone/time-zone.test.tsx) |
| `UserTimeZoneSync` | component | `UserTimeZoneSync(props: { api?; children? }): ReactElement` | Load the signed-in user's `profile.timezone` into the store once per sign-in, and clear it on sign-out | experimental | [example](../../../../apps/web/src/App.tsx) |
| `TimeZoneField` | component | `TimeZoneField(props: { value; onChange; disabled?; label? }): ReactElement` | A time zone row in a form of your own; it lazy-loads the picker | experimental | [example](../../../../apps/web/src/__tests__/examples/timezone/time-zone.test.tsx) |
| `TimeZonePickerDialog` | component | `TimeZonePickerDialog(props: { open; value; onClose; onSelect }): ReactElement` | Open the picker from your own control | experimental | [example](../../../../apps/web/src/__tests__/examples/timezone/time-zone.test.tsx) |
| `TimeZoneMap` | component | `TimeZoneMap(props: { value; onChange?; zones?; 'aria-label'?; sx? }): ReactElement` | Show a zone on the world map, or build a picker of your own | experimental | [example](../../../../apps/web/src/__tests__/examples/timezone/time-zone.test.tsx) |

## Data

None on the server beyond the settings slice's `profile.timezone` (read with `GET /api/user-settings`, written by the profile card's `PATCH`). In the browser, one `localStorage` key, `platform.timezone`, holds the chosen id (removed for automatic); every access is guarded, so a blocked storage only loses the reload cache.

The map data (`headless/map-data.ts`) is generated by `scripts/generate-timezone-map.mjs` from Natural Earth 1:50m land (public domain, via world-atlas, ISC) and tzdata `zone.tab` (public domain): a 1.5-degree land grid of 240 by 95 cells and 418 zone pins. Never hand-edit it; re-run the script.

## Permissions and settings

No permission of its own. `UserTimeZoneSync` calls `GET /api/user-settings` (`user_settings:read`); a viewer without it keeps the device's zone. Saving needs `user_settings:write`, enforced by the settings API, which also validates the id (`timeZoneIdSchema`).

## UI

- **Pages.** None; the picker lives on the settings slice's Profile page (`/settings/profile`).
- **Map.** One SVG in map units (one unit is one degree; equirectangular, `x = lon + 180`, `y = 84 - lat`): the land as one path of round dots, faint hour stripes, the 15-degree band of the selected offset (split at the date line), and every zone as a tiny dot. The selected ring, the hover label and the offset axis (every 2 hours, every 4 below `sm`) are HTML placed by percentage, so they keep their size at any width. Colors come from the theme (`primary` for the land, `secondary` for the band and the ring), in light and dark mode.
- **Interaction.** A click or tap anywhere picks the nearest zone pin (`nearestZone`, longitude wraps); a fine pointer previews the nearest zone with its city, country, offset and local time. The ring's pulse stops under `prefers-reduced-motion`.
- **Responsive.** The dialog is full screen below `sm` (600px) with a close button, a `md` dialog above. This `down('sm')` read is not one of the five shell breakpoint gates.
- **Accessibility.** The map is one `role="img"` labelled with the selection; the accessible way to choose is the search field (an Autocomplete with an explicit label), the Automatic switch and the device button. The summary is a polite live region.
- **Code splitting.** `TimeZoneField` imports the dialog with `React.lazy`, and the store and formatters come from `core`, so a page that formats dates never loads the map data.

## Infra

None.

## Observability

None. A failed settings load is dropped silently; the device's zone is the fallback.

## Security notes

- The browser decides only how to display times; the API validates every stored id. The store accepts only ids `Intl.DateTimeFormat` knows (`isValidTimeZone`), so a tampered `localStorage` value is ignored.
- The zone is a display preference, never an input to an authorization decision.
- Clearing on sign-out (inside an `AuthProvider`, a settled session with no user) keeps one user's zone from following the next one on a shared device.

## Conformance suite

None. The slice's behaviour is pinned by its package tests (`test/timezone/`) and the profile card's (`test/settings/ui/ProfileSettings.timezone.test.tsx`).

## Upgrade notes

The store and formatters moved to `core` (`@marinoscar/platform-web/core`), unchanged; this slice re-exports them, so imports from `/timezone/headless` keep working. New: `NUMERIC_DATE_TIME`, `NUMERIC_DATE`, `NUMERIC_TIME`. Every packaged page now renders in the display zone (see Purpose and scope).

First release: new. `profile.timezone` became a core profile field; an app that drew it with the profile card's `ExtraFields` slot drops that field (the reference app's example is now `PronounsField.example.tsx`). `useUserSettings` of the settings slice gains `syncTimeZone` (default `true`).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Times stay in the device's zone after a reload | `UserTimeZoneSync` is not mounted, or has no transport | Mount it inside `AuthProvider` and pass `api` when it sits above `PlatformHostProvider` |
| A saved zone does not re-render a list | The component formats without subscribing | Call `useDisplayTimeZone()` in it (or pass its value as `timeZone`) |
| A test's expected time differs between machines | The formatters follow the device's zone and ICU's spacing | Pass `timeZone` and `locale`, and normalise whitespace (` ` before AM/PM) |

## Links

- [Package README](../../README.md)
- [Settings slice README](../settings/README.md)
- [Platform packages spec](../../../../docs/specs/platform-packages.md)
- [Package documentation standard](../../../../docs/PACKAGES.md)

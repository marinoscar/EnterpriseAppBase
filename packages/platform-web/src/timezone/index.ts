// The timezone slice's entry point for SIBLING SLICES of this package: the
// boundary lint lets one slice import another only through the other's
// `index.ts`, and only when packages/platform-slices.json lists the dependency
// (settings -> timezone: the profile card draws `TimeZoneField`,
// `useUserSettings` pushes `profile.timezone` into the store). Not a package
// subpath: apps import `@marinoscar/platform-web/timezone/headless` and
// `/timezone/ui`. Narrow on purpose, and by file: nothing here pulls the map
// data.

export { setPreferredTimeZone, timeZoneFromProfile } from './headless/store.js';
export { TimeZoneField } from './ui/TimeZoneField.js';
export type { TimeZoneFieldProps } from './ui/TimeZoneField.js';

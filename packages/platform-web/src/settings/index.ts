// The settings slice's entry point for SIBLING SLICES of this package (issue
// #738): the boundary lint lets one slice import another only through the
// other's `index.ts`, and only when packages/platform-slices.json lists the
// dependency (email, notifications -> settings). Not a package subpath: apps
// import `@marinoscar/platform-web/settings/headless` and `/settings/ui`.
// Narrow on purpose: only what a sibling uses.

export { useSystemSettings, useUserSettings } from './headless/index.js';
export type { UserSettingsUpdateBase } from './headless/index.js';

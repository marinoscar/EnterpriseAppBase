// The onboarding slice's entry point for SIBLING SLICES of this package (issue
// #892): the boundary lint lets one slice import another only through the
// other's `index.ts`, and only when packages/platform-slices.json lists the
// dependency (settings -> onboarding). Not a package subpath: apps import
// `@marinoscar/platform-web/onboarding/headless` and `/onboarding/ui`.
// Narrow on purpose: only what a sibling uses.

export { FeatureUnavailableNotice } from './ui/FeatureUnavailableNotice.js';
export type { FeatureUnavailableNoticeProps } from './ui/FeatureUnavailableNotice.js';

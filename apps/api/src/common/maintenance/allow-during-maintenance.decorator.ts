// The maintenance-window exemption (#257) lives in `@marinoscar/platform-api/core`
// since #727, so packaged controllers (the identity slice's sign-in routes) can
// carry it. Re-exported here so the app's imports are unchanged; the metadata
// key and the semantics are the same. The exempt set is asserted as a whole by
// `test/maintenance/maintenance-reachable-set.integration.spec.ts`.
export { ALLOW_DURING_MAINTENANCE_KEY, AllowDuringMaintenance } from '@marinoscar/platform-api/core';

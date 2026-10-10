// `@marinoscar/platform-api/storage/testing`: the storage slice's test seams
// (issue #736): the conformance suite (importing this entry registers it with
// `runPlatformConformance`) and the storage driver kit (PP-14.7), which an app
// runs on every driver it registers. Never import it from production code.
// Documented in ../README.md.

export {
  checkOrgScopedKeys,
  checkStorageKeyPrefixes,
  checkStorageSettingsSchemas,
  storageConformanceSuite,
} from './conformance';
export type { StorageConformanceOptions } from './conformance';
export { describeStorageDriverConformance } from './driver-conformance';
export type {
  StorageDriverConformanceHarness,
  StorageDriverConformanceOptions,
  StorageDriverConformanceScenario,
} from './driver-conformance';

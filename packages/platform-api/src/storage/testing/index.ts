// `@marinoscar/platform-api/storage/testing`: the storage slice's test seams
// (issue #736): the conformance suite (importing this entry registers it with
// `runPlatformConformance`). Never import it from production code. Documented
// in ../README.md.

export {
  checkOrgScopedKeys,
  checkStorageKeyPrefixes,
  checkStorageSettingsSchemas,
  storageConformanceSuite,
} from './conformance';
export type { StorageConformanceOptions } from './conformance';

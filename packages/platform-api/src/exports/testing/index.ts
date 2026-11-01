// `@marinoscar/platform-api/exports/testing`: the exports slice's conformance
// suite and test helpers (issue #744). Importing this entry registers the
// `exports` suite with `runPlatformConformance` (@marinoscar/platform-api/testing).
// Never import it from production code. Documented in ../README.md.

export {
  checkExportRegistries,
  collectExportOutput,
  exportSentinel,
  exportsConformanceSuite,
  forbiddenExportSentinels,
  runSentinelExports,
  sentinelExportDb,
  tablesOf,
} from './conformance';
export type { CollectedExportOutput, ExportsConformanceOptions, SentinelExportOutput } from './conformance';
export { exportFileText, isZip, readZipEntries } from './zip';
export type { ZipEntry } from './zip';

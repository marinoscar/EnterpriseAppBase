// `@marinoscar/platform-api/sharing/testing`: the sharing slice's conformance
// suite (issue #732). Importing this entry registers the `sharing` suite with
// `runPlatformConformance` (@marinoscar/platform-api/testing). Never import it
// from production code. Documented in ../README.md ("Conformance suite").

export {
  SHARING_RAW_SQL_INDEXES,
  checkGroupOwnershipRegistered,
  checkLinkRoutesGuarded,
  checkNoDirectSharingAccess,
  checkResourceTypeIdsStable,
  checkSharingRawSqlIndexes,
  discoverSharingRoutes,
  modelsWithOwnerGroupColumn,
  sharingConformanceSuite,
} from './conformance';
export type { SharingConformanceCheck, SharingConformanceFinding, SharingConformanceOptions, SharingRoute } from './conformance';
export { HOSTILE_STRINGS, describeGranteeKindConformance } from './grantee-kind-conformance';
export type { GranteeKindConformanceSubject } from './grantee-kind-conformance';
export { describeAccessRuleConformance } from './access-rule-conformance';
export type { AccessRuleConformanceSubject, AccessRuleFixture } from './access-rule-conformance';
export { recordingSqlKit } from './recording-sql-kit';
export type { RecordedSql } from './recording-sql-kit';

// `@marinoscar/platform-api/email/testing`: the email slice's test seams
// (issue #737): the conformance suite (importing this entry registers it with
// `runPlatformConformance`). Never import it from production code. Documented
// in ../README.md.

export {
  checkEmailSettingsSchemas,
  checkEmailTemplateRendering,
  checkPlatformEmailTemplates,
  emailConformanceSuite,
} from './conformance';
export type { EmailConformanceOptions } from './conformance';

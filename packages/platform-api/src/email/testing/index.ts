// `@marinoscar/platform-api/email/testing`: the email slice's test seams
// (issue #737): the conformance suite (importing this entry registers it with
// `runPlatformConformance`) and the email transport kit (PP-14.8), which an app
// runs on every transport it registers. Never import it from production code. Documented
// in ../README.md.

export {
  checkEmailSettingsSchemas,
  checkEmailTemplateRendering,
  checkPlatformEmailTemplates,
  emailConformanceSuite,
} from './conformance';
export type { EmailConformanceOptions } from './conformance';
export { describeEmailTransportConformance } from './transport-conformance';
export type {
  EmailTransportConformanceBackend,
  EmailTransportConformanceHarness,
  EmailTransportConformanceOptions,
  EmailTransportConformanceScenario,
  ReceivedEmail,
  ReceivedEmailAttachment,
} from './transport-conformance';

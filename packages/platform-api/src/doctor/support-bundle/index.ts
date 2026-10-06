// The support bundle (issue #772, PP-13.1): part of the Doctor slice,
// re-exported by `@marinoscar/platform-api/doctor`. Explicit named exports only.

export { isSupportBundleOmission, omitSupportBundleSection } from './support-bundle-section.interface';
export type {
  SupportBundleOmission,
  SupportBundlePrincipal,
  SupportBundleSection,
  SupportBundleSectionContext,
} from './support-bundle-section.interface';
export { SupportBundleRegistry } from './support-bundle.registry';
export { SupportBundleService } from './support-bundle.service';
export type { SupportBundleBuild } from './support-bundle.service';
export {
  SUPPORT_BUNDLE_AUDIT_ACTION,
  SUPPORT_BUNDLE_MAX_BYTES,
  SUPPORT_BUNDLE_SECTION_MAX_BYTES,
  SUPPORT_BUNDLE_SECTION_TIMEOUT_MS,
  SUPPORT_BUNDLE_SUBPATH,
  defaultSupportBundlePrincipal,
} from './support-bundle.options';
export type { ResolvedSupportBundleOptions, SupportBundleOptions } from './support-bundle.options';
export { SupportBundleDto, createSupportBundleController } from './support-bundle.controller';
export type { SupportBundleControllerInstance } from './support-bundle.controller';
export {
  COMMIT_SHA_ALLOWED_PATHS,
  REDACTED,
  SENSITIVE_KEY_PATTERN,
  SUPPORT_BUNDLE_REDACTION_VERSION,
  redactString,
  redactValue,
} from './redact';
export type { RedactionResult } from './redact';
export { MetaSupportBundleSection, PLATFORM_PACKAGE_NAMES } from './sections/meta.section';
export type { MetaSupportBundleData } from './sections/meta.section';
export { DoctorSupportBundleSection } from './sections/doctor.section';
export type { DoctorSupportBundleData } from './sections/doctor.section';

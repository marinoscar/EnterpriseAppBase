// `@marinoscar/platform-web/user-data/headless`: the user-data slice's
// clients, the destructive-job hook and the Danger-Zone-last check, with no
// component (issue #743, PP-9.1). Documented in ../README.md.

export { createFactoryResetClient, createOrgOffboardingClient, createUserDataClient } from './client.js';
export type { FactoryResetClient, OrgOffboardingClient, UserDataClient } from './client.js';
export { useDestructiveJob } from './use-destructive-job.js';
export type {
  DestructiveJobPhase,
  DestructiveJobStatus,
  UseDestructiveJobOptions,
  UseDestructiveJobReturn,
} from './use-destructive-job.js';
export { DANGER_ZONE_GROUP_LABEL, dangerZoneLastViolations } from './sections.js';
export type { SettingsCardLike, SettingsSectionLike, SettingsSectionsLike } from './sections.js';

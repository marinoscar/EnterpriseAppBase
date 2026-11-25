// The user-data pages' copy and card descriptors' strings (issue #743).

/** @stability experimental */
export const DANGER_ZONE_PAGE_TITLE = 'Delete my data';
/** @stability experimental */
export const DANGER_ZONE_PAGE_DESCRIPTION = 'Delete what you own in this application. Your account stays.';
/** @stability experimental */
export const FACTORY_RESET_PAGE_TITLE = 'Factory reset';
/** @stability experimental */
export const FACTORY_RESET_PAGE_DESCRIPTION = 'Return the whole application to a fresh install, keeping configuration and backups.';

/** What every per-user deletion keeps (EvoPath's list plus memberships). @stability experimental */
export const USER_DATA_KEPT: readonly string[] = [
  'Your account, your sign-in identities and your roles',
  'Your organization and group memberships',
  'This browser session (you stay signed in)',
  'The audit log',
];

/** What a factory reset deletes. @stability experimental */
export const FACTORY_RESET_DELETED: readonly string[] = [
  'Every other user, their sessions and their access tokens',
  "Every user's data, yours included",
  'Job history, broadcasts, device logins and the allowlist (except your own entry)',
  'Every stored file except database backups',
  'Every organization except the default one',
];

/** What a factory reset keeps. @stability experimental */
export const FACTORY_RESET_KEPT: readonly string[] = [
  'Your account and this session',
  'Roles and permissions',
  'Configuration: system settings, storage, email and AI credentials, AI models',
  'Database backups, their files and their jobs',
  'Worker nodes (reassigned to you)',
  'The audit log',
];

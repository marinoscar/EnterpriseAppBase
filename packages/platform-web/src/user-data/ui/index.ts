// `@marinoscar/platform-web/user-data/ui`: the user-data slice's pages and
// dialogs (issue #743, PP-9.1): the user Danger Zone, the admin factory reset,
// the organization offboarding dialog and its button, the typed-confirmation
// dialog, and the two packaged settings pages. Documented in ../README.md.

export { TypedConfirmDialog } from './TypedConfirmDialog.js';
export type { TypedConfirmDialogProps, TypedConfirmResultRow } from './TypedConfirmDialog.js';
export { UserDangerZonePage } from './UserDangerZonePage.js';
export type { UserDangerZonePageProps } from './UserDangerZonePage.js';
export { FactoryResetPage } from './FactoryResetPage.js';
export type { FactoryResetPageProps } from './FactoryResetPage.js';
export { OrgOffboardingDialog } from './OrgOffboardingDialog.js';
export type { OffboardedOrganization, OrgOffboardingDialogProps } from './OrgOffboardingDialog.js';
export { OffboardOrganizationButton } from './OffboardOrganizationButton.js';
export type { OffboardOrganizationButtonProps } from './OffboardOrganizationButton.js';
export { dangerZoneSettingsPage, factoryResetSettingsPage } from './settings-pages.js';
export {
  DANGER_ZONE_PAGE_DESCRIPTION,
  DANGER_ZONE_PAGE_TITLE,
  FACTORY_RESET_DELETED,
  FACTORY_RESET_KEPT,
  FACTORY_RESET_PAGE_DESCRIPTION,
  FACTORY_RESET_PAGE_TITLE,
  USER_DATA_KEPT,
} from './copy.js';

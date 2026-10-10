// `@marinoscar/platform-web/identity/ui`: the identity slice's pages and
// components (issue #727, PP-6.6), built on `/identity/headless` only.
// "Packages own behaviour, apps own appearance": the app's theme styles them,
// `slots` and the identity adapters (spinner, table) replace parts. Documented
// in ../README.md. Explicit named exports only.

export { LoginPage } from './LoginPage.js';
export type { LoginPageProps, LoginPageSlots, LoginProvidersSlotProps } from './LoginPage.js';
export { AuthCallbackPage } from './AuthCallbackPage.js';
export type { AuthCallbackPageProps } from './AuthCallbackPage.js';
export { SignInErrorView } from './SignInErrorView.js';
export type { SignInErrorViewProps } from './SignInErrorView.js';
export {
  DEFAULT_SIGN_IN_ERROR_CODE,
  SIGN_IN_ERROR_CODES,
  createSignInErrorContent,
  resolveSignInErrorCode,
} from './sign-in-error-content.js';
export type {
  SignInErrorCode,
  SignInErrorContent,
  SignInErrorPrimaryAction,
  SignInErrorSeverity,
} from './sign-in-error-content.js';
export { BUILT_IN_AUTH_PROVIDERS, OAuthButton } from './OAuthButton.js';
export type { OAuthButtonProps } from './OAuthButton.js';
export { ActivateDevicePage } from './ActivateDevicePage.js';
export { OrgSwitcher } from './OrgSwitcher.js';
export { UserTokensPage } from './tokens/UserTokensPage.js';
export { PersonalAccessTokens } from './tokens/PersonalAccessTokens.js';
export { UsersPage } from './users/UsersPage.js';
export { UserList } from './users/UserList.js';
export { AllowlistTable } from './users/AllowlistTable.js';
export { buildUserColumns } from './users/userListColumns.js';
export { OrganizationPage } from './org/OrganizationPage.js';
export { OrganizationsPage } from './org/OrganizationsPage.js';
export type { OrganizationsPageProps } from './org/OrganizationsPage.js';
export { OrgMembersPanel } from './org/OrgMembersPanel.js';
export { OrgInvitesPanel } from './org/OrgInvitesPanel.js';
export { identityAdminSections, identityUserSettingsSections } from './settings.js';
export type { IdentitySettingsCard } from './settings.js';

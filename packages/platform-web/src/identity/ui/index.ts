// `@marinoscar/platform-web/identity/ui`: the identity slice's pages and
// components (issue #727, PP-6.6), built on `/identity/headless` only.
// "Packages own behaviour, apps own appearance": the app's theme styles them,
// `slots` and the identity adapters (spinner, table) replace parts. Documented
// in ../README.md. Explicit named exports only.

export { LoginPage } from './LoginPage.js';
export type { LoginPageProps, LoginPageSlots, LoginProvidersSlotProps } from './LoginPage.js';
export { AuthCallbackPage } from './AuthCallbackPage.js';
export type { AuthCallbackPageProps, AuthCallbackPageSlots } from './AuthCallbackPage.js';
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
export type { ActivateDevicePageProps, ActivateDevicePageSlots } from './ActivateDevicePage.js';
export { OrgSwitcher } from './OrgSwitcher.js';
export { UserTokensPage } from './tokens/UserTokensPage.js';
export type { UserTokensPageProps, UserTokensPageSlots } from './tokens/UserTokensPage.js';
export { PersonalAccessTokens } from './tokens/PersonalAccessTokens.js';
export { UsersPage } from './users/UsersPage.js';
export type { UsersPageProps, UsersPageSlots, UsersPageTab } from './users/UsersPage.js';
export { UserList } from './users/UserList.js';
export type { UserListProps, UserListSlots } from './users/UserList.js';
export { AllowlistTable } from './users/AllowlistTable.js';
export { buildUserColumns } from './users/userListColumns.js';
export { OrganizationPage } from './org/OrganizationPage.js';
export type { OrganizationPageProps, OrganizationPageSlots } from './org/OrganizationPage.js';
export { OrganizationsPage } from './org/OrganizationsPage.js';
export type { OrganizationsPageProps, OrganizationsPageSlots } from './org/OrganizationsPage.js';
export { OrgMembersPanel } from './org/OrgMembersPanel.js';
export type { OrgMembersPanelProps, OrgMembersPanelSlots } from './org/OrgMembersPanel.js';
export { OrgInvitesPanel } from './org/OrgInvitesPanel.js';
export type { OrgInvitesPanelProps } from './org/OrgInvitesPanel.js';
export { identityAdminSections, identityUserSettingsSections } from './settings.js';
// The OAuth server's pages (PP-15.7, #1185): the consent and error routes
// (outside the shell), the user's Connected apps and the admin OAuth clients.
export { CONSENT_ALLOW_DELAY_MS, OAuthConsentPage, defaultConsentSelection } from './oauth/OAuthConsentPage.js';
export type { OAuthConsentPageProps, OAuthConsentPageSlots } from './oauth/OAuthConsentPage.js';
export { OAuthErrorPage, oauthErrorPageContent } from './oauth/OAuthErrorPage.js';
export type { OAuthErrorPageProps, OAuthErrorPageSlots } from './oauth/OAuthErrorPage.js';
export { CONNECTED_APPS_TABLE_ID, ConnectedAppsPage } from './oauth/ConnectedAppsPage.js';
export type { ConnectedAppsPageProps, ConnectedAppsPageSlots } from './oauth/ConnectedAppsPage.js';
export { OAUTH_CLIENTS_TABLE_ID, OAuthClientsPage } from './oauth/OAuthClientsPage.js';
export type { OAuthClientsPageProps, OAuthClientsPageSlots } from './oauth/OAuthClientsPage.js';
export type { IdentitySettingsCard } from './settings.js';

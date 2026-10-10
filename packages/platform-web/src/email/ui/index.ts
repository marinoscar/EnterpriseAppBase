// `@marinoscar/platform-web/email/ui`: the `/admin/settings/email` page
// (issue #737, PP-8.4), as a default and a named export, so the app keeps
// `lazy(() => import('@marinoscar/platform-web/email/ui'))` and the page stays
// in a chunk of its own. Also the email transport panel registry (PP-14.8):
// `registerEmailTransportPanel`, and the generic panel it falls back to.
// Documented in ../README.md.

export { default, default as EmailSettingsPage } from './EmailSettingsPage.js';
export {
  EmailGenericTransportPanel,
  getEmailTransportPanel,
  registerEmailTransportPanel,
} from './transport-panels.js';
export type {
  EmailTransportPanelComponent,
  EmailTransportPanelOptions,
  EmailTransportPanelProps,
} from './transport-panels.js';

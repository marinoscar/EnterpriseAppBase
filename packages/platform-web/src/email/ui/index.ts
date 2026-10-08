// `@marinoscar/platform-web/email/ui`: the `/admin/settings/email` page
// (issue #737, PP-8.4), as a default and a named export, so the app keeps
// `lazy(() => import('@marinoscar/platform-web/email/ui'))` and the page stays
// in a chunk of its own. Documented in ../README.md.

export { default, default as EmailSettingsPage } from './EmailSettingsPage.js';

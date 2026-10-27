// `@marinoscar/platform-web/ai/ui/config-page`: the AiConfigPage route component alone
// (issue #890), as a default and a named export, so the app keeps
// `lazy(() => import('@marinoscar/platform-web/ai/ui/config-page'))` and the page
// stays in a chunk of its own: Admin → Settings → AI (`/admin/settings/ai`). Documented in ../README.md.

export { default, default as AiConfigPage } from './AiConfigPage.js';

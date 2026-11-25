// `@marinoscar/platform-web/ai/ui/usage-page`: the AiUsagePage route component alone
// (issue #890), as a default and a named export, so the app keeps
// `lazy(() => import('@marinoscar/platform-web/ai/ui/usage-page'))` and the page
// stays in a chunk of its own: Admin → Settings → AI → Usage. Documented in ../README.md.

export { default, default as AiUsagePage } from './AiUsagePage.js';

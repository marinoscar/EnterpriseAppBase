// `@marinoscar/platform-web/ai/ui/models-page`: the AiModelsPage route component alone
// (issue #890), as a default and a named export, so the app keeps
// `lazy(() => import('@marinoscar/platform-web/ai/ui/models-page'))` and the page
// stays in a chunk of its own: Admin → Settings → AI → Models. Documented in ../README.md.

export { default, default as AiModelsPage } from './AiModelsPage.js';

// `@marinoscar/platform-web/ai/ui/playground-page`: the AiPlaygroundPage route component alone
// (issue #890), as a default and a named export, so the app keeps
// `lazy(() => import('@marinoscar/platform-web/ai/ui/playground-page'))` and the page
// stays in a chunk of its own: the AI playground (`/ai`). Documented in ../README.md.

export { default, default as AiPlaygroundPage } from './AiPlaygroundPage.js';

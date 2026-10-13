// `@marinoscar/platform-web/ai/ui/playground-page`: the AiPlaygroundPage route component alone
// (issue #890), as a default and a named export, so the app keeps
// `lazy(() => import('@marinoscar/platform-web/ai/ui/playground-page'))` and the page
// stays in a chunk of its own: the AI playground (`/ai`). Documented in ../README.md.

export { default, default as AiPlaygroundPage } from './AiPlaygroundPage.js';

// The packaged panels, so an app's playground mode (`registerAiPlaygroundMode`,
// PP-14.17) can reuse one: it loads with the page's chunk, not the main one.
export { AiTranscribeMode } from './playground/AiTranscribeMode.js';
export type { AiTranscribeModeProps } from './playground/AiTranscribeMode.js';

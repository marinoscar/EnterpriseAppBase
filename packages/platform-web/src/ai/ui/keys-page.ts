// `@marinoscar/platform-web/ai/ui/keys-page`: the UserAiKeysPage route component alone
// (issue #890), as a default and a named export, so the app keeps
// `lazy(() => import('@marinoscar/platform-web/ai/ui/keys-page'))` and the page
// stays in a chunk of its own: the user's AI keys page (`/settings/ai`). Documented in ../README.md.

export { default, default as UserAiKeysPage } from './UserAiKeysPage.js';

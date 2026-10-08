// `@marinoscar/platform-web/ai/ui`: the AI slice's packaged pages (issue
// #739, PP-8.6): the Organization AI keys page, as a default and a named
// export, so the app keeps `lazy(() => import('@marinoscar/platform-web/ai/ui'))`.
// Documented in ../README.md.

export { default, default as OrgAiKeysPage, ORG_AI_KEYS_DESCRIPTION } from './OrgAiKeysPage.js';

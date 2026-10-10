// `@marinoscar/platform-web/ai/ui`: the AI slice's packaged pages (issues #739,
// PP-8.6, and #890): the Organization AI keys page as the default export, so
// the app keeps `lazy(() => import('@marinoscar/platform-web/ai/ui'))`, and
// every other AI page as a named export. Each page is also a subpath of its
// own (`./config-page`, `./models-page`, `./usage-page`, `./keys-page`,
// `./playground-page`) so the app lazy-loads one chunk per route.
// Documented in ../README.md.

export { default, default as OrgAiKeysPage, ORG_AI_KEYS_DESCRIPTION } from './OrgAiKeysPage.js';
export { default as AiConfigPage } from './AiConfigPage.js';
export { default as AiModelsPage } from './AiModelsPage.js';
export { default as AiUsagePage } from './AiUsagePage.js';
export { default as UserAiKeysPage } from './UserAiKeysPage.js';
export { default as AiPlaygroundPage } from './AiPlaygroundPage.js';
export { RequireAiEnabled } from './RequireAiEnabled.js';
export type { RequireAiEnabledProps } from './RequireAiEnabled.js';
export {
  AiGenericProviderCard,
  getAiProviderCard,
  registerAiProviderCard,
} from './provider-cards.js';
export type {
  AiProviderCardComponent,
  AiProviderCardProps,
  AiProviderFormErrors,
  AiProviderFormValue,
} from './provider-cards.js';

// `@marinoscar/platform-web/ai/ui/require-ai-enabled`: the AI feature route guard
// alone (issue #899), so the app's router imports it without pulling every AI
// page into the main chunk. Documented in ../README.md.

export { RequireAiEnabled } from './RequireAiEnabled.js';
export type { RequireAiEnabledProps } from './RequireAiEnabled.js';

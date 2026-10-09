// `@marinoscar/platform-web/ai/headless`: the AI slice's headless web layer
// (issues #739, PP-8.6, and #890): the organization AI keys hook and policy,
// the AI calls over the host transport, the hooks behind the admin, key and
// playground pages, and the slots (app spinner, app table). Documented in
// ../README.md.

// ---- the organization's own keys (#739) ----
export { useOrgAiKeys } from './use-org-ai-keys.js';
export type { UseOrgAiKeysOptions, UseOrgAiKeysResult } from './use-org-ai-keys.js';
export { useOrgAiPolicy } from './use-org-ai-policy.js';
export type { UseOrgAiPolicyOptions, UseOrgAiPolicyResult } from './use-org-ai-policy.js';
export type { OrgAiKeyView } from '@marinoscar/platform-contract/ai';

// ---- the slots the app fills (#890) ----
export { AiWebAdaptersProvider, useAiWebAdapters } from './adapters.js';
export type { AiSpinnerProps, AiWebAdapters } from './adapters.js';

// ---- the wire: types, constants and the calls over `PlatformApiClient` ----
export * from './types.js';
export * from './client.js';
export * from './chat-attachments.js';
export { toAiErrorInfo } from './errors.js';
export type { AiErrorInfo } from './errors.js';

// ---- hooks ----
export { useAiApi } from './use-ai-api.js';
export type { AiHookOptions } from './use-ai-api.js';
export {
  AI_CONFIG_DISABLED,
  AiConfigContext,
  useAiConfig,
  useAiConfigQuery,
  useAiFeatures,
} from './use-ai-config.js';
export type { AiFeatureFlags, UseAiConfigReturn } from './use-ai-config.js';
export { AiConfigProvider } from './ai-config-provider.js';
export { useAiStorageObjects } from './use-ai-storage.js';
export { useAiUserSettings } from './use-ai-user-settings.js';
export type { AiUserSettings, AiUserSettingsUpdate } from './use-ai-user-settings.js';
export * from './use-ai-chat.js';
export * from './use-ai-run.js';
export * from './use-ai-realtime-session.js';
export * from './use-microphone-permission.js';
export * from './schema-presets.js';
export * from './use-ai-models.js';
export * from './use-ai-usage.js';
export * from './use-ai-admin-config.js';
export * from './use-user-ai-keys.js';
export * from './use-usable-ai-models.js';

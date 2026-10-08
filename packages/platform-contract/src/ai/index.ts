// `@marinoscar/platform-contract/ai`: the wire contract of the AI platform
// slice (issue #739, PP-8.6): the `ai` system and user settings namespace
// schemas (with the compile-time `AiSettingsCarriesNoSecret` proof), the org
// layer of the system namespace, and the org-key and feature-list routes'
// shapes. zod only. Documented in ./README.md. Explicit named exports only.

export {
  AI_AZURE_API_VERSION_PATTERN,
  AI_AZURE_DEPLOYMENT_PATTERN,
  AI_AZURE_DEPLOYMENTS_MAX,
  AI_AZURE_ENDPOINT_SCHEMES,
  AI_AZURE_MODEL_ID_MAX,
  AI_COMPATIBLE_ENDPOINT_SCHEMES,
  AI_ENDPOINT_URL_MAX,
  AI_KEY_POLICIES,
  AI_LIMIT_MODEL_KEY_MAX,
  AI_LIMIT_MODEL_KEY_PATTERN,
  AI_LIMIT_VALUE_MAX,
  AI_LIMITS_PER_MODEL_MAX,
  AI_MCP_ALLOWED_HOST_PATTERN,
  AI_MCP_ALLOWED_HOSTS_MAX,
  AI_OPENAI_API_STYLES,
  AI_PROVIDER_IDS,
  AI_SETTINGS_CARRIES_NO_SECRET,
  AI_USAGE_RETENTION_MAX_DAYS,
  aiAzureDeploymentsSchema,
  aiEndpointUrlProblem,
  aiEndpointUrlSchema,
  aiLimitsSettingsSchema,
  aiLimitValueSchema,
  aiResponseSchema,
  aiSettingsPatchSchema,
  aiSettingsSchema,
  systemAiAzureProviderSchema,
  systemAiCompatibleProviderSchema,
  systemAiLimitsSchema,
  systemAiPatchSchema,
  systemAiProviderSchema,
  systemAiSchema,
  userAiSettingsPatchSchema,
  userAiSettingsSchema,
} from './settings.js';
export type {
  AiKeyPolicy,
  AiOpenAiApiStyle,
  AiProviderId,
  AiSettingsCarriesNoSecret,
  SystemAiLimitsValue,
  SystemAiValue,
  UserAiSettingsPatchValue,
  UserAiSettingsValue,
} from './settings.js';
export { aiFeatureViewSchema } from './features.js';
export type { AiFeatureView } from './features.js';

// `@marinoscar/platform-contract/ai`: the wire contract of the AI platform
// slice (issue #739, PP-8.6): the `ai` system and user settings namespace
// schemas (with the compile-time `AiSettingsCarriesNoSecret` proof), the org
// layer of the system namespace, and the org-key and feature-list routes'
// shapes. Documented in ./README.md. Explicit named exports only.
// constants.ts is zod-free.

// ---- constants (zod-free) ----------------------------------------------------------------
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
  AI_PROVIDER_ID_PATTERN,
  AI_PROVIDER_IDS,
  BUILTIN_AI_PROVIDER_IDS,
  AI_USAGE_RETENTION_MAX_DAYS,
  ORG_AI_KEY_MAX,
  ORG_AI_KEY_MIN,
  aiEndpointUrlProblem,
} from './constants.js';
export type {
  AiKeyPolicy,
  AiKeyPolicyEnum,
  AiOpenAiApiStyle,
  AiOpenAiApiStyleEnum,
  AiProviderId,
  BuiltinAiProviderId,
  AiSecretFieldNames,
  KeyMaterialFieldNames,
} from './constants.js';

// ---- the `ai` settings namespaces ---------------------------------------------------------
export {
  orgAiProvidersSchema,
  orgAiSettingsSchema,
  tightenAiPolicy,
  AI_SETTINGS_CARRIES_NO_SECRET,
  aiAzureDeploymentsSchema,
  aiEndpointUrlSchema,
  aiLimitsSettingsSchema,
  aiProviderIdSchema,
  aiProviderSlotPatchSchema,
  aiProviderSlotSchema,
  aiProvidersResponseSchema,
  aiLimitValueSchema,
  aiResponseSchema,
  aiSettingsPatchSchema,
  aiSettingsSchema,
  systemAiAzureProviderSchema,
  systemAiCompatibleProviderSchema,
  systemAiLimitsSchema,
  systemAiPatchSchema,
  systemAiProviderSchema,
  systemAiProvidersPatchSchema,
  systemAiProvidersSchema,
  systemAiSchema,
  userAiSettingsPatchSchema,
  userAiSettingsSchema,
} from './schemas.js';
export type {
  OrgAiSettingsValue,
  AiSettingsCarriesNoSecret,
  SystemAiLimitsValue,
  SystemAiValue,
  UserAiSettingsPatchValue,
  UserAiSettingsValue,
} from './schemas.js';

// ---- the feature list and the organization keys ------------------------------------------
export { aiFeatureViewSchema } from './features.js';
export type { AiFeatureView } from './features.js';
export { ORG_AI_KEY_VIEW_CARRIES_NO_SECRET, orgAiKeyViewSchema, setOrgAiKeySchema } from './org-keys.js';
export type { OrgAiKeyView, OrgAiKeyViewCarriesNoSecret, SetOrgAiKeyInput } from './org-keys.js';

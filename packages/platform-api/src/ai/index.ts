// `@marinoscar/platform-api/ai`: the AI platform slice (issue #739, PP-8.6).
// The provider-agnostic core, the five provider modules (their SDKs confined
// to ./providers/<provider>/), the model catalogue, the deployment policy and
// its admin routes, key resolution (a user's own key, the organization's, the
// deployment's), the runtime facade `AiService`, the HTTP surface under
// /api/ai and /api/admin/ai, usage accounting and limits. Documented in
// ./README.md. The fake provider, the runtime harness and the conformance
// kits are `@marinoscar/platform-api/ai/testing`.

// ---- the module and its options (rung 1) ---------------------------------------------------
export { AiModule } from './ai.module';
export type { AiModuleOptions, AiProviderModuleId } from './ai.module';
export { AI_MODULE_OPTIONS, DEFAULT_AI_OPTIONS } from './ai.options';
export type { AiResolvedOptions } from './ai.options';

// ---- the host ports (rung 3) -----------------------------------------------------------------
export { AI_METRICS, AI_OBJECT_STORE, AI_SYSTEM_PRISMA, NOOP_AI_METRICS } from './ports';
export type { AiMetrics, AiObjectStore, AiUsageMetricEvent } from './ports';

// ---- the data, structurally ------------------------------------------------------------------
export type {
  AiDb,
  AiDelegate,
  AiInputJsonValue,
  AiJsonArray,
  AiJsonObject,
  AiJsonValue,
  AiModelRow,
  AiPrisma,
  AiQueryArgs,
  AiRunRow,
  AiStorageObjectRow,
  AiSystemPrisma,
  AiSystemReason,
  AiUsageEventRow,
  UserAiKeyRow,
} from './data/ai-db';

// ---- permissions and settings namespaces -------------------------------------------------------
export { AI_PERMISSIONS } from './ai.permissions';
export type { AiPermissionDeclaration } from './ai.permissions';
export { AI_SYSTEM_SETTINGS } from './ai.system-settings';
export { AI_USER_SETTINGS } from './ai.user-settings';

// ---- the provider-agnostic core ---------------------------------------------------------------
export * from './core/index';

// ---- configuration: policy, guard, the deployment's keys ----------------------------------------
export * from './config/index';
export { AiOrgEnabledInterceptor } from './config/ai-org-enabled.interceptor';
export { AiConfigAdminService } from './config/ai-config-admin.service';

// ---- keys ---------------------------------------------------------------------------------------
export { AiKeyResolver } from './keys/ai-key-resolver.service';
export type { AiKeyScope, AiKeySource, AiKeyTier, ResolvedAiKey } from './keys/ai-key-resolver.service';
export { UsableModelsService } from './keys/usable-models.service';
export { UserAiKeysService } from './keys/user-ai-keys.service';
export { AiOrgKeyService, ORG_AI_KEY_AUDIT_ACTIONS } from './keys/org-key.service';
export { AiOrgKeysController } from './keys/org-keys.controller';
export { AiConfigWriterLookup } from './keys/ai-config-writer.lookup';
export { AI_KEYS_RECHECK_TYPE } from './keys/ai-user-key.constants';

// ---- the feature registry (rung 2) and the target resolver (rung 3) ----------------------------
export {
  aiFeatureRegistry,
  getAiFeature,
  listAiFeatures,
  registerAiFeature,
} from './features/ai-feature.registry';
export type { AiFeatureDefinition } from './features/ai-feature.registry';
export { AiFeaturesModule } from './features/ai-features.module';
export { AiFeaturesService, modelFitsFeature } from './features/ai-features.service';
export { AiFeaturesController } from './features/ai-features.controller';
export { AI_TARGET_RESOLVER, DefaultAiTargetResolver } from './runtime/target-resolver';
export type { AiTarget, AiTargetContext, AiTargetResolver } from './runtime/target-resolver';

// ---- the runtime facade ----------------------------------------------------------------------
export * from './runtime/index';
export { AiRunsPurgeHandler, AI_RUNS_PURGE_TYPE } from './runtime/ai-runs-purge.handler';
export { AiLimitsService, AI_LIMITS_CLOCK } from './runtime/ai-limits.service';
export type { AiLimitCall, AiLimitName, AiLimitsClock } from './runtime/ai-limits.service';
export { AiUsageRecorder } from './runtime/ai-usage.recorder';
export type { AiUsageOperation, AiUsageRecord, AiUsageStatus, AiUsageUnits } from './runtime/ai-usage.recorder';

// ---- object storage in and out ----------------------------------------------------------------
export * from './storage/index';

// ---- catalogue -----------------------------------------------------------------------------------
export { AI_CATALOG_REFRESH_TYPE } from './catalog/ai-catalog.service';

// ---- usage ---------------------------------------------------------------------------------------
export { AiUsageService } from './usage/ai-usage.service';
export { AiUsagePurgeHandler, AI_USAGE_PURGE_TYPE } from './usage/ai-usage-purge.handler';

// ---- the provider modules (adding one: docs/specs/ai-platform.md §4) ---------------------------
export { AiCoreModule } from './core/ai-core.module';
export { OpenAiProviderModule } from './providers/openai/openai.module';
export { AnthropicProviderModule } from './providers/anthropic/anthropic.module';
export { GeminiProviderModule } from './providers/gemini/gemini.module';
export { AzureOpenAiProviderModule } from './providers/azure-openai/azure-openai.module';
export { OpenAiCompatibleProviderModule } from './providers/openai-compatible/openai-compatible.module';
export { OPENAI_TTS1_VOICES, classifyOpenAiModel } from './providers/openai/openai-model-catalog';

// ---- the HTTP surface (controllers and wire schemas, for route discovery and contract tests) -----
export { AiAdminController } from './config/ai-admin.controller';
export { AiResponsesController } from './http/ai-responses.controller';
export { AiRunsController } from './http/ai-runs.controller';
export { UserAiKeysController } from './keys/user-ai-keys.controller';
export { AiUsageAdminController } from './usage/ai-usage-admin.controller';
export { AiUsageController } from './usage/ai-usage.controller';
export { AI_SSE_HEADERS, AI_SSE_HEARTBEAT_MS } from './http/ai-sse';
export { aiEmbeddingsResponseSchema } from './http/dto/ai-embeddings.dto';
export { aiRealtimeSessionResponseSchema } from './http/dto/ai-realtime.dto';
export {
  aiImageRunOutputSchema,
  aiResponseSchema,
  aiRunSchema,
  aiRunStartedSchema,
  aiSpeechRunOutputSchema,
  aiTranscriptionRunOutputSchema,
} from './http/dto/ai-response.dto';
export { aiConfigResponseSchema, aiKeyRemovalResponseSchema } from './config/dto/ai-config-response.dto';
export { aiModelSchema, refreshAiCatalogResultSchema } from './config/dto/ai-model.dto';
export { aiProviderTestResultSchema } from './config/dto/ai-provider-test.dto';
export { aiPublicConfigSchema } from './config/dto/ai-public-config.dto';
export { usableAiModelSchema } from './keys/dto/usable-ai-model.dto';
export { userAiKeyTestResultSchema, userAiKeyViewSchema } from './keys/dto/user-ai-key.dto';

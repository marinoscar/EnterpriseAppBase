// `@marinoscar/platform-api/ai/testing`: the AI slice's test kit (issue #739).
// The scripted fake provider (`FakeAiProvider`), the runtime harness that
// builds a real `AiService` over in-memory keys, storage and usage, the
// adapter conformance kit (`describeAiProviderConformance`) and the
// conformance suites (kill switch, RBAC matrix, secret egress, key policy,
// jobs server-only, no SDK leak, orchestration boundary; issue #742). Jest-only:
// it calls `jest.fn` and `describe`.
// Documented in ../README.md.

// Importing this entry registers the conformance suites with `runPlatformConformance`.
import './conformance/register';

export {
  HARNESS_USER,
  HARNESS_OTHER_USER,
  HARNESS_ORG,
  HARNESS_USER_KEY,
  HARNESS_ORG_KEY,
  HARNESS_TENANT_KEY,
  HARNESS_PROVIDER,
  HARNESS_MODEL,
  HARNESS_EMBEDDING_MODEL,
  HARNESS_IMAGE_MODEL,
  HARNESS_TRANSCRIPTION_MODEL,
  HARNESS_SPEECH_MODEL,
  HARNESS_REALTIME_MODEL,
  createAiRuntimeHarness,
} from './ai-runtime-harness';
export type {
  HarnessModel,
  AiRuntimeHarnessOptions,
  StoredAiRun,
  AiRuntimeHarness,
} from './ai-runtime-harness';
export {
  CONFORMANCE_TEXT_PROMPT,
  CONFORMANCE_STRUCTURED_PROMPT,
  CONFORMANCE_TOOL_PROMPT,
  CONFORMANCE_EMBEDDING_INPUTS,
  CONFORMANCE_IMAGE_PROMPT,
  CONFORMANCE_PNG,
  CONFORMANCE_WAV,
  conformanceStructuredSchema,
  conformanceWeatherTool,
  conformanceRequests,
  describeAiProviderConformance,
} from './conformance';
export type {
  AiConformanceScenario,
  AiConformanceFixtures,
  AiConformanceSubject,
  AiConformanceOptions,
  AiConformanceRequests,
  ConformanceWeatherReport,
} from './conformance';
export {
  FAKE_FILE_INPUT_STRATEGY,
  FAKE_TEXT_MODEL_CAPABILITIES,
  FAKE_EMBEDDING_MODEL_CAPABILITIES,
  FAKE_IMAGE_MODEL_CAPABILITIES,
  FAKE_TRANSCRIPTION_MODEL_CAPABILITIES,
  FAKE_SPEECH_MODEL_CAPABILITIES,
  FAKE_REALTIME_MODEL_CAPABILITIES,
  FAKE_REALTIME_VOICES,
  FAKE_REALTIME_SECRET_PREFIX,
  FAKE_REALTIME_BASE_URL,
  FAKE_SPEECH_VOICES,
  FAKE_IMAGE_BYTES,
  fakeEmbeddingVector,
  FakeAiProvider,
} from './fake-ai-provider';
export type {
  FakeAiScriptedResponse,
  FakeAiScript,
  FakeAiCallMethod,
  FakeAiCall,
  FakeAiDeliveredInput,
  FakeAiProviderOptions,
} from './fake-ai-provider';
export {
  createInMemoryAiKeysPrisma,
} from './in-memory-ai-keys-prisma';
export type {
  FakeUserAiKeyRow,
  FakeAiModelRow,
  InMemoryAiKeysPrisma,
  InMemoryAiKeysClient,
  InMemoryUserAiKeyDelegate,
  InMemoryAiModelDelegate,
} from './in-memory-ai-keys-prisma';
export {
  InMemoryStorageNotConfiguredError,
  IN_MEMORY_PRESIGNED_SIGNATURE,
  IN_MEMORY_PRESIGNED_ORIGIN,
  createInMemoryAiStorage,
} from './in-memory-ai-storage';
export type {
  InMemoryStorageObject,
  InMemoryAiStorage,
  InMemoryAiObjectStore,
} from './in-memory-ai-storage';
// The conformance suites.
export { aiJobsServerOnlySuite, findAiJobsMissingFromServerOnly, findNodeEligibleAiJobs } from './conformance/ai-jobs-server-only.suite';
export type { AiJobsServerOnlyOptions, JobHandlerView, JobRegistryView } from './conformance/ai-jobs-server-only.suite';
export { aiKeyPolicySuite, keysSeenBy } from './conformance/ai-key-policy.suite';
export type { AiKeyPolicyOptions } from './conformance/ai-key-policy.suite';
export {
  collectPropertyNames,
  findKeyShapedProperties,
  findLeakedSentinels,
  findSecretShapedProperties,
  KEY_SHAPED_PROPERTY_NAMES,
} from './conformance/ai-egress-checks';
export { aiKillSwitchSuite } from './conformance/ai-kill-switch.suite';
export {
  discoverAiRbacRoutes,
  discoverAiRoutes,
  findAdminRoutesBlocked,
  findAiPermissionDeclarationFailures,
  findRoleMismatches,
  findRoutesNotAnswering401,
  findRoutesNotKillSwitched,
  isPermissionDenied,
} from './conformance/ai-route-checks';
export type { AiRbacRoute, AiRoute, DiscoveredAiRoutes } from './conformance/ai-route-checks';
export type { AiKillSwitchOptions } from './conformance/ai-kill-switch.suite';
export {
  PROVIDER_SDK_PACKAGES,
  aiNoSdkLeakSuite,
  aiPackageProviderDirs,
  declaredSdks,
  findSdkLeaks,
  importSpecifiers,
  registeredAiSdkPackages,
} from './conformance/ai-no-sdk-leak.suite';
export type { AiNoSdkLeakOptions, SdkLeakTree, SdkOwnerManifest } from './conformance/ai-no-sdk-leak.suite';
export { aiOrchestrationBoundarySuite } from './conformance/ai-orchestration-boundary.registered';
export { aiRbacMatrixSuite } from './conformance/ai-rbac-matrix.suite';
export type { AiRbacMatrixOptions } from './conformance/ai-rbac-matrix.suite';
export { aiSecretEgressSuite } from './conformance/ai-secret-egress.suite';
export type { AiSecretEgressOptions } from './conformance/ai-secret-egress.suite';
export {
  ALL_KEYS,
  OTHER_USER_KEY,
  authHeader,
  concreteRoutePath,
  forEachDocumentOperation,
  parseSse,
} from './conformance/ai-conformance-fixture';
export type {
  AiAuthorizationHeader,
  AiConformanceApp,
  AiConformanceContext,
  AiConformanceFixture,
  AiConformanceNestApp,
  AiConformanceOpenApiDocument,
  AiConformanceUser,
  ParsedFrame,
} from './conformance/ai-conformance-fixture';
export {
  DEFAULT_BANNED_ORCHESTRATION_PACKAGES,
  findOrchestrationViolations,
  isBannedOrchestrationPackage,
  orchestrationImportSpecifiers,
  runOrchestrationBoundarySuite,
} from './conformance/orchestration-boundary.suite';
export type {
  OrchestrationBoundaryOptions,
  OrchestrationManifest,
  OrchestrationScannedFile,
} from './conformance/orchestration-boundary.suite';

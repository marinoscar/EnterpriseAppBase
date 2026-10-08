// `@marinoscar/platform-api/ai/testing`: the AI slice's test kit (issue #739).
// The scripted fake provider (`FakeAiProvider`), the runtime harness that
// builds a real `AiService` over in-memory keys, storage and usage, the
// adapter conformance kit (`describeAiProviderConformance`) and the
// orchestration-boundary suite. Jest-only: it calls `jest.fn` and `describe`.
// Documented in ../README.md.

export {
  HARNESS_USER,
  HARNESS_OTHER_USER,
  HARNESS_ORG,
  HARNESS_USER_KEY,
  HARNESS_ORG_KEY,
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
} from './in-memory-ai-storage';

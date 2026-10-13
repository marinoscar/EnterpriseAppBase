// `@marinoscar/platform-cli/node`: the worker node's executor contract and
// registry (#715). An app adds a node-eligible job type with
// `registerNodeExecutor` (or `createCli({ nodeExecutors })`).
export {
  ExecutorRegistry,
  NODE_APP_SPAN_NAME_PATTERN,
  binaryCapability,
  evaluateCapabilities,
  isNodeSpanName,
  probeCapabilities,
  registerJobRequirement,
  registerProbedBinary,
  runStartupSelfTest,
  sanitizeExtraVitals,
  defaultExecutorRegistry,
  defaultExecutors,
  listRegisteredNodeExecutors,
  registerNodeExecutor,
} from '../engine/index.js';
export type {
  Capability,
  CapabilityGap,
  CapabilityProbe,
  JobRequirementInput,
  JobTypeRequirements,
  SelfTestOptions,
  SelfTestResult,
  NodeSpanAttributes,
  NodeSpanName,
  ProbedBinaryOptions,
  ClaimToken,
  DownloadUrlResult,
  ExecutorNodeApi,
  JobExecutionContext,
  JobExecutor,
  JobSecret,
  NodeJob,
  UploadUrlResult,
} from '../engine/index.js';

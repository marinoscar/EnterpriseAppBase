// `@marinoscar/platform-cli/node`: the worker node's executor contract and
// registry (#715). An app adds a node-eligible job type with
// `registerNodeExecutor` (or `createCli({ nodeExecutors })`).
export {
  ExecutorRegistry,
  defaultExecutorRegistry,
  defaultExecutors,
  listRegisteredNodeExecutors,
  registerNodeExecutor,
} from '../engine/index.js';
export type {
  ClaimToken,
  DownloadUrlResult,
  ExecutorNodeApi,
  JobExecutionContext,
  JobExecutor,
  JobSecret,
  NodeJob,
  UploadUrlResult,
} from '../engine/index.js';

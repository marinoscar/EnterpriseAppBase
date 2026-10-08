// `@marinoscar/platform-contract/nodes`: the node routes' request shapes,
// shared by `@marinoscar/platform-api/nodes` (its DTOs wrap these schemas) and
// node clients (issue #734, PP-8.2). Documented in ./README.md. Explicit
// named exports only. constants.ts is zod-free.

export {
  MAX_NODE_CONCURRENCY,
  MAX_NODE_CREDENTIAL_DAYS,
  MAX_NODE_ELIGIBLE_TYPES,
} from './constants.js';
export {
  claimJobsSchema,
  claimTokenField,
  createNodeCredentialSchema,
  heartbeatNodeSchema,
  nodeDownloadUrlSchema,
  nodeJobFailureSchema,
  nodeJobResultSchema,
  nodeJobSecretRequestSchema,
  nodeUploadUrlSchema,
  nodeVitalsCountersSchema,
  nodeVitalsSchema,
  registerNodeSchema,
  renewLeaseSchema,
} from './schemas.js';
export type {
  NodeReportedStatusEnum,
  NodeVitals,
  NodeVitalsCounters,
} from './schemas.js';

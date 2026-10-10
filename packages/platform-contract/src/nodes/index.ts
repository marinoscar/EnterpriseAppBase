// `@marinoscar/platform-contract/nodes`: the node routes' request shapes,
// shared by `@marinoscar/platform-api/nodes` (its DTOs wrap these schemas) and
// node clients (issue #734, PP-8.2). Documented in ./README.md. Explicit
// named exports only. constants.ts is zod-free.

export {
  MAX_NODE_CONCURRENCY,
  MAX_NODE_CREDENTIAL_DAYS,
  MAX_NODE_CREDENTIAL_NAME_LENGTH,
  MAX_NODE_ELIGIBLE_TYPES,
  NODE_HEALTHS,
  NODE_STATUSES,
} from './constants.js';
// ---- ./admin-schemas.ts: the admin fleet's response shapes (#881)
export {
  adminNodeCredentialSchema,
  adminNodeSchema,
  nodeCredentialCreatedSchema,
  nodeCredentialListItemSchema,
  nodeJobCountsSchema,
  nodeOwnerSchema,
} from './admin-schemas.js';
export type {
  AdminNode,
  AdminNodeCredential,
  NodeCredentialCreated,
  NodeCredentialListItem,
  NodeHealth,
  NodeHealthEnum,
  NodeJobCounts,
  NodeOwner,
  NodeStatus,
  NodeStatusEnum,
} from './admin-schemas.js';
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

// ---- ./settings-schemas.ts: the `nodes` system-settings namespace (#865)
export {
  nodesResponseSchema,
  nodesSettingsPatchSchema,
  nodesSettingsSchema,
  systemNodesPatchSchema,
  systemNodesSchema,
} from './settings-schemas.js';
export type { NodesSettingsPatchInput, SystemNodesValue } from './settings-schemas.js';

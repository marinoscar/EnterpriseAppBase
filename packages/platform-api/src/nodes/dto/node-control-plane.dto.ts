// =============================================================================
// The node control plane's request bodies (issue #268, epic #254)
//
// The wire schemas, and the design notes that used to sit here, live in
// `@marinoscar/platform-contract/nodes` since #734 (`schemas.ts`, section
// "From node-control-plane.dto.ts"). This file wraps them with `createZodDto`, which is how
// they reach the OpenAPI document and the global `ZodValidationPipe`.
// =============================================================================

import { createZodDto } from 'nestjs-zod';
import {
  MAX_NODE_CONCURRENCY,
  MAX_NODE_ELIGIBLE_TYPES,
  claimJobsSchema,
  heartbeatNodeSchema,
  nodeJobFailureSchema,
  nodeJobResultSchema,
  nodeVitalsCountersSchema,
  nodeVitalsSchema,
  registerNodeSchema,
  renewLeaseSchema,
} from '@marinoscar/platform-contract/nodes';
import type {
  NodeVitals,
  NodeVitalsCounters,
} from '@marinoscar/platform-contract/nodes';

// The wire schemas live in @marinoscar/platform-contract/nodes since #734; re-exported under
// their old names so every import inside the slice is unchanged.
export {
  MAX_NODE_CONCURRENCY,
  MAX_NODE_ELIGIBLE_TYPES,
  nodeVitalsCountersSchema,
  nodeVitalsSchema,
  registerNodeSchema,
  heartbeatNodeSchema,
  claimJobsSchema,
  renewLeaseSchema,
  nodeJobResultSchema,
  nodeJobFailureSchema,
};
export type {
  NodeVitals,
  NodeVitalsCounters,
};

/**
 * The register body (`registerNodeSchema`).
 *
 * @stability experimental
 */
export class RegisterNodeDto extends createZodDto(registerNodeSchema) {}
/**
 * The heartbeat body (`heartbeatNodeSchema`).
 *
 * @stability experimental
 */
export class HeartbeatNodeDto extends createZodDto(heartbeatNodeSchema) {}
/**
 * The claim body (`claimJobsSchema`).
 *
 * @stability experimental
 */
export class ClaimJobsDto extends createZodDto(claimJobsSchema) {}
/**
 * The renew body (`renewLeaseSchema`).
 *
 * @stability experimental
 */
export class RenewLeaseDto extends createZodDto(renewLeaseSchema) {}
/**
 * The result body (`nodeJobResultSchema`).
 *
 * @stability experimental
 */
export class NodeJobResultDto extends createZodDto(nodeJobResultSchema) {}
/**
 * The failure body (`nodeJobFailureSchema`).
 *
 * @stability experimental
 */
export class NodeJobFailureDto extends createZodDto(nodeJobFailureSchema) {}

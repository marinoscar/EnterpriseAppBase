// `@marinoscar/platform-api/nodes`: the nodes slice (issue #734, PP-8.2). The
// worker-node fleet: the `nod_` credential family, the control plane
// (`/api/nodes`), the data plane (signed URLs), the brokered job secret, the
// fleet admin routes, sweeps and gauges. Needs `@marinoscar/platform-api/jobs`.
// Documented in ./README.md. Explicit named exports only.

// ---- the modules and options (rung 1) --------------------------------------------------
export { NodesModule } from './nodes.module';
export { NODES_OPTIONS, resolveNodesModuleOptions } from './nodes.options';
export type { NodesModuleOptions, ResolvedNodesModuleOptions } from './nodes.options';
export { NODES_SYSTEM_SETTINGS, mergeNodesSettings } from './nodes.system-settings';
export { NodeCredentialModule } from './node-credential.module';

// ---- the host ports (rung 3) -------------------------------------------------------------
export { NODE_JOB_INPUTS, NODE_OBJECT_STORE, NodeJobInputError } from './ports';
export type {
  NodeJobInputFailureReason,
  NodeJobInputObject,
  NodeJobInputs,
  NodeObjectStore,
  SignedPutUrlOptions,
  SignedUrlOptions,
} from './ports';

// ---- events (rung 4) -------------------------------------------------------------------------
export { NODE_OFFLINE_EVENT, NodeOfflineEvent } from './events/node-offline.event';

// ---- services ----------------------------------------------------------------------------------
export { CREDENTIAL_OWNER_SELECT, NODE_TOKEN_PREFIX, NodeCredentialService } from './node-credential.service';
export { NodesService } from './nodes.service';
export { NodeLifecycleService } from './node-lifecycle.service';
export { NODE_OUTPUT_KEY_PREFIX, NodeDataPlaneService } from './node-data-plane.service';
export { NodeSecretBrokerService, SECRET_CLOCK_SKEW_ALLOWANCE_MS } from './node-secret-broker.service';
export { NodesAdminService, OWNER_SELECT } from './nodes-admin.service';
export { NODE_FLEET_PRUNE_TYPE, NodeFleetPruneHandler } from './handlers/node-fleet-prune.handler';
export { NODE_FLEET_SWEEP_TYPE, NodeFleetSweepHandler } from './handlers/node-fleet-sweep.handler';

// ---- the wire DTOs (Nest classes over the zod schemas) ------------------------------------------
export { ClaimJobsDto, NodeJobResultDto } from './dto/node-control-plane.dto';
export { NodeDownloadUrlDto, NodeUploadUrlDto } from './dto/node-data-plane.dto';

// ---- service result shapes and the response DTOs (types; the OpenAPI document describes the wire) ----
export type { AdminNodeCredentialRow, NodeCredentialCreated, NodeCredentialListRow } from './node-credential.service';
export type { NodeEligibleJobType, NodeJobSettlement, NodeRegistration } from './nodes.service';
export type { NodeSecretSweepResult } from './node-secret-broker.service';
export type { PruneOfflineNodesResult } from './handlers/node-fleet-prune.handler';
export type { NodeSettlementLedger } from './node-settlement-ledger';
export type { CreateNodeCredentialDto } from './dto/create-node-credential.dto';
export type { HeartbeatNodeDto, NodeJobFailureDto, RegisterNodeDto, RenewLeaseDto } from './dto/node-control-plane.dto';
export type {
  NodeDownloadUrlResponseDto,
  NodeJobTypeDto,
  NodeJobTypesResponseDto,
  NodeUploadUrlResponseDto,
} from './dto/node-data-plane.dto';
export type { NodeJobSecretRequestDto, NodeJobSecretResponseDto } from './dto/node-job-secret.dto';
export type {
  AdminNodeCredentialDto,
  AdminNodeDto,
  NodeJobCountsDto,
  NodeOwnerDto,
  NodeVitalsCountersDto,
  NodeVitalsDto,
} from './dto/node-admin.dto';
export type {
  ClaimJobsResponseDto,
  JobSettlementResponseDto,
  NodeJobAssignmentDto,
  NodeJobDto,
  RegisterNodeResponseDto,
  RenewLeaseResponseDto,
  WorkerNodeDto,
} from './dto/node-response.dto';
export type { NodeCredentialCreatedResponseDto, NodeCredentialListItemDto } from './dto/node-credential-response.dto';

// ---- metrics, permissions ----------------------------------------------------------------------
export { NODES_APP_METRICS, NODE_HEALTH_VALUES, NODE_STATUS_VALUES } from './nodes.metrics';
export type { NodesAppMetricDef } from './nodes.metrics';
export { NODES_PERMISSIONS } from './nodes.permissions';
export type { NodesPermissionDeclaration } from './nodes.permissions';

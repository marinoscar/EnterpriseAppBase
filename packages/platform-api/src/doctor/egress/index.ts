// The egress inventory (issue #773, PP-13.2): part of the doctor slice,
// re-exported from `../index.ts`. Explicit named exports only.

export { DEPLOYMENT_NETWORKS, DEPLOYMENT_NETWORK_SOURCE, EGRESS_MAX_HOSTS } from './egress.types';
export type {
  DeploymentNetwork,
  DeploymentNetworkSource,
  EgressContributor,
  EgressDependency,
  EgressDependencyInput,
  EgressDirection,
  EgressScope,
} from './egress.types';
export { EgressRegistry } from './egress.registry';
export { classifyHost, egressDependency, hostnameOf, scopeOfHosts } from './classify-host';
export {
  AIR_GAPPED_RUNBOOK,
  NETWORK_EGRESS_CHECK_ID,
  NetworkEgressDoctorCheck,
  describeEgress,
  gradeEgress,
} from './network-egress.doctor-check';

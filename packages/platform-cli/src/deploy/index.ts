// `@marinoscar/platform-cli/deploy`: the deploy pipelines' step registry, the
// built-in step ids, the dry-run plan, the hooks every step reports through,
// and the env template helpers (#715).
export {
  DEPLOY_STATE_FILENAME,
  INSTALL_STEP_IDS,
  PLATFORM_DOCUMENTED_OPTIONAL_KEYS,
  PROXY_MANAGED_SENTINEL,
  UPDATE_STEP_IDS,
  builtinDeployStepIds,
  commentedAssignments,
  composeEnvSpecs,
  listRegisteredDeploySteps,
  parseEnvExample,
  planDeploySteps,
  registerDeployStep,
} from '../engine/index.js';
export type {
  AppDeployStep,
  DeployCommandResult,
  DeployHooks,
  DeployPipeline,
  DeployPlanStep,
  DeployStepContext,
  DeployStepRegistration,
  EnvVarSpec,
  StepOutcome,
  StepResult,
} from '../engine/index.js';

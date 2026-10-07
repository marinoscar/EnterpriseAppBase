import { buildInstallSteps } from '../install.js';
import { buildUpdateSteps } from '../update.js';

import type { DeployStep, StepContext } from './pipeline.js';
import type { DeployPipeline } from './registry.js';
import { withRegisteredSteps } from './registry.js';

/**
 * One step of a deploy plan.
 *
 * @stability experimental
 */
export interface DeployPlanStep {
  /** The step id, as `--resume` records it. */
  id: string;
  /** The step's title. */
  title: string;
  /** `builtin` for a platform step, `app` for one registered with `registerDeployStep`. */
  source: 'builtin' | 'app';
}

/**
 * The steps `deploy install` or `deploy update` would run, in order, with the
 * app's registered steps in place, WITHOUT running anything: a dry-run of the
 * pipeline's shape (which steps a given run then skips depends on its flags
 * and state).
 *
 * @param pipeline - `install` or `update`.
 * @returns The ordered plan.
 * @stability experimental
 */
export function planDeploySteps(pipeline: DeployPipeline): DeployPlanStep[] {
  const never = (): never => {
    throw new Error('planDeploySteps never runs a step');
  };
  // Only the ids and titles matter: the plan never runs a step.
  const builtins: DeployStep<StepContext>[] = (pipeline === 'install' ? buildInstallSteps() : buildUpdateSteps()).map(
    ({ id, title }) => ({ id, title, run: never }),
  );
  const builtinIds = new Set(builtins.map((step) => step.id));
  return withRegisteredSteps(pipeline, builtins, never).map((step) => ({
    id: step.id,
    title: step.title,
    source: builtinIds.has(step.id) ? 'builtin' : 'app',
  }));
}

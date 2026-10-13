import type { AppDeployStep, DeployStepRegistration } from '@marinoscar/platform-cli/deploy';

// =============================================================================
// EXAMPLE, NOT WIRED: placing a deploy step before, in place of, or skipping a built-in (PP-14.22)
// =============================================================================
//
// `registerDeployStep` takes exactly ONE anchor:
//
//   after     right after a step                    (announce.deploy-step.ts)
//   before    right before a step
//   replaces  instead of a step: the built-in does not run
//
// and `skipWhen`, which skips the step named by `replaces` when it returns true
// (with no `step`, it is a conditional skip of the built-in).
//
// The step reads the deployment's configuration through `context.env` and
// `context.answers`: READ-ONLY, and a SECRET key (annotated, or named
// *_SECRET / *PASSWORD* / *TOKEN* / *API_KEY*) is present (`has`) but never
// readable (`get` returns undefined), so a step cannot echo one by mistake.
//
// Replacing or skipping a BUILT-IN is the app's responsibility: later built-in
// steps read what earlier ones prepared (`checkout` sets the commit,
// `environment` writes the `.env`), so a replacement must leave the deployment
// in the state its neighbours expect. Prefer `before` / `after`.
//
// To use the pattern in a fork, add the registrations to `deploySteps`.
// =============================================================================

/** Warms the coach cache just before the stack is built, only when the coach group is on. */
export const coachWarmup: DeployStepRegistration & { step: AppDeployStep } = {
  pipeline: 'install',
  id: 'coach-warmup',
  before: 'build',
  step: {
    title: 'Warm the coach cache',
    skip: (context) => (context.env.has('COACH_API_URL') ? undefined : 'the coach group is not enabled'),
    async run(context) {
      context.log(`Warming ${context.env.get('COACH_API_URL') ?? ''}`);
      await context.exec(['curl', '--fail', '--silent', `${context.env.get('COACH_API_URL') ?? ''}/warmup`]);
    },
  },
};

/** Skips the database seed on `deploy update` for a deployment that sets `SKIP_SEED=true`. */
export const skipSeedWhenAsked: DeployStepRegistration = {
  pipeline: 'update',
  id: 'skip-seed',
  replaces: 'seed',
  skipWhen: (context) => context.env.get('SKIP_SEED') === 'true',
};

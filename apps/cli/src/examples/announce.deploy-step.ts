import type { DeployStepRegistration } from '@marinoscar/platform-cli/deploy';

// =============================================================================
// EXAMPLE, NOT WIRED: an app deploy step added through registerDeployStep (#715)
// =============================================================================
//
// The reference use of the deploy step registry. The step runs after the
// built-in `verify` step of `deploy install`, reports through the run's
// DeployHooks (never `process.stdout`) and runs its one command through the
// journal, redacted like a built-in step's. EvoPath's Android APK release is
// the real-world shape of this: one more thing to do once the stack is up.
//
// Not in `app.ts`, so `deploy install` runs exactly the platform's steps;
// `announce.deploy-step.test.ts` registers it itself. To use the pattern in a
// fork, add it to `APP_CLI_OPTIONS.deploySteps` in `app.ts`:
//
//   deploySteps: [announceInstall],
// =============================================================================

/** Logs the deployed commit, after `verify`, on a fresh install. */
export const announceInstall: DeployStepRegistration = {
  pipeline: 'install',
  id: 'announce',
  after: 'verify',
  step: {
    title: 'Announce the deployment',
    // An example of a skip reason: nothing to announce without a commit.
    skip: (context) => (context.commitSha === undefined ? 'no commit recorded' : undefined),
    async run(context) {
      const { stdout } = await context.exec(['git', 'log', '-1', '--format=%s'], { cwd: context.checkoutPath });
      context.log(`Deployed ${context.commitSha ?? ''}: ${stdout.trim()}`);
    },
  },
};

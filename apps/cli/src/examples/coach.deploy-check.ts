import type { DeployCheck } from '@marinoscar/platform-cli/deploy';

// =============================================================================
// EXAMPLE, NOT WIRED: an app prerequisite check (PP-14.22)
// =============================================================================
//
// A check is the same `Check` the platform's own doctor checks are, so the
// whole contract applies: it never throws (a throw becomes a failure), a
// failure carries a `remedy` that names a command or a path, `required` blocks
// `deploy install` / `deploy update` (and makes `doctor` exit non-zero), and it
// is READ-ONLY. `registerDeployCheck` (or `createCli({ deployChecks })`) puts
// it after the built-ins, in `doctor`, in the install and update preflight and
// in the TUI's doctor screen.
//
// To use the pattern in a fork:
//
//   deployChecks: [coachTokenCheck],
// =============================================================================

/** The coach token must be set once the `coach` group is on. Required: a deployment without it cannot call the assistant. */
export const coachTokenCheck: DeployCheck = {
  id: 'coach-token',
  title: 'Coach API token is set',
  severity: 'required',
  // Only meaningful with an environment to read; before the wizard has run, there is none.
  async run(context) {
    if (context.env === undefined) return { status: 'skip', detail: 'no environment yet' };
    if (!context.env.has('COACH_API_URL')) return { status: 'pass', detail: 'the coach group is not enabled' };
    const token = context.env.get('COACH_API_TOKEN') ?? '';
    return token.length >= 16
      ? { status: 'pass', detail: 'set' }
      : {
          status: 'fail',
          detail: 'COACH_API_TOKEN is empty or too short',
          remedy: 'Set COACH_API_TOKEN in infra/compose/.env (the wizard can generate one: re-run `deploy install --group coach`)',
        };
  },
};

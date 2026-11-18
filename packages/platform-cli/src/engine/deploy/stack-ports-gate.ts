import { PreconditionError } from '../errors.js';
import { ALL_CHECKS } from './checks/index.js';
import { checksPassed, runChecks, type CheckContext } from './checks/types.js';

// =============================================================================
// The `stack-ports` step: the port question, asked again right before the stack moves  (#1024)
// =============================================================================
//
// `stack-ports-free` also runs in the preflight, but the preflight sees the
// stack as it is BEFORE this run changes it. Two things move afterwards:
//
//   - update's `fetch` checks out the new revision, whose compose files may
//     publish a port the old ones did not, and `environment-drift` writes the
//     keys it introduces;
//   - install's preflight runs before there is a checkout or a `.env` at all.
//
// So both pipelines ask once more with the FINAL files and environment, and
// before the first step that stops or recreates a container (update:
// `database-role` can recreate the api; install: nothing runs yet, but a clash
// found at `start` is found after a full build). Not skippable: the only thing
// it reads is Docker, and a clash found later costs the site.
// =============================================================================

/** The built-in step id both pipelines share for this gate. */
export const STACK_PORTS_STEP_ID = 'stack-ports';


/**
 * Runs `stack-ports-free` against `context` and stops the run when a host port
 * the stack publishes is taken. Changes nothing.
 *
 * @param options - The check context (with the run's final `groups`), and where
 *   to report.
 * @throws PreconditionError naming each port, its holder and the fix.
 */
export async function assertStackPortsFree(options: {
  context: CheckContext;
  /** Journal line writer. */
  line: (text: string) => void;
  /** Where a warning is shown to the operator. */
  warn?: ((text: string) => void) | undefined;
}): Promise<void> {
  const check = ALL_CHECKS.find((candidate) => candidate.id === 'stack-ports-free');
  if (check === undefined) throw new Error('the stack-ports-free check is not registered');

  // `requires` dropped: the preflight already established Docker and Compose
  // v2, a second round of version probes would only slow the step down (and
  // host-facts are collected once per run), and the check itself skips when
  // Docker cannot be asked.
  const results = await runChecks([{ ...check, requires: [] }], options.context);

  for (const result of results) {
    options.line(`${result.status} ${result.id}: ${result.detail}`);
    if (result.status === 'warn') {
      options.warn?.(`warning: ${result.id}: ${result.detail}${result.remedy === undefined ? '' : ` (${result.remedy})`}`);
    }
  }

  if (!checksPassed(results)) {
    throw new PreconditionError(
      results
        .filter((result) => result.status === 'fail')
        .map((result) => `${result.id}: ${result.detail}${result.remedy === undefined ? '' : `\n    ${result.remedy}`}`)
        .join('\n'),
    );
  }
}

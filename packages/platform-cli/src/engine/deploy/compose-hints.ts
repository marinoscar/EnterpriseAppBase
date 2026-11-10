import { cliName, cliVersion } from '../identity.js';
import { CommandFailedError } from './executor.js';

// =============================================================================
// A compose "required variable" refusal, explained  (#1009)
// =============================================================================
//
// A compose file can refuse to start without a value (`${VAR:?message}`). The
// message names the variable and, at best, the file; it cannot say WHY the file
// has no value. On a real server it is almost always one of two things, and
// neither is visible from the compose output:
//
//   1. This CLI is older than the revision it is deploying. The CLI generates a
//      new required secret (`autoGenerate`, e.g. STACK_AGENT_TOKEN) during
//      `update`; a CLI built before the revision introduced it does not know
//      the key exists, so the build fails at the first compose call. The CLI is
//      updated separately from the application, which is what makes this easy
//      to hit.
//   2. The key is missing or empty in the `.env` (deleted, never generated).
//
// So every place that runs compose against the deployment appends this hint,
// keeping the original output intact above it.
// =============================================================================

const REQUIRED_VARIABLE = /required variable ([A-Za-z_][A-Za-z0-9_]*) is missing a value/g;

/** Marker that keeps a re-thrown error from collecting the hint twice. */
const HINT_MARKER = 'Hint: docker compose refused to run';

/** Variables a compose failure text reports as required and empty, in order, once each. */
export function missingComposeVariables(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(REQUIRED_VARIABLE)) {
    if (match[1] !== undefined) found.add(match[1]);
  }
  return [...found];
}

/** The plain-language explanation for the given variables. */
export function composeMissingVariableHint(variables: readonly string[], envPath: string): string {
  const cli = cliName();
  const names = variables.join(', ');
  const noun = variables.length === 1 ? `${names} has` : `${names} have`;

  return [
    `${HINT_MARKER} because ${noun} no value in ${envPath}.`,
    'There are two usual causes:',
    `  1. This ${cli} (v${cliVersion()}) is older than the revision being deployed. The revision requires ${names}, ` +
      `and only a newer ${cli} generates it during \`deploy update\`. The CLI is updated separately from the application: ` +
      `update the CLI first (re-run its installer, or your bootstrap script's --update), then run ` +
      `\`${cli} deploy update\` again. A plain retry is enough; --force is not needed.`,
    `  2. The key is missing or empty in ${envPath}. Add ${variables.map((v) => `${v}=<value>`).join(' and ')} ` +
      `there (for a token, \`openssl rand -hex 32\` makes a good one), then run \`${cli} deploy update\` again.`,
  ].join('\n');
}

/**
 * The same error with the hint appended when it is a compose "required variable"
 * refusal; anything else comes back untouched. The original message (the compose
 * output) is kept in full, and a `CommandFailedError` stays one, with its result.
 */
export function explainComposeFailure(error: unknown, envPath: string): unknown {
  if (!(error instanceof Error)) return error;
  if (error.message.includes(HINT_MARKER)) return error;

  const result = error instanceof CommandFailedError ? error.result : undefined;
  const variables = missingComposeVariables(
    [error.message, result?.stderr ?? '', result?.stdout ?? ''].join('\n'),
  );
  if (variables.length === 0) return error;

  const message = `${error.message}\n\n${composeMissingVariableHint(variables, envPath)}`;
  return result === undefined
    ? new Error(message, { cause: error })
    : new CommandFailedError(message, result);
}

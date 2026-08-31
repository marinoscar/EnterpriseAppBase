import { createInterface } from 'node:readline/promises';

import { CLI_NAME } from './branding.js';
import { UsageError } from './errors.js';

// =============================================================================
// Interactive prompting  (issues #142/#143, epic #110)
// =============================================================================
//
// `node:readline/promises`, no dependency. The prompt libraries (inquirer,
// prompts, enquirer) earn their weight when you need select lists, validation
// loops and multi-step forms; this CLI asks exactly one question — "which
// server?" — and the standard library answers it in fifteen lines. #145's TUI
// takes over the rich case with ink, so a second interaction library would be
// dead weight the moment it landed.
//
// TWO RULES, BOTH LOAD-BEARING:
//
//   1. THE PROMPT GOES TO STDERR. program.ts reserves stdout for command
//      output so that #144's `--raw` pipes into `jq` unchanged. A prompt on
//      stdout would be indistinguishable from data — and, worse, would be
//      swallowed by the pipe, leaving the user staring at a hung command with
//      no visible question.
//
//   2. NO TTY MEANS NO PROMPT — IT MEANS A CLEAR ERROR. Calling `question()`
//      on a redirected or closed stdin does not fail; it waits, or it returns
//      empty at EOF. In CI that is a job that hangs until the runner kills it,
//      and the log shows nothing about why. Failing immediately with "pass
//      --server" turns a ten-minute timeout into a one-line fix.
// =============================================================================

export interface PromptContext {
  input?: NodeJS.ReadStream | undefined;
  output?: NodeJS.WriteStream | undefined;
}

/** True when we can actually ask a question and expect an answer. */
export function canPrompt(ctx?: PromptContext): boolean {
  return (ctx?.input ?? process.stdin).isTTY === true;
}

/**
 * Ask a question on stderr and return the trimmed answer.
 *
 * Throws UsageError (exit 2 — the invocation was wrong, not the server)
 * when there is no TTY.
 */
export async function prompt(question: string, ctx?: PromptContext): Promise<string> {
  const input = ctx?.input ?? process.stdin;
  const output = ctx?.output ?? process.stderr;

  if (input.isTTY !== true) {
    throw new UsageError(
      `${CLI_NAME} needs an interactive terminal to ask "${question.trim()}". Supply the value on the command line instead.`,
    );
  }

  const rl = createInterface({ input, output, terminal: true });
  try {
    return (await rl.question(question)).trim();
  } finally {
    // Always closed, including when the promise rejects on Ctrl-C. A readline
    // interface left open holds stdin in raw mode: the shell the user returns
    // to stops echoing what they type, which looks like a broken terminal and
    // is fixed only by `reset`.
    rl.close();
  }
}

/**
 * Ask for the server URL.
 *
 * The default is shown in the prompt and returned on an empty answer, so a
 * repeat login is one keypress. Returning the default rather than re-asking
 * matters: an empty line at the end of piped input would otherwise loop
 * forever.
 */
export async function promptForServerUrl(
  defaultUrl?: string | undefined,
  ctx?: PromptContext,
): Promise<string> {
  const suffix = defaultUrl === undefined ? '' : ` [${defaultUrl}]`;
  const answer = await prompt(`Server URL${suffix}: `, ctx);

  if (answer.length > 0) return answer;
  if (defaultUrl !== undefined) return defaultUrl;

  throw new UsageError(
    `A server URL is required. Re-run with --server <url> (for example: --server https://app.example.com).`,
  );
}

import { Command, CommanderError } from 'commander';

import { CLI_DISPLAY_NAME, CLI_NAME } from './branding.js';
import { registerApiCommand } from './commands/api.js';
import { registerConfigCommand } from './commands/config.js';
import { registerLoginCommand } from './commands/login.js';
import { EXIT, exitCodeFor, formatError } from './errors.js';
import { CLI_VERSION } from './package-info.js';

// =============================================================================
// Command wiring  (issue #140, epic #110)
// =============================================================================
//
// Commands so far: `login` (#142/#143), `config` (#143) and `api` (#144).
// Still to come: the ink TUI (#145). `--help` and `--version` remain the proof
// that the bin resolves, that the ESM build runs, and — the part that is easy
// to get wrong and expensive to discover later — that a failed invocation
// exits non-zero.
//
// SEPARATE FROM cli.ts, which is the executable. This module only ever RETURNS
// an exit code; it never calls `process.exit`, and it runs nothing on import.
// That is what lets a test call `run([...])` and assert on the number, instead
// of having to spawn a child process to find out whether the CLI would have
// failed.
//
// Two rules this file exists to enforce for every command added after it:
//
//   1. NOTHING BUT COMMAND OUTPUT GOES TO STDOUT. Errors, progress and prompts
//      go to stderr, because #144 promises that `--raw` output pipes into `jq`
//      unchanged, and one stray status line on stdout breaks that for every
//      consumer at once.
//
//   2. FAILURE IS NON-ZERO, ALWAYS. A CLI that prints an error and exits 0
//      passes CI, and the pipeline stays green while nothing works.
// =============================================================================

export function buildProgram(): Command {
  const program = new Command();

  program
    .name(CLI_NAME)
    .description(`${CLI_DISPLAY_NAME} — command-line client for the API.`)
    .version(CLI_VERSION, '-v, --version', 'Print the version and exit')
    // Commander's default is to exit the process itself. We take that over so
    // every exit in this package goes through one place with one set of codes
    // — otherwise an unknown-command error would exit with commander's 1 while
    // a failed request exits 3, and only one of the two would be documented.
    .exitOverride()
    // A bad flag should show what the right flags are. Without this, commander
    // prints a single line and leaves the user to run `--help` themselves.
    .showHelpAfterError(true)
    .showSuggestionAfterError(true)
    // Help the user ASKED for goes to stdout; a usage dump caused by a mistake
    // goes to stderr. The distinction is what keeps `--raw | jq` clean once
    // #144 lands.
    .configureOutput({
      writeErr: (str) => process.stderr.write(str),
      writeOut: (str) => process.stdout.write(str),
    });

  // Registered here rather than in each command's own module so there is one
  // list of what this CLI can do, in the order it is shown in `--help`.
  // `login` first: it is the only command that works before you have run it.
  // `api` second: it is the one people actually came for.
  registerLoginCommand(program);
  registerApiCommand(program);
  registerConfigCommand(program);

  return program;
}

/**
 * Parse `argv` (arguments only — no node binary, no script path) and return
 * the exit code the process should use.
 */
export async function run(argv: string[]): Promise<number> {
  const program = buildProgram();

  // No arguments is not yet the interactive experience — #145 adds the ink TUI
  // here, gated on stdout being a TTY. Until then, and PERMANENTLY for the
  // non-TTY case (epic #110, success criterion 7), bare invocation is a usage
  // error: it printed help, it did not do what was asked, so it must not
  // report success.
  if (argv.length === 0) {
    program.outputHelp({ error: true });
    return EXIT.USAGE;
  }

  try {
    await program.parseAsync(argv, { from: 'user' });
    return EXIT.OK;
  } catch (error) {
    if (error instanceof CommanderError) {
      // `--help` and `--version` arrive here as thrown "errors" purely because
      // of `exitOverride` above. They are successful invocations and must exit
      // 0; treating them as failures would break every script that checks the
      // version before doing anything else.
      if (
        error.code === 'commander.helpDisplayed' ||
        error.code === 'commander.help' ||
        error.code === 'commander.version'
      ) {
        return EXIT.OK;
      }
      // Anything else from commander is a malformed invocation, and commander
      // has already written its own message — printing ours too would show the
      // same problem twice.
      return EXIT.USAGE;
    }

    process.stderr.write(`${formatError(error)}\n`);
    return exitCodeFor(error);
  }
}

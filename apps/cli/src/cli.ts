#!/usr/bin/env node
import { createCli, EXIT, exitCodeFor, formatError } from '@marinoscar/platform-cli';

import { APP_CLI_OPTIONS } from './app.js';

// =============================================================================
// Executable entry point  (issue #140, epic #110; PP-8.9 #715)
// =============================================================================
//
// The ONLY module in this app with side effects at import time, and it is
// deliberately almost empty: the CLI itself is `@marinoscar/platform-cli`,
// composed with this app's identity and additions in app.ts.
//
// The shebang is what makes the built file directly executable once npm links
// it as `bin`. `postbuild` chmods it: tsc does not preserve a mode it never
// set, and a bin without the execute bit fails with EACCES on install.
// =============================================================================

/**
 * Set `process.exitCode` and RETURN, rather than calling `process.exit()`.
 *
 * This is not a style preference. `process.exit()` terminates immediately,
 * without waiting for pending writes to drain, and writes to a PIPE are
 * asynchronous in Node, unlike writes to a TTY. The version that calls
 * `process.exit()` therefore works by hand and silently TRUNCATES its output
 * the moment somebody appends `| jq`. Letting the event loop empty on its own
 * flushes everything first, and `api --raw` depends on it.
 */
async function main(): Promise<void> {
  let cli: ReturnType<typeof createCli>;
  try {
    // Throws on a broken composition (a duplicate command, screen, step or
    // executor id; an env key owned twice): a broken CLI, reported in one line.
    cli = createCli(APP_CLI_OPTIONS);
  } catch (error) {
    process.stderr.write(`${formatError(error)}\n`);
    process.exitCode = exitCodeFor(error);
    return;
  }
  process.exitCode = await cli.run(process.argv.slice(2));
}

// An unhandled rejection is a bug in this CLI, and Node's default response is
// a stack trace the user cannot act on. Convert it into the same one-line,
// name-prefixed failure every other error gets, with the generic exit code
// that says "this one was not your fault".
process.on('unhandledRejection', (reason) => {
  process.stderr.write(`${formatError(reason)}\n`);
  process.exitCode = EXIT.FAILURE;
});

void main();

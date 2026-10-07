import type { CliCommandRegistration } from '@marinoscar/platform-cli/core';

// =============================================================================
// EXAMPLE, NOT WIRED: an app command added through registerCliCommand (PP-4.6)
// =============================================================================
//
// The reference use of the CLI command registry. An app adds a command with
// ONE `registerCliCommand(...)` call; the host attaches it after every built-in
// (`appctl --help` lists built-ins first, then app commands in registration
// order) and maps a thrown error to a non-zero exit like a built-in's.
//
// WHY IT IS NOT WIRED. Calling `registerCliCommand(helloCommand)` from
// `platform-host/register.ts` would add `hello` to every fork's `appctl --help`.
// It is compiled with the CLI and exercised by `hello.command.test.ts`, which
// registers it itself. To use the pattern in a fork, replace `hello` with the
// real command and register it in `register.ts`'s `registerAll()`:
//
//   registerCliCommand(helloCommand);
// =============================================================================

/** Adds `hello [who]`: prints a greeting (default `world`) on stdout. */
export const helloCommand: CliCommandRegistration = (program) => {
  program
    .command('hello')
    .description('Say hello (the reference example of registerCliCommand)')
    .argument('[who]', 'who to greet', 'world')
    .action((who: string) => {
      process.stdout.write(`Hello, ${who}!\n`);
    });
};

// The `platform` command (bin/platform.js runs `main`): a subcommand router.
// `platform db compose` (./compose) and `platform db sync|check|promote|drift`
// (./db-commands) are here; `platform db baseline` plugs in as a further `db`
// subcommand. `main` returns the exit code and takes
// its output sinks so tests drive it without process.exit.

import { isAbsolute, join, resolve } from 'node:path';

import { Command, CommanderError } from 'commander';

import { registerDbSyncCommands, type DbCommandContext } from './db-commands.js';
import { ComposeError, checkComposedSchema, writeComposedSchema, type ComposeOptions } from '../compose/index.js';

/**
 * Where the command writes: injectable so tests capture output.
 *
 * @internal
 */
export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

const DEFAULT_IO: CliIo = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
};

/**
 * Exit codes: 0 success, 1 a failed check or a refusal (`compose --check`, `db check`, `db drift`, `db sync`),
 * 2 a rejected fragment or a usage error.
 */
type ExitCode = 0 | 1 | 2;

interface ComposeFlags {
  check?: boolean;
  root: string;
  fragments: string;
  out: string;
  platformSchema?: string;
}

function registerCompose(db: Command, io: CliIo, setExit: (code: ExitCode) => void): void {
  db.command('compose')
    .description(
      'Compose the platform fragments and the app fragments into the Prisma schema folder (committed, generated)',
    )
    .option('--check', 'write nothing; exit 1 when the generated folder differs from a fresh compose')
    .option('--root <dir>', "the app's directory (default: the current directory)", process.cwd())
    .option('--fragments <dir>', "the app's fragment folder, relative to --root", 'prisma/fragments')
    .option('--out <dir>', 'the generated schema folder, relative to --root', 'prisma/schema')
    .option('--platform-schema <dir>', "the platform fragments (default: the folder shipped in @marinoscar/platform-db)")
    .action((flags: ComposeFlags) => {
      const root = resolve(flags.root);
      const at = (p: string): string => (isAbsolute(p) ? p : join(root, p));
      const opts: ComposeOptions = {
        appFragmentsDir: at(flags.fragments),
        outDir: at(flags.out),
        ...(flags.platformSchema ? { platformSchemaDir: at(flags.platformSchema) } : {}),
      };
      try {
        if (flags.check) {
          const res = checkComposedSchema(opts);
          if (res.upToDate) {
            io.out(`${flags.out} is up to date`);
            return;
          }
          io.err(res.diff);
          io.err(`\n${flags.out} is out of date: run "platform db compose" (npm run db:compose) and commit the result.`);
          setExit(1);
          return;
        }
        const res = writeComposedSchema(opts);
        for (const w of res.warnings) io.err(`warning: ${w}`);
        io.out(`composed ${res.files.length} files into ${flags.out}`);
      } catch (e) {
        if (e instanceof ComposeError) {
          io.err(e.message);
          setExit(2);
          return;
        }
        throw e;
      }
    });
}

/**
 * Runs the command.
 *
 * @param argv - Arguments after the command name (`['db', 'compose', '--check']`).
 * @param io - Output sinks.
 * @param overrides - Working directory, environment, clock and package root, for tests.
 * @returns The process exit code.
 * @internal
 */
export async function main(
  argv: string[],
  io: CliIo = DEFAULT_IO,
  overrides: Partial<Omit<DbCommandContext, 'out' | 'err' | 'setExitCode'>> = {},
): Promise<number> {
  let exit: ExitCode = 0;
  const setExit = (code: ExitCode): void => {
    exit = code;
  };
  const program = new Command('platform')
    .description('Tools of the @marinoscar/platform-* packages')
    .exitOverride()
    .configureOutput({ writeOut: (s: string) => io.out(s.replace(/\n$/, '')), writeErr: (s: string) => io.err(s.replace(/\n$/, '')) });
  const db = program.command('db').description('Database schema, migrations and seeds').exitOverride();
  registerCompose(db, io, setExit);
  registerDbSyncCommands(db, {
    out: io.out,
    err: io.err,
    cwd: process.cwd(),
    env: process.env,
    now: () => new Date(),
    packageRoot: resolve(__dirname, '..', '..'),
    ...overrides,
    setExitCode: (code) => setExit(code as ExitCode),
  });
  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (e) {
    if (e instanceof CommanderError) return e.exitCode === 0 ? 0 : 2;
    throw e;
  }
  return exit;
}

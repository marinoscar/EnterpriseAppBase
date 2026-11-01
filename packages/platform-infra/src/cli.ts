// The `platform-infra` command (bin/platform-infra.mjs): argument parsing and
// output around ./sync.ts. Kept free of process.exit so tests drive it.

import { PLATFORM_PACKAGE } from './package-name.js';
import { DEFAULT_IDENTITY_FILE } from './app-identity.js';
import { checkInfra, LOCK_PATH, syncInfra, type SyncOptions } from './sync.js';

/**
 * Usage text of the `platform-infra` command.
 *
 * @internal
 */
export const USAGE = `Usage: platform-infra sync [--check] [--root <dir>] [--identity <file>]

  sync              Materialise the infra fragments of ${PLATFORM_PACKAGE} into
                    the app's infra/ folder (compose, nginx, env templates,
                    telemetry), rendered with the app identity and with a
                    generated-file header, and write ${LOCK_PATH}.
                    App-owned files (overlays, infra/nginx/app.d/,
                    infra/compose/app.env.example, infra/otel/app-collector.yaml)
                    are created from their example only when absent.
  --check           Write nothing; exit 1 when a generated file differs from the
                    package (rendered) or from the lock (for CI).
  --root <dir>      The app's repository root (default: the current directory).
  --identity <file> The app identity, relative to the root (default:
                    ${DEFAULT_IDENTITY_FILE}, with the CLI name from
                    apps/cli/package.json's bin when the file has no cliName).
`;

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
 * Runs the command and returns its exit code: 0 success, 1 check failure or
 * error, 2 usage error.
 *
 * @param argv - Arguments after the command name.
 * @param io - Output sinks.
 * @param overrides - Package-side overrides for tests (package root, version, fragments).
 * @returns The process exit code.
 * @internal
 */
export function main(argv: readonly string[], io: CliIo = DEFAULT_IO, overrides: Omit<SyncOptions, 'root'> = {}): number {
  const args = [...argv];
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    (args.length === 0 ? io.err : io.out)(USAGE);
    return args.length === 0 ? 2 : 0;
  }
  const command = args.shift();
  if (command !== 'sync') {
    io.err(`platform-infra: unknown command "${command ?? ''}"\n\n${USAGE}`);
    return 2;
  }

  let check = false;
  let root = process.cwd();
  let identityFile: string | undefined;
  while (args.length > 0) {
    const arg = args.shift();
    if (arg === '--check') {
      check = true;
    } else if (arg === '--root') {
      const value = args.shift();
      if (value === undefined || value.startsWith('--')) {
        io.err(`platform-infra: --root needs a directory\n\n${USAGE}`);
        return 2;
      }
      root = value;
    } else if (arg === '--identity') {
      const value = args.shift();
      if (value === undefined || value.startsWith('--')) {
        io.err(`platform-infra: --identity needs a file\n\n${USAGE}`);
        return 2;
      }
      identityFile = value;
    } else {
      io.err(`platform-infra: unknown option "${arg ?? ''}"\n\n${USAGE}`);
      return 2;
    }
  }

  try {
    if (check) {
      const result = checkInfra({ ...overrides, root, ...(identityFile === undefined ? {} : { identityFile }) });
      for (const w of result.warnings) io.err(`warning: ${w.file}: ${w.message}`);
      for (const p of result.problems) io.err(`error: ${p.file}: ${p.message}`);
      if (result.problems.length > 0) {
        io.err(`platform-infra sync --check: ${result.problems.length} problem(s). Generated files are never edited by hand.`);
        return 1;
      }
      io.out(`platform-infra sync --check: ${result.checked.length} generated file(s) match ${PLATFORM_PACKAGE}@${result.version} and ${LOCK_PATH}.`);
      return 0;
    }

    const result = syncInfra({ ...overrides, root, ...(identityFile === undefined ? {} : { identityFile }) });
    for (const file of result.written) io.out(`wrote    ${file}`);
    for (const file of result.created) io.out(`created  ${file} (app-owned: edit it freely)`);
    for (const file of result.kept) io.out(`kept     ${file} (app-owned)`);
    if (result.lockWritten) io.out(`wrote    ${LOCK_PATH}`);
    io.out(
      `platform-infra sync: ${result.written.length} written, ${result.unchanged.length} unchanged, ${result.created.length} created.`,
    );
    return 0;
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

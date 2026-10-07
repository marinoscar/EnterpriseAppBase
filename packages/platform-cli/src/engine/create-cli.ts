import type { Command } from 'commander';

import { registerCliCommand, registerEnvSpecFragment, type CliCommandRegistration, type EnvSpecFragment } from '../core/index.js';

import { ensurePlatformRegistrations } from './builtin-registrations.js';
import { registerDeployStep, type DeployStepRegistration } from './deploy/steps/registry.js';
import { setCliIdentity, type CliIdentity } from './identity.js';
import type { JobExecutor } from './node/executors/index.js';
import { registerNodeExecutor } from './node/executors/registry.js';
import { buildProgram, run, type RunOptions } from './program.js';
import { freezeCliRegistries } from './registries.js';
import { registerTuiScreen, type TuiScreenRegistration } from './tui/screen-registry.js';

// =============================================================================
// createCli: the one call an app makes  (PP-8.9, #715)
// =============================================================================
//
// An app's `src/cli.ts` used to be the whole CLI. Now it is one call:
//
//   const cli = createCli({ identity, version, extraCommands });
//   process.exitCode = await cli.run(process.argv.slice(2));
//
// `createCli` sets the identity once, registers the platform's built-ins
// first and the app's additions after them (the options arrays and the
// `register*` functions feed the same registries, so either style gives the
// same CLI), and builds the program eagerly so a broken composition (a
// duplicate command name, a key owned twice) throws HERE, at startup, rather
// than on some later invocation.
// =============================================================================

/**
 * Options of {@link createCli}.
 *
 * @stability experimental
 */
export interface CreateCliOptions {
  /** The product identity: executable name, display name, repository. */
  identity: CliIdentity;
  /** The APP's version (its own package.json); `--version` prints the platform's beside it. */
  version: string;
  /** App commands, added after the built-ins in this order. Same as `registerCliCommand`. */
  extraCommands?: readonly CliCommandRegistration[] | undefined;
  /** Screens added to the TUI menu. Same as `registerTuiScreen`. */
  tuiScreens?: readonly TuiScreenRegistration[] | undefined;
  /** Steps inserted into `deploy install` / `deploy update`. Same as `registerDeployStep`. */
  deploySteps?: readonly DeployStepRegistration[] | undefined;
  /** Executors for the app's node-eligible job types. Same as `registerNodeExecutor`. */
  nodeExecutors?: readonly JobExecutor[] | undefined;
  /** Env-key metadata for the app's own `.env.example` keys. Same as `registerEnvSpecFragment`. */
  envSpecFragments?: readonly EnvSpecFragment[] | undefined;
}

/**
 * What {@link createCli} returns.
 *
 * @stability experimental
 */
export interface CliInstance {
  /** The program as built at startup: built-ins, then app commands. For help and introspection. */
  readonly program: Command;
  /**
   * Parses `argv` (arguments only) and returns the exit code. Sets nothing on
   * `process`: the caller assigns `process.exitCode` and returns, never
   * `process.exit()`, so piped output is flushed.
   */
  run(argv: string[], runOptions?: RunOptions): Promise<number>;
}

/**
 * Builds the CLI from the app's identity and additions plus the registries.
 *
 * @param options - The identity, the app version and the app's additions.
 * @returns The program and its `run`.
 * @throws Error when the identity is invalid or a different one is already
 *   set, when an app command's name, TUI route, deploy step id or executor
 *   type is taken (or a step's `after` names no step), when an env key gets
 *   two owners, or when it registers anything after an earlier `createCli`
 *   froze the registries.
 * @stability experimental
 */
export function createCli(options: CreateCliOptions): CliInstance {
  setCliIdentity(options.identity, options.version);
  ensurePlatformRegistrations();
  for (const fragment of options.envSpecFragments ?? []) registerEnvSpecFragment(fragment);
  for (const command of options.extraCommands ?? []) registerCliCommand(command);
  for (const screen of options.tuiScreens ?? []) registerTuiScreen(screen);
  for (const step of options.deploySteps ?? []) registerDeployStep(step);
  for (const executor of options.nodeExecutors ?? []) registerNodeExecutor(executor);

  const program = buildProgram();
  freezeCliRegistries('createCli built the CLI');
  return {
    program,
    run: (argv, runOptions) => run(argv, runOptions),
  };
}

// `@marinoscar/platform-cli/commands`: the built-in command registrars and
// the error model an app command shares with them (#715). `createCli`
// registers the built-ins itself; an app adds its own with
// `registerCliCommand` (`/core`) or `createCli({ extraCommands })`.
import type { Command } from 'commander';

import {
  registerApiCommand as registerApi,
  registerConfigCommand as registerConfig,
  registerDeployCommand as registerDeploy,
  registerInitCommand as registerInit,
  registerLoginCommand as registerLogin,
  registerNodeCommand as registerNode,
} from '../engine/index.js';

export {
  BUILTIN_COMMAND_NAMES,
  CliError,
  ConfigError,
  EXIT,
  PreconditionError,
  UsageError,
  exitCodeFor,
  formatError,
} from '../engine/index.js';
export type { ExitCode } from '../engine/index.js';

/**
 * Adds `init`: creates `infra/compose/.env` so a fresh checkout can start.
 *
 * @param program - The host program.
 * @returns The `init` command.
 * @stability stable
 */
export function registerInitCommand(program: Command): Command {
  return registerInit(program);
}

/**
 * Adds `login`: authorizes this machine (device flow, or `--token`) and stores the token.
 *
 * @param program - The host program.
 * @returns The `login` command.
 * @stability stable
 */
export function registerLoginCommand(program: Command): Command {
  return registerLogin(program);
}

/**
 * Adds `api <method> <path>`: calls any API endpoint and prints the response.
 *
 * @param program - The host program.
 * @returns The `api` command.
 * @stability stable
 */
export function registerApiCommand(program: Command): Command {
  return registerApi(program);
}

/**
 * Adds `config`: shows the stored server URL and a masked token hint.
 *
 * @param program - The host program.
 * @returns The `config` command.
 * @stability stable
 */
export function registerConfigCommand(program: Command): Command {
  return registerConfig(program);
}

/**
 * Adds `node`: runs this machine as a worker node for the job queue.
 *
 * @param program - The host program.
 * @returns The `node` command group.
 * @stability stable
 */
export function registerNodeCommand(program: Command): Command {
  return registerNode(program);
}

/**
 * Adds `deploy`: checks, installs and updates the application on a server.
 *
 * @param program - The host program.
 * @returns The `deploy` command group.
 * @stability stable
 */
export function registerDeployCommand(program: Command): Command {
  return registerDeploy(program);
}

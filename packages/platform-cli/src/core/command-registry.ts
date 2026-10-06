import type { Command } from 'commander';

// =============================================================================
// CLI command registry  (PP-4.5, #706)
// =============================================================================
//
// The host CLI registers its built-in commands itself, in the order its
// `--help` documents. An app adds its own with `registerCliCommand`, and the
// host calls `applyRegisteredCommands(program)` once, AFTER the built-ins, so
// the help order is: built-ins first, then app commands in registration order.
//
// The commands are attached to the host's own `program`, so they inherit its
// `exitOverride`, output routing and error-to-exit-code mapping: an app
// command that throws exits non-zero exactly like a built-in one.
//
// A name collision throws, with a message that names the app registration as
// the cause. Commander 14 refuses a duplicate name or alias on its own, but
// its message reads like a host bug, and it does not reserve `help`; older
// commander releases added a second `deploy` silently.
// =============================================================================

/**
 * Adds one or more commands to the host program. Receives the program itself,
 * so it calls `program.command(...)` exactly as a built-in command would.
 *
 * @stability experimental
 */
export type CliCommandRegistration = (program: Command) => void;

/** Commander's implicit help command; an app must never shadow it. */
const RESERVED_NAMES: readonly string[] = ['help'];

const registrations: CliCommandRegistration[] = [];

/**
 * Registers a function that adds commands to the host CLI.
 *
 * Nothing runs until the host calls {@link applyRegisteredCommands}; functions
 * run in registration order.
 *
 * @param register - Called with the host's `program` once it has its built-ins.
 * @stability experimental
 * @extensionPoint registry
 * @example
 * ```ts
 * registerCliCommand((program) => program.command('coach-seed').action(seedCoachData));
 * ```
 */
export function registerCliCommand(register: CliCommandRegistration): void {
  if (typeof register !== 'function') {
    throw new TypeError('registerCliCommand expects a function (program) => void.');
  }
  registrations.push(register);
}

function namesOf(command: Command): string[] {
  return [command.name(), ...command.aliases()];
}

/**
 * Runs every registered function against `program`, after its built-in
 * commands, and returns the program.
 *
 * Throws when an app command's name or alias is already taken by a built-in,
 * by an earlier app command or by commander's own `help`.
 *
 * @param program - The host program, with its built-in commands registered.
 * @returns The same program.
 * @stability experimental
 */
export function applyRegisteredCommands(program: Command): Command {
  const taken = new Map<string, string>();
  for (const name of RESERVED_NAMES) taken.set(name, 'reserved by commander');
  for (const command of program.commands) {
    for (const name of namesOf(command)) taken.set(name, 'a built-in command');
  }

  for (const register of registrations) {
    const before = new Set(program.commands);
    try {
      register(program);
    } catch (error) {
      // Commander 14 refuses a duplicate name or alias itself, with a message
      // that does not say an app registration caused it. Re-word that one
      // case; anything else the registration threw is passed through as is.
      const message = error instanceof Error ? error.message : '';
      const duplicate = /cannot add (?:command|alias) '([^']+)'/.exec(message);
      if (duplicate?.[1] !== undefined) {
        throw collision(duplicate[1], taken.get(duplicate[1]) ?? 'taken', error);
      }
      throw error;
    }
    for (const command of program.commands) {
      if (before.has(command)) continue;
      for (const name of namesOf(command)) {
        const holder = taken.get(name);
        if (holder !== undefined) throw collision(name, holder);
        taken.set(name, 'an app command registered earlier');
      }
    }
  }
  return program;
}

function collision(name: string, holder: string, cause?: unknown): Error {
  return new Error(
    `An app command cannot be named "${name}": that name is already ${holder}. ` +
      'Choose another name for the command registered with registerCliCommand.',
    cause === undefined ? undefined : { cause },
  );
}

/**
 * Every registered function, in registration order.
 *
 * @returns A frozen copy of the list.
 * @stability experimental
 */
export function listRegisteredCommands(): readonly CliCommandRegistration[] {
  return Object.freeze([...registrations]);
}

/**
 * Empties the registry. For tests only: production code never unregisters.
 *
 * @internal
 * @stability experimental
 */
export function resetCommandRegistryForTests(): void {
  registrations.length = 0;
}

import { Command, CommanderError } from 'commander';
import { afterEach, describe, expect, it } from 'vitest';

import {
  applyRegisteredCommands,
  listRegisteredCommands,
  registerCliCommand,
  resetCommandRegistryForTests,
} from './command-registry.js';

/** A host program with two built-ins, configured not to exit the test runner. */
function hostProgram(): Command {
  const program = new Command().name('host').exitOverride().configureOutput({
    writeOut: () => undefined,
    writeErr: () => undefined,
  });
  program.command('login').description('built-in one');
  program.command('deploy').alias('d').description('built-in two');
  return program;
}

describe('CLI command registry', () => {
  afterEach(() => resetCommandRegistryForTests());

  it('adds app commands after the built-ins, in registration order', () => {
    registerCliCommand((program) => program.command('zeta'));
    registerCliCommand((program) => {
      program.command('alpha');
    });

    const program = applyRegisteredCommands(hostProgram());

    expect(program.commands.map((command) => command.name())).toEqual(['login', 'deploy', 'zeta', 'alpha']);
    expect(listRegisteredCommands()).toHaveLength(2);
  });

  it('runs nothing until applied', () => {
    let calls = 0;
    registerCliCommand(() => {
      calls += 1;
    });
    expect(calls).toBe(0);
    applyRegisteredCommands(hostProgram());
    expect(calls).toBe(1);
  });

  it('runs an app command through the host program', async () => {
    const seen: string[] = [];
    registerCliCommand((program) =>
      program
        .command('hello')
        .argument('<who>')
        .action((who: string) => {
          seen.push(who);
        }),
    );

    await applyRegisteredCommands(hostProgram()).parseAsync(['hello', 'world'], { from: 'user' });
    expect(seen).toEqual(['world']);
  });

  it('lets an app command failure reach the host, so the host maps it to a non-zero exit', async () => {
    registerCliCommand((program) =>
      program.command('boom').action(() => {
        throw new Error('app command failed');
      }),
    );

    await expect(applyRegisteredCommands(hostProgram()).parseAsync(['boom'], { from: 'user' })).rejects.toThrow(
      'app command failed',
    );
  });

  it.each([
    ['deploy', 'a built-in command'],
    ['d', 'a built-in command'],
    ['help', 'reserved by commander'],
  ])('refuses an app command named %s', (name, holder) => {
    registerCliCommand((program) => program.command(name));
    expect(() => applyRegisteredCommands(hostProgram())).toThrow(`cannot be named "${name}": that name is already ${holder}`);
  });

  it('refuses an alias that collides, and two app commands with one name', () => {
    registerCliCommand((program) => program.command('seed').alias('login'));
    expect(() => applyRegisteredCommands(hostProgram())).toThrow(/"login"/);

    resetCommandRegistryForTests();
    registerCliCommand((program) => program.command('seed'));
    registerCliCommand((program) => program.command('seed'));
    expect(() => applyRegisteredCommands(hostProgram())).toThrow(/already an app command registered earlier/);
  });

  it('refuses something that is not a function', () => {
    expect(() => registerCliCommand('hello' as unknown as () => void)).toThrow(TypeError);
  });

  it('keeps commander errors for unknown commands intact', async () => {
    const program = applyRegisteredCommands(hostProgram());
    await expect(program.parseAsync(['nope'], { from: 'user' })).rejects.toBeInstanceOf(CommanderError);
  });
});

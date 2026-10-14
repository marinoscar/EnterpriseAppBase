import type { ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerCliCommand, registerEnvSpecFragment, resolveEnvMetadata } from '../core/index.js';

import { configDirPath } from './config.js';
import { createCli, type CreateCliOptions } from './create-cli.js';
import { DEPLOY_STATE_FILENAME } from './deploy/state.js';
import { PROXY_MANAGED_SENTINEL } from './deploy/proxy.js';
import { planDeploySteps } from './deploy/steps/plan.js';
import { registerDeployStep, type DeployStepRegistration } from './deploy/steps/registry.js';
import { EXIT } from './errors.js';
import { cliIdentity, envVar } from './identity.js';
import type { JobExecutor } from './node/executors/index.js';
import { defaultExecutorRegistry, registerNodeExecutor } from './node/executors/registry.js';
import { renderUnit, serviceUnitName, userUnitPath } from './node/service.js';
import { PLATFORM_CLI_VERSION } from './package-info.js';
import { allTuiScreens } from './tui/builtin-screens.js';
import { registerTuiScreen, type TuiScreenProps, type TuiScreenRegistration } from './tui/screen-registry.js';
import { resetCliForTests, TEST_CLI_IDENTITY } from './test-support.js';

// =============================================================================
// createCli  (PP-8.9, #715)
// =============================================================================
//
// The one call an app makes. These tests pin the four promises the story
// makes about it: the options arrays and the register* functions build the
// SAME CLI; the registries freeze when it returns; a duplicate id throws AT
// createCli; and the identity reaches help, the config directory, the env
// prefix and the systemd unit while the two live-server literals stay put.
// =============================================================================

const ACME = { name: 'acmectl', displayName: 'Acme CLI', productName: 'Acme', repoSlug: 'acme/acme' };
const BASE: CreateCliOptions = { identity: TEST_CLI_IDENTITY, version: '2.3.4' };

const Screen: ComponentType<TuiScreenProps> = () => null;
const SCREEN: TuiScreenRegistration = { route: 'about', label: 'About', order: 70, component: Screen };
const STEP: DeployStepRegistration = {
  pipeline: 'install',
  id: 'announce',
  after: 'verify',
  step: { title: 'Announce', run: async () => undefined },
};
const EXECUTOR: JobExecutor = { type: 'app.echo', requiresInput: false, execute: async () => ({ ok: true }) };
const hello = (program: import('commander').Command): void => {
  program.command('hello').description('Say hello').action(() => undefined);
};

let stdout: ReturnType<typeof vi.spyOn>;
let stderr: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  resetCliForTests();
  stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});
afterEach(() => {
  stdout.mockRestore();
  stderr.mockRestore();
  resetCliForTests();
});

const written = (spy: ReturnType<typeof vi.spyOn>): string => spy.mock.calls.map((call: unknown[]) => String(call[0])).join('');

/** What a CLI built from the registries looks like, for equivalence. */
function shape(cli: ReturnType<typeof createCli>): unknown {
  return {
    commands: cli.program.commands.map((command) => command.name()),
    screens: allTuiScreens().map((screen) => screen.route),
    install: planDeploySteps('install').map((step) => step.id),
    executors: defaultExecutorRegistry().types(),
    fragment: resolveEnvMetadata('APP_KEY'),
  };
}

describe('createCli', () => {
  it('builds the built-ins in --help order and runs --version with both versions', async () => {
    const cli = createCli(BASE);
    expect(cli.program.commands.map((command) => command.name())).toEqual(['init', 'login', 'api', 'config', 'node', 'deploy']);

    expect(await cli.run(['--version'])).toBe(EXIT.OK);
    expect(written(stdout)).toBe(`2.3.4 (platform ${PLATFORM_CLI_VERSION})\n`);
  });

  it('keeps run semantics: no args is a usage error off a TTY, help exits 0', async () => {
    const cli = createCli(BASE);
    expect(await cli.run([], { tty: { stdin: { isTTY: false }, stdout: { isTTY: false }, env: {} } })).toBe(EXIT.USAGE);
    expect(await cli.run(['--help'])).toBe(EXIT.OK);
    expect(await cli.run(['--no-such-flag'])).toBe(EXIT.USAGE);
  });

  it('options arrays and register* functions build the same CLI', () => {
    const fragment = { id: 'app', metadata: { APP_KEY: { secret: true } } };

    const fromOptions = shape(
      createCli({
        ...BASE,
        extraCommands: [hello],
        tuiScreens: [SCREEN],
        deploySteps: [STEP],
        nodeExecutors: [EXECUTOR],
        envSpecFragments: [fragment],
      }),
    );

    resetCliForTests();
    registerCliCommand(hello);
    registerTuiScreen(SCREEN);
    registerDeployStep(STEP);
    registerNodeExecutor(EXECUTOR);
    registerEnvSpecFragment(fragment);
    expect(shape(createCli(BASE))).toEqual(fromOptions);
  });

  it('puts every addition where the story says it appears', () => {
    const cli = createCli({ ...BASE, extraCommands: [hello], tuiScreens: [SCREEN], deploySteps: [STEP], nodeExecutors: [EXECUTOR] });
    expect(cli.program.commands.at(-1)?.name()).toBe('hello');
    expect(allTuiScreens().map((screen) => screen.route)).toEqual(['login', 'invoke', 'status', 'node', 'deploy', 'logout', 'about']);
    const install = planDeploySteps('install').map((step) => step.id);
    expect(install.slice(install.indexOf('verify'), install.indexOf('verify') + 2)).toEqual(['verify', 'announce']);
    expect(defaultExecutorRegistry().types()).toEqual(['app.echo', 'db.backup.run', 'example.checksum']);
  });

  it('freezes every registry when it returns', () => {
    createCli(BASE);
    expect(() => registerCliCommand(hello)).toThrow(/after createCli built the CLI/);
    expect(() => registerTuiScreen(SCREEN)).toThrow(/after createCli built the CLI/);
    expect(() => registerDeployStep(STEP)).toThrow(/after createCli built the CLI/);
    expect(() => registerNodeExecutor(EXECUTOR)).toThrow(/after createCli built the CLI/);
    expect(() => registerEnvSpecFragment({ id: 'late', metadata: {} })).toThrow(/after createCli built the CLI/);
  });

  describe('a duplicate id throws at createCli', () => {
    it('a command named like a built-in', () => {
      expect(() => createCli({ ...BASE, extraCommands: [(p) => void p.command('deploy')] })).toThrow(/"deploy"/);
    });
    it('a TUI route', () => {
      expect(() => createCli({ ...BASE, tuiScreens: [SCREEN, SCREEN] })).toThrow(/already registered/);
      resetCliForTests();
      expect(() => createCli({ ...BASE, tuiScreens: [{ ...SCREEN, route: 'deploy' }] })).toThrow(/built-in screen/);
    });
    it('a deploy step id, and a step after an unknown step', () => {
      expect(() => createCli({ ...BASE, deploySteps: [STEP, STEP] })).toThrow(/already a step/);
      resetCliForTests();
      expect(() => createCli({ ...BASE, deploySteps: [{ ...STEP, after: 'nope' }] })).toThrow(/not a step of the install pipeline/);
    });
    it('an executor type', () => {
      expect(() => createCli({ ...BASE, nodeExecutors: [EXECUTOR, EXECUTOR] })).toThrow(/already registered/);
      resetCliForTests();
      expect(() => createCli({ ...BASE, nodeExecutors: [{ ...EXECUTOR, type: 'db.backup.run' }] })).toThrow(/built-in executor/);
    });
    it('an env key owned twice', () => {
      expect(() => createCli({ ...BASE, envSpecFragments: [{ id: 'app', metadata: { JWT_SECRET: {} } }] })).toThrow(
        /defined by env-spec fragment "platform"/,
      );
    });
  });

  it('refuses a second, different identity in one process', () => {
    createCli(BASE);
    expect(() => createCli({ ...BASE, identity: ACME })).toThrow(/already set/);
  });
});

describe('createCli with identity { name: "acmectl" }', () => {
  it('follows the identity in help, the config directory, the env prefix and the systemd unit', async () => {
    const cli = createCli({ identity: ACME, version: '0.1.0' });

    expect(cli.program.name()).toBe('acmectl');
    expect(cli.program.helpInformation()).toMatch(/^Usage: acmectl /);
    expect(cli.program.helpInformation()).toContain('Acme CLI');
    expect(await cli.run(['config', '--help'])).toBe(EXIT.OK);
    expect(written(stdout)).toContain('Usage: acmectl config');

    expect(configDirPath({ home: '/home/u' })).toBe('/home/u/.acmectl');
    expect(cliIdentity().envPrefix).toBe('ACMECTL_');
    expect(envVar('TOKEN')).toBe('ACMECTL_TOKEN');
    expect(serviceUnitName()).toBe('acmectl-node.service');
    expect(userUnitPath({ home: '/home/u' })).toBe('/home/u/.config/systemd/user/acmectl-node.service');
    expect(renderUnit({ execPath: '/usr/bin/node', scriptPath: '/opt/acmectl/cli.js' })).toContain('Description=Acme worker node (acmectl)');
  });

  it('leaves the deploy state file and the proxy sentinel at their live-server values', () => {
    createCli({ identity: ACME, version: '0.1.0' });
    expect(DEPLOY_STATE_FILENAME).toBe('.appctl-deploy.json');
    expect(PROXY_MANAGED_SENTINEL).toBe('# Managed by appctl deploy');
  });
});

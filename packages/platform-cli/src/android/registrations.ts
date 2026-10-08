// =============================================================================
// The android slice's registrations (#746, PP-9.4)
// =============================================================================
//
// What an app passes to `createCli` (or to the three registries): the merged
// `android` command group, an optional deploy step and a TUI screen. Nothing
// registers itself on import.
// =============================================================================

import type { CliCommandRegistration } from '../core/index.js';
import type { DeployPipeline, DeployStepRegistration, TuiScreenRegistration } from '../engine/index.js';
import { envVar, readState } from '../engine/index.js';
import { registerAndroidCommand, type AndroidCommandContext } from './command.js';
import {
  androidReportLines,
  defaultAndroidStepDeps,
  runDeployAndroidStep,
  type AndroidStepDeps,
  type DeployAndroidOptions,
} from './deploy-step.js';
import { configureAndroidIdentity, type AndroidIdentitySource } from './identity.js';

/**
 * Options of {@link androidCommand}.
 *
 * @stability experimental
 */
export interface AndroidCommandOptions {
  /** The app's product identity (`ANDROID_IDENTITY_SOURCE` of `@app/shared`), used outside a checkout. */
  identity?: AndroidIdentitySource | undefined;
}

/**
 * The merged `android` command group (EvoPath's and MemoriaHub's):
 * `doctor [--fix [--dry-run]]`, `keystore init|import|show|secrets`,
 * `version [--bump|--set|--code]`, `build`, `publish`, `release`,
 * `releases [current <id>]` (make a release current, a rollback included). Pass it to `createCli({ extraCommands })` or
 * `registerCliCommand`.
 *
 * @param options - see {@link AndroidCommandOptions}.
 * @returns the registration.
 *
 * @example
 * ```ts
 * createCli({ identity, version, extraCommands: [androidCommand({ identity: ANDROID_IDENTITY_SOURCE })] });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function androidCommand(options: AndroidCommandOptions = {}): CliCommandRegistration {
  return createAndroidCommand(options);
}

/**
 * {@link androidCommand} with the command's test seams (streams, env, home,
 * cwd, fetch, exec). Internal: not exported from the slice entry.
 *
 * @param options - the public options.
 * @param context - the seams.
 * @returns the registration.
 */
export function createAndroidCommand(options: AndroidCommandOptions, context?: AndroidCommandContext): CliCommandRegistration {
  return (program) => {
    configureAndroidIdentity(options.identity);
    registerAndroidCommand(program, context);
  };
}

/**
 * Options of {@link androidDeployStep}.
 *
 * @stability experimental
 */
export interface AndroidDeployStepOptions {
  /** Which pipeline (default `update`). Register twice for both. */
  pipeline?: DeployPipeline | undefined;
  /** The bump and notes for the published release. */
  release?: DeployAndroidOptions | undefined;
}

/**
 * The env var that opts a deploy into the Android step: `<PREFIX>DEPLOY_ANDROID=1`.
 *
 * @returns the variable name.
 *
 * @stability experimental
 */
export function deployAndroidEnvVar(): string {
  return envVar('DEPLOY_ANDROID');
}

/**
 * An optional deploy step (EvoPath's `--with-android`): after `verify`, when
 * `<PREFIX>DEPLOY_ANDROID=1`, compare the local APK version with the
 * deployment's current release and, when newer, run the Android doctor,
 * build and publish it as current. It NEVER fails the deploy and never
 * prompts: every outcome is a logged line with the command that fixes it.
 *
 * @param options - see {@link AndroidDeployStepOptions}.
 * @returns the registration for `createCli({ deploySteps })` or `registerDeployStep`.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function androidDeployStep(options: AndroidDeployStepOptions = {}): DeployStepRegistration {
  return createAndroidDeployStep(options, defaultAndroidStepDeps());
}

/**
 * {@link androidDeployStep} over explicit collaborators (tests). Internal.
 *
 * @param options - the public options.
 * @param deps - the step's collaborators.
 * @returns the registration.
 */
export function createAndroidDeployStep(options: AndroidDeployStepOptions, deps: AndroidStepDeps): DeployStepRegistration {
  const pipeline = options.pipeline ?? 'update';
  return {
    pipeline,
    id: 'android-release',
    after: 'verify',
    step: {
      title: 'Publish the Android APK',
      skip: () => (process.env[deployAndroidEnvVar()] === '1' ? undefined : `set ${deployAndroidEnvVar()}=1 to publish the Android APK`),
      async run(context) {
        const state = readState(context.deployRoot);
        const outcome = await runDeployAndroidStep(
          { domain: state?.domain, deployRoot: context.deployRoot, options: options.release ?? {} },
          deps,
          (line) => context.log(line),
        );
        for (const line of androidReportLines(outcome)) context.log(line);
      },
    },
  };
}

/**
 * The TUI's Android screen: the status panel (local version, keystore,
 * login, the server's current release) over doctor, bump, build, publish,
 * release and the releases list. Loaded lazily.
 *
 * @stability experimental
 */
export const androidTuiScreen: TuiScreenRegistration = {
  route: 'android',
  label: 'Android app',
  order: 65,
  load: async () => (await import('./screen.js')).AndroidScreen,
};

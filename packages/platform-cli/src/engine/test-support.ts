import { resetPlatformRegistrationsForTests } from './builtin-registrations.js';
import { replaceCliIdentityForTests, type CliIdentity } from './identity.js';

// =============================================================================
// Test helpers published through `@marinoscar/platform-cli/testing`  (#715)
// =============================================================================
//
// The CLI's identity is set once per process and its registries freeze when
// `createCli` returns, which is right for a real process and wrong for a test
// file that builds several CLIs. These helpers are the one sanctioned way
// around both, and they live behind `/testing` so production code cannot
// reach them through the root entry point.
// =============================================================================

/**
 * An identity for tests: the reference app's executable name `appctl`, with a neutral product name.
 *
 * @stability experimental
 */
export const TEST_CLI_IDENTITY: Readonly<CliIdentity> = Object.freeze({
  name: 'appctl',
  displayName: 'Example App CLI',
  productName: 'Example App',
  repoSlug: 'example/example-app',
});

/**
 * Replaces the process's CLI identity for a test, bypassing set-once.
 *
 * @param identity - The identity to use, or `undefined` for "none set".
 * @param version - The app version `cliVersion()` reports. Defaults to the
 *   current one, else `0.0.0-test`.
 * @returns A function that restores the previous identity.
 * @stability experimental
 * @example
 * ```ts
 * const restore = useTestCliIdentity({ name: 'acmectl', displayName: 'Acme CLI', repoSlug: 'acme/acme' });
 * afterEach(restore);
 * ```
 */
export function useTestCliIdentity(identity: CliIdentity | undefined, version?: string): () => void {
  return replaceCliIdentityForTests(identity, version);
}

/**
 * Forgets everything `createCli` set up: the identity and every registry
 * (commands, env-spec fragments, TUI screens, deploy steps, node executors),
 * so the next `createCli` starts from a fresh process's state.
 *
 * @stability experimental
 */
export function resetCliForTests(): void {
  resetPlatformRegistrationsForTests();
  replaceCliIdentityForTests(undefined);
}

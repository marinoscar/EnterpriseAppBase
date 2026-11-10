import type { CliConformanceSuite } from '@marinoscar/platform-cli/testing';

// =============================================================================
// EXAMPLE, NOT WIRED: an app's own CLI conformance suite (PP-14.22)
// =============================================================================
//
// The CLI's conformance runner is a registry (`cliConformanceSuites`), like the
// API's. A suite is registered once by id (`registerCliConformanceSuite`) and
// receives the options the app passes under its camelCase key. Every suite an
// app names must either get its options or `{ skip: 'reason' }`: an empty
// reason, or `false`, throws, and the reason is printed in the run summary.
//
// To type the options, augment the interface in the app's test file:
//
//   declare module '@marinoscar/platform-cli/testing' {
//     interface CliPlatformConformanceSuites { coachCommands?: CoachCommandsOptions | CliConformanceSkip }
//   }
// =============================================================================

/** What the suite is configured with. */
export interface CoachCommandsOptions {
  /** Command names that must exist. */
  required: readonly string[];
  /** The commands the program has. */
  commands: readonly string[];
}

/** Every command the app promises exists. */
export const coachCommandsSuite: CliConformanceSuite<CoachCommandsOptions> = {
  id: 'coach-commands',
  title: 'coach commands conformance',
  description: 'The coach commands the app documents are registered.',
  register(api, options) {
    api.describe('coach commands conformance', () => {
      for (const name of options.required) {
        api.it(`command ${name} is registered`, () => {
          api.expect(options.commands.includes(name)).toEqual(true);
        });
      }
    });
  },
};

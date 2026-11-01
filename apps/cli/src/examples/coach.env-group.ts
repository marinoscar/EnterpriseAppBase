import type { EnvGroupRegistration, EnvSpecFragment } from '@marinoscar/platform-cli/core';

// =============================================================================
// EXAMPLE, NOT WIRED: an app's opt-in env group (PP-14.22)
// =============================================================================
//
// `ENV_GROUPS` used to be a closed list of three, so an app could not make its
// own keys opt-in. A group is registered (`registerEnvGroup`, or
// `createCli({ envGroups })`), and an env-spec fragment puts keys in it by id.
// The deploy wizard then asks for these keys only when the operator enabled
// the group (`deploy install --group coach`, or the TUI's group question).
//
// The keys must exist in the app's `.env.example` (infra/compose/app.env.example)
// for the wizard to ask them; this example is not wired, so the shipped file
// does not carry them. To use the pattern in a fork:
//
//   envGroups: [coachEnvGroup],
//   envSpecFragments: [coachEnvSpecFragment],
// =============================================================================

/** The `coach` group: the coaching assistant's connection. Opt-in. */
export const coachEnvGroup: EnvGroupRegistration = {
  id: 'coach',
  label: 'Coach',
  description: 'The coaching assistant: its API address and token.',
  defaultEnabled: false,
};

/** The keys of the group. The token is a secret the wizard generates itself (see coach.env-generator.ts). */
export const coachEnvSpecFragment: EnvSpecFragment = {
  id: 'coach',
  metadata: {
    COACH_API_URL: { group: 'coach', essential: true },
    COACH_API_TOKEN: { group: 'coach', secret: true, generate: 'token-24', autoGenerate: true },
  },
};

/**
 * The flags the deploy screens expose, as DATA.
 *
 * =============================================================================
 * ⚠ WHY THIS IS A LIST AND NOT A FORM
 * =============================================================================
 *
 * The rule from the specification is blunt: THE TUI MUST PASS THE SAME FLAGS
 * THE CLI DOES. The screen this replaces passed none of them -- no `--resume`,
 * `--ref`, `--group`, `--all`, `--staging` or any `--skip-*` -- while hardcoding
 * the root, the proxy root and the port. The worst consequence was not the
 * missing options: it was that the screen TOLD the operator, three times, that
 * re-running install would resume, then passed no resume flag, so every retry
 * re-ran the whole pipeline including a four-minute build and re-asked every
 * question blank.
 *
 * Declaring them as data is what makes the parity CHECKABLE. `flags-model.test`
 * builds the real Commander command and asserts that every `--flag` it declares
 * appears here, so adding an option to the subcommand and forgetting the screen
 * turns a test red instead of quietly re-creating the gap.
 *
 * Flags deliberately NOT offered, each for a stated reason, are listed in
 * `NOT_IN_TUI` below -- an explicit exclusion the parity test reads, rather
 * than a silent omission it would have to tolerate.
 * =============================================================================
 */

export type DeployAction = 'doctor' | 'install' | 'update' | 'status';

export interface ToggleFlag {
  /** Exactly as the subcommand declares it, so the parity test can match. */
  flag: string;
  /** The `InstallOptions`/`UpdateOptions` key this sets. */
  option: string;
  label: string;
  help: string;
  /**
   * True when the flag NEGATES: Commander's `--no-cache` sets `cache: false`,
   * so the screen's "on" means the option is absent.
   */
  negated?: boolean | undefined;
}

export const INSTALL_TOGGLES: readonly ToggleFlag[] = [
  {
    flag: '--all',
    option: 'all',
    label: 'Review every variable',
    help: 'Ask about every environment variable, not only the essential ones.',
  },
  {
    flag: '--reinstall',
    option: 'reinstall',
    label: 'Reinstall over what is here',
    help: 'Install on top of an existing deployment instead of refusing.',
  },
  {
    flag: '--skip-doctor',
    option: 'skipDoctor',
    label: 'Skip the prerequisite checks',
    help: 'Go straight to the work. The checks exist to fail before anything is written.',
  },
  {
    flag: '--skip-proxy',
    option: 'skipProxy',
    label: 'Do not touch the proxy',
    help: 'No vhost, no certificate. The stack answers on the loopback port only.',
  },
  {
    flag: '--skip-seed',
    option: 'skipSeed',
    label: 'Do not run the seed',
    help: 'The seed is how new permissions reach a deployment; skipping it surfaces as a 403.',
  },
  {
    flag: '--no-cache',
    option: 'noCache',
    label: 'Rebuild without the layer cache',
    help: 'Slower, and the answer when a build is reusing something stale.',
  },
  {
    flag: '--force',
    option: 'force',
    label: 'Discard local changes in the checkout',
    help: 'Throws away anything uncommitted under the deploy root.',
  },
  {
    flag: '--staging',
    option: 'staging',
    label: "Use Let's Encrypt staging",
    help: 'Certificates browsers do not trust, and rate limits that forgive a mistake.',
  },
  {
    flag: '--no-version-bump',
    option: 'noVersionBump',
    label: 'Do not bump the version',
    help: 'Deploy the current version: no manifest write, no commit, no push.',
  },
];

export const UPDATE_TOGGLES: readonly ToggleFlag[] = [
  {
    flag: '--force',
    option: 'force',
    label: 'Rebuild even when nothing moved',
    help: 'Update normally exits without doing anything when the revision is unchanged.',
  },
  {
    flag: '--no-cache',
    option: 'noCache',
    label: 'Rebuild without the layer cache',
    help: 'Slower, and the answer when a build is reusing something stale.',
  },
  {
    flag: '--skip-seed',
    option: 'skipSeed',
    label: 'Do not re-run the seed',
    help: 'The seed is how new permissions reach an existing deployment.',
  },
  {
    flag: '--skip-proxy',
    option: 'skipProxy',
    label: 'Do not touch the proxy',
    help: 'Leaves the vhost and the certificate exactly as they are.',
  },
  {
    flag: '--no-version-bump',
    option: 'noVersionBump',
    label: 'Do not bump the version',
    help: 'Deploy the current version: no manifest write, no commit, no push.',
  },
];

/**
 * Flags the screens deliberately do not offer, each with the reason.
 *
 * ⚠ AN EXPLICIT EXCLUSION, NOT A SILENT ONE. The parity test reads this list,
 * so dropping a flag costs a sentence here rather than nothing at all -- and a
 * flag that stops being justifiable becomes visible as a stale sentence.
 */
export const NOT_IN_TUI: Readonly<Record<string, string>> = Object.freeze({
  '--json':
    'A machine-readable report on stdout is meaningless while ink owns the terminal.',
  '--no-color':
    'Colour here is ink’s, not the renderer’s; the screen has no monochrome mode to switch to.',
  '--non-interactive':
    'The screen IS the interaction. It always passes this to the wizard underneath, because readline cannot ask a question while ink holds stdin in raw mode.',
  '--resume':
    'Decided, not offered: see decideResume. Resume is passed only when the collected answers still match the file, which is a fact the screen knows and the operator should not have to assert.',
  '--answer':
    'Every answer is collected by the screen itself; a second channel for them would be two sources of truth for one value.',
  '--answers-file':
    'Same as --answer: the screen collects them.',
});

/** The options object a set of chosen toggles produces. */
export function optionsFromToggles(
  toggles: readonly ToggleFlag[],
  chosen: ReadonlySet<string>,
): Record<string, true> {
  const options: Record<string, true> = {};
  for (const toggle of toggles) {
    if (chosen.has(toggle.flag)) options[toggle.option] = true;
  }
  return options;
}

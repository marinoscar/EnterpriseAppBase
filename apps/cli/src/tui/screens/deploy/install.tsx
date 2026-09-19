import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useState, type ReactNode } from 'react';

import { DEFAULT_BIND_PORT, DEFAULT_PROXY_ROOT } from '../../../commands/deploy.js';
import type { EnvGroup } from '../../../deploy/env-metadata.js';
import { parseEnvExample, type EnvVarSpec } from '../../../deploy/env-spec.js';
import { runCommand, withSignal } from '../../../deploy/executor.js';
import type { DeployHooks } from '../../../deploy/hooks.js';
import { runInstall } from '../../../deploy/install.js';
import { DEFAULT_APPS_ROOT, deployRootFor } from '../../../deploy/layout.js';
import { readState, type DeployState } from '../../../deploy/state.js';
import { ConfirmStep, FieldWizard, NameStep, ToggleStep, toggled, withFlags } from './fields.js';
import { INSTALL_TOGGLES, optionsFromToggles } from './flags-model.js';
import {
  decideResume,
  envAnswers,
  installFields,
  reconcileSeed,
  seedFor,
  validatePort,
  EMPTY_SEED,
  type AppName,
  type ResumeDecision,
  type Seed,
} from './install-model.js';
import type { FieldSpec } from './model.js';
import { RunFrame, useDeployRun } from './run.js';

// =============================================================================
// `deploy install`, as a screen  (issue #406, epic #397)
// =============================================================================
//
// The order of the first two steps is the whole design, and it is not
// negotiable:
//
//   1. RESOLVE THE NAME. Everything else is keyed on it - the path, the `.env`
//      that is read, the record that is consulted.
//   2. SEED FROM THAT DEPLOYMENT'S OWN `.env`, then build the questions with
//      the seeded values as their PLACEHOLDERS.
//
// Step 2 is what makes a re-run safe. The environment wizard generates a value
// for an EMPTY answer, so a screen that always started blank minted a fresh
// `JWT_SECRET`, `COOKIE_SECRET` and `SECRETS_ENCRYPTION_KEY` on every re-run -
// and the last of those makes every stored credential in the database
// permanently undecryptable. Prefilling fixes it BY CONSTRUCTION rather than by
// a guard: there is no empty answer left for the generator to fire on.
//
// ⚠ A CHANGED NAME THROWS THE SEED AWAY. The name is a field, so an operator
// typing a neighbour's name reads that neighbour's `.env` on the way past.
// `reconcileSeed` runs on EVERY keystroke of the name field, because a seed
// kept from a neighbour would prefill this install with their database password
// and their secrets, and an operator pressing Enter through the defaults would
// confirm it.
//
// ⚠ RESUME IS DECIDED, NOT ASKED. See `decideResume` and `NOT_IN_TUI` in
// flags-model.ts: whether the collected answers still match the file is a fact
// this screen knows and an operator should not have to assert.
// =============================================================================

export interface InstallScreenProps {
  onDone: () => void;
  /** The deployment this host already has, offered as the default name. */
  located: string | undefined;
}

type Step =
  | { kind: 'name' }
  | { kind: 'questions'; name: AppName; fields: readonly FieldSpec[] }
  | { kind: 'flags'; name: AppName; answers: ReadonlyMap<string, string> }
  | {
      kind: 'confirm';
      name: AppName;
      answers: ReadonlyMap<string, string>;
      resume: ResumeDecision;
    };

export function InstallScreen({ onDone, located }: InstallScreenProps): ReactNode {
  const [step, setStep] = useState<Step>({ kind: 'name' });
  // The values already on disk for the RESOLVED deployment. Held in state
  // rather than recomputed, because `reconcileSeed` must be able to retract it.
  const [seed, setSeed] = useState<Seed>(EMPTY_SEED);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  // Off while a text field owns the keyboard, on everywhere else - including
  // during the run, where Esc is the two-press cancel.
  const escapeActive = step.kind !== 'name' && step.kind !== 'questions';
  const run = useDeployRun({ onEscape: onDone, escapeActive });

  if (run.phase.kind !== 'idle') return <RunFrame action="install" run={run} />;

  if (step.kind === 'name') {
    return (
      <NameStep
        title="Install"
        located={located}
        appsRoot={DEFAULT_APPS_ROOT}
        // ⚠ Every keystroke, not only the submission. A seed belonging to the
        // name that WAS typed is stale the moment the name changes.
        onChange={(name) => {
          setSeed((current) => reconcileSeed(current, name.resolved));
        }}
        onSubmit={(name) => {
          // ⚠ `name.resolved` is the only thing allowed to reach `seedFor` or a
          // path. `name.display` exists for the titles below and nothing else.
          const resolved = name.resolved;
          const fresh = seedFor(DEFAULT_APPS_ROOT, resolved);
          setSeed(fresh);
          setStep({
            kind: 'questions',
            name,
            fields: [
              ...installFields(loadSpecs(resolved), fresh),
              ...installFlagFields(recordFor(resolved), fresh),
            ],
          });
        }}
      />
    );
  }

  if (step.kind === 'questions') {
    return (
      <FieldWizard
        title={`Install — ${step.name.display}`}
        subtitle={`Into ${pathFor(step.name.resolved)}`}
        fields={step.fields}
        onComplete={(answers) => {
          setStep({ kind: 'flags', name: step.name, answers });
        }}
      />
    );
  }

  if (step.kind === 'flags') {
    return (
      <ToggleStep
        title={`Install — ${step.name.display}`}
        toggles={INSTALL_TOGGLES}
        chosen={chosen}
        onToggle={(flag) => {
          setChosen((current) => toggled(current, flag));
        }}
        onContinue={() => {
          setStep({
            kind: 'confirm',
            name: step.name,
            answers: step.answers,
            resume: decideResumeFor(step.name.resolved, step.answers, seed),
          });
        }}
      />
    );
  }

  return (
    <ConfirmStep
      action="install"
      // `__name` is carried as an answer of its own so the deployment being
      // written to is on the review, not merely in the frame's title. It is a
      // screen field, so `envAnswers` strips it before it can reach the `.env`.
      answers={withFlags(
        new Map([['__name', step.name.display], ...step.answers]),
        chosen,
      )}
      notes={[
        // Every branch of `decideResume` names a reason, including the yeses,
        // and the operator sees it before agreeing to anything.
        `Resume: ${step.resume.resume ? 'yes' : 'no'} — ${step.resume.reason}`,
      ]}
      onNo={() => {
        setStep({ kind: 'flags', name: step.name, answers: step.answers });
      }}
      onYes={() => {
        const resolved = step.name.resolved;
        if (resolved === undefined) return;
        const answers = step.answers;
        const flags = chosen;
        const resume = step.resume.resume;
        run.start(
          async (signal, hooks) => await performInstall(resolved, answers, flags, resume, signal, hooks),
        );
      }}
    />
  );
}

function pathFor(resolved: string | undefined): string {
  return resolved === undefined ? DEFAULT_APPS_ROOT : deployRootFor(DEFAULT_APPS_ROOT, resolved);
}

/**
 * The template the questions are derived from.
 *
 * Read from the RESOLVED deployment's own checkout, because a fork's
 * `.env.example` is the specification of its own environment and no other
 * deployment's will do.
 */
function loadSpecs(resolved: string | undefined): EnvVarSpec[] {
  if (resolved === undefined) return [];
  try {
    return parseEnvExample(
      readFileSync(
        join(deployRootFor(DEFAULT_APPS_ROOT, resolved), 'repo', 'infra', 'compose', '.env.example'),
        'utf8',
      ),
    );
  } catch {
    // Before a first checkout there is no template to read; the domain
    // question alone is still enough to get started.
    return [];
  }
}

/** The state recorded for a deployment, or undefined when there is none to read. */
function recordFor(resolved: string | undefined): DeployState | undefined {
  if (resolved === undefined) return undefined;
  try {
    return readState(deployRootFor(DEFAULT_APPS_ROOT, resolved));
  } catch {
    // ⚠ An UNREADABLE record is not an absent one, but for prefilling the two
    // are the same. `runInstall` reports the real problem properly.
    return undefined;
  }
}

/**
 * The text-valued flags, prefilled from what this deployment already records.
 *
 * ⚠ THE PLACEHOLDER IS THE RECORDED VALUE, for exactly the reason the
 * environment fields' are. A deployment installed on a non-default proxy root
 * or port, re-installed by pressing Enter through a form that offered the
 * DEFAULTS, would be moved to a port nothing forwards to and a vhost directory
 * the proxy does not read - silently, and reported as a success.
 *
 * ⚠ An optional flag's placeholder is EMPTY, never a description. The wizard
 * stores the placeholder for an empty submission, so a hint in that slot would
 * become the answer; `performInstall` reads `''` as "not given" and leaves the
 * option off the call.
 */
function installFlagFields(state: DeployState | undefined, seed: Seed): FieldSpec[] {
  return [
    {
      key: '__proxyRoot',
      label: 'proxy-root',
      help: 'The shared reverse proxy this host runs. The vhost and certificate are written under it.',
      placeholder: state?.proxyRoot ?? DEFAULT_PROXY_ROOT,
      secret: false,
      prefilled: state?.proxyRoot !== undefined,
    },
    {
      key: '__port',
      label: 'port',
      help: 'Loopback port the proxy forwards to. One per application on this host.',
      placeholder: String(state?.bindPort ?? DEFAULT_BIND_PORT),
      secret: false,
      prefilled: state?.bindPort !== undefined,
      validate: validatePort,
    },
    {
      key: '__repo',
      label: 'repo',
      help: "Repository to deploy. Empty uses this checkout's own origin, so a fork deploys itself.",
      placeholder: state?.repoUrl ?? '',
      secret: false,
      prefilled: state?.repoUrl !== undefined,
    },
    {
      key: '__ref',
      label: 'ref',
      help: "Branch, tag or commit. Empty uses the remote's default branch.",
      placeholder: state?.ref ?? '',
      secret: false,
      prefilled: state?.ref !== undefined,
    },
    {
      key: '__email',
      label: 'email',
      help: "Certificate registration address. Let's Encrypt sends expiry warnings here.",
      // The deployment's own admin address is the one the certs command falls
      // back to, so offering it here keeps the two from disagreeing.
      placeholder: seed.values.get('INITIAL_ADMIN_EMAIL') ?? '',
      secret: false,
      prefilled: seed.values.has('INITIAL_ADMIN_EMAIL'),
      validate: (value) =>
        value === '' || value.includes('@') ? undefined : 'must be an email address',
    },
    {
      key: '__group',
      label: 'group',
      help: `Optional feature groups, comma-separated: ${GROUP_NAMES.join(', ')}. Their variables are skipped otherwise.`,
      placeholder: (state?.groups ?? []).join(', '),
      secret: false,
      prefilled: (state?.groups ?? []).length > 0,
      validate: validateGroups,
    },
  ];
}

/**
 * ⚠ Exhaustive BY CONSTRUCTION. `EnvGroup` is a union with no runtime list, so
 * this record is how a new member becomes a compile error here rather than a
 * value the screen silently refuses.
 */
const GROUP_RECORD: Readonly<Record<EnvGroup, true>> = Object.freeze({
  observability: true,
  email: true,
  'microsoft-oauth': true,
});

const GROUP_NAMES: readonly string[] = Object.keys(GROUP_RECORD);

function splitGroups(value: string): string[] {
  return value
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');
}

function validateGroups(value: string): string | undefined {
  const unknown = splitGroups(value).filter((name) => !(name in GROUP_RECORD));
  return unknown.length === 0
    ? undefined
    : `must name only ${GROUP_NAMES.join(', ')}; got ${unknown.join(', ')}`;
}

/** Narrowed rather than cast, so an unknown group cannot reach `runInstall`. */
function selectedGroups(value: string): EnvGroup[] {
  return splitGroups(value).filter((name): name is EnvGroup => name in GROUP_RECORD);
}

/**
 * Whether this run may resume, asked of the model.
 *
 * ⚠ AN UNREADABLE RECORD IS NOT A RESUMABLE ONE. `readState` throws when the
 * file is there and this build cannot interpret it, which is a different
 * condition from "nothing has been attempted here" and must not be flattened
 * into it: resuming exempts the "already exists" guard, so a wrong yes here
 * skips every recorded step and reports an install that did nothing.
 */
function decideResumeFor(
  resolved: string | undefined,
  answers: ReadonlyMap<string, string>,
  seed: Seed,
): ResumeDecision {
  if (resolved === undefined) {
    return { resume: false, reason: 'no deployment is named' };
  }

  let state: DeployState | undefined;
  try {
    state = readState(deployRootFor(DEFAULT_APPS_ROOT, resolved));
  } catch {
    return {
      resume: false,
      reason: 'the deployment record here cannot be read, so no step may be skipped',
    };
  }

  return decideResume({
    state,
    answers: envAnswers(answers),
    // What the deployment's `.env` holds right now. The seed IS that file, read
    // once when the name resolved and retracted whenever it changed.
    onDisk: seed.values,
  });
}

async function performInstall(
  resolved: string,
  answers: ReadonlyMap<string, string>,
  chosen: ReadonlySet<string>,
  resume: boolean,
  signal: AbortSignal,
  hooks: DeployHooks,
): Promise<string[]> {
  const domain = answers.get('__domain') ?? '';
  const repo = answers.get('__repo') ?? '';
  const ref = answers.get('__ref') ?? '';
  const email = answers.get('__email') ?? '';
  const groups = selectedGroups(answers.get('__group') ?? '');

  const result = await runInstall({
    deployRoot: deployRootFor(DEFAULT_APPS_ROOT, resolved),
    // Load-bearing: every child process runs under the screen's signal, so
    // aborting the controller SIGTERMs the `docker compose build` rather than
    // leaving it running on a production server.
    runCommand: withSignal(runCommand, signal),
    bindPort: Number(answers.get('__port') ?? DEFAULT_BIND_PORT),
    proxyRoot: answers.get('__proxyRoot') ?? DEFAULT_PROXY_ROOT,
    // ⚠ Screen fields stripped. `runInstall` writes `answers` into the `.env`
    // as template keys, so a `__domain` reaching it becomes a variable of that
    // name in a production environment file.
    answers: envAnswers(answers),
    // readline cannot ask a question while ink holds stdin in raw mode, so the
    // values were collected above and the wizard runs with nothing left to ask.
    nonInteractive: true,
    // ⚠ Only when the model said so. See `decideResume`.
    ...(resume ? { resume: true } : {}),
    ...(domain === '' ? {} : { domain }),
    ...(repo === '' ? {} : { repo }),
    ...(ref === '' ? {} : { ref }),
    ...(email === '' ? {} : { email }),
    ...(groups.length === 0 ? {} : { groups }),
    // `--no-version-bump` and every other toggle land here as their real
    // option keys; `flags-model.test.ts` asserts the list against the
    // subcommand's own Commander definitions, so a toggle for a flag the CLI
    // does not declare is a failing test rather than a control that does
    // nothing.
    ...optionsFromToggles(INSTALL_TOGGLES, chosen),
    hooks,
  });

  return [`Installed ${result.commitSha.slice(0, 12)}.`, `Log: ${result.journalPath}`, '', result.nextStep];
}

import { useState, type ReactNode } from 'react';

import { runCommand, withSignal } from '../../../deploy/executor.js';
import type { DeployHooks } from '../../../deploy/hooks.js';
import { DEFAULT_APPS_ROOT, deployRootFor } from '../../../deploy/layout.js';
import { readState, type DeployState } from '../../../deploy/state.js';
import { runUpdate } from '../../../deploy/update.js';
import { ConfirmStep, FieldWizard, NameStep, ToggleStep, toggled, withFlags } from './fields.js';
import { optionsFromToggles, UPDATE_TOGGLES } from './flags-model.js';
import type { AppName } from './install-model.js';
import type { FieldSpec } from './model.js';
import { RunFrame, useDeployRun } from './run.js';

// =============================================================================
// `deploy update`, as a screen  (issue #406)
// =============================================================================
//
// `runUpdate`, with the flags the subcommand accepts actually reachable:
// --ref as a question, and --force/--no-cache/--skip-seed/--skip-proxy from
// UPDATE_TOGGLES. The screen this replaces offered none of them, so the one
// thing an operator most often wants from a TUI update - rebuild without the
// layer cache, because the build is reusing something stale - could only be
// had by leaving the TUI.
//
// ⚠ IT PASSES ITS OWN `runCommand`. The predecessor did not, which meant the
// abort controller reached every child process of install, doctor and status
// and NONE of update's: Esc during an update reported a cancel and left
// `docker compose build` running on the server. Update is the command run
// weekly, so that was the most-used path with the least honest cancel.
// =============================================================================

export interface UpdateScreenProps {
  onDone: () => void;
  /** The deployment this host already has, offered as the default name. */
  located: string | undefined;
}

type Step =
  | { kind: 'name' }
  | { kind: 'questions'; name: AppName; fields: readonly FieldSpec[] }
  | { kind: 'flags'; name: AppName; answers: ReadonlyMap<string, string> }
  | { kind: 'confirm'; name: AppName; answers: ReadonlyMap<string, string> };

export function UpdateScreen({ onDone, located }: UpdateScreenProps): ReactNode {
  const [step, setStep] = useState<Step>({ kind: 'name' });
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  // Off while a text field owns the keyboard, on everywhere else - including
  // during the run, where Esc is the two-press cancel.
  const escapeActive = step.kind !== 'name' && step.kind !== 'questions';
  const run = useDeployRun({ onEscape: onDone, escapeActive });

  if (run.phase.kind !== 'idle') return <RunFrame action="update" run={run} />;

  if (step.kind === 'name') {
    return (
      <NameStep
        title="Update"
        located={located}
        appsRoot={DEFAULT_APPS_ROOT}
        onSubmit={(name) => {
          setStep({ kind: 'questions', name, fields: updateFields(recordFor(name.resolved)) });
        }}
      />
    );
  }

  if (step.kind === 'questions') {
    return (
      <FieldWizard
        title={`Update — ${step.name.display}`}
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
        title={`Update — ${step.name.display}`}
        toggles={UPDATE_TOGGLES}
        chosen={chosen}
        onToggle={(flag) => {
          setChosen((current) => toggled(current, flag));
        }}
        onContinue={() => {
          setStep({ kind: 'confirm', name: step.name, answers: step.answers });
        }}
      />
    );
  }

  return (
    <ConfirmStep
      action="update"
      answers={withFlags(step.answers, chosen)}
      onNo={() => {
        setStep({ kind: 'flags', name: step.name, answers: step.answers });
      }}
      onYes={() => {
        // ⚠ `name.resolved`, never `name.display`: this becomes a path.
        const resolved = step.name.resolved;
        if (resolved === undefined) return;
        const answers = step.answers;
        const flags = chosen;
        run.start(async (signal, hooks) => await performUpdate(resolved, answers, flags, signal, hooks));
      }}
    />
  );
}

/** The state recorded for a deployment, or undefined when there is none to read. */
function recordFor(resolved: string | undefined): DeployState | undefined {
  if (resolved === undefined) return undefined;
  try {
    return readState(deployRootFor(DEFAULT_APPS_ROOT, resolved));
  } catch {
    // ⚠ An UNREADABLE record is not an absent one, but for prefilling the two
    // are the same: there is nothing to offer. `runUpdate` reports the real
    // problem properly, with the message this screen has no business guessing.
    return undefined;
  }
}

/**
 * The one text-valued flag update takes.
 *
 * ⚠ The placeholder is the RECORDED ref, so pressing Enter through it keeps
 * the branch this deployment is actually following. An empty placeholder
 * stores `''`, which the call below reads as "not given" and leaves off
 * entirely - `runUpdate` then follows whatever the state records, rather than
 * being told to move to a ref the operator never typed.
 */
function updateFields(state: DeployState | undefined): FieldSpec[] {
  return [
    {
      key: '__ref',
      label: 'ref',
      help: 'Branch, tag or commit to move to. Empty follows the one this deployment already tracks.',
      placeholder: state?.ref ?? '',
      secret: false,
      prefilled: state?.ref !== undefined,
    },
  ];
}

async function performUpdate(
  resolved: string,
  answers: ReadonlyMap<string, string>,
  chosen: ReadonlySet<string>,
  signal: AbortSignal,
  hooks: DeployHooks,
): Promise<string[]> {
  const ref = answers.get('__ref') ?? '';

  const result = await runUpdate({
    deployRoot: deployRootFor(DEFAULT_APPS_ROOT, resolved),
    // Load-bearing: without it the abort reaches nothing. See the file header.
    runCommand: withSignal(runCommand, signal),
    // readline cannot ask a question while ink holds stdin in raw mode, so the
    // values were collected above and the wizard runs with nothing left to ask.
    nonInteractive: true,
    ...(ref === '' ? {} : { ref }),
    // ⚠ `--no-version-bump` is declared in INSTALL_TOGGLES/UPDATE_TOGGLES but is
    // not an option `runInstall`/`runUpdate` accept yet, so it is spread here
    // and read by nobody. It is passed rather than filtered out so the toggle
    // starts working the moment the option lands - but until then it is a
    // control that does nothing, which is exactly the kind of quiet lie these
    // screens are otherwise written to avoid. Wire the option, or drop the
    // toggle; do not leave it here indefinitely.
    ...optionsFromToggles(UPDATE_TOGGLES, chosen),
    hooks,
  });

  return result.changed
    ? [`Updated to ${result.commitSha.slice(0, 12)}.`, `Log: ${result.journalPath}`]
    : ['Already up to date.'];
}

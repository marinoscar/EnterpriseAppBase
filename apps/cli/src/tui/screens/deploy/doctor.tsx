import { useState, type ReactNode } from 'react';

import { ALL_CHECKS, checksPassed, runChecks, type CompletedCheck } from '../../../deploy/checks/index.js';
import { runCommand, withSignal } from '../../../deploy/executor.js';
import type { DeployHooks } from '../../../deploy/hooks.js';
import { DEFAULT_APPS_ROOT, deployRootFor } from '../../../deploy/layout.js';
import { DEFAULT_BIND_PORT, DEFAULT_PROXY_ROOT } from '../../../commands/deploy.js';
import { FieldWizard, NameStep, optionalHostname } from './fields.js';
import { seedFor, validatePort, type AppName } from './install-model.js';
import type { FieldSpec } from './model.js';
import { RunFrame, useDeployRun } from './run.js';

// =============================================================================
// `deploy doctor`, as a screen  (issue #406)
// =============================================================================
//
// It calls `runChecks` with the same context `runDoctorCommand` builds, and
// renders the stream of results instead of writing them to stderr. There is no
// confirmation step and there is nothing to undo: checks are READ-ONLY by
// contract (checks/types.ts rule 4), which is what makes doctor safe to run
// against a production server at any time.
//
// ⚠ ROOT, PROXY ROOT AND PORT ARE ASKED FOR, NOT ASSUMED. The screen this
// replaces hardcoded all three, so a deployment installed anywhere else was
// checked against a directory it does not live in - every answer correct about
// the wrong server.
// =============================================================================

export interface DoctorScreenProps {
  onDone: () => void;
  /** The deployment this host already has, offered as the default name. */
  located: string | undefined;
}

const DOCTOR_FIELDS: readonly FieldSpec[] = [
  {
    key: '__proxyRoot',
    label: 'proxy-root',
    help: 'The shared reverse proxy this host runs. Checked for a vhost directory and a live container.',
    placeholder: DEFAULT_PROXY_ROOT,
    secret: false,
    prefilled: false,
  },
  {
    key: '__port',
    label: 'port',
    help: 'Loopback port the proxy forwards to. Checked for a conflict with something already listening.',
    placeholder: String(DEFAULT_BIND_PORT),
    secret: false,
    prefilled: false,
    validate: validatePort,
  },
  {
    key: '__domain',
    label: 'domain',
    help: 'Optional. Empty skips the DNS and TLS checks rather than running them against a guess.',
    placeholder: '',
    secret: false,
    prefilled: false,
    validate: optionalHostname,
  },
];

export function DoctorScreen({ onDone, located }: DoctorScreenProps): ReactNode {
  const [name, setName] = useState<AppName | undefined>(undefined);
  // Every step before the run is a text field, so Esc is off until the run
  // starts - after which it is the cancel. `started` rather than the run's own
  // phase because the phase is what the hook returns, and the hook needs this.
  const [started, setStarted] = useState(false);
  const run = useDeployRun({ onEscape: onDone, escapeActive: started });

  if (run.phase.kind !== 'idle') return <RunFrame action="doctor" run={run} />;

  if (name === undefined) {
    return (
      <NameStep
        title="Doctor"
        located={located}
        appsRoot={DEFAULT_APPS_ROOT}
        onSubmit={setName}
      />
    );
  }

  return (
    <FieldWizard
      title={`Doctor — ${name.display}`}
      fields={DOCTOR_FIELDS}
      onComplete={(answers) => {
        // ⚠ `name.resolved`, never `name.display`. A fallback display name must
        // not reach a path or a port probe; `NameStep` refuses to submit an
        // unresolved name, which is what makes this narrowing sound.
        const resolved = name.resolved;
        if (resolved === undefined) return;
        setStarted(true);
        run.start(async (signal, hooks) => await performDoctor(resolved, answers, signal, hooks));
      }}
    />
  );
}

/**
 * Runs the checks.
 *
 * ⚠ THE SAME FUNCTION THE SUBCOMMAND CALLS, with the same context shape.
 * Anything this computed for itself would be a second answer to a question
 * `runDoctorCommand` already answers.
 */
async function performDoctor(
  resolved: string,
  answers: ReadonlyMap<string, string>,
  signal: AbortSignal,
  hooks: DeployHooks,
): Promise<string[]> {
  const deployRoot = deployRootFor(DEFAULT_APPS_ROOT, resolved);
  const domain = answers.get('__domain') ?? '';
  // The deployment's own environment, so the database checks have credentials
  // to probe with. `runDoctorCommand` reads it for the same reason; this goes
  // through `seedFor`, which knows both the current `.env` location and the
  // legacy one, so an older deployment is not checked with no environment at
  // all merely because its file is in the other place.
  const seed = seedFor(DEFAULT_APPS_ROOT, resolved);

  const results: CompletedCheck[] = await runChecks(
    ALL_CHECKS,
    {
      // Every child process runs under the screen's signal, so Esc reaches it.
      runCommand: withSignal(runCommand, signal),
      deployRoot,
      bindPort: Number(answers.get('__port') ?? DEFAULT_BIND_PORT),
      proxyRoot: answers.get('__proxyRoot') ?? DEFAULT_PROXY_ROOT,
      ...(domain === '' ? {} : { domain }),
      ...(seed.values.size === 0 ? {} : { env: seed.values }),
    },
    (result) => hooks.onLog?.(`${result.status.toUpperCase()} ${result.title}: ${result.detail}`),
  );

  return checksPassed(results)
    ? ['All required checks passed.']
    : [
        'Required checks failed:',
        ...results
          .filter((result) => result.severity === 'required' && result.status === 'fail')
          .map((result) => `  ${result.title}: ${result.detail}`),
      ];
}

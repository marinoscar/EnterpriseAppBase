import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import Spinner from 'ink-spinner';
import TextInput from 'ink-text-input';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { CLI_NAME } from '../../branding.js';
import {
  DEFAULT_BIND_PORT,
  DEFAULT_DEPLOY_ROOT,
  DEFAULT_PROXY_ROOT,
} from '../../commands/deploy.js';
import {
  ALL_CHECKS,
  runChecks,
  checksPassed,
  summarise,
  type CheckStatus,
  type CompletedCheck,
} from '../../deploy/checks/index.js';
import { collectHealth, isHealthy, type HealthReport } from '../../deploy/health.js';
import { buildInstallSteps, runInstall } from '../../deploy/install.js';
import { runUpdate } from '../../deploy/update.js';
import { runCommand } from '../../deploy/executor.js';
import { metadataFor } from '../../deploy/env-metadata.js';
import { parseEnvExample, type EnvVarSpec } from '../../deploy/env-spec.js';
import { DEFAULT_PROXY_CONTAINER, type ProxyMode } from '../../deploy/proxy.js';
import { readState, type DeployState } from '../../deploy/state.js';
import { formatError } from '../../errors.js';
import { ErrorNotice, Field, Frame, useTerminalSize } from '../layout.js';
import { ScrollBox } from '../scroll-box.js';

// =============================================================================
// The deploy screen  (issue #184, epic #168; extended by #393, epic #388)
// =============================================================================
//
// One screen, not four routes. There is deliberately no history stack in this
// TUI (see routes.ts), so a route per action would return to the TOP menu
// rather than back here - meaning choosing a second action would mean walking
// in from the start every time.
//
// IT CALLS THE SAME FUNCTIONS THE SUBCOMMANDS CALL. runChecks, runInstall,
// runUpdate and collectHealth are shared; only the DeployHooks implementation
// differs, writing into React state instead of onto stderr. That is the
// device-login.ts pattern, and it is the reason there is no orchestration
// logic in this file at all.
//
// TWO HAZARDS SPECIFIC TO THIS SCREEN
//
//   1. THE ABORT CONTROLLER IS LOAD-BEARING. Without it, pressing Esc tears
//      down the UI and leaves the work running - and here the work is a
//      `docker compose build` on a production server. So Esc is REFUSED while
//      a deploy is running, with a hint saying so, rather than offered as a
//      cancel that does not cancel.
//   2. THE EXIT CODE INVERTS HERE. A normal TUI exit is 0 even after a failed
//      operation (tui/index.tsx), whereas `appctl deploy install` must exit
//      non-zero. That is intended - the user has read the outcome on screen -
//      but it means the failure has to be UNMISTAKABLE in the frame, because
//      the exit code will not carry it. That is what the `failed` phase's
//      failing step, output tail and re-run command are for: the frame has to
//      leave something to ACT on, not merely something to read.
//
// THE NON-INTERACTIVE CONSTRAINT IS WHY THE FORM KEEPS GROWING (#393).
// `perform` passes `nonInteractive: true` because readline cannot prompt while
// ink holds stdin in raw mode. That is not a workaround, it is the only
// correct design under that constraint - but it has a standing consequence:
// ANYTHING THE PIPELINE WOULD OTHERWISE PROMPT FOR MUST BE COLLECTED BY THE
// FORM UP FRONT, or the install fails listing it as unresolved. When a new
// question is added to install.ts (`--bootstrap-proxy` and `--create-database`
// are the two live ones), a field for it belongs in `fieldsForInstall` in the
// same change.
//
// THE SETTINGS ARE STATE, NOT CONSTANTS (#393). The deploy root, the proxy
// root and the bind port were hardcoded here until this issue, which made a
// second application on the same box - which needs a different bind port BY
// DEFINITION - impossible to install, doctor or status from the TUI at all.
// They now live in `DeploySettings`, seeded from the SAME constants the
// subcommand's flags default to, so the two surfaces cannot drift.
// =============================================================================

export interface DeployScreenProps {
  onDone: () => void;
}

export type Action = 'doctor' | 'install' | 'update' | 'status';

/**
 * How an install relates to whatever is already at the deploy root.
 *
 * `runInstall` REFUSES a plain install over an existing deployment, so the
 * screen has to state which of the two it means; offering only "install" was
 * an offer that could not be taken up on any box that had one.
 */
export type InstallMode = 'fresh' | 'resume' | 'reinstall';

interface StepView {
  id: string;
  title: string;
  outcome: 'running' | 'ok' | 'skipped' | 'failed';
  detail?: string | undefined;
}

type Phase =
  | { kind: 'choosing' }
  | {
      kind: 'advanced';
      /** Where Enter on the last field lands. The menu, or install's preflight. */
      returnTo: 'choosing' | 'preflight';
      fields: FieldSpec[];
      index: number;
      answers: Map<string, string>;
      fieldError?: string | undefined;
    }
  | { kind: 'preflight' }
  | {
      kind: 'collecting';
      action: Action;
      mode: InstallMode;
      fields: FieldSpec[];
      index: number;
      answers: Map<string, string>;
      fieldError?: string | undefined;
    }
  | { kind: 'confirming'; action: Action; mode: InstallMode; answers: Map<string, string> }
  | { kind: 'running'; action: Action; mode: InstallMode; steps: StepView[]; lines: string[] }
  | {
      kind: 'done';
      action: Action;
      summary: string[];
      /** Doctor only: the full result set, so the frame can group it. */
      checks?: readonly CompletedCheck[] | undefined;
    }
  | {
      kind: 'failed';
      action: Action;
      mode: InstallMode;
      message: string;
      /** Carried out of `running`, because a failure with no context is a dead end. */
      steps: StepView[];
      lines: string[];
      answers: Map<string, string>;
    };

export interface FieldSpec {
  key: string;
  label: string;
  help: string;
  /**
   * What Enter alone accepts.
   *
   * For a `confirm` this is the DEFAULT ANSWER rather than a hint, which is
   * what keeps "one keypress means the safe answer" true for both kinds.
   */
  placeholder: string;
  secret: boolean;
  /** `text` walks a TextInput; `confirm` is a two-item yes/no list. */
  kind: 'text' | 'confirm';
  validate?: ((value: string) => string | undefined) | undefined;
}

/** Lines kept in the live log. Unbounded growth is a leak on a long build. */
const MAX_LOG_LINES = 2_000;

/** Output lines shown beneath a failed step. Enough to see the real error. */
export const FAILURE_TAIL_LINES = 12;

/**
 * Rows the chrome around a report costs, subtracted from the terminal height.
 *
 * The frame, the summary line, the group headings and the hint line. What is
 * left is the budget for the entries themselves - see `DoctorReport`.
 */
const REPORT_CHROME_ROWS = 10;

/** The same subtraction for the failure frame: notice, step, command, hints. */
const FAILURE_CHROME_ROWS = 14;

export const ANSWER_YES = 'yes';
export const ANSWER_NO = 'no';

/** `--proxy-mode` omitted: probe for it. Spelled out so a field can offer it. */
export const PROXY_MODE_DETECT = 'detect';

// -----------------------------------------------------------------------------
// Settings  (gap 1 of #393)
// -----------------------------------------------------------------------------

export interface DeploySettings {
  deployRoot: string;
  proxyRoot: string;
  bindPort: number;
  proxyContainer: string;
  /** `undefined` probes for it, exactly as omitting `--proxy-mode` does. */
  proxyMode: ProxyMode | undefined;
}

/**
 * The same values the subcommand's flags default to.
 *
 * IMPORTED RATHER THAN RESTATED. Three of these used to be local constants in
 * this file, which is precisely how the TUI came to have no equivalent of
 * `--root`, `--proxy-root` or `--port`: a copy nobody was obliged to keep in
 * step. `commands/deploy.ts` owns them; this screen reads them.
 */
export const DEFAULT_SETTINGS: DeploySettings = {
  deployRoot: DEFAULT_DEPLOY_ROOT,
  proxyRoot: DEFAULT_PROXY_ROOT,
  bindPort: DEFAULT_BIND_PORT,
  proxyContainer: DEFAULT_PROXY_CONTAINER,
  proxyMode: undefined,
};

function requireAbsolutePath(value: string): string | undefined {
  return value.startsWith('/') ? undefined : 'must be an absolute path';
}

function validatePort(value: string): string | undefined {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port < 65_536
    ? undefined
    : 'must be a port between 1 and 65535';
}

function validateProxyMode(value: string): string | undefined {
  return value === 'container' || value === 'host' || value === PROXY_MODE_DETECT
    ? undefined
    : `must be container, host or ${PROXY_MODE_DETECT}`;
}

function validateOptionalEmail(value: string): string | undefined {
  if (value === '') return undefined;
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)
    ? undefined
    : 'must be an email address, or blank to use INITIAL_ADMIN_EMAIL';
}

/**
 * The advanced step: where this deployment lives and which port it takes.
 *
 * PRE-FILLED WITH WHAT IS IN EFFECT, not with the defaults, so re-entering it
 * to change one value does not silently reset the other four. Every placeholder
 * is the current value, so Enter through the lot is a no-op.
 */
export function advancedFields(settings: DeploySettings = DEFAULT_SETTINGS): FieldSpec[] {
  return [
    {
      key: '__root',
      label: 'Deploy root',
      help: 'Where this deployment\'s checkout, .env, logs and state file live. One per application on this box. (--root)',
      placeholder: settings.deployRoot,
      secret: false,
      kind: 'text',
      validate: requireAbsolutePath,
    },
    {
      key: '__proxyRoot',
      label: 'Proxy root',
      help: 'The SHARED reverse proxy directory. Every application on this box points at the same one. (--proxy-root)',
      placeholder: settings.proxyRoot,
      secret: false,
      kind: 'text',
      validate: requireAbsolutePath,
    },
    {
      key: '__port',
      label: 'Bind port',
      help: 'Loopback port the shared proxy forwards to. A second application on this box needs a different one. (--port)',
      placeholder: String(settings.bindPort),
      secret: false,
      kind: 'text',
      validate: validatePort,
    },
    {
      key: '__proxyContainer',
      label: 'Proxy container',
      help: 'Container the shared proxy runs in, when it is containerised. (--proxy-container)',
      placeholder: settings.proxyContainer,
      secret: false,
      kind: 'text',
      validate: (value) => (value.trim() === '' ? 'must be a container name' : undefined),
    },
    {
      key: '__proxyMode',
      label: 'Proxy mode',
      help: `How the shared proxy is operated: container, host, or ${PROXY_MODE_DETECT} to probe for it. (--proxy-mode)`,
      placeholder: settings.proxyMode ?? PROXY_MODE_DETECT,
      secret: false,
      kind: 'text',
      validate: validateProxyMode,
    },
  ];
}

/**
 * Folds the advanced answers back into settings.
 *
 * Total and pure: a missing or unusable answer falls back to `base` rather
 * than producing a settings object with a NaN port, which would reach
 * `runInstall` as a bind port and fail somewhere far from here.
 */
export function settingsFromAnswers(
  answers: ReadonlyMap<string, string>,
  base: DeploySettings = DEFAULT_SETTINGS,
): DeploySettings {
  const port = Number(answers.get('__port'));
  const mode = answers.get('__proxyMode');

  return {
    deployRoot: answers.get('__root') ?? base.deployRoot,
    proxyRoot: answers.get('__proxyRoot') ?? base.proxyRoot,
    bindPort: Number.isInteger(port) && port > 0 && port < 65_536 ? port : base.bindPort,
    proxyContainer: answers.get('__proxyContainer') ?? base.proxyContainer,
    // Anything that is not one of the two modes means "probe", which is what
    // `detect` and an unanswered field both are.
    proxyMode: mode === 'container' || mode === 'host' ? mode : undefined,
  };
}

/** One line for the menu, so the settings in effect are visible without entering them. */
export function describeSettings(settings: DeploySettings): string {
  return `root ${settings.deployRoot} · port ${settings.bindPort} · proxy ${settings.proxyRoot}`;
}

// -----------------------------------------------------------------------------
// The install questions
// -----------------------------------------------------------------------------

/**
 * The questions install needs, derived from the template.
 *
 * A hand-rolled union of thirty step variants does not scale, so the wizard is
 * DATA and the screen keeps a cursor into it - which also preserves the "one
 * thing accepting input at any moment" invariant that invoke.tsx argues for.
 *
 * The four trailing fields are not environment variables at all: they are the
 * questions the PIPELINE would ask, and they are here because it cannot ask
 * them (see the header's note on `nonInteractive`). Both confirmations default
 * to NO, matching the flags they stand in for - `--bootstrap-proxy` binds
 * ports 80 and 443 on a shared host, and `--create-database` cannot tell a
 * database that does not exist yet from a typo in POSTGRES_DB.
 */
export function fieldsForInstall(specs: readonly EnvVarSpec[]): FieldSpec[] {
  const fields: FieldSpec[] = [
    {
      key: '__domain',
      label: 'Domain',
      help: 'The public hostname this will be served on. APP_URL and the OAuth callback are derived from it.',
      placeholder: 'app.example.com',
      secret: false,
      kind: 'text',
      validate: (value) =>
        /^[a-z0-9.-]+$/i.test(value) ? undefined : 'must be a hostname',
    },
  ];

  for (const spec of specs) {
    const metadata = metadataFor(spec.key);
    if (metadata.never === true || metadata.fixed !== undefined) continue;
    if (metadata.derive !== undefined) continue;
    if (metadata.group !== undefined) continue;
    if (metadata.essential !== true) continue;

    fields.push({
      key: spec.key,
      label: spec.key,
      help: spec.help,
      placeholder: spec.defaultValue,
      secret: metadata.secret === true,
      kind: 'text',
      ...(metadata.validate === undefined ? {} : { validate: metadata.validate }),
    });
  }

  fields.push(
    {
      key: '__email',
      label: 'Certificate email',
      help: "Where Let's Encrypt sends expiry warnings. Leave blank to use INITIAL_ADMIN_EMAIL. (--email)",
      placeholder: '',
      secret: false,
      kind: 'text',
      validate: validateOptionalEmail,
    },
    {
      key: '__bootstrapProxy',
      label: 'Create the shared proxy?',
      help: 'Only when this box has no shared reverse proxy yet. It binds ports 80 and 443. (--bootstrap-proxy)',
      placeholder: ANSWER_NO,
      secret: false,
      kind: 'confirm',
    },
    {
      key: '__createDatabase',
      label: 'Create the database?',
      help: 'Create POSTGRES_DB when it does not exist. A typo in the name looks exactly like this. (--create-database)',
      placeholder: ANSWER_NO,
      secret: false,
      kind: 'confirm',
    },
    {
      key: '__skipRenewal',
      label: 'Skip renewal scheduling?',
      help: 'Yes only when something else already renews this certificate tree. (--skip-renewal)',
      placeholder: ANSWER_NO,
      secret: false,
      kind: 'confirm',
    },
  );

  return fields;
}

/** True when an answer collected by a `confirm` field means yes. */
export function answeredYes(
  answers: ReadonlyMap<string, string>,
  key: string,
): boolean {
  return answers.get(key) === ANSWER_YES;
}

/** Display name for an answer key, so the summary does not read as camelCase. */
export function answerLabel(key: string): string {
  return (
    ANSWER_LABELS[key] ??
    // An environment variable is already the name the operator knows it by.
    key.replace(/^__/, '')
  );
}

const ANSWER_LABELS: Record<string, string> = {
  __domain: 'domain',
  __email: 'cert email',
  __bootstrapProxy: 'make proxy',
  __createDatabase: 'make db',
  __skipRenewal: 'no renewal',
  __root: 'root',
  __proxyRoot: 'proxy root',
  __port: 'port',
  __proxyContainer: 'proxy ctr',
  __proxyMode: 'proxy mode',
};

// -----------------------------------------------------------------------------
// Doctor results  (gap 2 of #393)
// -----------------------------------------------------------------------------

/**
 * The status marks, which are GLYPHS as well as colours.
 *
 * The same two characters `appctl deploy doctor` prints, and for the same
 * reason: a terminal may be monochrome, a frame gets screenshotted in
 * greyscale, and a reader may not distinguish red from green. Colour alone
 * would make the status invisible to all three.
 */
export const CHECK_GLYPHS: Record<CheckStatus, string> = {
  pass: 'OK',
  warn: '!!',
  fail: 'XX',
  skip: '--',
};

const CHECK_COLOURS: Record<CheckStatus, string> = {
  pass: 'green',
  warn: 'yellow',
  fail: 'red',
  skip: 'gray',
};

const CHECK_LABELS: Record<CheckStatus, string> = {
  pass: 'Passed',
  warn: 'Warnings',
  fail: 'Failed',
  skip: 'Skipped',
};

/**
 * Worst first.
 *
 * There are about thirty checks and a terminal is twenty-four rows, so the
 * order decides what a short window shows at all. A flat list in registry
 * order buries the two failures that matter under twenty-eight that do not.
 */
const GROUP_ORDER: readonly CheckStatus[] = ['fail', 'warn', 'pass', 'skip'];

export interface CheckGroup {
  status: CheckStatus;
  label: string;
  glyph: string;
  colour: string;
  count: number;
  /** In registry order within the group; each keeps its own `remedy`. */
  results: CompletedCheck[];
}

/**
 * Groups doctor results by status, worst first, dropping empty groups.
 *
 * The REMEDY travels with the result rather than being re-derived, because it
 * is the useful half of a failed check - "Docker is not installed" without
 * `apt-get install docker.io` tells an operator something they already knew.
 */
export function groupCheckResults(results: readonly CompletedCheck[]): CheckGroup[] {
  return GROUP_ORDER.map((status) => {
    const matching = results.filter((result) => result.status === status);
    return {
      status,
      label: CHECK_LABELS[status],
      glyph: CHECK_GLYPHS[status],
      colour: CHECK_COLOURS[status],
      count: matching.length,
      results: matching,
    };
  }).filter((group) => group.count > 0);
}

/** The counts, on one line. `renderSummary`'s content without the escapes. */
export function checkSummaryLine(results: readonly CompletedCheck[]): string {
  const summary = summarise(results);
  const parts: string[] = [];

  if (summary.failed > 0) parts.push(`${summary.failed} failed`);
  if (summary.warned > 0) parts.push(`${summary.warned} warning${summary.warned === 1 ? '' : 's'}`);
  parts.push(`${summary.passed} passed`);
  if (summary.skipped > 0) parts.push(`${summary.skipped} skipped`);

  return parts.join(', ');
}

// -----------------------------------------------------------------------------
// Resume  (gap 5 of #393)
// -----------------------------------------------------------------------------

export interface ResumeOffer {
  /** Install steps the state file records as done, in pipeline order. */
  completed: readonly string[];
  /** Step ids a resumed run would still execute, in pipeline order. */
  remaining: readonly string[];
  nextStepId: string;
  nextStepTitle: string;
  /** Steps in the whole pipeline, so the frame can say "reached N of M". */
  totalSteps: number;
}

/**
 * What `--resume` would continue from, or undefined when there is nothing to
 * continue.
 *
 * Derived from the SAME pipeline the install runs (`buildInstallSteps`), not
 * from a second list of step ids - a copy here would go stale the moment a
 * step is added, and would go stale silently, naming a step that no longer
 * exists.
 *
 * WHAT IS RESUMED IS EVERYTHING PAST THE FURTHEST POINT THE RECORDED RUN
 * REACHED, not every id absent from `completedSteps`, and the difference is
 * the whole correctness of this function. A SKIPPED step is never recorded -
 * `runPipeline` pushes an id only when the step ran or was resumed - so a
 * perfectly successful install whose database already existed and whose box
 * already had a proxy records neither `ensure-database` nor `proxy-bootstrap`.
 * Treating those two absences as "pending" would offer to resume a deployment
 * that finished, which is the one thing this offer must never say.
 *
 * Two consequences fall out of the same rule, both wanted:
 *
 *   - A finished install has recorded `verify`, the last step, so nothing
 *     follows it and no offer is made.
 *   - A state file written by `update`, whose pipeline has ids of its own,
 *     also ends at `verify`. It is read here as "nothing left", rather than
 *     as an install that never started.
 *
 * Nothing recognisable at all means no offer either: resuming from step one is
 * starting over, and dressing it up as continuing would be a lie.
 */
export function resumeOffer(
  state: DeployState | undefined,
  steps: readonly { id: string; title: string }[] = buildInstallSteps(),
): ResumeOffer | undefined {
  const recorded = state?.completedSteps ?? [];
  if (recorded.length === 0) return undefined;

  const done = new Set(recorded);
  const reached = steps.reduce(
    (furthest, step, index) => (done.has(step.id) ? index : furthest),
    -1,
  );
  if (reached < 0) return undefined;

  const remaining = steps.slice(reached + 1);
  const next = remaining[0];
  if (next === undefined) return undefined;

  return {
    completed: steps
      .slice(0, reached + 1)
      .filter((step) => done.has(step.id))
      .map((step) => step.id),
    remaining: remaining.map((step) => step.id),
    nextStepId: next.id,
    nextStepTitle: next.title,
    totalSteps: steps.length,
  };
}

// -----------------------------------------------------------------------------
// Failure  (gap 4 of #393)
// -----------------------------------------------------------------------------

/**
 * The step the run died on.
 *
 * Falls back to whichever step was still RUNNING, because a throw from outside
 * the pipeline - a `UsageError` from `runInstall`'s own preconditions, an
 * abort - never produces a `failed` result at all, and "it stopped somewhere
 * in Build images" is still worth more than nothing.
 */
export function failingStep(steps: readonly StepView[]): StepView | undefined {
  const reversed = [...steps].reverse();
  return (
    reversed.find((step) => step.outcome === 'failed') ??
    reversed.find((step) => step.outcome === 'running')
  );
}

/** The last few output lines. The end of a build log is the part that matters. */
export function tailLines(
  lines: readonly string[],
  count: number = FAILURE_TAIL_LINES,
): string[] {
  return lines.slice(-count);
}

/**
 * Which flags each subcommand actually accepts.
 *
 * Spelled out rather than assumed uniform, because they are NOT uniform:
 * `update` has no `--port`, `--proxy-root` or `--domain`, and `status` has
 * neither proxy flag. A re-run line that names a flag the subcommand rejects
 * is worse than no line at all - it fails with a usage error that reads like
 * the deployment's fault.
 */
const FLAGS_BY_ACTION: Record<Action, ReadonlySet<string>> = {
  doctor: new Set(['root', 'proxy-root', 'proxy-container', 'proxy-mode', 'port', 'domain']),
  install: new Set([
    'root', 'proxy-root', 'proxy-container', 'proxy-mode', 'port', 'domain',
    'email', 'bootstrap-proxy', 'create-database', 'skip-renewal',
    'resume', 'reinstall',
  ]),
  update: new Set(['root', 'proxy-container', 'proxy-mode', 'create-database', 'skip-renewal']),
  status: new Set(['root', 'port', 'domain']),
};

/**
 * The exact command that repeats this run from a shell.
 *
 * NO ENVIRONMENT ANSWER IS EVER READ HERE - only the `__`-prefixed ones, which
 * are the screen's own questions. That is what keeps POSTGRES_PASSWORD and
 * JWT_SECRET out of a line whose entire purpose is to be copied, pasted and
 * pasted again into a bug report. The property is structural: the function
 * never indexes `answers` by anything but a literal key on the list below.
 *
 * Flags equal to the default are omitted. The command is still exact - the
 * default is what the flag would set - and a line short enough to read in a
 * narrow terminal is one an operator will actually use.
 */
export function rerunCommand(
  action: Action,
  settings: DeploySettings = DEFAULT_SETTINGS,
  answers: ReadonlyMap<string, string> = new Map(),
  options?: { mode?: InstallMode | undefined },
): string {
  const supported = FLAGS_BY_ACTION[action];
  const parts = [CLI_NAME, 'deploy', action];

  const flag = (name: string, ...values: string[]): void => {
    if (!supported.has(name)) return;
    parts.push(`--${name}`, ...values);
  };

  if (settings.deployRoot !== DEFAULT_SETTINGS.deployRoot) flag('root', settings.deployRoot);
  if (settings.proxyRoot !== DEFAULT_SETTINGS.proxyRoot) flag('proxy-root', settings.proxyRoot);
  if (settings.bindPort !== DEFAULT_SETTINGS.bindPort) flag('port', String(settings.bindPort));
  if (settings.proxyContainer !== DEFAULT_SETTINGS.proxyContainer) {
    flag('proxy-container', settings.proxyContainer);
  }
  if (settings.proxyMode !== undefined) flag('proxy-mode', settings.proxyMode);

  const domain = answers.get('__domain');
  if (domain !== undefined && domain !== '') flag('domain', domain);

  const email = answers.get('__email');
  if (email !== undefined && email !== '') flag('email', email);

  if (answeredYes(answers, '__bootstrapProxy')) flag('bootstrap-proxy');
  if (answeredYes(answers, '__createDatabase')) flag('create-database');
  if (answeredYes(answers, '__skipRenewal')) flag('skip-renewal');

  if (options?.mode === 'resume') flag('resume');
  else if (options?.mode === 'reinstall') flag('reinstall');

  return parts.join(' ');
}

/**
 * Where this run's journal is being written.
 *
 * A GLOB, not a path, and deliberately so: `openJournal` picks the timestamp
 * INSIDE `runInstall`, and `DeployHooks` has no member that could carry the
 * resulting filename back out. Naming the directory and the pattern is the
 * honest version of that, and it is still the single most useful thing to have
 * on screen while a four-minute build is running - the log outlives the
 * terminal session, which is the whole point of having one. The failure
 * message itself carries the exact path, because `runInstall` puts it there.
 *
 * `appctl-` is journal.ts's own literal prefix rather than CLI_NAME; it is
 * matched here so the pattern keeps working in a fork that renames the binary.
 */
export function journalHint(deployRoot: string, action: Action): string {
  return join(deployRoot, 'logs', `appctl-${action}-*.log`);
}

/** Only install and update open a journal; doctor and status change nothing. */
export function writesJournal(action: Action): boolean {
  return action === 'install' || action === 'update';
}

// =============================================================================
// The screen
// =============================================================================

export function DeployScreen({ onDone }: DeployScreenProps): ReactNode {
  const [phase, setPhase] = useState<Phase>({ kind: 'choosing' });
  const [value, setValue] = useState('');
  const [settings, setSettings] = useState<DeploySettings>(DEFAULT_SETTINGS);
  const mounted = useRef(true);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const { narrow, rows } = useTerminalSize();

  // Re-read whenever the root moves: "is something installed here" is a
  // question about the root, and the advanced step can change the root.
  const state = useMemo(() => readStateSafely(settings.deployRoot), [settings.deployRoot]);
  const installSteps = useMemo(() => buildInstallSteps(), []);

  useEffect(
    () => () => {
      mounted.current = false;
      // Load-bearing: without it, Esc tears down the UI and leaves a
      // `docker compose build` running on a production server.
      abortRef.current?.abort();
    },
    [],
  );

  const isRunning = phase.kind === 'running';
  const inTextField = phase.kind === 'collecting' || phase.kind === 'advanced';

  // Esc is REFUSED while running rather than offered as a cancel that does not
  // cancel. `isActive` is off entirely while a field walk owns the keyboard.
  //
  // ENTER IS NOT A SYNONYM FOR ESC HERE. Every list on this screen binds Enter
  // as SELECT, and ink dispatches a keypress to every active handler with no
  // way to stop it propagating - so a global "Enter leaves" would fire
  // alongside the selection, choosing an action and abandoning the screen in
  // one keypress. It is bound only on the two phases that mount no list.
  useInput(
    (_input, key) => {
      if (isRunning) return;
      if (key.escape) {
        onDone();
        return;
      }
      if (key.return && (phase.kind === 'done' || phase.kind === 'failed')) onDone();
    },
    { isActive: !inTextField },
  );

  const appendLine = useCallback((line: string) => {
    if (!mounted.current) return;
    setPhase((current) => {
      if (current.kind !== 'running') return current;
      const lines = [...current.lines, line];
      // Oldest-first, because the end of a build log is the part that matters.
      return { ...current, lines: lines.slice(-MAX_LOG_LINES) };
    });
  }, []);

  const hooks = {
    onStepStart: ({ id, title }: { id: string; title: string }) => {
      if (!mounted.current) return;
      setPhase((current) =>
        current.kind === 'running'
          ? { ...current, steps: [...current.steps, { id, title, outcome: 'running' as const }] }
          : current,
      );
    },
    onStepResult: (result: { id: string; outcome: string; detail?: string | undefined }) => {
      if (!mounted.current) return;
      setPhase((current) =>
        current.kind === 'running'
          ? {
              ...current,
              steps: current.steps.some((step) => step.id === result.id)
                ? current.steps.map((step) =>
                    step.id === result.id
                      ? { ...step, outcome: result.outcome as StepView['outcome'], detail: result.detail }
                      : step,
                  )
                : [
                    ...current.steps,
                    {
                      id: result.id,
                      title: result.id,
                      outcome: result.outcome as StepView['outcome'],
                      detail: result.detail,
                    },
                  ],
            }
          : current,
      );
    },
    onProgress: appendLine,
    onLog: appendLine,
  };

  const start = useCallback(
    async (action: Action, mode: InstallMode, answers: Map<string, string>) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setPhase({ kind: 'running', action, mode, steps: [], lines: [] });

      try {
        const outcome = await perform(action, mode, answers, settings, hooks, appendLine);
        if (mounted.current) {
          setPhase({
            kind: 'done',
            action,
            summary: outcome.summary,
            ...(outcome.checks === undefined ? {} : { checks: outcome.checks }),
          });
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
        if (!mounted.current) return;
        // The steps and the log tail are carried OUT of `running` rather than
        // discarded with it: the exit code cannot report this failure (hazard
        // 2), so the frame has to carry both the diagnosis and the evidence.
        setPhase((current) => ({
          kind: 'failed',
          action,
          mode,
          message: formatError(error),
          steps: current.kind === 'running' ? current.steps : [],
          lines: current.kind === 'running' ? current.lines : [],
          answers,
        }));
      }
    },
    [appendLine, settings],
  );

  /** One field accepted, shared by the advanced walk and the install walk. */
  const submitField = useCallback(
    (
      field: FieldSpec,
      submitted: string,
      answers: Map<string, string>,
    ): { answers: Map<string, string> } | { error: string } => {
      const answer = submitted === '' ? field.placeholder : submitted;
      const message = field.validate?.(answer);

      // Kept on the field they got it wrong on, rather than made to start the
      // flow again - invoke.tsx's rule.
      if (message !== undefined) return { error: `${field.label} ${message}` };

      return { answers: new Map(answers).set(field.key, answer) };
    },
    [],
  );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (phase.kind === 'choosing') {
    const installed = state !== undefined;
    const items = [
      { key: 'doctor', label: 'Doctor  (check prerequisites)', value: 'doctor' as const },
      {
        key: 'install',
        // Annotated rather than hidden, following the menu's convention: the
        // destination produces the real message.
        label: installed ? 'Install  (already installed here)' : 'Install',
        value: 'install' as const,
      },
      {
        key: 'update',
        label: installed ? 'Update' : 'Update  (nothing installed here)',
        value: 'update' as const,
      },
      { key: 'status', label: 'Status', value: 'status' as const },
      {
        key: 'advanced',
        label: narrow ? 'Advanced…' : `Advanced…  (${describeSettings(settings)})`,
        value: 'advanced' as const,
      },
    ];

    return (
      <Frame title="Deploy" hints={['enter select', 'esc back']}>
        <Text dimColor wrap="truncate-end">
          Acting on {settings.deployRoot} · port {settings.bindPort}
        </Text>
        <Box marginTop={1}>
          <SelectInput
            items={items}
            onSelect={(item) => {
              if (item.value === 'advanced') {
                setPhase({
                  kind: 'advanced',
                  returnTo: 'choosing',
                  fields: advancedFields(settings),
                  index: 0,
                  answers: new Map(),
                });
                setValue('');
                return;
              }
              if (item.value === 'install') {
                setPhase({ kind: 'preflight' });
                return;
              }
              void start(item.value, 'fresh', new Map());
            }}
          />
        </Box>
      </Frame>
    );
  }

  if (phase.kind === 'advanced') {
    const field = phase.fields[phase.index];
    if (field === undefined) return <Frame title="Advanced"><Text>Nothing to set.</Text></Frame>;

    return (
      <FieldPrompt
        title={`Advanced — ${phase.index + 1}/${phase.fields.length}`}
        field={field}
        value={value}
        onValueChange={setValue}
        fieldError={phase.fieldError}
        onSubmit={(submitted) => {
          const result = submitField(field, submitted, phase.answers);
          if ('error' in result) {
            setPhase({ ...phase, fieldError: result.error });
            return;
          }

          setValue('');

          if (phase.index + 1 < phase.fields.length) {
            setPhase({ ...phase, index: phase.index + 1, answers: result.answers, fieldError: undefined });
            return;
          }

          setSettings((current) => settingsFromAnswers(result.answers, current));
          setPhase(phase.returnTo === 'preflight' ? { kind: 'preflight' } : { kind: 'choosing' });
        }}
      />
    );
  }

  if (phase.kind === 'preflight') {
    const offer = resumeOffer(state, installSteps);
    const installed = state !== undefined;

    // THE FIRST ITEM IS THE COMMON PATH, so the whole advanced step is one
    // Enter away from never being seen. Resume leads when there is one: a run
    // that stopped at step nine should not have to rebuild images to get back
    // to where it was.
    const items = [
      ...(offer === undefined
        ? []
        : [
            {
              key: 'resume',
              label: `Continue from “${offer.nextStepTitle}”  (skip the first ${offer.totalSteps - offer.remaining.length})`,
              value: 'resume' as const,
            },
          ]),
      {
        key: 'start',
        label: installed ? 'Start over  (reinstall from the first step)' : 'Start',
        value: 'start' as const,
      },
      {
        key: 'advanced',
        label: narrow ? 'Advanced…' : `Advanced…  (${describeSettings(settings)})`,
        value: 'advanced' as const,
      },
    ];

    return (
      <Frame title="Install" hints={['enter select', 'esc back']}>
        <Text dimColor wrap="truncate-end">Installing into {settings.deployRoot}</Text>
        {offer === undefined ? null : (
          <Text dimColor wrap="truncate-end">
            A previous run reached step {offer.totalSteps - offer.remaining.length} of{' '}
            {offer.totalSteps}.
          </Text>
        )}
        <Box marginTop={1}>
          <SelectInput
            items={items}
            onSelect={(item) => {
              if (item.value === 'advanced') {
                setPhase({
                  kind: 'advanced',
                  returnTo: 'preflight',
                  fields: advancedFields(settings),
                  index: 0,
                  answers: new Map(),
                });
                setValue('');
                return;
              }

              const mode: InstallMode =
                item.value === 'resume' ? 'resume' : installed ? 'reinstall' : 'fresh';

              setPhase({
                kind: 'collecting',
                action: 'install',
                mode,
                fields: fieldsForInstall(loadSpecs(settings.deployRoot)),
                index: 0,
                answers: new Map(),
              });
              setValue('');
            }}
          />
        </Box>
      </Frame>
    );
  }

  if (phase.kind === 'collecting') {
    const field = phase.fields[phase.index];
    if (field === undefined) {
      return <Frame title="Deploy"><Text>No questions to ask.</Text></Frame>;
    }

    return (
      <FieldPrompt
        title={`Install — ${phase.index + 1}/${phase.fields.length}`}
        field={field}
        value={value}
        onValueChange={setValue}
        fieldError={phase.fieldError}
        onSubmit={(submitted) => {
          const result = submitField(field, submitted, phase.answers);
          if ('error' in result) {
            setPhase({ ...phase, fieldError: result.error });
            return;
          }

          setValue('');

          if (phase.index + 1 < phase.fields.length) {
            setPhase({ ...phase, index: phase.index + 1, answers: result.answers, fieldError: undefined });
          } else {
            setPhase({
              kind: 'confirming',
              action: phase.action,
              mode: phase.mode,
              answers: result.answers,
            });
          }
        }}
      />
    );
  }

  if (phase.kind === 'confirming') {
    const items = [
      // "No" FIRST and selected by default: install mutates a server, and a
      // destructive action whose default is yes is one stray Enter away from
      // happening by accident.
      { key: 'no', label: 'No, go back', value: 'no' as const },
      { key: 'yes', label: `Yes, ${phase.action} now`, value: 'yes' as const },
    ];

    return (
      <Frame title="Confirm" hints={['enter select', 'esc back']}>
        <Text>
          About to {phase.action}
          {phase.mode === 'resume' ? ' (resuming)' : phase.mode === 'reinstall' ? ' (reinstall)' : ''}{' '}
          on this server:
        </Text>
        <Box marginTop={1} flexDirection="column">
          {[...phase.answers.entries()].map(([key, answer]) => (
            <Field
              key={key}
              label={answerLabel(key)}
              value={metadataFor(key).secret === true ? '********' : answer === '' ? '(default)' : answer}
            />
          ))}
          <Field label="root" value={settings.deployRoot} dim />
          <Field label="port" value={String(settings.bindPort)} dim />
        </Box>
        <Box marginTop={1}>
          <SelectInput
            items={items}
            onSelect={(item) => {
              if (item.value === 'yes') void start(phase.action, phase.mode, phase.answers);
              else setPhase({ kind: 'choosing' });
            }}
          />
        </Box>
      </Frame>
    );
  }

  if (phase.kind === 'running') {
    return (
      <Frame
        title={`${phase.action} — running`}
        // No "esc cancel": it would not cancel, and offering it would be a lie.
        hints={['ctrl-c abort']}
      >
        <Box>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text> {phase.steps.at(-1)?.title ?? 'Starting'}…</Text>
        </Box>
        {writesJournal(phase.action) ? (
          // On screen from the first frame, not only on failure: it is what an
          // operator needs when the SSH session drops mid-build.
          <Text dimColor wrap="truncate-end">
            Journal: {journalHint(settings.deployRoot, phase.action)}
          </Text>
        ) : null}
        <Box flexDirection="column" marginTop={1}>
          {phase.steps.map((step) => (
            <Text key={step.id}>
              {`  ${STEP_GLYPHS[step.outcome]} `}
              {step.title}
            </Text>
          ))}
        </Box>
        <Box marginTop={1} flexDirection="column">
          {/* Bounded viewport, following the tail. An unbounded list of Text
              would be redrawn in full on every appended line. */}
          <ScrollBox lines={phase.lines} reservedRows={18} followTail isActive={false} />
        </Box>
      </Frame>
    );
  }

  if (phase.kind === 'failed') {
    const step = failingStep(phase.steps);
    // The window shrinks with the terminal, for the reason DoctorReport gives:
    // the evidence is worth nothing if drawing it pushes the diagnosis into
    // scrollback.
    const tail = tailLines(
      phase.lines,
      Math.min(FAILURE_TAIL_LINES, Math.max(3, rows - FAILURE_CHROME_ROWS)),
    );
    // `--resume` whatever this run was: the point of the line is to continue
    // from the step that failed, and a fresh install that got eight steps in
    // has exactly as much to resume as a resumed one did.
    const command = rerunCommand(phase.action, settings, phase.answers, {
      ...(phase.action === 'install' ? { mode: 'resume' as const } : {}),
    });

    return (
      <Frame title={`${phase.action} — FAILED`} hints={['esc return to the menu']}>
        <ErrorNotice
          message={phase.message}
          // The exit code will be 0 whatever happened here, so the frame has to
          // carry the failure on its own.
          hint={`This screen exits 0 whatever happened; \`${CLI_NAME} deploy ${phase.action}\` exits non-zero.`}
        />

        {step === undefined ? null : (
          <Box marginTop={1} flexDirection="column">
            <Text color="red">
              {`  ${CHECK_GLYPHS.fail} `}
              {step.title}
            </Text>
            {step.detail === undefined ? null : (
              <Text dimColor wrap="truncate-end">{`     ${step.detail}`}</Text>
            )}
          </Box>
        )}

        {tail.length === 0 ? null : (
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>Last output:</Text>
            {tail.map((line, index) => (
              <Text key={`${index}:${line}`} dimColor wrap="truncate-end">
                {`  ${line}`}
              </Text>
            ))}
          </Box>
        )}

        <Box marginTop={1} flexDirection="column">
          <Text dimColor>Re-run from the step that failed:</Text>
          <Text wrap="truncate-end">{`  ${command}`}</Text>
        </Box>
      </Frame>
    );
  }

  return (
    <Frame title={`${phase.action} — done`} hints={['esc return to the menu']}>
      {phase.checks === undefined ? (
        <Box flexDirection="column">
          {phase.summary.map((line) => (
            <Text key={line}>{line}</Text>
          ))}
        </Box>
      ) : (
        <DoctorReport checks={phase.checks} />
      )}
    </Frame>
  );
}

const STEP_GLYPHS: Record<StepView['outcome'], string> = {
  ok: 'OK',
  failed: 'XX',
  skipped: '--',
  running: '..',
};

// -----------------------------------------------------------------------------
// Pieces
// -----------------------------------------------------------------------------

/**
 * One question: a text field, or a two-item yes/no list.
 *
 * Shared by the advanced walk and the install walk so the two cannot diverge
 * in their handling of masking, validation or the "Enter accepts the
 * placeholder" rule.
 */
function FieldPrompt({
  title,
  field,
  value,
  onValueChange,
  fieldError,
  onSubmit,
}: {
  title: string;
  field: FieldSpec;
  value: string;
  onValueChange: (value: string) => void;
  fieldError?: string | undefined;
  onSubmit: (submitted: string) => void;
}): ReactNode {
  const { narrow } = useTerminalSize();

  return (
    <Frame
      title={title}
      hints={field.kind === 'confirm' ? ['enter select', 'ctrl-c quit'] : ['enter next', 'ctrl-c quit']}
    >
      {field.help === '' ? null : (
        // One line of it: the frame is a viewport, not a manual, and the
        // template's help can run to a paragraph.
        <Text dimColor wrap={narrow ? 'truncate-end' : 'wrap'}>
          {field.help.split('\n')[0]}
        </Text>
      )}

      {field.kind === 'confirm' ? (
        <Box marginTop={1} flexDirection="column">
          <Text>{field.label}</Text>
          <SelectInput
            // The DEFAULT answer first, so one Enter is the safe answer - the
            // same rule the install confirmation follows.
            items={
              field.placeholder === ANSWER_YES
                ? [
                    { key: 'yes', label: 'Yes', value: ANSWER_YES },
                    { key: 'no', label: 'No', value: ANSWER_NO },
                  ]
                : [
                    { key: 'no', label: 'No', value: ANSWER_NO },
                    { key: 'yes', label: 'Yes', value: ANSWER_YES },
                  ]
            }
            onSelect={(item) => onSubmit(item.value)}
          />
        </Box>
      ) : (
        <Box marginTop={1}>
          <Text dimColor>{field.label}  </Text>
          <TextInput
            value={value}
            onChange={onValueChange}
            placeholder={field.placeholder}
            {...(field.secret ? { mask: '*' } : {})}
            onSubmit={onSubmit}
          />
        </Box>
      )}

      {fieldError === undefined ? null : (
        <Box marginTop={1}>
          <ErrorNotice message={fieldError} />
        </Box>
      )}
    </Frame>
  );
}

/**
 * Doctor's results, grouped worst-first with the remedies attached.
 *
 * Only the groups that need acting on are EXPANDED. There are about thirty
 * checks and a terminal is twenty-four rows, so listing them all flat means
 * the two that failed are off-screen; a pass is fully described by its count.
 */
function DoctorReport({ checks }: { checks: readonly CompletedCheck[] }): ReactNode {
  const { rows } = useTerminalSize();
  const groups = groupCheckResults(checks);

  // Each expanded entry costs up to two rows - the finding and its remedy - so
  // the budget is halved and spent WORST FIRST. A frame taller than the
  // terminal is the one thing a full-screen app must not draw: everything above
  // the height is pushed into scrollback where ink's redraw cannot reach it,
  // and the next state change leaves a copy of this one behind (scroll-box.tsx
  // makes the same argument at greater length). Never fewer than two, so a
  // failure is always visible even in a very short window.
  let budget = Math.max(2, Math.floor((rows - REPORT_CHROME_ROWS) / 2));

  return (
    <Box flexDirection="column">
      <Text bold>{checkSummaryLine(checks)}</Text>

      {groups.map((group) => {
        const expanded = group.status === 'fail' || group.status === 'warn';
        const shown = expanded ? group.results.slice(0, budget) : [];
        budget -= shown.length;
        const hidden = group.results.length - shown.length;

        return (
          <Box key={group.status} flexDirection="column" marginTop={1}>
            <Text color={group.colour} bold>
              {group.glyph} {group.label} ({group.count})
            </Text>

            {shown.map((result) => (
              <Box key={result.id} flexDirection="column">
                <Text wrap="truncate-end">
                  {`  ${group.glyph} `}
                  {result.title}: {result.detail}
                </Text>
                {result.remedy === undefined ? null : (
                  // The remedy is the useful half of a failed check, so it is
                  // beneath the failure rather than behind another command.
                  <Text dimColor wrap="truncate-end">{`     -> ${result.remedy}`}</Text>
                )}
              </Box>
            ))}

            {expanded && hidden > 0 ? (
              <Text dimColor>{`  … and ${hidden} more — run \`${CLI_NAME} deploy doctor\``}</Text>
            ) : null}

            {expanded ? null : (
              <Text dimColor wrap="truncate-end">
                {`  ${group.results.map((result) => result.id).join(', ')}`}
              </Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

// -----------------------------------------------------------------------------
// Plumbing
// -----------------------------------------------------------------------------

/** Nothing installed, an unreadable state file: both mean "no offer to make". */
function readStateSafely(deployRoot: string): DeployState | undefined {
  try {
    return readState(deployRoot);
  } catch {
    return undefined;
  }
}

function loadSpecs(deployRoot: string): EnvVarSpec[] {
  try {
    return parseEnvExample(
      readFileSync(join(deployRoot, 'repo', 'infra', 'compose', '.env.example'), 'utf8'),
    );
  } catch {
    // Before a first checkout there is no template to read; the domain
    // question alone is still enough to get started.
    return [];
  }
}

interface ActionOutcome {
  summary: string[];
  /** Doctor only. The screen groups them; nothing here can hold a secret. */
  checks?: readonly CompletedCheck[] | undefined;
}

/**
 * Runs the chosen action.
 *
 * Every branch calls the SAME function the corresponding subcommand calls.
 */
async function perform(
  action: Action,
  mode: InstallMode,
  answers: Map<string, string>,
  settings: DeploySettings,
  hooks: Parameters<typeof runInstall>[0]['hooks'],
  appendLine: (line: string) => void,
): Promise<ActionOutcome> {
  if (action === 'doctor') {
    const results: CompletedCheck[] = await runChecks(
      ALL_CHECKS,
      {
        runCommand,
        deployRoot: settings.deployRoot,
        bindPort: settings.bindPort,
        proxyRoot: settings.proxyRoot,
        proxyContainer: settings.proxyContainer,
        ...(settings.proxyMode === undefined ? {} : { proxyMode: settings.proxyMode }),
      },
      (result) => appendLine(`${CHECK_GLYPHS[result.status]} ${result.title}: ${result.detail}`),
    );

    return {
      summary: [
        checksPassed(results)
          ? 'All required checks passed.'
          : 'Required checks failed. Nothing was changed.',
      ],
      checks: results,
    };
  }

  if (action === 'status') {
    const report: HealthReport = await collectHealth({
      runCommand,
      deployRoot: settings.deployRoot,
      bindPort: settings.bindPort,
    });

    return {
      summary: [
        isHealthy(report) ? 'Healthy.' : 'NOT healthy.',
        `Containers: ${report.containers.map((container) => `${container.service}=${container.state}`).join(' ') || 'none'}`,
        `Readiness:  ${report.local.ready.ok ? 'ok' : (report.local.ready.error ?? 'failed')}`,
        `Frontend:   ${report.local.frontend.ok ? 'ok' : (report.local.frontend.error ?? 'failed')}`,
        `Migrations: ${report.migrations.known ? `${report.migrations.pending.length} pending` : 'unknown'}`,
      ],
    };
  }

  if (action === 'update') {
    const result = await runUpdate({
      deployRoot: settings.deployRoot,
      proxyContainer: settings.proxyContainer,
      ...(settings.proxyMode === undefined ? {} : { proxyMode: settings.proxyMode }),
      ...(hooks === undefined ? {} : { hooks }),
    });
    return {
      summary: result.changed
        ? [`Updated to ${result.commitSha.slice(0, 12)}.`, `Log: ${result.journalPath}`]
        : ['Already up to date.'],
    };
  }

  const domain = answers.get('__domain') ?? '';
  const email = answers.get('__email') ?? '';
  // Only the environment answers reach .env; the `__` keys are this screen's
  // own questions and are mapped onto InstallOptions below.
  const env = new Map([...answers].filter(([key]) => !key.startsWith('__')));

  const result = await runInstall({
    deployRoot: settings.deployRoot,
    bindPort: settings.bindPort,
    proxyRoot: settings.proxyRoot,
    proxyContainer: settings.proxyContainer,
    ...(settings.proxyMode === undefined ? {} : { proxyMode: settings.proxyMode }),
    domain,
    answers: env,
    // readline cannot ask a question while ink holds stdin in raw mode, so the
    // values were collected above and the wizard runs with nothing left to ask.
    // The three questions the PIPELINE would otherwise prompt for are answered
    // here for the same reason - unanswered, they abort the install.
    nonInteractive: true,
    bootstrapProxy: answeredYes(answers, '__bootstrapProxy'),
    createDatabase: answeredYes(answers, '__createDatabase'),
    skipRenewal: answeredYes(answers, '__skipRenewal'),
    ...(email === '' ? {} : { email }),
    ...(mode === 'resume' ? { resume: true } : {}),
    ...(mode === 'reinstall' ? { reinstall: true } : {}),
    ...(hooks === undefined ? {} : { hooks }),
  });

  return {
    summary: [
      `Installed ${result.commitSha.slice(0, 12)}.`,
      `Log: ${result.journalPath}`,
      '',
      result.nextStep,
    ],
  };
}

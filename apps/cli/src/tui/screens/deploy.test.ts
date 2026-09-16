import { describe, expect, it } from 'vitest';

import type { CompletedCheck } from '../../deploy/checks/index.js';
import { buildInstallSteps } from '../../deploy/install.js';
import { parseEnvExample } from '../../deploy/env-spec.js';
import type { DeployState } from '../../deploy/state.js';
import {
  ANSWER_NO,
  ANSWER_YES,
  CHECK_GLYPHS,
  DEFAULT_SETTINGS,
  advancedFields,
  answerLabel,
  answeredYes,
  checkSummaryLine,
  describeSettings,
  failingStep,
  fieldsForInstall,
  groupCheckResults,
  journalHint,
  rerunCommand,
  resumeOffer,
  settingsFromAnswers,
  tailLines,
  writesJournal,
} from './deploy.js';

// `ink-testing-library` is not a dependency (see status.test.ts), so screen
// tests assert the DATA a screen derives rather than the rendered frame.

const TEMPLATE = [
  '# ------------------------------------------------------------',
  '# Application',
  '# ------------------------------------------------------------',
  'NODE_ENV=development',
  'APP_URL=http://localhost:3535',
  'PORT=3000',
  '',
  '# ------------------------------------------------------------',
  '# Database',
  '# ------------------------------------------------------------',
  '# The database host.',
  'POSTGRES_HOST=localhost',
  'POSTGRES_USER=postgres',
  'POSTGRES_PASSWORD=postgres',
  'POSTGRES_DB=appdb',
  '',
  '# ------------------------------------------------------------',
  '# JWT / Session',
  '# ------------------------------------------------------------',
  'JWT_SECRET=your-super-secret-key-min-32-characters-long',
  '',
  '# ------------------------------------------------------------',
  '# Test Authentication',
  '# ------------------------------------------------------------',
  'TEST_AUTH_ENABLED=false',
  '',
  '# ------------------------------------------------------------',
  '# Email (Amazon SES)',
  '# ------------------------------------------------------------',
  'SES_REGION=us-east-1',
].join('\n');

const FIELDS = fieldsForInstall(parseEnvExample(TEMPLATE));
const keys = FIELDS.map((field) => field.key);

/** The questions the pipeline would ask if it could; see the screen's header. */
const PIPELINE_QUESTIONS = [
  '__email',
  '__bootstrapProxy',
  '__createDatabase',
  '__skipRenewal',
];

describe('fieldsForInstall', () => {
  it('asks for the domain first, since everything else is derived from it', () => {
    expect(keys[0]).toBe('__domain');
  });

  it('asks only for the essential keys', () => {
    expect(keys).toEqual([
      '__domain',
      'POSTGRES_HOST',
      'POSTGRES_USER',
      'POSTGRES_PASSWORD',
      'POSTGRES_DB',
      'JWT_SECRET',
      ...PIPELINE_QUESTIONS,
    ]);
  });

  it('does not ask for values that are derived from the domain', () => {
    // APP_URL restates information already given.
    expect(keys).not.toContain('APP_URL');
  });

  it('does not ask for values that are forced', () => {
    expect(keys).not.toContain('NODE_ENV');
  });

  it('never asks about test authentication', () => {
    // True in production fails startup by design.
    expect(keys).not.toContain('TEST_AUTH_ENABLED');
  });

  it('does not ask for an opt-in group', () => {
    expect(keys).not.toContain('SES_REGION');
  });

  it('marks secrets so the input is masked and the summary is not', () => {
    const secret = FIELDS.filter((field) => field.secret).map((field) => field.key);

    expect(secret).toEqual(['POSTGRES_PASSWORD', 'JWT_SECRET']);
  });

  it('carries the template comment through as help text', () => {
    expect(FIELDS.find((field) => field.key === 'POSTGRES_HOST')?.help).toBe(
      'The database host.',
    );
  });

  it('carries the validator, so a bad value is caught on the field', () => {
    const jwt = FIELDS.find((field) => field.key === 'JWT_SECRET');

    expect(jwt?.validate?.('short')).toContain('32');
    expect(jwt?.validate?.('a-perfectly-long-replacement-secret-value')).toBeUndefined();
  });

  it('rejects a domain that is not a hostname', () => {
    const domain = FIELDS[0];

    expect(domain?.validate?.('not a host')).toBeDefined();
    expect(domain?.validate?.('app.example.com')).toBeUndefined();
  });

  it('still asks the domain and the pipeline questions with no template', () => {
    // Before a first checkout there is nothing to parse, and the domain
    // question alone is enough to get started - but the pipeline's own
    // questions do not come from the template at all, so they survive.
    expect(fieldsForInstall([]).map((field) => field.key)).toEqual([
      '__domain',
      ...PIPELINE_QUESTIONS,
    ]);
  });
});

describe('fieldsForInstall — the questions the pipeline cannot ask', () => {
  const byKey = (key: string) => FIELDS.find((field) => field.key === key);

  it('asks the three prompting flags as yes/no fields', () => {
    for (const key of ['__bootstrapProxy', '__createDatabase', '__skipRenewal']) {
      expect(byKey(key)?.kind).toBe('confirm');
    }
  });

  it('defaults every confirmation to no, matching the flag it stands in for', () => {
    // `--bootstrap-proxy` binds ports 80 and 443; `--create-database` cannot
    // tell a missing database from a typo in POSTGRES_DB. Neither is a default.
    for (const key of ['__bootstrapProxy', '__createDatabase', '__skipRenewal']) {
      expect(byKey(key)?.placeholder).toBe(ANSWER_NO);
    }
  });

  it('names the flag it stands in for, so the field is traceable to the CLI', () => {
    expect(byKey('__bootstrapProxy')?.help).toContain('--bootstrap-proxy');
    expect(byKey('__createDatabase')?.help).toContain('--create-database');
    expect(byKey('__skipRenewal')?.help).toContain('--skip-renewal');
    expect(byKey('__email')?.help).toContain('--email');
  });

  it('asks for the certificate email as free text, blank meaning the admin address', () => {
    const email = byKey('__email');

    expect(email?.kind).toBe('text');
    expect(email?.placeholder).toBe('');
    expect(email?.validate?.('')).toBeUndefined();
    expect(email?.validate?.('ops@example.com')).toBeUndefined();
    expect(email?.validate?.('not-an-address')).toBeDefined();
  });

  it('never marks one of them secret, so none can reach the log or a frame masked', () => {
    expect(FIELDS.filter((field) => field.kind === 'confirm').every((f) => !f.secret)).toBe(true);
  });

  it('reads an answer back as a boolean', () => {
    const answers = new Map([
      ['__bootstrapProxy', ANSWER_YES],
      ['__createDatabase', ANSWER_NO],
    ]);

    expect(answeredYes(answers, '__bootstrapProxy')).toBe(true);
    expect(answeredYes(answers, '__createDatabase')).toBe(false);
    // Never asked at all is not yes.
    expect(answeredYes(answers, '__skipRenewal')).toBe(false);
  });

  it('labels its own keys readably rather than as camelCase', () => {
    expect(answerLabel('__bootstrapProxy')).toBe('make proxy');
    // An environment variable is already the name the operator knows.
    expect(answerLabel('POSTGRES_DB')).toBe('POSTGRES_DB');
  });
});

describe('advanced settings', () => {
  it('defaults to the same values the subcommand flags default to', () => {
    // Imported from commands/deploy.ts rather than restated here, which is the
    // whole fix: three of these used to be private constants in the screen.
    expect(DEFAULT_SETTINGS).toEqual({
      deployRoot: '/opt/infra/apps',
      proxyRoot: '/opt/infra/proxy',
      bindPort: 3535,
      proxyContainer: 'proxy-nginx',
      proxyMode: undefined,
    });
  });

  it('offers the five settings the subcommand exposes as flags', () => {
    expect(advancedFields().map((field) => field.key)).toEqual([
      '__root',
      '__proxyRoot',
      '__port',
      '__proxyContainer',
      '__proxyMode',
    ]);
  });

  it('pre-fills every field, so Enter through the lot changes nothing', () => {
    const fields = advancedFields();
    const answers = new Map(fields.map((field) => [field.key, field.placeholder]));

    expect(settingsFromAnswers(answers)).toEqual(DEFAULT_SETTINGS);
  });

  it('pre-fills from what is in effect, not from the defaults', () => {
    // Re-entering the step to change one value must not reset the other four.
    const settings = { ...DEFAULT_SETTINGS, deployRoot: '/srv/second', bindPort: 3536 };
    const fields = advancedFields(settings);

    expect(fields.find((field) => field.key === '__root')?.placeholder).toBe('/srv/second');
    expect(fields.find((field) => field.key === '__port')?.placeholder).toBe('3536');
  });

  it('lets a second application on the same box take a different port', () => {
    const settings = settingsFromAnswers(
      new Map([
        ['__root', '/opt/infra/apps/second'],
        ['__port', '3536'],
      ]),
    );

    expect(settings.deployRoot).toBe('/opt/infra/apps/second');
    expect(settings.bindPort).toBe(3536);
    // Untouched answers keep the base value rather than becoming undefined.
    expect(settings.proxyRoot).toBe(DEFAULT_SETTINGS.proxyRoot);
  });

  it('rejects a port and a root that would fail far away from this field', () => {
    const fields = advancedFields();
    const port = fields.find((field) => field.key === '__port');
    const root = fields.find((field) => field.key === '__root');

    expect(port?.validate?.('0')).toBeDefined();
    expect(port?.validate?.('70000')).toBeDefined();
    expect(port?.validate?.('not-a-port')).toBeDefined();
    expect(port?.validate?.('3536')).toBeUndefined();
    expect(root?.validate?.('relative/path')).toBeDefined();
    expect(root?.validate?.('/opt/infra/apps')).toBeUndefined();
  });

  it('treats "detect" as no --proxy-mode at all', () => {
    const fields = advancedFields();
    const mode = fields.find((field) => field.key === '__proxyMode');

    expect(mode?.placeholder).toBe('detect');
    expect(mode?.validate?.('detect')).toBeUndefined();
    expect(mode?.validate?.('contianer')).toBeDefined();
    expect(settingsFromAnswers(new Map([['__proxyMode', 'detect']])).proxyMode).toBeUndefined();
    expect(settingsFromAnswers(new Map([['__proxyMode', 'host']])).proxyMode).toBe('host');
  });

  it('never produces a NaN port from an unusable answer', () => {
    // A bind port of NaN would reach runInstall and fail nowhere near here.
    expect(settingsFromAnswers(new Map([['__port', 'banana']])).bindPort).toBe(3535);
  });

  it('describes itself for the menu line', () => {
    expect(describeSettings(DEFAULT_SETTINGS)).toContain('/opt/infra/apps');
    expect(describeSettings(DEFAULT_SETTINGS)).toContain('3535');
  });
});

// -----------------------------------------------------------------------------
// Doctor results
// -----------------------------------------------------------------------------

function check(
  id: string,
  status: CompletedCheck['status'],
  extra?: Partial<CompletedCheck>,
): CompletedCheck {
  return {
    id,
    title: id,
    severity: 'required',
    status,
    detail: `${id} detail`,
    durationMs: 1,
    ...extra,
  };
}

describe('groupCheckResults', () => {
  const results = [
    check('docker', 'pass'),
    check('proxy-root', 'fail', { remedy: 'mkdir -p /opt/infra/proxy' }),
    check('memory', 'warn', { remedy: 'add swap' }),
    check('database-exists', 'skip'),
    check('certbot', 'fail', { remedy: 'apt-get install certbot' }),
    check('disk', 'pass'),
  ];

  it('puts the failures first and the passes last', () => {
    // Thirty checks and twenty-four rows: the order decides what a short
    // terminal shows at all.
    expect(groupCheckResults(results).map((group) => group.status)).toEqual([
      'fail',
      'warn',
      'pass',
      'skip',
    ]);
  });

  it('counts each group', () => {
    const byStatus = new Map(groupCheckResults(results).map((g) => [g.status, g.count]));

    expect(byStatus.get('fail')).toBe(2);
    expect(byStatus.get('warn')).toBe(1);
    expect(byStatus.get('pass')).toBe(2);
    expect(byStatus.get('skip')).toBe(1);
  });

  it('keeps registry order inside a group', () => {
    const failed = groupCheckResults(results)[0];

    expect(failed?.results.map((result) => result.id)).toEqual(['proxy-root', 'certbot']);
  });

  it('keeps the remedy, which is the useful half of a failed check', () => {
    const failed = groupCheckResults(results)[0];

    expect(failed?.results.map((result) => result.remedy)).toEqual([
      'mkdir -p /opt/infra/proxy',
      'apt-get install certbot',
    ]);
  });

  it('drops empty groups rather than rendering a heading with nothing under it', () => {
    const groups = groupCheckResults([check('docker', 'pass')]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.status).toBe('pass');
  });

  it('carries a glyph as well as a colour, because a terminal may be monochrome', () => {
    for (const group of groupCheckResults(results)) {
      expect(group.glyph).toBe(CHECK_GLYPHS[group.status]);
      expect(group.glyph).not.toBe('');
      expect(group.colour).not.toBe('');
    }
  });

  it('uses the same marks the subcommand prints', () => {
    expect(CHECK_GLYPHS).toEqual({ pass: 'OK', warn: '!!', fail: 'XX', skip: '--' });
  });

  it('is total: no results is no groups', () => {
    expect(groupCheckResults([])).toEqual([]);
  });

  it('summarises the counts on one line, worst first', () => {
    expect(checkSummaryLine(results)).toBe('2 failed, 1 warning, 2 passed, 1 skipped');
  });

  it('says only what there is to say', () => {
    expect(checkSummaryLine([check('docker', 'pass')])).toBe('1 passed');
  });
});

// -----------------------------------------------------------------------------
// Resume
// -----------------------------------------------------------------------------

const STEPS = [
  { id: 'preflight', title: 'Check prerequisites' },
  { id: 'checkout', title: 'Fetch the application' },
  { id: 'build', title: 'Build images' },
];

function stateWith(completedSteps?: string[]): DeployState {
  return {
    version: 2,
    repoUrl: 'https://example.test/app.git',
    ref: 'main',
    commitSha: 'abcdef0123456789',
    bindPort: 3535,
    deployRoot: '/opt/infra/apps',
    installedAt: '2026-01-01T00:00:00.000Z',
    lastDeployedAt: '2026-01-01T00:00:00.000Z',
    lastCommand: 'install',
    appctlVersion: '1.0.0',
    ...(completedSteps === undefined ? {} : { completedSteps }),
  };
}

describe('resumeOffer', () => {
  it('offers nothing when nothing is installed', () => {
    expect(resumeOffer(undefined, STEPS)).toBeUndefined();
  });

  it('offers nothing when the state file records no completed steps', () => {
    expect(resumeOffer(stateWith(), STEPS)).toBeUndefined();
    expect(resumeOffer(stateWith([]), STEPS)).toBeUndefined();
  });

  it('names the step the run would continue from', () => {
    const offer = resumeOffer(stateWith(['preflight', 'checkout']), STEPS);

    expect(offer?.nextStepId).toBe('build');
    expect(offer?.nextStepTitle).toBe('Build images');
  });

  it('reports what is done and what is left, in pipeline order', () => {
    const offer = resumeOffer(stateWith(['preflight']), STEPS);

    expect(offer?.completed).toEqual(['preflight']);
    expect(offer?.remaining).toEqual(['checkout', 'build']);
    expect(offer?.totalSteps).toBe(3);
  });

  it('offers nothing once every step is done', () => {
    expect(resumeOffer(stateWith(['preflight', 'checkout', 'build']), STEPS)).toBeUndefined();
  });

  it('offers nothing when a SKIPPED step is the only one missing', () => {
    // `runPipeline` records an id only when the step ran, so a successful
    // install whose database already existed never records `ensure-database`.
    // Reading that absence as "pending" would offer to resume a deployment
    // that finished - the one thing this offer must never say.
    expect(resumeOffer(stateWith(['preflight', 'build']), STEPS)).toBeUndefined();
  });

  it('resumes from past the FURTHEST step reached, not from the first gap', () => {
    const steps = [...STEPS, { id: 'verify', title: 'Verify the deployment' }];
    // `checkout` was skipped; the run got as far as `build` and stopped.
    const offer = resumeOffer(stateWith(['preflight', 'build']), steps);

    expect(offer?.nextStepId).toBe('verify');
    expect(offer?.remaining).toEqual(['verify']);
    expect(offer?.completed).toEqual(['preflight', 'build']);
  });

  it('ignores a recorded step that is no longer in the pipeline', () => {
    const offer = resumeOffer(stateWith(['preflight', 'retired-step']), STEPS);

    expect(offer?.nextStepId).toBe('checkout');
  });

  it('offers nothing when no recorded step is in this pipeline at all', () => {
    // A state file written by `update`, whose pipeline has ids of its own.
    // Resuming from step one is starting over, and saying otherwise is a lie.
    expect(resumeOffer(stateWith(['restart', 'environment-drift']), STEPS)).toBeUndefined();
  });

  it('reads the real install pipeline by default, not a second copy of it', () => {
    const offer = resumeOffer(stateWith(['preflight']));

    expect(offer?.nextStepId).toBe('checkout');
    expect(offer?.remaining.length).toBeGreaterThan(5);
    expect(offer?.totalSteps).toBe(offer!.completed.length + offer!.remaining.length);
  });

  it('makes no offer after a real install that ran to the end', () => {
    // The live pipeline, minus the two steps a well-prepared box skips.
    const ids = buildInstallSteps()
      .map((step) => step.id)
      .filter((id) => id !== 'ensure-database' && id !== 'proxy-bootstrap');

    expect(resumeOffer(stateWith(ids))).toBeUndefined();
  });
});

// -----------------------------------------------------------------------------
// Failure
// -----------------------------------------------------------------------------

describe('failingStep', () => {
  it('finds the step that failed', () => {
    const step = failingStep([
      { id: 'preflight', title: 'Check prerequisites', outcome: 'ok' },
      { id: 'build', title: 'Build images', outcome: 'failed', detail: 'exit 1' },
    ]);

    expect(step?.id).toBe('build');
    expect(step?.detail).toBe('exit 1');
  });

  it('falls back to whatever was still running', () => {
    // A throw from outside the pipeline never produces a failed result at all.
    const step = failingStep([
      { id: 'preflight', title: 'Check prerequisites', outcome: 'ok' },
      { id: 'build', title: 'Build images', outcome: 'running' },
    ]);

    expect(step?.id).toBe('build');
  });

  it('has no answer when the run never started a step', () => {
    expect(failingStep([])).toBeUndefined();
  });
});

describe('tailLines', () => {
  it('keeps the END of the log, which is where the error is', () => {
    expect(tailLines(['a', 'b', 'c', 'd'], 2)).toEqual(['c', 'd']);
  });

  it('is total for a log shorter than the window', () => {
    expect(tailLines(['a'], 12)).toEqual(['a']);
    expect(tailLines([], 12)).toEqual([]);
  });
});

describe('rerunCommand', () => {
  it('omits flags that are already the default', () => {
    expect(rerunCommand('doctor')).toBe('appctl deploy doctor');
  });

  it('names the deploy root and port when they are not the defaults', () => {
    const settings = { ...DEFAULT_SETTINGS, deployRoot: '/srv/second', bindPort: 3536 };

    expect(rerunCommand('install', settings)).toBe(
      'appctl deploy install --root /srv/second --port 3536',
    );
  });

  it('includes --resume so the re-run continues from the step that failed', () => {
    expect(
      rerunCommand('install', DEFAULT_SETTINGS, new Map([['__domain', 'app.example.com']]), {
        mode: 'resume',
      }),
    ).toBe('appctl deploy install --domain app.example.com --resume');
  });

  it('includes --reinstall instead when that is what was run', () => {
    expect(rerunCommand('install', DEFAULT_SETTINGS, new Map(), { mode: 'reinstall' })).toBe(
      'appctl deploy install --reinstall',
    );
  });

  it('repeats the questions the operator answered yes to', () => {
    const answers = new Map([
      ['__domain', 'app.example.com'],
      ['__email', 'ops@example.com'],
      ['__bootstrapProxy', ANSWER_YES],
      ['__createDatabase', ANSWER_NO],
      ['__skipRenewal', ANSWER_YES],
    ]);

    expect(rerunCommand('install', DEFAULT_SETTINGS, answers)).toBe(
      'appctl deploy install --domain app.example.com --email ops@example.com --bootstrap-proxy --skip-renewal',
    );
  });

  it('NEVER puts an environment answer on the command line', () => {
    // The line exists to be copied, pasted, and pasted again into a bug
    // report. Only the screen's own `__` questions are ever read.
    const answers = new Map([
      ['__domain', 'app.example.com'],
      ['POSTGRES_PASSWORD', 'hunter2-the-real-one'],
      ['JWT_SECRET', 'a-perfectly-long-replacement-secret-value'],
    ]);

    const command = rerunCommand('install', DEFAULT_SETTINGS, answers);

    expect(command).not.toContain('hunter2');
    expect(command).not.toContain('a-perfectly-long-replacement-secret-value');
    expect(command).not.toContain('POSTGRES_PASSWORD');
  });

  it('never names a flag the subcommand does not accept', () => {
    // `update` has no --port, no --proxy-root and no --domain; a re-run line
    // that names one fails with a usage error that reads like the
    // deployment's fault.
    const settings = { ...DEFAULT_SETTINGS, bindPort: 3536, proxyRoot: '/srv/proxy' };
    const command = rerunCommand('update', settings, new Map([['__domain', 'app.example.com']]));

    expect(command).toBe('appctl deploy update');
  });

  it('gives status only the flags status has', () => {
    const settings = { ...DEFAULT_SETTINGS, bindPort: 3536, proxyContainer: 'other-nginx' };

    expect(rerunCommand('status', settings, new Map([['__domain', 'app.example.com']]))).toBe(
      'appctl deploy status --port 3536 --domain app.example.com',
    );
  });

  it('states the proxy mode only when the operator stated it', () => {
    expect(rerunCommand('doctor', { ...DEFAULT_SETTINGS, proxyMode: 'host' })).toBe(
      'appctl deploy doctor --proxy-mode host',
    );
  });
});

describe('journalHint', () => {
  it('points at this run\'s log directory and pattern', () => {
    // A glob, not a path: openJournal picks the timestamp inside runInstall
    // and DeployHooks has no member that could carry it back out.
    expect(journalHint('/opt/infra/apps', 'install')).toBe(
      '/opt/infra/apps/logs/appctl-install-*.log',
    );
  });

  it('is offered only for the two actions that open a journal', () => {
    expect(writesJournal('install')).toBe(true);
    expect(writesJournal('update')).toBe(true);
    // Doctor and status change nothing and write nothing.
    expect(writesJournal('doctor')).toBe(false);
    expect(writesJournal('status')).toBe(false);
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Command } from 'commander';

import { CLI_NAME } from '../branding.js';
import {
  ALL_CHECKS,
  checksPassed,
  runChecks,
  summarise,
  type CheckContext,
  type CheckStatus,
  type CompletedCheck,
} from '../deploy/checks/index.js';
import { parseEnvFile } from '../deploy/env-spec.js';
import { runCommand } from '../deploy/executor.js';
import { PreconditionError } from '../errors.js';
import { shouldUseColour } from '../output.js';

// =============================================================================
// `appctl deploy`  (issue #178, epic #168)
// =============================================================================
//
// The first user-facing surface of the deployment work, and the place the
// command GROUP is established - so the shape chosen here is the one every
// later subcommand follows.
//
// Two rules inherited from program.ts, neither negotiable here:
//
//   - HUMAN OUTPUT GOES TO STDERR. stdout carries `--json` and nothing else,
//     so `appctl deploy doctor --json | jq` is clean.
//   - FAILURE IS NON-ZERO. A doctor that prints failures and exits 0 makes
//     `doctor || provision-the-box` silently useless.
// =============================================================================

export const DEFAULT_DEPLOY_ROOT = '/opt/infra/apps';
export const DEFAULT_PROXY_ROOT = '/opt/infra/proxy';
export const DEFAULT_BIND_PORT = 3535;

const ESC = String.fromCharCode(27);
const RESET = ESC + '[0m';

export interface DoctorCommandOptions {
  root: string;
  proxyRoot: string;
  port: string;
  domain?: string | undefined;
  json?: boolean | undefined;
  color: boolean;
}

export interface DeployContext {
  /** Injected so tests drive the checks without a server. */
  checks?: readonly import('../deploy/checks/index.js').Check[] | undefined;
  runCommand?: typeof runCommand | undefined;
  stdout?: { write(chunk: string): unknown } | undefined;
  stderr?: { write(chunk: string): unknown } | undefined;
  isTty?: boolean | undefined;
}

export function registerDeployCommand(
  program: Command,
  ctx?: DeployContext,
): Command {
  const deploy = program
    .command('deploy')
    .description('Check, install and update this application on a server');

  deploy
    .command('doctor')
    .description('Check that this server meets the prerequisites')
    .option('--root <path>', 'Deployment directory', DEFAULT_DEPLOY_ROOT)
    .option('--proxy-root <path>', 'Shared reverse proxy directory', DEFAULT_PROXY_ROOT)
    .option('--port <port>', 'Loopback port the proxy forwards to', String(DEFAULT_BIND_PORT))
    .option('--domain <domain>', 'Public domain; enables the DNS and TLS checks')
    .option('--json', 'Print a machine-readable report on stdout')
    .option('--no-color', 'Disable colour even on a terminal')
    .addHelpText(
      'after',
      [
        '',
        'Examples:',
        `  ${CLI_NAME} deploy doctor`,
        `  ${CLI_NAME} deploy doctor --domain app.example.com`,
        `  ${CLI_NAME} deploy doctor --json | jq '.checks[] | select(.status=="fail")'`,
        '',
        'Exit codes:',
        '  0  every required check passed (warnings do not fail the run)',
        '  6  a required check failed; nothing was changed',
        '',
        'Nothing is installed, written or started. It is safe to run at any time.',
      ].join('\n'),
    )
    .action(async (options: DoctorCommandOptions) => {
      await runDoctorCommand(options, ctx);
    });

  return deploy;
}

/** Display-safe by construction: no field can hold a secret. */
export interface DoctorReport {
  ok: boolean;
  checks: Array<{
    id: string;
    title: string;
    severity: 'required' | 'recommended';
    status: CheckStatus;
    detail: string;
    remedy?: string;
    durationMs: number;
  }>;
  summary: ReturnType<typeof summarise>;
}

export async function runDoctorCommand(
  options: DoctorCommandOptions,
  ctx?: DeployContext,
): Promise<void> {
  const stdout = ctx?.stdout ?? process.stdout;
  const stderr = ctx?.stderr ?? process.stderr;
  const checks = ctx?.checks ?? ALL_CHECKS;
  const json = options.json === true;

  const context: CheckContext = {
    runCommand: ctx?.runCommand ?? runCommand,
    deployRoot: options.root,
    proxyRoot: options.proxyRoot,
    bindPort: Number(options.port),
    ...(options.domain === undefined ? {} : { domain: options.domain }),
    ...(readEnvironment(options.root) ?? {}),
  };

  // Under --json nothing is written until the end: a partial checklist on
  // stderr is useless to a machine, and colour is never consulted at all so
  // no FORCE_COLOR can inject escapes into the pipe.
  const colour =
    !json &&
    shouldUseColour({
      // `--no-color` arrives as `color: false`, matching commander's handling
      // of a `--no-` flag; `requested` is undefined when the user said nothing.
      requested: options.color === false ? false : undefined,
      env: process.env,
      isTTY: ctx?.isTty ?? process.stderr.isTTY === true,
    });

  if (!json) stderr.write('\n  Prerequisites\n\n');

  const results = await runChecks(checks, context, (result) => {
    // Streamed as each completes: a dozen subprocess probes take long enough
    // that a silent terminal looks like a hang.
    if (!json) stderr.write(renderResult(result, colour));
  });

  const report = buildReport(results);

  if (json) {
    stdout.write(`${JSON.stringify(report)}\n`);
  } else {
    stderr.write(renderSummary(report.summary, colour));
  }

  if (!report.ok) {
    const failed = results.filter(
      (result) => result.severity === 'required' && result.status === 'fail',
    );
    throw new PreconditionError(
      `${failed.length} required check(s) failed: ${failed.map((result) => result.id).join(', ')}`,
    );
  }
}

/** Reads the deployment's .env, when there is one, for the database checks. */
function readEnvironment(deployRoot: string): { env: Map<string, string> } | undefined {
  try {
    const contents = readFileSync(
      join(deployRoot, 'repo', 'infra', 'compose', '.env'),
      'utf8',
    );
    return { env: parseEnvFile(contents) };
  } catch {
    // Absent before a first install; the database checks then report `skip`.
    return undefined;
  }
}

export function buildReport(results: readonly CompletedCheck[]): DoctorReport {
  return {
    ok: checksPassed(results),
    checks: results.map((result) => ({
      id: result.id,
      title: result.title,
      severity: result.severity,
      status: result.status,
      detail: result.detail,
      ...(result.remedy === undefined ? {} : { remedy: result.remedy }),
      durationMs: result.durationMs,
    })),
    summary: summarise(results),
  };
}

const MARKS: Record<CheckStatus, string> = {
  pass: 'OK',
  warn: '!!',
  fail: 'XX',
  skip: '--',
};

const COLOURS: Record<CheckStatus, string> = {
  pass: '32',
  warn: '33',
  fail: '31',
  skip: '90',
};

const TITLE_WIDTH = 30;

/** One check, rendered. Exported for its test. */
export function renderResult(result: CompletedCheck, colour: boolean): string {
  // A GLYPH as well as a colour. These are read over SSH, piped into files,
  // and by people who cannot distinguish red from green; colour alone would
  // make the status invisible to all three.
  const mark = MARKS[result.status];
  const painted = colour ? `${ESC}[${COLOURS[result.status]}m${mark}${RESET}` : mark;

  const lines = [`  ${painted} ${result.title.padEnd(TITLE_WIDTH)}${result.detail}\n`];

  if (result.remedy !== undefined && (result.status === 'fail' || result.status === 'warn')) {
    // The arrow marks the remedy once; continuation lines are indented to
    // line up under it, so a wrapped sentence reads as one sentence rather
    // than as several separate instructions.
    wrap(result.remedy, 66).forEach((line, index) => {
      lines.push(`       ${index === 0 ? '->' : '  '} ${line}\n`);
    });
  }

  return lines.join('');
}

export function renderSummary(
  summary: ReturnType<typeof summarise>,
  colour: boolean,
): string {
  const parts = [`${summary.passed} passed`];
  if (summary.warned > 0) parts.unshift(`${summary.warned} warning(s)`);
  if (summary.failed > 0) parts.unshift(`${summary.failed} failed`);
  if (summary.skipped > 0) parts.push(`${summary.skipped} skipped`);

  const line = parts.join(', ');
  const painted =
    colour && summary.failed > 0 ? `${ESC}[31m${line}${RESET}` : line;

  return `\n  ${painted}\n\n`;
}

/** Wraps a remedy so it stays readable in an 80-column SSH session. */
function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (current === '') {
      current = word;
    } else if (`${current} ${word}`.length <= width) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== '') lines.push(current);

  return lines;
}

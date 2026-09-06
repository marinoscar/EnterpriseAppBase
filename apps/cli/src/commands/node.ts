import type { Command } from 'commander';

import { CLI_NAME } from '../branding.js';
import { UsageError } from '../errors.js';
import { enrollNode, registerNode } from '../node/enrollment.js';
import { HttpNodeApi } from '../node/node-api.js';
import {
  parseEligibleTypes,
  resolveNodeConfig,
  type NodeConfig,
} from '../node/node-config.js';
import { WORKER_ENV } from '../node/worker-env.js';
import { resolveConfig } from '../config.js';

// =============================================================================
// `appctl node` — the worker-node command group  (issue #272, epic #254)
// =============================================================================
//
// This file establishes the GROUP; the subcommands arrive with the issues that
// own them (#273 register/enroll, #275 start/stop/status/logs/set-concurrency,
// #276 doctor/install-deps/service, #277 heap-snapshot). Registering the group
// here, in its own module, is what lets each of those be a purely additive
// change to one file rather than a widening edit to `program.ts`.
//
// Inherited from `program.ts` and not negotiable in any subcommand added here:
//
//   - HUMAN OUTPUT GOES TO STDERR. stdout carries `--json` and nothing else.
//   - FAILURE IS NON-ZERO, ALWAYS.
// =============================================================================

/**
 * Injection seam shared by every `node` subcommand.
 *
 * Deliberately the same shape as `DeployContext`: streams, a fetch, and the
 * odd engine override. Tests drive the commands through this rather than
 * mutating `process.env` or writing to a real home directory.
 */
export interface NodeCommandContext {
  stdout?: { write(chunk: string): unknown } | undefined;
  stderr?: { write(chunk: string): unknown } | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  home?: string | undefined;
  fetch?: typeof globalThis.fetch | undefined;
}

export function registerNodeCommand(program: Command, ctx?: NodeCommandContext): Command {
  const node = program
    .command('node')
    .description('Run this machine as a worker node for the application’s job queue');

  node
    .command('config')
    .description('Show the worker settings this machine would start with')
    .option('--json', 'Emit the resolved settings as JSON on stdout')
    .action((options: { json?: boolean }) => {
      const stdout = ctx?.stdout ?? process.stdout;
      const stderr = ctx?.stderr ?? process.stderr;

      const resolved = resolveNodeConfig(contextOf(ctx));

      if (options.json === true) {
        // The token is NEVER in this output. `resolveNodeConfig` returns it
        // because the engine needs it; a display path that forwarded it would
        // put a `nod_` credential into anybody's terminal scrollback and CI
        // log. Fields are listed explicitly rather than spread for exactly
        // that reason — a spread would leak a future secret automatically.
        stdout.write(
          `${JSON.stringify(
            {
              serverUrl: resolved.serverUrl,
              nodeId: resolved.nodeId ?? null,
              name: resolved.node.name,
              concurrency: resolved.node.concurrency,
              eligibleTypes: resolved.node.eligibleTypes,
              pollIntervalMs: resolved.node.pollIntervalMs,
              headless: resolved.headless,
              stateDir: resolved.stateDir,
              synthesised: resolved.synthesised,
            },
            null,
            2,
          )}\n`,
        );
        return;
      }

      const lines = [
        `Server        ${resolved.serverUrl} (${resolved.serverUrlSource})`,
        `Node          ${resolved.nodeId ?? `not registered — run \`${CLI_NAME} node register\``}`,
        `Name          ${resolved.node.name}`,
        `Concurrency   ${resolved.node.concurrency}`,
        `Types         ${
          resolved.node.eligibleTypes.length > 0 ? resolved.node.eligibleTypes.join(', ') : '(all node-eligible types)'
        }`,
        `Poll interval ${resolved.node.pollIntervalMs} ms`,
        `Headless      ${resolved.headless ? 'yes' : 'no'}`,
        `State dir     ${resolved.stateDir}`,
      ];

      if (resolved.synthesised) {
        lines.push('', `No config file — these settings came from ${WORKER_ENV.serverUrl}/${WORKER_ENV.token}.`);
      }

      stderr.write(`${lines.join('\n')}\n`);
    });

  node
    .command('enroll')
    .description('Log in and mint a node credential for this machine, in one step')
    .option('-s, --server <url>', 'Server URL, when this machine has no stored one')
    .option('-n, --name <name>', 'Name for the credential in the web UI')
    .option('--expires-in-days <days>', 'Expire the credential after N days (default: never)')
    .option('--no-browser', 'Do not try to open a browser; print the URL instead')
    .option(
      '--show-token',
      'Print the credential. Only needed to provision ANOTHER machine — it is already stored here',
    )
    .action(async (options: EnrollCommandOptions) => {
      const stdout = ctx?.stdout ?? process.stdout;
      const stderr = ctx?.stderr ?? process.stderr;
      const configContext = contextOf(ctx);

      const serverUrl = options.server ?? resolveConfig(configContext).serverUrl;
      if (serverUrl === undefined) {
        throw new UsageError(
          `No server URL. Pass --server, or set ${WORKER_ENV.serverUrl}.`,
        );
      }

      const result = await enrollNode({
        serverUrl,
        ...(options.name !== undefined ? { credentialName: options.name } : {}),
        ...(options.expiresInDays !== undefined
          ? { expiresInDays: parsePositiveInteger('--expires-in-days', options.expiresInDays) }
          : {}),
        openBrowser: options.browser !== false,
        configContext,
        hooks: {
          onCodeIssued: (grant) => {
            stderr.write(
              `\nTo authorise this machine, open:\n  ${grant.verificationUriComplete}\n` +
                `and confirm the code:  ${grant.userCode}\n\n`,
            );
          },
        },
      });

      stderr.write(
        `Enrolled. Credential "${result.credentialName}" (${result.tokenPrefix}…) stored in ${result.configPath}.\n` +
          `Expiry: ${result.expiresAt ?? 'never'}\n` +
          `Next:   ${CLI_NAME} node register\n`,
      );

      // stdout ONLY when explicitly asked for, so the secret is pipeable to a
      // provisioning script and absent from every other invocation's output.
      if (options.showToken === true) stdout.write(`${result.token}\n`);
    });

  node
    .command('register')
    .description('Register (or re-attach) this machine as a worker node')
    .option('-n, --name <name>', 'Node name. Reattachment keys on it; defaults to the hostname')
    .option('-c, --concurrency <n>', 'How many jobs to run at once')
    .option('-t, --types <csv>', 'Comma-separated job types to claim (default: all node-eligible)')
    .option('--json', 'Emit the registered node as JSON on stdout')
    .action(async (options: RegisterCommandOptions) => {
      const stdout = ctx?.stdout ?? process.stdout;
      const stderr = ctx?.stderr ?? process.stderr;
      const configContext = contextOf(ctx);

      const resolved = resolveNodeConfig(configContext);

      // Flags win over both the file and the environment: a flag is the most
      // explicit thing a user can say, and it is the thing they will re-run.
      const node: NodeConfig = {
        name: options.name ?? resolved.node.name,
        concurrency:
          options.concurrency !== undefined
            ? parsePositiveInteger('--concurrency', options.concurrency)
            : resolved.node.concurrency,
        eligibleTypes:
          options.types !== undefined ? parseEligibleTypes(options.types) : resolved.node.eligibleTypes,
        pollIntervalMs: resolved.node.pollIntervalMs,
      };

      const api = HttpNodeApi.create(resolved.serverUrl, resolved.token, {
        ...(ctx?.fetch !== undefined ? { fetch: ctx.fetch } : {}),
      });

      const result = await registerNode({ api, node, configContext });

      if (options.json === true) {
        stdout.write(`${JSON.stringify({ ...result.node, reattached: result.reattached }, null, 2)}\n`);
        return;
      }

      stderr.write(
        `${result.reattached ? 'Reattached to' : 'Registered'} node "${result.node.name}" (${result.node.id}).\n` +
          `Concurrency ${result.node.concurrency}; types ${
            result.node.eligibleTypes.length > 0 ? result.node.eligibleTypes.join(', ') : '(all node-eligible)'
          }.\n`,
      );
    });

  return node;
}

interface EnrollCommandOptions {
  server?: string;
  name?: string;
  expiresInDays?: string;
  browser?: boolean;
  showToken?: boolean;
}

interface RegisterCommandOptions {
  name?: string;
  concurrency?: string;
  types?: string;
  json?: boolean;
}

/** Commander hands every option through as a string. Reject a non-number here. */
function parsePositiveInteger(flag: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new UsageError(`${flag} must be a whole number of at least 1 (got ${JSON.stringify(raw)}).`);
  }
  return value;
}

/** Narrow the command context to the config seam, dropping undefined keys. */
function contextOf(ctx: NodeCommandContext | undefined): { env?: NodeJS.ProcessEnv; home?: string } {
  return {
    ...(ctx?.env !== undefined ? { env: ctx.env } : {}),
    ...(ctx?.home !== undefined ? { home: ctx.home } : {}),
  };
}

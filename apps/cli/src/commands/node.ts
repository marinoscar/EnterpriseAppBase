import type { Command } from 'commander';

import { CLI_NAME } from '../branding.js';
import { resolveNodeConfig } from '../node/node-config.js';
import { WORKER_ENV } from '../node/worker-env.js';

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

      const resolved = resolveNodeConfig({
        ...(ctx?.env !== undefined ? { env: ctx.env } : {}),
        ...(ctx?.home !== undefined ? { home: ctx.home } : {}),
      });

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

  return node;
}

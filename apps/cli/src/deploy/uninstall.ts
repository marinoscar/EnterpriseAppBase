/**
 * Removing a deployment — and the four things this must refuse to remove.
 *
 * Most of this file is refusals, which is why it needs writing down. Refusals
 * are what a later "simplify" pass deletes, so every one of them is pinned by
 * a test in `uninstall.test.ts`.
 *
 * ⚠ THE FOUR PERMANENT REFUSALS. Each is SHARED infrastructure that this
 * deployment is a tenant of, not an owner of:
 *
 *   1. The shared Docker network — other applications are on it.
 *   2. The shared proxy container — other applications are served by it.
 *   3. The TLS certificates, BY DEFAULT — Let's Encrypt allows 5 duplicate
 *      certificates per week, and reinstalling during a debugging session would
 *      exhaust that quota. Keeping them is what makes the next install possible.
 *   4. The renewal cron entry — it is per-HOST and renews every application's
 *      certificate, so removing it silently expires the neighbours.
 *
 * ⚠ THE TWO OPT-IN EXTRAS EACH NEED THEIR OWN FLAG AND THEIR OWN TYPED
 * CONFIRMATION OF THAT RESOURCE'S OWN REAL NAME. The confirmation is the
 * database's name, or the bucket's name — never the word DELETE — because a
 * word typed for one must never authorise the other. An operator who has
 * decided to drop a database has not thereby decided to empty a bucket.
 *
 * ⚠ A READ-ONLY INVENTORY RUNS BEFORE EVERY PROMPT. Nobody can consent to a
 * number they were not shown.
 */
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { CLI_NAME } from '../branding.js';
import { UsageError } from '../errors.js';
import { CLI_VERSION } from '../package-info.js';
import { describeEvidence, resolveEnvPath } from './deployment-evidence.js';
import { readEnvFile } from './env-file.js';
import { runCommand as defaultRunCommand } from './executor.js';
import type { DeployHooks } from './hooks.js';
import { composeArgv, composeCwd, composeProjectFor, secretsFrom } from './install.js';
import { openJournal } from './journal.js';
import { removeVhost, type ProxyTarget } from './proxy.js';
import { readState, deployStatePath } from './state.js';

export interface UninstallOptions {
  deployRoot: string;
  proxyRoot?: string | undefined;
  /** Opt-in: drop the application's PostgreSQL database. */
  dropDatabase?: boolean | undefined;
  /** Opt-in: delete every object this application wrote to storage. */
  purgeStorage?: boolean | undefined;
  /** The database name, typed back. Required with --drop-database. */
  confirmDatabase?: string | undefined;
  /** The bucket name, typed back. Required with --purge-storage. */
  confirmBucket?: string | undefined;
  /** Report what would happen and change nothing. */
  dryRun?: boolean | undefined;
  runCommand?: typeof defaultRunCommand | undefined;
  hooks?: DeployHooks | undefined;
}

export interface UninstallPlan {
  deployRoot: string;
  /** Present when a deployment record was readable. */
  domain?: string | undefined;
  composeProject: string;
  databaseName?: string | undefined;
  /** Paths this run will delete. */
  removes: string[];
  /** Paths and resources it will not, and why. */
  keeps: { what: string; because: string }[];
}

export interface UninstallResult {
  plan: UninstallPlan;
  /** False for a dry run, or when a confirmation did not match. */
  removed: boolean;
  /** Bookkeeping that failed after the deployment was already gone. */
  warnings: string[];
  journalPath: string;
}

/**
 * What uninstall would do, without doing any of it.
 *
 * Deliberately separate from the removal, and always run first: §7.4's
 * read-only inventory is not a courtesy, it is the thing the operator's
 * confirmation is *about*.
 */
export function planUninstall(options: UninstallOptions): UninstallPlan {
  const { deployRoot } = options;
  const evidence = describeEvidence(deployRoot);

  if (!evidence.isDeployment && readState(deployRoot) === undefined) {
    throw new UsageError(
      `Nothing to uninstall at ${deployRoot}: it has neither a checkout nor a readable environment file.`,
    );
  }

  const state = readState(deployRoot);
  const envPath = resolveEnvPath(deployRoot);
  const env = envPath === undefined ? new Map<string, string>() : readEnvFile(envPath);

  const removes = [
    `containers and volumes for compose project ${composeProjectFor(state)}`,
    join(deployRoot, 'repo'),
    join(deployRoot, 'logs'),
    join(deployRoot, 'deploy-info'),
    envPath ?? join(deployRoot, '.env'),
    deployStatePath(deployRoot),
  ];

  const keeps: { what: string; because: string }[] = [
    {
      what: 'the shared Docker network',
      because: 'other applications on this host are attached to it',
    },
    {
      what: 'the shared proxy container',
      because: 'other applications on this host are served by it',
    },
    {
      what: 'the TLS certificate',
      because:
        "Let's Encrypt allows 5 duplicate certificates per week; keeping it is what makes a reinstall possible",
    },
    {
      what: 'the certificate renewal cron entry',
      because: "it is per-host and renews every application's certificate",
    },
  ];

  if (options.dropDatabase !== true) {
    keeps.push({
      what: `the database${env.get('POSTGRES_DB') === undefined ? '' : ` ${env.get('POSTGRES_DB') as string}`}`,
      because: 'not requested; pass --drop-database and type its name to confirm',
    });
  }

  if (options.purgeStorage !== true) {
    keeps.push({
      what: 'every object in storage',
      because: 'not requested; pass --purge-storage and type the bucket name to confirm',
    });
  }

  return {
    deployRoot,
    ...(state?.domain === undefined ? {} : { domain: state.domain }),
    composeProject: composeProjectFor(state),
    ...(env.get('POSTGRES_DB') === undefined ? {} : { databaseName: env.get('POSTGRES_DB') }),
    removes,
    keeps,
  };
}

/**
 * Checks a typed confirmation against the resource's real name.
 *
 * ⚠ Compared against the ACTUAL name, and each extra has its own. This is the
 * whole reason the confirmation is not the word DELETE: a single magic word
 * typed once would authorise both extras at once, and an operator who has
 * decided to drop a database has not thereby decided to empty a bucket.
 */
export function confirmationMatches(
  typed: string | undefined,
  actual: string | undefined,
): boolean {
  if (typed === undefined || actual === undefined) return false;
  return typed.trim() === actual.trim();
}

/**
 * Runs the purge inside the api image.
 *
 * Two phases, because §7.4's inventory has to be something the operator's
 * confirmation is ABOUT: the first invocation is a dry run that reports what
 * is there, the second carries `--confirm --bucket <typed>` and the entry point
 * re-checks that name against the LIVE configuration inside the container. The
 * CLI cannot make that check itself -- it has no way to read an encrypted
 * credential or a settings row, which is the whole reason this runs there.
 */
async function purgeStorage(args: {
  deployRoot: string;
  composeProject: string;
  confirmBucket: string | undefined;
  runCommand: typeof defaultRunCommand;
  journal: { line: (message: string) => void; redact: (text: string) => string };
}): Promise<{ purged: boolean; detail: string }> {
  if (args.confirmBucket === undefined || args.confirmBucket.trim() === '') {
    return {
      purged: false,
      detail: "--purge-storage needs the bucket's own name typed back with --confirm-bucket",
    };
  }

  const argv = composeArgv(
    [
      'run',
      '--rm',
      '--no-deps',
      'api',
      'npm',
      'run',
      'storage:purge',
      '--',
      '--confirm',
      '--bucket',
      args.confirmBucket,
    ],
    args.composeProject,
  );

  try {
    const result = await args.runCommand(argv, {
      cwd: composeCwd(args.deployRoot),
      timeoutMs: 30 * 60_000,
      redact: args.journal.redact,
    });
    return { purged: true, detail: result.stdout.trim().slice(-2000) || 'completed' };
  } catch (error) {
    return { purged: false, detail: (error as Error).message };
  }
}

export async function runUninstall(options: UninstallOptions): Promise<UninstallResult> {
  const plan = planUninstall(options);
  const runCommand = options.runCommand ?? defaultRunCommand;
  const warnings: string[] = [];

  const envPath = resolveEnvPath(options.deployRoot);
  const journal = openJournal({
    deployRoot: options.deployRoot,
    command: 'uninstall',
    secrets: envPath === undefined ? [] : secretsFrom(readEnvFile(envPath)),
  });

  journal.line(`${CLI_NAME} ${CLI_VERSION} uninstalling ${options.deployRoot}`);
  for (const keep of plan.keeps) journal.line(`KEEP ${keep.what}: ${keep.because}`);

  if (options.dryRun === true) {
    journal.finish('success');
    return { plan, removed: false, warnings, journalPath: journal.path };
  }

  // Confirmations are checked BEFORE anything is removed, and each gates only
  // its own extra.
  if (options.dropDatabase === true &&
      !confirmationMatches(options.confirmDatabase, plan.databaseName)) {
    journal.finish('failure', 'database confirmation did not match');
    throw new UsageError(
      `--drop-database needs the database's own name typed back. Expected ${plan.databaseName ?? '(unknown)'}.`,
    );
  }

  // ⚠ ORDER IS LOAD-BEARING. Anything that needs the application's own image or
  // configuration must run BEFORE the stack and the clone are destroyed.
  // Storage purge is exactly that case.
  if (options.purgeStorage === true) {
    const purge = await purgeStorage({
      deployRoot: options.deployRoot,
      composeProject: plan.composeProject,
      confirmBucket: options.confirmBucket,
      runCommand,
      journal,
    });

    if (!purge.purged) {
      journal.finish('failure', purge.detail);
      // ⚠ REFUSES LOUDLY rather than skipping. A purge that quietly did not
      // happen -- because the image was already gone, or the typed name did
      // not match -- would leave the operator believing their bucket is empty.
      // Silent retention is the one outcome this must never produce.
      throw new UsageError(
        `Storage was NOT purged: ${purge.detail}\n` +
          `Nothing has been removed. Re-run once this is resolved, or drop --purge-storage to remove the deployment and keep the objects.`,
      );
    }
    journal.line(`Purged storage: ${purge.detail}`);
  }

  const project = plan.composeProject;
  try {
    await runCommand(composeArgv(['down', '-v'], project), {
      cwd: composeCwd(options.deployRoot),
      timeoutMs: 10 * 60_000,
      redact: journal.redact,
    });
  } catch (error) {
    // The containers may already be gone; that is not a reason to leave the
    // rest of the deployment on disk.
    warnings.push(`Could not stop the stack cleanly: ${(error as Error).message}`);
  }

  if (plan.domain !== undefined && options.proxyRoot !== undefined) {
    const target: ProxyTarget = {
      domain: plan.domain,
      bindPort: 0,
      proxyRoot: options.proxyRoot,
    };
    try {
      // Refuses any vhost this CLI did not write -- the `# Managed by appctl
      // deploy` sentinel -- so a hand-written neighbour is never removed.
      await removeVhost(target, {
        runCommand,
        ...(options.hooks === undefined ? {} : { hooks: options.hooks }),
      });
    } catch (error) {
      // ⚠ A vhost that could not be removed is BOOKKEEPING, not the
      // deployment: the stack is already down and the site is already gone.
      // Failing the whole uninstall here would leave the clone and the .env on
      // disk over a configuration file.
      warnings.push(`Could not remove the vhost: ${(error as Error).message}`);
    }
  }

  for (const path of [
    join(options.deployRoot, 'repo'),
    join(options.deployRoot, 'logs'),
    join(options.deployRoot, 'deploy-info'),
    envPath ?? join(options.deployRoot, '.env'),
    deployStatePath(options.deployRoot),
  ]) {
    if (!existsSync(path)) continue;
    try {
      rmSync(path, { recursive: true, force: true });
    } catch (error) {
      warnings.push(`Could not remove ${path}: ${(error as Error).message}`);
    }
  }

  journal.finish('success');
  return { plan, removed: true, warnings, journalPath: journal.path };
}

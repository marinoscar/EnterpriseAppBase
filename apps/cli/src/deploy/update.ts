import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { CLI_NAME } from '../branding.js';
import { PreconditionError, UsageError } from '../errors.js';
import { CLI_VERSION } from '../package-info.js';
import { ALL_CHECKS, checksPassed, runChecks } from './checks/index.js';
import { offerDatabaseCreation } from './database.js';
import { smokeOAuth } from './oauth-check.js';
import { ensureRenewal } from './renewal.js';
import { diffEnv, parseEnvExample, parseEnvFile, serializeEnvFile } from './env-spec.js';
import { metadataFor } from './env-metadata.js';
import { runEnvWizard } from './env-wizard.js';
import { runCommand as defaultRunCommand } from './executor.js';
import { collectHealth, isHealthy, waitForHealthy, type FetchLike } from './health.js';
import type { DeployHooks } from './hooks.js';
import { openJournal, type Journal } from './journal.js';
import {
  certificateStatus,
  installVhost,
  issueCertificate,
  resolveProxyRuntime,
  type ProxyMode,
  type ProxyRuntime,
  type ProxyTarget,
} from './proxy.js';
import { ensureCheckout, resolveRepoTarget, type RepoTarget } from './repo.js';
import { collectHostFacts } from './host-facts.js';
import {
  appendDeployment,
  requireState,
  writeState,
  type DeployProxyRecord,
  type DeployState,
} from './state.js';
import { runPipeline, type DeployStep, type StepContext } from './steps/pipeline.js';
import { composeArgv, composeCwd, secretsFrom } from './install.js';
import type { PromptContext } from '../prompt.js';

// =============================================================================
// `appctl deploy update`  (issue #182, epic #168)
// =============================================================================
//
// Installing is the rare operation; updating is the one performed weekly, often
// while something is already broken. It needs different behaviour from install,
// not a flag on it - the PRECONDITIONS ARE OPPOSITE. Install refuses when state
// exists; update refuses when it does not. One command with two contradictory
// guards is harder to reason about than two commands.
//
// TWO DECISIONS WORTH KNOWING ABOUT:
//
//   1. IT RE-SEEDS BY DEFAULT, which the shell scripts this replaces did not.
//      prisma/seed.ts is entirely upserts, and it is also how NEW PERMISSIONS
//      reach an existing deployment. A release that adds a permission and
//      grants it to the admin role does nothing on a server that never
//      re-seeds; the feature ships, the permission does not exist, and it
//      surfaces as a confusing 403 rather than as a deployment error.
//      --skip-seed restores the old behaviour.
//
//   2. THERE IS NO AUTOMATIC ROLLBACK. A partially-applied migration cannot be
//      undone by checking out the old code, and a tool that claims otherwise
//      causes worse outages than one that stops and reports. A failed update
//      leaves the previous SHA recorded and hands back the command to redeploy
//      it, which is an honest manual recovery path.
// =============================================================================

export interface UpdateOptions {
  deployRoot: string;
  ref?: string | undefined;
  force?: boolean | undefined;
  noCache?: boolean | undefined;
  nonInteractive?: boolean | undefined;
  skipSeed?: boolean | undefined;
  skipProxy?: boolean | undefined;
  /** Do not schedule certificate renewal, whoever does or does not own it. */
  skipRenewal?: boolean | undefined;
  /** Create POSTGRES_DB when it does not exist; the --non-interactive answer. */
  createDatabase?: boolean | undefined;
  /** Container the shared proxy runs in. Default proxy-nginx. */
  proxyContainer?: string | undefined;
  /** Skips the probe in `resolveProxyRuntime` and states the answer. */
  proxyMode?: ProxyMode | undefined;
  runCommand?: typeof defaultRunCommand | undefined;
  /** Injected so the OAuth smoke is testable without a running deployment. */
  fetch?: FetchLike | undefined;
  hooks?: DeployHooks | undefined;
  promptContext?: PromptContext | undefined;
  cwd?: string | undefined;
  /** Values collected elsewhere; see InstallOptions.answers. */
  answers?: ReadonlyMap<string, string> | undefined;
}

interface UpdateContext extends StepContext {
  options: UpdateOptions;
  runCommand: typeof defaultRunCommand;
  journal: Journal;
  state: DeployState;
  target?: RepoTarget | undefined;
  previousSha?: string | undefined;
  commitSha?: string | undefined;
  env?: Map<string, string> | undefined;
  /** Set by `publish`, recorded in the state file. Absent when it is skipped. */
  proxy?: DeployProxyRecord | undefined;
  /** Set when the remote has not moved, so the rest of the pipeline stands down. */
  unchanged?: boolean | undefined;
  /** Resolved once by `publish`; `renewal` reuses it rather than re-probing. */
  proxyRuntime?: ProxyRuntime | undefined;
}

/** Certificates are renewed within this window, not on every deploy. */
const RENEW_WITHIN_DAYS = 30;

/**
 * The shared proxy's directory for an installed deployment.
 *
 * Derived from the deploy root the same way `publish` has always derived it,
 * in one place now that three steps need the answer - two of which would
 * otherwise be free to derive it differently.
 */
function proxyRootFor(deployRoot: string): string {
  return join(deployRoot, '..', '..', 'proxy');
}

function envFilePath(deployRoot: string): string {
  return join(composeCwd(deployRoot), '.env');
}

async function compose(
  context: UpdateContext,
  extra: readonly string[],
  options?: { timeoutMs?: number },
): Promise<void> {
  const result = await context.runCommand(composeArgv(extra), {
    cwd: composeCwd(context.options.deployRoot),
    timeoutMs: options?.timeoutMs ?? 30 * 60_000,
    redact: context.journal.redact,
    ...(context.hooks?.onLog === undefined
      ? {}
      : { onLine: (line: string) => context.hooks?.onLog?.(line) }),
  });
  context.journal.command(result);
}

/** Every step after `fetch` stands down when the remote has not moved. */
function skipWhenUnchanged(context: UpdateContext): string | undefined {
  return context.unchanged === true ? 'already up to date' : undefined;
}

export function buildUpdateSteps(): DeployStep<UpdateContext>[] {
  return [
    {
      id: 'preflight',
      title: 'Check the essentials',
      async run(context) {
        // A LIGHT preflight, not the full doctor. DNS and certificate checks
        // are install-time concerns; a site that is already serving does not
        // need them re-litigated on every update.
        const wanted = new Set([
          'docker-installed',
          'docker-daemon',
          'docker-compose-v2',
          'git-installed',
          'disk-space',
        ]);

        const results = await runChecks(
          ALL_CHECKS.filter((check) => wanted.has(check.id)),
          {
            runCommand: context.runCommand,
            deployRoot: context.options.deployRoot,
            bindPort: context.state.bindPort,
            proxyRoot: proxyRootFor(context.options.deployRoot),
          },
        );

        for (const result of results) {
          context.journal.line(`${result.status} ${result.id}: ${result.detail}`);
        }

        if (!checksPassed(results)) {
          throw new PreconditionError(
            results
              .filter((result) => result.status === 'fail')
              .map((result) => `${result.id}: ${result.detail}`)
              .join('\n'),
          );
        }
      },
    },
    {
      id: 'fetch',
      title: 'Look for a new revision',
      async run(context) {
        const target = await resolveRepoTarget({
          cwd: context.options.cwd ?? process.cwd(),
          runCommand: context.runCommand,
          state: context.state,
          ...(context.options.ref === undefined ? {} : { refFlag: context.options.ref }),
        });

        const checkout = await ensureCheckout(target, {
          deployRoot: context.options.deployRoot,
          runCommand: context.runCommand,
          ...(context.hooks === undefined ? {} : { hooks: context.hooks }),
          ...(context.options.force === undefined ? {} : { force: context.options.force }),
        });

        context.target = target;
        context.previousSha = checkout.previousSha;
        context.commitSha = checkout.sha;

        const moved = checkout.changed;
        const rebuildAnyway = context.options.force === true || context.options.noCache === true;

        if (!moved && !rebuildAnyway) {
          // Several minutes of build and a restart for a no-op is exactly the
          // friction that stops people updating often.
          context.unchanged = true;
          context.journal.line(`Already at ${checkout.sha}; nothing to do.`);
          return;
        }

        context.journal.line(
          `${checkout.previousSha ?? 'unknown'} -> ${checkout.sha} (${target.ref})`,
        );

        // Recorded BEFORE anything is mutated, so a failed update still leaves
        // behind what it was replacing.
        //
        // NO HISTORY ENTRY HERE, deliberately (#392). Nothing has been
        // deployed at this point - the build has not run - and an entry
        // written now would survive a failed migration as a record of a
        // deployment that never happened. `runUpdate` appends one after the
        // pipeline comes back clean. Spreading the state forward also carries
        // `host`, `proxy` and any existing `history` through untouched, which
        // is what a mid-run checkpoint should do to fields it knows nothing
        // about.
        writeState({
          ...context.state,
          previousSha: checkout.previousSha,
          lastDeployedAt: new Date().toISOString(),
        } as DeployState);
      },
    },
    {
      id: 'environment-drift',
      title: 'Check for new environment variables',
      skip: skipWhenUnchanged,
      async run(context) {
        const templatePath = join(composeCwd(context.options.deployRoot), '.env.example');
        const path = envFilePath(context.options.deployRoot);

        if (!existsSync(templatePath) || !existsSync(path)) return;

        const specs = parseEnvExample(readFileSync(templatePath, 'utf8'));
        const current = parseEnvFile(readFileSync(path, 'utf8'));
        const { missing, unknown } = diffEnv(specs, current);

        if (unknown.length > 0) {
          // Carried through, never dropped: it may be a fork's own variable.
          context.journal.line(`Keeping ${unknown.length} variable(s) not in the template`);
        }

        if (missing.length === 0) return;

        const needsAnswer = missing.filter((spec) => {
          const metadata = metadataFor(spec.key);
          return metadata.essential === true || metadata.secret === true;
        });

        context.journal.line(
          `This revision adds ${missing.length} variable(s); ${needsAnswer.length} need a value.`,
        );

        if (needsAnswer.length === 0) {
          // Everything new has a usable default; add them and say so.
          const merged = new Map(current);
          for (const spec of missing) {
            if (!spec.optional) merged.set(spec.key, spec.defaultValue);
          }
          writeFileSync(path, serializeEnvFile(merged, specs), { mode: 0o600 });
          context.env = merged;
          return;
        }

        const domain = context.state.domain;
        if (domain === undefined) {
          throw new UsageError(
            'This revision needs new environment values, but no domain is recorded for this deployment. Re-run install, or set them by hand.',
          );
        }

        const { values } = await runEnvWizard({
          specs,
          domain,
          existing:
            context.options.answers === undefined
              ? current
              : new Map([...current, ...context.options.answers]),
          ...(context.options.nonInteractive === undefined
            ? {}
            : { nonInteractive: context.options.nonInteractive }),
          ...(context.options.promptContext === undefined
            ? {}
            : { ctx: context.options.promptContext }),
        });

        writeFileSync(path, serializeEnvFile(values, specs), { mode: 0o600 });
        context.env = values;
      },
    },
    {
      id: 'ensure-database',
      title: 'Check the database exists',
      skip: skipWhenUnchanged,
      // The same thin caller install's step is (#396). Update PROBES for
      // itself, unlike install, because it has no `validate-environment` step
      // to read a verdict from - and `offerDatabaseCreation` does that
      // probing, the offering and the re-verification in one place, so the two
      // pipelines cannot answer this question differently.
      //
      // This step has no preflight problem of its own to fix: update's
      // preflight ("Check the essentials") runs five host checks -
      // docker-installed, docker-daemon, docker-compose-v2, git-installed,
      // disk-space - and no database check at all, so nothing there can abort
      // a run over the condition this step exists to remedy.
      async run(context) {
        if (context.env === undefined) return;

        const result = await offerDatabaseCreation({
          runCommand: context.runCommand,
          env: context.env,
          deployRoot: context.options.deployRoot,
          bindPort: context.state.bindPort,
          proxyRoot: proxyRootFor(context.options.deployRoot),
          ...(context.hooks === undefined ? {} : { hooks: context.hooks }),
          ...(context.options.createDatabase === undefined
            ? {}
            : { createDatabase: context.options.createDatabase }),
          ...(context.options.nonInteractive === undefined
            ? {}
            : { nonInteractive: context.options.nonInteractive }),
          ...(context.options.promptContext === undefined
            ? {}
            : { promptContext: context.options.promptContext }),
          onCheck: (check) =>
            context.journal.line(`${check.status} ${check.id}: ${check.detail}`),
        });

        // An update runs against a deployment that was working, so `blocked`
        // is left to the migration to report in its own words rather than
        // pre-empted here - the point of this step is the one situation that
        // has an offer attached to it.
        if (result.outcome === 'not-needed') return;

        context.journal.line(result.detail);

        if (result.outcome === 'declined') {
          throw new PreconditionError(
            `${result.database} was not created, so there is nothing to migrate into. Check POSTGRES_DB in ${envFilePath(context.options.deployRoot)}: a database that has disappeared from under a working deployment is worth understanding before this update continues.`,
          );
        }

        if (result.outcome === 'cannot' && result.reason === 'non-interactive') {
          throw new PreconditionError(
            `${result.detail}\nPOSTGRES_DB is set in ${envFilePath(context.options.deployRoot)}.`,
          );
        }
      },
    },
    {
      id: 'build',
      title: 'Build images',
      skip: skipWhenUnchanged,
      async run(context) {
        await compose(context, [
          'build',
          ...(context.options.noCache === true ? ['--no-cache'] : []),
        ]);
      },
    },
    {
      id: 'migrate',
      title: 'Apply migrations',
      skip: skipWhenUnchanged,
      async run(context) {
        // The api container is stopped first so two instances cannot race the
        // same migration, and brought back if the migration fails - leaving a
        // working deployment down because a migration failed would turn a
        // failed update into an outage.
        await compose(context, ['stop', 'api'], { timeoutMs: 5 * 60_000 });

        try {
          await compose(
            context,
            ['run', '--rm', '--no-deps', 'api', 'npm', 'run', 'prisma:migrate'],
            { timeoutMs: 10 * 60_000 },
          );
        } catch (error) {
          await compose(context, ['start', 'api'], { timeoutMs: 5 * 60_000 }).catch(
            () => undefined,
          );
          throw error;
        }
      },
    },
    {
      id: 'seed',
      title: 'Refresh roles and permissions',
      skip: (context) =>
        skipWhenUnchanged(context) ??
        (context.options.skipSeed === true ? 'skipped with --skip-seed' : undefined),
      async run(context) {
        // Idempotent, and the only way new permissions reach an existing
        // deployment. See the header.
        await compose(
          context,
          ['run', '--rm', '--no-deps', 'api', 'npm', 'run', 'prisma:seed'],
          { timeoutMs: 10 * 60_000 },
        );
      },
    },
    {
      id: 'restart',
      title: 'Restart the stack',
      skip: skipWhenUnchanged,
      async run(context) {
        await compose(context, ['up', '-d']);
        // nginx caches the api container's address, and a rebuilt container
        // gets a new one, so a stale resolution outlives the update.
        await compose(context, ['restart', 'nginx'], { timeoutMs: 5 * 60_000 });
      },
    },
    {
      id: 'health',
      title: 'Wait for the API',
      skip: skipWhenUnchanged,
      async run(context) {
        const probe = await waitForHealthy({
          runCommand: context.runCommand,
          deployRoot: context.options.deployRoot,
          bindPort: context.state.bindPort,
          ...(context.hooks === undefined ? {} : { hooks: context.hooks }),
        });

        if (!probe.ok) {
          throw new Error(
            `The API did not become ready: ${probe.error ?? `HTTP ${probe.status ?? '?'}`}`,
          );
        }
      },
    },
    {
      id: 'publish',
      title: 'Refresh the vhost and certificate',
      skip: (context) => {
        if (context.unchanged === true) return 'already up to date';
        if (context.options.skipProxy === true) return 'skipped with --skip-proxy';
        if (context.state.domain === undefined) return 'this deployment is not published';
        return undefined;
      },
      async run(context) {
        const target: ProxyTarget = {
          domain: context.state.domain as string,
          bindPort: context.state.bindPort,
          proxyRoot: proxyRootFor(context.options.deployRoot),
        };

        // Resolved once, then shared: the certificate, the rendered vhost and
        // the `nginx -t`/reload must all address the same proxy.
        const runtime = await resolveProxyRuntime(target, {
          runCommand: context.runCommand,
          ...(context.options.proxyMode === undefined
            ? {}
            : { proxyMode: context.options.proxyMode }),
          ...(context.options.proxyContainer === undefined
            ? {}
            : { proxyContainer: context.options.proxyContainer }),
        });

        // Kept for `renewal`: it must schedule against the same proxy this
        // published through, not against whatever a second probe finds.
        context.proxyRuntime = runtime;

        // The standing fact, not just this run's log line. An update is also
        // where a deployment installed under a host nginx and since moved into
        // a container gets its record corrected.
        context.proxy = {
          domain: target.domain,
          bindPort: target.bindPort,
          mode: runtime.mode,
          ...(runtime.container === undefined ? {} : { container: runtime.container }),
        };

        context.journal.line(
          runtime.mode === 'container'
            ? `Shared proxy: container ${runtime.container ?? ''}; certificates at ${runtime.certRoot} and the ACME webroot at ${runtime.webroot} as it sees them`
            : `Shared proxy: host nginx; certificates at ${runtime.certRoot}`,
        );

        // Existence only: `CertInfo` carries no expiry, so `proxy.certNotAfter`
        // stays unset rather than growing an `openssl` call here. See the
        // field's own comment in state.ts.
        const status = certificateStatus(target);
        if (!status.exists) {
          const email = context.env?.get('INITIAL_ADMIN_EMAIL') ?? '';
          if (email !== '') {
            await issueCertificate(target, {
              runCommand: context.runCommand,
              email,
              runtime,
              ...(context.hooks === undefined ? {} : { hooks: context.hooks }),
            });
          }
        }

        // Rewritten and re-validated so a change to the template reaches an
        // existing deployment; identical content is a no-op with no reload.
        // Passing the runtime also means an existing host-path vhost is
        // rewritten to the container's view on the next update.
        await installVhost(target, {
          runCommand: context.runCommand,
          runtime,
          ...(context.hooks === undefined ? {} : { hooks: context.hooks }),
        });
      },
    },
    {
      id: 'renewal',
      title: 'Check certificate renewal',
      skip: (context) => {
        if (context.unchanged === true) return 'already up to date';
        if (context.options.skipRenewal === true) return 'skipped with --skip-renewal';
        if (context.options.skipProxy === true) return 'skipped with --skip-proxy';
        if (context.state.domain === undefined) return 'this deployment is not published';
        return undefined;
      },
      async run(context) {
        const proxyRoot = proxyRootFor(context.options.deployRoot);

        const runtime =
          context.proxyRuntime ??
          (await resolveProxyRuntime(
            { proxyRoot },
            {
              runCommand: context.runCommand,
              ...(context.options.proxyMode === undefined
                ? {}
                : { proxyMode: context.options.proxyMode }),
              ...(context.options.proxyContainer === undefined
                ? {}
                : { proxyContainer: context.options.proxyContainer }),
            },
          ));

        // Runs on every update on purpose. A deployment installed before this
        // existed has no schedule at all, and a central script that was
        // removed since take-over is exactly the state nobody notices: the
        // owner probe is cheap and the answer is almost always "somebody else
        // has this, do nothing".
        const result = await ensureRenewal({
          proxyRoot,
          runtime,
          runCommand: context.runCommand,
          ...(context.hooks === undefined ? {} : { hooks: context.hooks }),
        });

        context.journal.line(`renewal: ${result.detail}`);
      },
    },
    {
      id: 'verify',
      title: 'Verify the deployment',
      skip: skipWhenUnchanged,
      async run(context) {
        const report = await collectHealth({
          runCommand: context.runCommand,
          deployRoot: context.options.deployRoot,
          bindPort: context.state.bindPort,
          ...(context.options.fetch === undefined ? {} : { fetch: context.options.fetch }),
          ...(context.state.domain === undefined || context.options.skipProxy === true
            ? {}
            : { domain: context.state.domain }),
        });

        if (!isHealthy(report)) {
          throw new Error(
            `The stack restarted but is not healthy. Run \`${CLI_NAME} deploy status\` for the detail.`,
          );
        }

        // The same end-to-end sign-in check install runs. An update is where a
        // changed .env, a rotated secret or a renamed callback URL actually
        // reaches the running container, so this is not a re-run of something
        // already proved - it is the first time this revision's wiring has
        // been exercised.
        const finding = await smokeOAuth({
          baseUrl: `http://127.0.0.1:${context.state.bindPort}`,
          ...(context.env?.get('GOOGLE_CLIENT_ID') === undefined
            ? {}
            : { clientId: context.env.get('GOOGLE_CLIENT_ID') as string }),
          ...(context.env?.get('GOOGLE_CALLBACK_URL') === undefined
            ? {}
            : { callbackUrl: context.env.get('GOOGLE_CALLBACK_URL') as string }),
          ...(context.options.fetch === undefined ? {} : { fetch: context.options.fetch }),
        });

        context.journal.line(`${finding.status} ${finding.id}: ${finding.detail}`);

        if (finding.status === 'fail') {
          throw new Error(
            `The stack is healthy, but sign-in is not wired up: ${finding.detail}.\n${finding.remedy ?? ''}`,
          );
        }
      },
    },
  ];
}

export interface UpdateResult {
  changed: boolean;
  previousSha?: string | undefined;
  commitSha: string;
  journalPath: string;
  durationMs: number;
}

export async function runUpdate(options: UpdateOptions): Promise<UpdateResult> {
  // The precondition install does not have, and the reason this is its own
  // command: nothing to update is a different situation from nothing installed.
  const state = requireState(options.deployRoot);
  const startedAt = Date.now();

  const path = envFilePath(options.deployRoot);
  const journal = openJournal({
    deployRoot: options.deployRoot,
    command: 'update',
    secrets: existsSync(path) ? secretsFrom(parseEnvFile(readFileSync(path, 'utf8'))) : [],
  });

  const context: UpdateContext = {
    options,
    runCommand: options.runCommand ?? defaultRunCommand,
    journal,
    hooks: options.hooks,
    completed: new Set<string>(),
    state,
    ...(existsSync(path) ? { env: parseEnvFile(readFileSync(path, 'utf8')) } : {}),
  };

  const result = await runPipeline(buildUpdateSteps(), context);

  if (result.failed !== undefined) {
    journal.finish('failure', `${result.failed.id}: ${result.failed.detail ?? ''}`);
    const previous = context.previousSha ?? state.commitSha;

    throw new Error(
      `${result.failed.title} failed: ${result.failed.detail ?? 'unknown error'}\n` +
        `The full log is at ${journal.path}\n` +
        // An honest manual recovery path. A partially-applied migration cannot
        // be undone by checking out the old code, so this does not pretend to.
        `To go back to the previous revision: ${CLI_NAME} deploy update --ref ${previous} --force`,
    );
  }

  if (context.unchanged === true) {
    // No state write and no history entry: the remote had not moved, so
    // nothing was deployed. A run that rebuilt nothing must not appear in the
    // deployments list as though it had.
    journal.finish('success', 'already up to date');
    return {
      changed: false,
      commitSha: context.commitSha ?? state.commitSha,
      journalPath: journal.path,
      durationMs: Date.now() - startedAt,
    };
  }

  const now = new Date().toISOString();
  const commitSha = context.commitSha ?? state.commitSha;
  const ref = context.target?.ref ?? state.ref;

  // Never throws; see host-facts.ts rule 1. Refreshed rather than carried
  // forward, because the point of recording it is to catch the server having
  // changed under the deployment - a resize, a kernel upgrade, a new Docker.
  const host = await collectHostFacts({ runCommand: context.runCommand });

  const next: DeployState = {
    ...state,
    ref,
    commitSha,
    previousSha: context.previousSha,
    lastDeployedAt: now,
    lastCommand: 'update',
    appctlVersion: CLI_VERSION,
    ...(host === undefined ? {} : { host }),
    // Left alone when `publish` was skipped: --skip-proxy on one update is not
    // a statement that the deployment stopped being published.
    ...(context.proxy === undefined ? {} : { proxy: context.proxy }),
  };

  // Appended HERE and nowhere else in this file. The pipeline came back with
  // no failed step and the stack verified healthy, which is the only thing
  // that entitles this run to claim a deployment happened.
  writeState(
    appendDeployment(next, {
      at: now,
      command: 'update',
      commitSha,
      ...(context.previousSha === undefined ? {} : { previousSha: context.previousSha }),
      ref,
      durationMs: Date.now() - startedAt,
      appctlVersion: CLI_VERSION,
      outcome: 'success',
    }),
  );

  journal.finish('success');

  return {
    changed: true,
    ...(context.previousSha === undefined ? {} : { previousSha: context.previousSha }),
    commitSha: context.commitSha ?? state.commitSha,
    journalPath: journal.path,
    durationMs: Date.now() - startedAt,
  };
}

export { RENEW_WITHIN_DAYS };

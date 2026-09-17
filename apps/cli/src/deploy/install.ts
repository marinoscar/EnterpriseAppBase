import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { CLI_NAME } from '../branding.js';
import { PreconditionError, UsageError } from '../errors.js';
import { CLI_VERSION } from '../package-info.js';
import {
  ALL_CHECKS,
  checksPassed,
  requiredChecks,
  runChecks,
  type Check,
} from './checks/index.js';
import {
  DATABASE_DEFERRED_CHECKS,
  classifyDatabase,
  offerDatabaseCreation,
  willOfferDatabaseCreation,
  type DatabaseVerdict,
} from './database.js';
import { smokeOAuth, verifyOAuthConfiguration } from './oauth-check.js';
import { bootstrapProxy, proxyRootPresent } from './proxy-bootstrap.js';
import { ensureRenewal } from './renewal.js';
import { parseEnvExample, parseEnvFile, serializeEnvFile } from './env-spec.js';
import { runEnvWizard } from './env-wizard.js';
import type { EnvGroup } from './env-metadata.js';
import { runCommand as defaultRunCommand } from './executor.js';
import { waitForHealthy, collectHealth, isHealthy, type FetchLike } from './health.js';
import type { DeployHooks } from './hooks.js';
import { openJournal, type Journal, type SecretEntry } from './journal.js';
import {
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
  DEPLOY_STATE_VERSION,
  appendDeployment,
  readState,
  writeState,
  type DeployProxyRecord,
  type DeployState,
} from './state.js';
import { runPipeline, type DeployStep, type StepContext } from './steps/pipeline.js';
import { metadataFor } from './env-metadata.js';
import type { PromptContext } from '../prompt.js';

// =============================================================================
// `appctl deploy install`  (issue #180, epic #168)
// =============================================================================
//
// Takes a prepared VPS from nothing to a running, migrated, seeded, healthy,
// HTTPS deployment.
//
// FOUR THINGS THAT DECIDE WHETHER THIS WORKS AT ALL, all of them learned from
// the code rather than assumed:
//
//   1. MIGRATIONS NEED THE ENVIRONMENT EXPLICITLY. scripts/prisma-env.js only
//      loads dotenv when NODE_ENV !== 'production', and the production stack
//      sets NODE_ENV=production - so POSTGRES_* must be present in the migrate
//      container's environment, not merely in a file it might have read.
//   2. NEVER `npm ci` WITH NODE_ENV=production anywhere in here. It drops
//      @nestjs/cli, the Prisma CLI and ts-node, which build, migrate and seed
//      all need. This has bitten the repository before; ci.yml says so.
//   3. /api/health/ready IS NOT PROOF THAT MIGRATIONS RAN. Its only indicator
//      issues SELECT 1, which passes against an empty database. Step 8's exit
//      status is what proves the schema; the health wait proves the process is
//      up. Do not let a green probe stand in for the migration.
//   4. THE CERTIFICATE IS ISSUED BEFORE THE VHOST IS WRITTEN. A vhost naming a
//      certificate that does not exist fails nginx -t and takes the shared
//      proxy's reload down for every site on the host.
// =============================================================================

const COMPOSE_FILES = ['base.compose.yml', 'prod.compose.yml', 'vps.compose.yml'] as const;

export interface InstallOptions {
  deployRoot: string;
  domain?: string | undefined;
  bindPort: number;
  proxyRoot: string;
  /** Container the shared proxy runs in. Default proxy-nginx. */
  proxyContainer?: string | undefined;
  /** Skips the probe in `resolveProxyRuntime` and states the answer. */
  proxyMode?: ProxyMode | undefined;
  repo?: string | undefined;
  ref?: string | undefined;
  nonInteractive?: boolean | undefined;
  all?: boolean | undefined;
  groups?: readonly EnvGroup[] | undefined;
  reinstall?: boolean | undefined;
  resume?: boolean | undefined;
  skipDoctor?: boolean | undefined;
  skipProxy?: boolean | undefined;
  skipSeed?: boolean | undefined;
  /** Do not schedule certificate renewal, whoever does or does not own it. */
  skipRenewal?: boolean | undefined;
  /** Stand the shared proxy up when this box has none. The --non-interactive
   *  answer to the question `proxy-bootstrap` would otherwise ask. */
  bootstrapProxy?: boolean | undefined;
  /** Create POSTGRES_DB when it does not exist. The --non-interactive answer
   *  to the question `ensure-database` would otherwise ask. */
  createDatabase?: boolean | undefined;
  noCache?: boolean | undefined;
  force?: boolean | undefined;
  email?: string | undefined;
  staging?: boolean | undefined;
  runCommand?: typeof defaultRunCommand | undefined;
  /** Injected so the OAuth checks and probes are testable without a network. */
  fetch?: FetchLike | undefined;
  hooks?: DeployHooks | undefined;
  promptContext?: PromptContext | undefined;
  cwd?: string | undefined;
  /**
   * Values collected elsewhere, merged in ahead of the wizard.
   *
   * The ink screen (#184) needs this: readline cannot ask a question while
   * ink holds stdin in raw mode, so the TUI collects the fields with its own
   * text input and hands them over, then runs the wizard non-interactively.
   */
  answers?: ReadonlyMap<string, string> | undefined;
}

interface InstallContext extends StepContext {
  options: InstallOptions;
  runCommand: typeof defaultRunCommand;
  journal: Journal;
  target?: RepoTarget | undefined;
  checkoutPath?: string | undefined;
  commitSha?: string | undefined;
  env?: Map<string, string> | undefined;
  /** Set by `publish`, recorded in the state file. Absent when it is skipped. */
  proxy?: DeployProxyRecord | undefined;
  /**
   * What `validate-environment` concluded about the database.
   *
   * Carried rather than re-probed: `ensure-database` acts on the same answer
   * the operator was just shown, and two runs of the same check against a
   * live server can legitimately differ.
   */
  databaseVerdict?: DatabaseVerdict | undefined;
  /** Resolved once by `publish`; `renewal` reuses it rather than re-probing. */
  proxyRuntime?: ProxyRuntime | undefined;
}

export function composeCwd(deployRoot: string): string {
  // The relative build contexts in base.compose.yml (`../..`, `../nginx`)
  // resolve against the COMPOSE FILE's directory, so this is not incidental.
  return join(deployRoot, 'repo', 'infra', 'compose');
}

export function composeArgv(extra: readonly string[]): string[] {
  return ['docker', 'compose', ...COMPOSE_FILES.flatMap((file) => ['-f', file]), ...extra];
}

function envFilePath(deployRoot: string): string {
  return join(composeCwd(deployRoot), '.env');
}

/** Secrets for the journal's redactor, from the metadata rather than a guess. */
export function secretsFrom(env: ReadonlyMap<string, string>): SecretEntry[] {
  return [...env.entries()]
    .filter(([key]) => metadataFor(key).secret === true)
    .map(([key, value]) => ({ key, value }));
}

async function compose(
  context: InstallContext,
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

/**
 * The three OAuth layers, reported and then enforced.
 *
 * A `fail` stops the install HERE - before the build, before the migration,
 * before a certificate is spent - because every one of them is a
 * configuration mistake that would otherwise surface as a broken sign-in on a
 * deployment that reported itself healthy. A `warn` (an unreachable Google,
 * most often) is recorded and carried on from: an air-gapped or
 * egress-filtered server must still be able to install.
 */
async function verifyOAuth(context: InstallContext): Promise<void> {
  const domain = context.options.domain;
  if (context.env === undefined || domain === undefined) return;

  const findings = await verifyOAuthConfiguration({
    env: context.env,
    domain,
    ...(context.options.fetch === undefined ? {} : { fetch: context.options.fetch }),
  });

  for (const finding of findings) {
    context.journal.line(`${finding.status} ${finding.id}: ${finding.detail}`);
  }

  const failed = findings.filter((finding) => finding.status === 'fail');
  if (failed.length === 0) return;

  throw new PreconditionError(
    `OAuth is not configured correctly, so nobody would be able to sign in:\n` +
      failed
        .map((finding) => `  - ${finding.detail}\n    ${finding.remedy ?? ''}`)
        .join('\n'),
  );
}

/**
 * Required checks that ask about a shared proxy this install is about to CREATE.
 *
 * Every one of them is a fair question about a box that already has a proxy and
 * a meaningless one about a box that does not: `proxy-root` reports the very
 * absence `proxy-bootstrap` exists to fix, and the other three are all
 * downstream of it. `certbot-installed` is in the list for a subtler reason -
 * left to probe, `resolveProxyRuntime` reports HOST mode while there is no
 * proxy container running, so it demands a host certbot binary that a
 * containerised proxy (which is what the bootstrap creates) will never use.
 *
 * They are deferred ONLY when a bootstrap is genuinely going to be offered. A
 * `--non-interactive` run with no `--bootstrap-proxy` still fails here, before
 * anything is cloned, which is a better place to learn it than eight steps
 * later.
 */
export const BOOTSTRAP_DEFERRED_CHECKS: readonly string[] = [
  'proxy-root',
  'proxy-conf-writable',
  'acme-webroot',
  'proxy-container',
  'certbot-installed',
];

/** True when this run may create the shared proxy, so its absence is not fatal. */
export function willOfferBootstrap(options: InstallOptions): boolean {
  if (options.skipProxy === true) return false;
  if (options.domain === undefined) return false;
  if (proxyRootPresent(options.proxyRoot)) return false;
  // Unattended runs must say so out loud; see `bootstrapProxy`'s `approve`.
  return options.bootstrapProxy === true || options.nonInteractive !== true;
}

/**
 * The checks the preflight actually runs, after both deferrals  (issue #396).
 *
 * A pure function of the options so it can be asserted on directly: "which
 * questions is this run entitled to fail on" is the whole of the bug #396
 * fixed, and a test of it should not have to stand up a server to ask.
 *
 * TWO deferrals, ONE shape. `BOOTSTRAP_DEFERRED_CHECKS` describes a proxy this
 * run may create; `DATABASE_DEFERRED_CHECKS` describes a database this run may
 * create. In both cases the checks left in the set are the ones describing
 * conditions the pipeline CANNOT remedy - which for the database is
 * `database-reachable` and `database-credentials`, still `required`, still
 * fatal here, because creating a database is impossible against a server that
 * will not answer or a password that is wrong.
 */
export function preflightChecks(options: InstallOptions): Check[] {
  const bootstrap = willOfferBootstrap(options);
  const database = willOfferDatabaseCreation(options);

  return requiredChecks(ALL_CHECKS).filter(
    (check) =>
      !(bootstrap && BOOTSTRAP_DEFERRED_CHECKS.includes(check.id)) &&
      !(database && DATABASE_DEFERRED_CHECKS.includes(check.id)),
  );
}

export function buildInstallSteps(): DeployStep<InstallContext>[] {
  return [
    {
      id: 'preflight',
      title: 'Check prerequisites',
      skip: (context) =>
        context.options.skipDoctor === true
          ? 'skipped with --skip-doctor'
          : undefined,
      async run(context) {
        if (willOfferBootstrap(context.options)) {
          context.journal.line(
            `No shared proxy at ${context.options.proxyRoot}; deferring ${BOOTSTRAP_DEFERRED_CHECKS.join(', ')} to the proxy-bootstrap step.`,
          );
        }
        if (willOfferDatabaseCreation(context.options)) {
          context.journal.line(
            `Deferring ${DATABASE_DEFERRED_CHECKS.join(', ')} to the ensure-database step; the database may be created by this run.`,
          );
        }

        const wanted: readonly Check[] = preflightChecks(context.options);

        const results = await runChecks(wanted, {
          runCommand: context.runCommand,
          deployRoot: context.options.deployRoot,
          bindPort: context.options.bindPort,
          proxyRoot: context.options.proxyRoot,
          // So the certbot check asks about the proxy this install will use,
          // rather than about whichever one the probe happens to find.
          ...(context.options.proxyMode === undefined
            ? {}
            : { proxyMode: context.options.proxyMode }),
          ...(context.options.proxyContainer === undefined
            ? {}
            : { proxyContainer: context.options.proxyContainer }),
          ...(context.options.domain === undefined
            ? {}
            : { domain: context.options.domain }),
        });

        for (const result of results) {
          context.journal.line(`${result.status} ${result.id}: ${result.detail}`);
        }

        if (!checksPassed(results)) {
          const failed = results.filter((result) => result.status === 'fail');
          // Aborts BEFORE anything is cloned or written.
          throw new PreconditionError(
            `Prerequisites not met:\n` +
              failed
                .map((result) => `  - ${result.id}: ${result.detail}\n    ${result.remedy ?? ''}`)
                .join('\n') +
              `\nRun \`${CLI_NAME} deploy doctor\` for the full report.`,
          );
        }
      },
    },
    {
      id: 'checkout',
      title: 'Fetch the application',
      async run(context) {
        const target = await resolveRepoTarget({
          cwd: context.options.cwd ?? process.cwd(),
          runCommand: context.runCommand,
          ...(context.options.repo === undefined ? {} : { repoFlag: context.options.repo }),
          ...(context.options.ref === undefined ? {} : { refFlag: context.options.ref }),
        });

        context.journal.line(`Deploying ${target.url} @ ${target.ref} (${target.source})`);

        const checkout = await ensureCheckout(target, {
          deployRoot: context.options.deployRoot,
          runCommand: context.runCommand,
          ...(context.hooks === undefined ? {} : { hooks: context.hooks }),
          ...(context.options.force === undefined ? {} : { force: context.options.force }),
        });

        context.target = target;
        context.checkoutPath = checkout.path;
        context.commitSha = checkout.sha;
        context.journal.line(`Checked out ${checkout.sha}`);
      },
    },
    {
      id: 'environment',
      title: 'Configure the environment',
      async run(context) {
        const templatePath = join(
          context.options.deployRoot,
          'repo',
          'infra',
          'compose',
          '.env.example',
        );
        const specs = parseEnvExample(readFileSync(templatePath, 'utf8'));

        const path = envFilePath(context.options.deployRoot);
        const onDisk = existsSync(path) ? parseEnvFile(readFileSync(path, 'utf8')) : undefined;

        // Answers supplied by a caller win over what is on disk: they are the
        // more recent statement of intent.
        const existing =
          context.options.answers === undefined
            ? onDisk
            : new Map([...(onDisk ?? new Map()), ...context.options.answers]);

        const domain = context.options.domain;
        if (domain === undefined) {
          throw new UsageError(
            'A domain is required so APP_URL and the OAuth callback can be derived. Pass --domain.',
          );
        }

        const { values } = await runEnvWizard({
          specs,
          domain,
          ...(existing === undefined ? {} : { existing }),
          ...(context.options.all === undefined ? {} : { all: context.options.all }),
          ...(context.options.nonInteractive === undefined
            ? {}
            : { nonInteractive: context.options.nonInteractive }),
          ...(context.options.groups === undefined ? {} : { groups: context.options.groups }),
          ...(context.options.promptContext === undefined
            ? {}
            : { ctx: context.options.promptContext }),
        });

        values.set('APP_BIND_PORT', String(context.options.bindPort));

        mkdirSync(composeCwd(context.options.deployRoot), { recursive: true });
        // 0600: it holds the database password, the JWT secret and the OAuth
        // client secret.
        writeFileSync(path, serializeEnvFile(values, specs), { mode: 0o600 });

        context.env = values;
        // BEFORE anything else can log. On a FIRST install the journal was
        // opened with no secrets at all - there was no .env to seed it from -
        // so until this call the database password, the JWT secret and the
        // OAuth client secret are redacted from nothing. The live credential
        // probe two steps down is the one that would otherwise be able to put
        // a client secret into an error message.
        context.journal.addSecrets(secretsFrom(values));
        context.journal.line(`Wrote ${path} (${values.size} variables)`);
      },
    },
    {
      id: 'validate-environment',
      title: 'Validate the environment',
      async run(context) {
        if (context.env === undefined) return;

        // Belt and braces with the `environment` step's own call: a --resume
        // that re-ran this step without re-running the wizard must still have
        // taught the redactor before the OAuth probe below sends a secret
        // anywhere.
        context.journal.addSecrets(secretsFrom(context.env));

        const results = await runChecks(
          ALL_CHECKS.filter((check) => check.id.startsWith('database-')),
          {
            runCommand: context.runCommand,
            deployRoot: context.options.deployRoot,
            bindPort: context.options.bindPort,
            proxyRoot: context.options.proxyRoot,
            env: context.env,
          },
        );

        for (const result of results) {
          context.journal.line(`${result.status} ${result.id}: ${result.detail}`);
        }

        // "Reachable, credentials fine, database not there" is the ONE database
        // failure this pipeline can offer to fix, so it is held back from the
        // fatal set and handed to `ensure-database`. Every other failure stays
        // fatal: creating a database is not the remedy for a refused
        // connection or a wrong password, and attempting one would replace a
        // precise error with a vaguer one.
        //
        // Held back ONLY when a creation will genuinely be offered (#396) -
        // the same condition the preflight defers on, read from the same
        // function. A `--non-interactive` run with no `--create-database` has
        // nothing to hand the next step, so the absence stays fatal HERE,
        // before the build and the migration, rather than being carried one
        // step further to be refused there.
        context.databaseVerdict = classifyDatabase(results);
        const offerable = willOfferDatabaseCreation(context.options);
        const deferrable = context.databaseVerdict === 'missing' && offerable;
        const fatal = results.filter(
          (result) =>
            result.severity === 'required' &&
            result.status === 'fail' &&
            !(deferrable && result.id === 'database-exists'),
        );

        if (deferrable) {
          context.journal.line('The database does not exist yet; ensure-database will offer to create it.');
        }

        if (fatal.length > 0) {
          throw new PreconditionError(
            `The database is not usable with these settings:\n` +
              fatal
                .map((result) => `  - ${result.detail}\n    ${result.remedy ?? ''}`)
                .join('\n') +
              (context.databaseVerdict === 'missing' && !offerable
                ? `\n  Pass --create-database to have this run create it. It is not created automatically because a typo in POSTGRES_DB looks exactly like this.`
                : ''),
          );
        }

        await verifyOAuth(context);
      },
    },
    {
      id: 'ensure-database',
      title: 'Create the database',
      skip: (context) => {
        switch (context.databaseVerdict) {
          case 'missing':
            return undefined;
          case undefined:
            // --resume skipped `validate-environment` as already completed, so
            // this run has no verdict to act on. NOT skipped: the step asks
            // for itself below rather than assuming the answer from a previous
            // run that may be hours old.
            return undefined;
          case 'ok':
            return 'the database already exists';
          default:
            return `nothing to create (${context.databaseVerdict})`;
        }
      },
      // A THIN CALLER of `offerDatabaseCreation`, exactly as `certificate
      // -renewal` is a thin caller of `findRenewalOwner` (#396). Everything
      // this step decides is which pipeline error each outcome deserves; the
      // offering, the creating and the re-verifying all live in database.ts,
      // where a fork's own installer can call them from its own wizard.
      async run(context) {
        if (context.env === undefined) return;

        const result = await offerDatabaseCreation({
          runCommand: context.runCommand,
          env: context.env,
          deployRoot: context.options.deployRoot,
          bindPort: context.options.bindPort,
          proxyRoot: context.options.proxyRoot,
          // The verdict `validate-environment` reached, when this run has one.
          // A --resume that skipped that step has none, and the function
          // probes for itself rather than assuming an answer from a previous
          // run that may be hours old.
          ...(context.databaseVerdict === undefined
            ? {}
            : { verdict: context.databaseVerdict }),
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

        context.journal.line(result.detail);

        if (result.outcome === 'declined') {
          // Declining is an ANSWER, not a cancellation: the operator has just
          // said this name is not the one they meant. Migrating into a
          // database they disowned is the exact outcome the question exists to
          // prevent, so the install stops here with POSTGRES_DB named.
          throw new PreconditionError(
            `${result.database} was not created, so there is nothing to migrate into. Fix POSTGRES_DB in ${envFilePath(context.options.deployRoot)} (or create the database by hand) and re-run with --resume.`,
          );
        }

        if (result.outcome === 'cannot' && result.reason === 'non-interactive') {
          throw new PreconditionError(
            `${result.detail}\nPOSTGRES_DB is set in ${envFilePath(context.options.deployRoot)}.`,
          );
        }

        if (result.outcome === 'created') {
          // The database is there now, so a --resume that re-runs a later step
          // does not re-ask a question that has been answered.
          context.databaseVerdict = 'ok';
        }
      },
    },
    {
      id: 'build',
      title: 'Build images',
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
      async run(context) {
        // `run --rm` rather than `exec`: the stack is not up yet, and this must
        // not depend on the api container already running.
        await compose(context, [
          'run', '--rm', '--no-deps', 'api',
          'npm', 'run', 'prisma:migrate',
        ], { timeoutMs: 10 * 60_000 });
      },
    },
    {
      id: 'seed',
      title: 'Seed roles and permissions',
      skip: (context) =>
        context.options.skipSeed === true ? 'skipped with --skip-seed' : undefined,
      async run(context) {
        await compose(context, [
          'run', '--rm', '--no-deps', 'api',
          'npm', 'run', 'prisma:seed',
        ], { timeoutMs: 10 * 60_000 });
      },
    },
    {
      id: 'start',
      title: 'Start the stack',
      async run(context) {
        await compose(context, ['up', '-d']);
      },
    },
    {
      id: 'health',
      title: 'Wait for the API',
      async run(context) {
        const probe = await waitForHealthy({
          runCommand: context.runCommand,
          deployRoot: context.options.deployRoot,
          bindPort: context.options.bindPort,
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
      id: 'proxy-bootstrap',
      title: 'Set up the shared proxy',
      skip: (context) => {
        if (context.options.skipProxy === true) return 'skipped with --skip-proxy';
        if (context.options.domain === undefined) return 'no --domain given';
        // Checked HERE as well as inside `bootstrapProxy`, so the pipeline
        // reports "nothing to do" for the overwhelmingly common case - a box
        // that already has a proxy - rather than running a step that decides
        // to do nothing. The module still re-checks: it is the guarantee, and
        // a guarantee that lives only in a caller is not one.
        if (proxyRootPresent(context.options.proxyRoot)) {
          return `${context.options.proxyRoot} already exists`;
        }
        return undefined;
      },
      async run(context) {
        const result = await bootstrapProxy({
          proxyRoot: context.options.proxyRoot,
          runCommand: context.runCommand,
          ...(context.hooks === undefined ? {} : { hooks: context.hooks }),
          ...(context.options.proxyContainer === undefined
            ? {}
            : { container: context.options.proxyContainer }),
          ...(context.options.bootstrapProxy === undefined
            ? {}
            : { bootstrapProxy: context.options.bootstrapProxy }),
          ...(context.options.nonInteractive === undefined
            ? {}
            : { nonInteractive: context.options.nonInteractive }),
          ...(context.options.promptContext === undefined
            ? {}
            : { promptContext: context.options.promptContext }),
        });

        context.journal.line(result.detail);

        if (result.outcome === 'declined') {
          // There is nowhere to write a vhost and nowhere for certbot to put a
          // challenge, so publishing cannot work. Stopping with the reason is
          // better than letting `publish` fail on a missing directory.
          throw new PreconditionError(
            `No shared reverse proxy at ${result.proxyRoot}, and it was not created. Set one up, or re-run with --skip-proxy to leave this deployment on ${`http://127.0.0.1:${context.options.bindPort}`}.`,
          );
        }
      },
    },
    {
      id: 'publish',
      title: 'Publish over HTTPS',
      skip: (context) => {
        if (context.options.skipProxy === true) return 'skipped with --skip-proxy';
        if (context.options.domain === undefined) return 'no --domain given';
        return undefined;
      },
      async run(context) {
        const target: ProxyTarget = {
          domain: context.options.domain as string,
          bindPort: context.options.bindPort,
          proxyRoot: context.options.proxyRoot,
        };

        const email =
          context.options.email ?? context.env?.get('INITIAL_ADMIN_EMAIL') ?? '';
        if (email === '') {
          throw new UsageError(
            'A registration email is required for the certificate. Pass --email, or set INITIAL_ADMIN_EMAIL.',
          );
        }

        // Resolved ONCE and shared by every call below. Issuing against one
        // path space and rendering against another is exactly issue #389.
        const runtime = await resolveProxyRuntime(target, {
          runCommand: context.runCommand,
          ...(context.options.proxyMode === undefined
            ? {}
            : { proxyMode: context.options.proxyMode }),
          ...(context.options.proxyContainer === undefined
            ? {}
            : { proxyContainer: context.options.proxyContainer }),
        });

        // Kept for `renewal`, which must schedule a command against the SAME
        // proxy this published through - re-probing there could answer
        // differently and write a cron entry for the other path space.
        context.proxyRuntime = runtime;

        // Recorded in the STATE as well as the journal (#392): the journal is
        // one run's log and is pruned after ten, while "which proxy is this
        // deployment published through" is a standing fact about the server.
        context.proxy = {
          domain: target.domain,
          bindPort: target.bindPort,
          mode: runtime.mode,
          ...(runtime.container === undefined ? {} : { container: runtime.container }),
        };

        // Recorded because an operator diagnosing a failed publish needs to
        // know which of the two setups this run assumed.
        context.journal.line(
          runtime.mode === 'container'
            ? `Shared proxy: container ${runtime.container ?? ''}; certificates at ${runtime.certRoot} and the ACME webroot at ${runtime.webroot} as it sees them`
            : `Shared proxy: host nginx; certificates at ${runtime.certRoot}`,
        );

        // Certificate FIRST. See rule 4 in the header.
        await issueCertificate(target, {
          runCommand: context.runCommand,
          email,
          runtime,
          ...(context.options.staging === undefined ? {} : { staging: context.options.staging }),
          ...(context.hooks === undefined ? {} : { hooks: context.hooks }),
        });

        await installVhost(target, {
          runCommand: context.runCommand,
          runtime,
          ...(context.hooks === undefined ? {} : { hooks: context.hooks }),
          ...(context.env?.get('MAX_FILE_SIZE') === undefined
            ? {}
            : { maxBodyBytes: Number(context.env.get('MAX_FILE_SIZE')) }),
        });
      },
    },
    {
      id: 'renewal',
      title: 'Schedule certificate renewal',
      skip: (context) => {
        if (context.options.skipRenewal === true) return 'skipped with --skip-renewal';
        if (context.options.skipProxy === true) return 'skipped with --skip-proxy';
        if (context.options.domain === undefined) return 'no --domain given';
        return undefined;
      },
      async run(context) {
        // Resolved by `publish` in the normal case; probed here only when that
        // step was skipped as already-completed by --resume.
        const runtime =
          context.proxyRuntime ??
          (await resolveProxyRuntime(
            { proxyRoot: context.options.proxyRoot },
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

        const result = await ensureRenewal({
          proxyRoot: context.options.proxyRoot,
          runtime,
          runCommand: context.runCommand,
          ...(context.hooks === undefined ? {} : { hooks: context.hooks }),
        });

        // Never thrown on: the site is published and healthy, and a server
        // where /etc/cron.d cannot be written has a real problem that is not
        // worth turning a successful deployment into a failed one over. The
        // line is what carries it - and `doctor`'s certificate-renewal check
        // keeps asking the same question on every later run.
        context.journal.line(`renewal: ${result.detail}`);
      },
    },
    {
      id: 'verify',
      title: 'Verify the deployment',
      async run(context) {
        const report = await collectHealth({
          runCommand: context.runCommand,
          deployRoot: context.options.deployRoot,
          bindPort: context.options.bindPort,
          ...(context.options.fetch === undefined ? {} : { fetch: context.options.fetch }),
          ...(context.options.domain === undefined || context.options.skipProxy === true
            ? {}
            : { domain: context.options.domain }),
        });

        context.journal.line(
          `containers=${report.containers.length} ready=${report.local.ready.ok} frontend=${report.local.frontend.ok} migrations=${report.migrations.known ? report.migrations.pending.length : 'unknown'}`,
        );

        if (!isHealthy(report)) {
          throw new Error(
            'The stack is up but not healthy. Run `' +
              CLI_NAME +
              ' deploy status` for the detail.',
          );
        }

        await smokeOAuthOrThrow(context);
      },
    },
  ];
}

/**
 * The post-deploy sign-in smoke test.
 *
 * `validate-environment` checked what is IN .env; this checks what the running
 * application does with it, against loopback, with no credential in flight. A
 * `fail` here means nobody can sign in to a deployment that is otherwise
 * perfectly healthy - which is precisely the state this install would
 * otherwise report as finished, one line above a message telling the operator
 * to go and log in.
 *
 * The message is written to be actionable on its own: this is the last step,
 * and the person reading it has just watched eleven others succeed.
 */
async function smokeOAuthOrThrow(context: InstallContext): Promise<void> {
  const finding = await smokeOAuth({
    baseUrl: `http://127.0.0.1:${context.options.bindPort}`,
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
}

export interface InstallResult {
  deployRoot: string;
  commitSha: string;
  journalPath: string;
  domain?: string | undefined;
  /** The one thing the operator still has to do. */
  nextStep: string;
}

export async function runInstall(options: InstallOptions): Promise<InstallResult> {
  // Before anything, including the precondition check: the history entry's
  // duration is how long the operator waited, not how long the steps took.
  const startedAt = Date.now();
  const existingState = readState(options.deployRoot);

  if (existingState !== undefined && options.reinstall !== true && options.resume !== true) {
    throw new UsageError(
      `A deployment already exists at ${options.deployRoot} (${existingState.commitSha.slice(0, 12)}). Use \`${CLI_NAME} deploy update\` to bring it up to date, or --reinstall to start over.`,
    );
  }

  mkdirSync(options.deployRoot, { recursive: true });

  const journal = openJournal({
    deployRoot: options.deployRoot,
    command: 'install',
    // Seeded from an existing .env so a resumed run redacts from the first
    // line, before the wizard has run again.
    secrets: existsSync(envFilePath(options.deployRoot))
      ? secretsFrom(parseEnvFile(readFileSync(envFilePath(options.deployRoot), 'utf8')))
      : [],
  });

  const context: InstallContext = {
    options,
    runCommand: options.runCommand ?? defaultRunCommand,
    journal,
    hooks: options.hooks,
    completed:
      options.resume === true && existingState !== undefined
        ? new Set(existingState.completedSteps ?? [])
        : new Set<string>(),
  };

  const result = await runPipeline(buildInstallSteps(), context);

  if (result.failed !== undefined) {
    journal.finish('failure', `${result.failed.id}: ${result.failed.detail ?? ''}`);
    throw new Error(
      `${result.failed.title} failed: ${result.failed.detail ?? 'unknown error'}\n` +
        `The full log is at ${journal.path}\n` +
        `Fix the cause and re-run with --resume to continue from this step.`,
    );
  }

  const now = new Date().toISOString();
  const commitSha = context.commitSha ?? '';
  const ref = context.target?.ref ?? '';

  // A --reinstall over a deployment that was on a different commit genuinely
  // replaced something, and that is the one case where an install has a
  // predecessor worth recording. A --resume of the same commit does not.
  const previousSha =
    existingState !== undefined && existingState.commitSha !== commitSha
      ? existingState.commitSha
      : undefined;

  // Never throws; see host-facts.ts rule 1. Nothing about a deployment that
  // has already built, migrated and verified may hinge on reading /proc.
  const host = await collectHostFacts({ runCommand: context.runCommand });

  const state: DeployState = {
    version: DEPLOY_STATE_VERSION,
    repoUrl: context.target?.url ?? '',
    ref,
    commitSha,
    ...(options.domain === undefined ? {} : { domain: options.domain }),
    bindPort: options.bindPort,
    deployRoot: options.deployRoot,
    installedAt: existingState?.installedAt ?? now,
    lastDeployedAt: now,
    lastCommand: 'install',
    appctlVersion: CLI_VERSION,
    ...(previousSha === undefined ? {} : { previousSha }),
    completedSteps: result.completed,
    ...(host === undefined ? {} : { host }),
    ...(context.proxy === undefined ? {} : { proxy: context.proxy }),
    // Carried forward, because --reinstall and --resume both land here and
    // neither is a reason to forget what this server has deployed before.
    ...(existingState?.history === undefined ? {} : { history: existingState.history }),
  };

  // Appended only now, on the success path: the pipeline reported no failed
  // step, so a deployment did happen.
  writeState(
    appendDeployment(state, {
      at: now,
      command: 'install',
      commitSha,
      ...(previousSha === undefined ? {} : { previousSha }),
      ref,
      durationMs: Date.now() - startedAt,
      appctlVersion: CLI_VERSION,
      outcome: 'success',
    }),
  );

  journal.finish('success');

  const admin = context.env?.get('INITIAL_ADMIN_EMAIL') ?? 'the admin address';
  const url =
    options.domain === undefined
      ? `http://127.0.0.1:${options.bindPort}`
      : `https://${options.domain}`;

  return {
    deployRoot: options.deployRoot,
    commitSha: context.commitSha ?? '',
    journalPath: journal.path,
    ...(options.domain === undefined ? {} : { domain: options.domain }),
    // The seed writes the ALLOWLIST row, not a user account. Nobody is an
    // admin until this login happens, and an install that does not say so
    // looks broken.
    nextStep: `Log in at ${url} as ${admin} to claim the Admin role.`,
  };
}

/** Slug used for the default deploy root, from the repository name. */
export function defaultRootFor(repoUrl: string, base: string): string {
  const name = basename(repoUrl).replace(/\.git$/, '') || 'app';
  return join(base, name.toLowerCase());
}

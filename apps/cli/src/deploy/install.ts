import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { CLI_NAME } from '../branding.js';
import { PreconditionError, UsageError } from '../errors.js';
import { CLI_VERSION } from '../package-info.js';
import { ALL_CHECKS, checksPassed, requiredChecks, runChecks } from './checks/index.js';
import { parseEnvExample, parseEnvFile } from './env-spec.js';
import { writeEnvFile } from './env-file.js';
import { isDeployment } from './deployment-evidence.js';
import { runEnvWizard } from './env-wizard.js';
import type { EnvGroup } from './env-metadata.js';
import { runCommand as defaultRunCommand } from './executor.js';
import { waitForHealthy, collectHealth, isHealthy } from './health.js';
import type { DeployHooks } from './hooks.js';
import { openJournal, type Journal, type SecretEntry } from './journal.js';
import { bootstrapProxyRoot, installVhost, issueCertificate, type ProxyTarget } from './proxy.js';
import { ensureCheckout, resolveRepoTarget, type RepoTarget } from './repo.js';
import {
  DEPLOY_STATE_VERSION,
  readState,
  writeState,
  type DeployState,
} from './state.js';
import { runPipeline, type DeployStep, type StepContext } from './steps/pipeline.js';
import {
  checkoutPathFor,
  publishVersion,
  runVersionStep,
  stampAppVersion,
  type VersionStepResult,
} from './version-step.js';
import { writeDeployInfo } from './deploy-info.js';
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
  noCache?: boolean | undefined;
  force?: boolean | undefined;
  email?: string | undefined;
  staging?: boolean | undefined;
  runCommand?: typeof defaultRunCommand | undefined;
  hooks?: DeployHooks | undefined;
  promptContext?: PromptContext | undefined;
  cwd?: string | undefined;
  /**
   * The release version to deploy, overriding the suggested patch bump.
   *
   * Rejected outright when it does not sort ABOVE the clone's current version
   * -- see app-version.ts. Absent means "suggest the patch bump".
   */
  appVersion?: string | undefined;
  /** Deploy the clone's current version unchanged: no write, no commit, no push. */
  noVersionBump?: boolean | undefined;
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
  /** Undefined means the directory-derived default; see composeProjectFor. */
  composeProject?: string | undefined;
  /** The result of the `version` step, read by `publish-version`. */
  version?: VersionStepResult | undefined;
}

export function composeCwd(deployRoot: string): string {
  // The relative build contexts in base.compose.yml (`../..`, `../nginx`)
  // resolve against the COMPOSE FILE's directory, so this is not incidental.
  return join(deployRoot, 'repo', 'infra', 'compose');
}

/**
 * The compose project name for a deployment.
 *
 * ⚠ THIS IS AN OUTAGE WAITING TO HAPPEN IF GOT WRONG, so read before changing.
 *
 * Without `-p`, Compose derives the project name from the compose file's
 * DIRECTORY, which is `compose` for every deployment on the host -- so two
 * applications collide on one project and each `up -d` fights the other. That
 * is the bug this fixes.
 *
 * But naming an EXISTING deployment's project renames it, and Compose then
 * sees no existing containers: it builds a parallel stack that collides with
 * the old one still holding the bind port. A bookkeeping change would have
 * caused an outage.
 *
 * So the name is RECORDED, never derived at the call site. A deployment that
 * was installed before this existed stays on `compose` for ever; only a fresh
 * install gets its own name. `state.composeProject` is the record, and the
 * absence of it means `compose` -- which is exactly what every deployment in
 * the field has.
 */
export const LEGACY_COMPOSE_PROJECT = 'compose';

export function composeProjectFor(
  state: { composeProject?: string | undefined } | undefined,
): string {
  return state?.composeProject ?? LEGACY_COMPOSE_PROJECT;
}

export function composeArgv(extra: readonly string[], project?: string): string[] {
  return [
    'docker',
    'compose',
    ...(project === undefined ? [] : ['-p', project]),
    ...COMPOSE_FILES.flatMap((file) => ['-f', file]),
    ...extra,
  ];
}

/**
 * Creates every directory compose bind-mounts from, before compose runs.
 *
 * =============================================================================
 * ⚠ CALLED BEFORE **EVERY** COMPOSE INVOCATION, NOT JUST BEFORE `up`
 * =============================================================================
 *
 * Docker creates a missing bind SOURCE itself, as `root:root`, the moment it
 * instantiates the service that mounts it -- and `compose run --rm --no-deps
 * api` instantiates the api service just as thoroughly as `up` does. So
 * `migrate`, two steps before `start`, was already creating
 * `<deployRoot>/deploy-info` owned by root; the `mkdirSync` at `start` then
 * no-opped on a directory that already existed, and the `deploy-info` step
 * later got EACCES writing into it.
 *
 * Every step reported green. The deployment was up, healthy and serving; only
 * the About page was permanently empty, and the one line saying why was a
 * warning in a journal nobody reads on a successful run.
 *
 * Guarding the ORDER was the original fix and it was the wrong shape: it left
 * the invariant depending on which step happens to come first, so adding a
 * compose call earlier in the pipeline silently reintroduces the bug. Guarding
 * the CALL makes that unrepresentable. `mkdirSync` with `recursive` is a no-op
 * when the directory is already there, so the cost is one syscall.
 */
function ensureBindSources(deployRoot: string): void {
  mkdirSync(join(deployRoot, 'deploy-info'), { recursive: true });
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
  ensureBindSources(context.options.deployRoot);

  const result = await context.runCommand(composeArgv(extra, context.composeProject), {
    cwd: composeCwd(context.options.deployRoot),
    timeoutMs: options?.timeoutMs ?? 30 * 60_000,
    redact: context.journal.redact,
    ...(context.hooks?.onLog === undefined
      ? {}
      : { onLine: (line: string) => context.hooks?.onLog?.(line) }),
  });
  context.journal.command(result);
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
        // Create the shared proxy's directory layout BEFORE the checks that
        // look for it. Both the spec and the runbook promise install does this;
        // until now the checks simply failed instead, so an operator following
        // the documentation on a fresh VPS hit a refusal it told them would not
        // happen. Directories only -- the proxy itself is shared infrastructure
        // this deployment is a tenant of, not an owner of.
        if (context.options.skipProxy !== true) {
          const { created } = bootstrapProxyRoot(context.options.proxyRoot, context.hooks);
          for (const path of created) context.journal.line(`Created ${path}`);
        }

        const results = await runChecks(requiredChecks(ALL_CHECKS), {
          runCommand: context.runCommand,
          deployRoot: context.options.deployRoot,
          bindPort: context.options.bindPort,
          proxyRoot: context.options.proxyRoot,
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
        //
        // A BLANK ANSWER IS NOT AN ANSWER, though, and this is the guard that
        // says so. The TUI collects every essential key into a form and hands
        // the whole map over, so a field the operator left alone arrives as
        // `''`. Letting that beat the on-disk value means a re-install over a
        // live deployment overwrites the secrets it did not ask about - and for
        // `SECRETS_ENCRYPTION_KEY` that makes every credential encrypted under
        // the old key permanently undecryptable, with no visible symptom.
        //
        // Dropping blanks here means "leave it as it is" survives the round
        // trip, which is what an untouched field means in every UI anyone has
        // ever used.
        const supplied = new Map(
          [...(context.options.answers ?? new Map<string, string>())].filter(
            ([, value]) => value !== '',
          ),
        );
        const existing =
          context.options.answers === undefined
            ? onDisk
            : new Map([...(onDisk ?? new Map()), ...supplied]);

        const domain = context.options.domain;
        if (domain === undefined && context.options.skipProxy !== true) {
          throw new UsageError(
            'A domain is required so APP_URL and the OAuth callback can be derived. Pass --domain.',
          );
        }

        const { values } = await runEnvWizard({
          specs,
          // With --skip-proxy and no --domain there is no public hostname to
          // derive from, and localhost is the honest stand-in: APP_URL and the
          // OAuth callback then point where the stack actually answers.
          domain: domain ?? 'localhost',
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

        // ⚠ THE CLI'S OWN KEY, AND THE BIND MOUNT DOES NOT WORK WITHOUT IT.
        //
        // `DEPLOY_ROOT` was READ in three places and written in none:
        //
        //   - `vps.compose.yml` interpolates it for the deploy-info bind mount
        //     source. Unset, it falls back to `./.deploy/deploy-info` --
        //     relative to the compose directory -- so the api container mounts
        //     an empty directory Docker created, and the About page reports
        //     `absent` for ever. Every step still reports green, because the
        //     stack is up and the fallback path is perfectly valid.
        //   - `layout.ts` uses it as the marker identifying an `.env` THIS CLI
        //     wrote, so `deploy list` and the ambiguity refusal labelled every
        //     deployment we had written as unmarked.
        //   - `version-step.ts`'s comment describes it as already being there.
        //
        // It is deliberately absent from `.env.example` -- that is what makes
        // it a usable marker, since a stranger's file cannot have it -- so it
        // lands under the serializer's own `# Not in .env.example` banner.
        //
        // ⚠ `COMPOSE_PROJECT_NAME` is deliberately NOT written here. The
        // project name reaches compose through `-p` on every invocation this
        // CLI makes, and writing it into an EXISTING deployment's `.env`
        // renames the project: compose then sees no existing containers,
        // builds a parallel stack, and collides with the old one on the bind
        // port. That is an outage caused by a bookkeeping change, and `-p`
        // already solves the problem it would solve.
        values.set('DEPLOY_ROOT', context.options.deployRoot);

        mkdirSync(composeCwd(context.options.deployRoot), { recursive: true });
        writeEnvFile(path, values, specs);

        context.env = values;
        context.journal.line(`Wrote ${path} (${values.size} variables)`);
      },
    },
    {
      id: 'validate-environment',
      title: 'Validate the environment',
      async run(context) {
        if (context.env === undefined) return;

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

        if (!checksPassed(results)) {
          throw new PreconditionError(
            `The database is not usable with these settings:\n` +
              results
                .filter((result) => result.status === 'fail')
                .map((result) => `  - ${result.detail}\n    ${result.remedy ?? ''}`)
                .join('\n'),
          );
        }
      },
    },
    {
      id: 'version',
      title: 'Choose the release version',
      // ⚠ NO `skip` FOR --no-version-bump. The flag means "do not bump", not
      // "do not stamp": the step still writes the clone's CURRENT version into
      // the `.env`, because skipping it entirely would leave the container
      // reporting whatever APP_VERSION the last deploy happened to set.
      async run(context) {
        // ⚠ IMMEDIATELY BEFORE `build`, AND IT COMMITS. The checkout step
        // refuses a dirty tree, so leaving manifests dirty across a
        // four-minute build would wedge the NEXT update behind a refusal about
        // files the operator never touched. See version-step.ts's header.
        const result = await runVersionStep({
          checkoutPath: checkoutPathFor(context.options.deployRoot),
          ...(context.options.appVersion === undefined
            ? {}
            : { requested: context.options.appVersion }),
          ...(context.options.noVersionBump === undefined
            ? {}
            : { disabled: context.options.noVersionBump }),
          runCommand: context.runCommand,
        });

        context.version = result;
        context.journal.line(`Version: ${result.detail}`);

        // ⚠ The DEPLOYED COMMIT IS THE BUMP COMMIT. Recording the pre-bump one
        // leaves every server reporting itself a commit behind for ever,
        // rebuilding identical code and bumping again on every update. It is
        // also more accurate: the commit happens before `build`, so the images
        // really were built with HEAD here.
        if (result.commitSha !== undefined) context.commitSha = result.commitSha;

        // ⚠ STAMPED ON DISK, NOT JUST IN MEMORY. `context.env` is the wizard's
        // map and nothing writes it again after the `environment` step, so an
        // in-memory set alone would leave the running container on whatever
        // APP_VERSION the last deploy wrote. The disk write is what the build
        // and the api container actually read.
        const stamped = stampAppVersion(
          envFilePath(context.options.deployRoot),
          join(composeCwd(context.options.deployRoot), '.env.example'),
          result.version,
        );
        context.env?.set('APP_VERSION', result.version);
        if (!stamped) {
          context.journal.line('APP_VERSION was not stamped: no .env on disk yet.');
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
        // The bind sources are created by `ensureBindSources`, which runs
        // before EVERY compose invocation -- see its header for why doing it
        // here, one step before `up`, was not enough.
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
          ...(context.composeProject === undefined
            ? {}
            : { composeProject: context.composeProject }),
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
      id: 'deploy-info',
      title: 'Record what was deployed',
      async run(context) {
        // ⚠ IMMEDIATELY AFTER `health`, NOT AT THE END. If the API is
        // answering, the application demonstrably IS deployed and the About
        // page should say so. Written at the end, a failure in `publish` --
        // which runs between here and there -- would leave that page reporting
        // nothing at all about a deployment that is up and serving, which is
        // exactly when somebody is looking at it.
        const now = new Date().toISOString();
        const result = writeDeployInfo(context.options.deployRoot, {
          name: basename(context.options.deployRoot),
          ...(context.version?.version === undefined
            ? {}
            : { version: context.version.version }),
          ...(context.commitSha === undefined ? {} : { commitSha: context.commitSha }),
          ...(context.target?.ref === undefined ? {} : { ref: context.target?.ref }),
          // The first install is `now`; a --reinstall keeps the original.
          installedAt: readState(context.options.deployRoot)?.installedAt ?? now,
          updatedAt: now,
          cliVersion: CLI_VERSION,
          ...(context.options.domain === undefined ? {} : { domain: context.options.domain }),
          // What THIS run has finished by the health gate -- not the resume
          // set, which is what a PREVIOUS run finished.
          completed: [...(context.progress ?? [])],
        });

        // ⚠ BOOKKEEPING, NOT THE DEPLOYMENT. By this point the stack is up and
        // answering; a file this CLI could not write is a warning, never a
        // failure that undoes a successful deploy.
        context.journal.line(
          result.written
            ? `Wrote ${result.path}`
            : `warning: could not write ${result.path}: ${result.error ?? 'unknown'}`,
        );
        if (!result.written) {
          context.hooks?.onProgress?.(`warning: deployment record not written (${result.error ?? 'unknown'})`);
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

        // Certificate FIRST. See rule 4 in the header.
        await issueCertificate(target, {
          runCommand: context.runCommand,
          email,
          ...(context.options.staging === undefined ? {} : { staging: context.options.staging }),
          ...(context.hooks === undefined ? {} : { hooks: context.hooks }),
        });

        await installVhost(target, {
          runCommand: context.runCommand,
          ...(context.hooks === undefined ? {} : { hooks: context.hooks }),
          ...(context.env?.get('MAX_FILE_SIZE') === undefined
            ? {}
            : { maxBodyBytes: Number(context.env.get('MAX_FILE_SIZE')) }),
        });
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
          ...(context.composeProject === undefined
            ? {}
            : { composeProject: context.composeProject }),
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
      },
    },
    {
      id: 'publish-version',
      title: 'Publish the release version',
      skip: (context) =>
        context.version?.bumped === true ? undefined : 'no version was bumped',
      async run(context) {
        // ⚠ PUSH LAST, AFTER VERIFY -- not at the health gate. Pushing to a
        // shared repository is irreversible and externally visible: a version
        // not pushed is re-derived next run, while a version pushed for a
        // deploy that did not finish is a commit someone has to reason about.
        const result = await publishVersion({
          checkoutPath: checkoutPathFor(context.options.deployRoot),
          ref: context.target?.ref ?? 'main',
          result: context.version as VersionStepResult,
          runCommand: context.runCommand,
        });

        // ⚠ A FAILED PUSH IS A WARNING, NEVER A FAILURE. By this point the app
        // is built, migrated, started, answering and verified. The rollback
        // keeps the clone level with origin; the deployment keeps the version.
        context.journal.line(`Publish: ${result.detail}`);
        if (!result.pushed) context.hooks?.onProgress?.(`warning: ${result.detail}`);
      },
    },
  ];
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
  const existingState = readState(options.deployRoot);

  // The mirror of the defect `update` had, and the same wrong question asked
  // from the other side. Guarding on the RECORD means a deployment whose state
  // file was lost -- containers running, certificate issued, site serving -- is
  // not recognised here either, so `install` proceeds and clobbers it: a fresh
  // checkout over the live one, a re-run wizard over the live `.env`.
  //
  // The guard is EVIDENCE OR RECORD. Either is enough to say something is
  // already here; requiring both would reintroduce the same gap.
  const alreadyDeployed = existingState !== undefined || isDeployment(options.deployRoot);

  if (alreadyDeployed && options.reinstall !== true && options.resume !== true) {
    const at =
      existingState === undefined
        ? 'it has a checkout and an environment file, but no deployment record'
        : `${existingState.commitSha.slice(0, 12)}`;
    throw new UsageError(
      `A deployment already exists at ${options.deployRoot} (${at}). Use \`${CLI_NAME} deploy update\` to bring it up to date, or --reinstall to start over.`,
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

  // A FRESH install gets its own compose project; anything already here keeps
  // the one it is running under. See composeProjectFor for why renaming an
  // existing deployment's project is an outage rather than a tidy-up.
  const composeProject =
    existingState === undefined && !isDeployment(options.deployRoot)
      ? basename(options.deployRoot)
      : composeProjectFor(existingState);

  const context: InstallContext = {
    options,
    runCommand: options.runCommand ?? defaultRunCommand,
    journal,
    hooks: options.hooks,
    composeProject,
    completed:
      options.resume === true && existingState !== undefined
        ? new Set(existingState.completedSteps ?? [])
        : new Set<string>(),
    // Appended by `runPipeline` as each step finishes; read by `deploy-info`.
    progress: [],
  };

  const result = await runPipeline(buildInstallSteps(), context);

  if (result.failed !== undefined) {
    journal.finish('failure', `${result.failed.id}: ${result.failed.detail ?? ''}`);

    // ⚠ THE FAILURE PATH RECORDS WHAT COMPLETED, AND WITHOUT THIS `--resume`
    // RESUMES NOTHING. `completedSteps` was written only on the SUCCESS path
    // below, so the one run that needs resuming -- a failed one -- left no
    // record of its progress, and the flag the error message recommends in the
    // very next line skipped zero steps and rebuilt everything. The message
    // was true about intent and false about behaviour.
    //
    // The record is marked `lastOutcome: 'failure'` so nothing downstream
    // mistakes a half-applied attempt for a deployment: `commitSha` is
    // whatever the checkout reached, which may be nothing.
    const attemptedAt = new Date().toISOString();
    try {
      writeState({
        ...(existingState ?? {}),
        version: DEPLOY_STATE_VERSION,
        repoUrl: context.target?.url ?? existingState?.repoUrl ?? '',
        ref: context.target?.ref ?? existingState?.ref ?? '',
        commitSha: context.commitSha ?? existingState?.commitSha ?? '',
        bindPort: options.bindPort,
        deployRoot: options.deployRoot,
        installedAt: existingState?.installedAt ?? '',
        lastDeployedAt: existingState?.lastDeployedAt ?? '',
        lastCommand: 'install',
        appctlVersion: CLI_VERSION,
        composeProject,
        ...(options.domain === undefined ? {} : { domain: options.domain }),
        ...(options.proxyRoot === undefined ? {} : { proxyRoot: options.proxyRoot }),
        completedSteps: result.completed,
        lastOutcome: 'failure',
        lastFailedStep: result.failed.id,
        lastAttemptAt: attemptedAt,
      } as DeployState);
    } catch {
      // ⚠ BOOKKEEPING, NEVER THE FAILURE ITSELF. The deploy has already failed
      // and the operator needs THAT reason, not a second one about a file the
      // CLI could not write while reporting the first.
    }

    throw new Error(
      `${result.failed.title} failed: ${result.failed.detail ?? 'unknown error'}\n` +
        `The full log is at ${journal.path}\n` +
        `Fix the cause and re-run with --resume to continue from this step.`,
    );
  }

  const now = new Date().toISOString();
  writeState({
    version: 1,
    repoUrl: context.target?.url ?? '',
    ref: context.target?.ref ?? '',
    commitSha: context.commitSha ?? '',
    ...(options.domain === undefined ? {} : { domain: options.domain }),
    bindPort: options.bindPort,
    deployRoot: options.deployRoot,
    installedAt: existingState?.installedAt ?? now,
    lastDeployedAt: now,
    lastCommand: 'install',
    appctlVersion: CLI_VERSION,
    // Recorded, never re-derived: see composeProjectFor.
    composeProject,
    // Recorded so update writes the vhost where install put it, rather than
    // re-deriving a path that ignores a non-default --proxy-root.
    ...(options.proxyRoot === undefined ? {} : { proxyRoot: options.proxyRoot }),
    // Recorded so a later `update` knows which opt-in groups this deployment
    // uses. It cannot be re-derived from the `.env`: a group's keys look
    // identical whether the feature is on or off.
    ...(options.groups === undefined || options.groups.length === 0
      ? {}
      : { groups: [...options.groups] }),
    completedSteps: result.completed,
    // Stated explicitly rather than left absent, so a later reader never has
    // to infer success from the shape of the record.
    lastOutcome: 'success',
    lastAttemptAt: now,
  } as DeployState);

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

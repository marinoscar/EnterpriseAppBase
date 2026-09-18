import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CLI_NAME } from '../branding.js';
import { PreconditionError, UsageError } from '../errors.js';
import { CLI_VERSION } from '../package-info.js';
import { ALL_CHECKS, checksPassed, runChecks } from './checks/index.js';
import { diffEnv, parseEnvExample, parseEnvFile } from './env-spec.js';
import { genuinelyNewKeys } from './env-absence.js';
import { adoptDeployment } from './adopt.js';
import { describeEvidence } from './deployment-evidence.js';
import { writeEnvFile } from './env-file.js';
import { metadataFor, type EnvGroup } from './env-metadata.js';
import { runEnvWizard } from './env-wizard.js';
import { runCommand as defaultRunCommand } from './executor.js';
import { collectHealth, isHealthy, waitForHealthy } from './health.js';
import type { DeployHooks } from './hooks.js';
import { openJournal, type Journal } from './journal.js';
import { certificateStatus, installVhost, issueCertificate, type ProxyTarget } from './proxy.js';
import { ensureCheckout, resolveRepoTarget, type RepoTarget } from './repo.js';
import { NotInstalledError, readState, writeState, type DeployState } from './state.js';
import { runPipeline, type DeployStep, type StepContext } from './steps/pipeline.js';
import {
  checkoutPathFor,
  publishVersion,
  runVersionStep,
  stampAppVersion,
  type VersionStepResult,
} from './version-step.js';
import { composeArgv, composeCwd, composeProjectFor, secretsFrom } from './install.js';
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
  runCommand?: typeof defaultRunCommand | undefined;
  hooks?: DeployHooks | undefined;
  promptContext?: PromptContext | undefined;
  cwd?: string | undefined;
  /** Values collected elsewhere; see InstallOptions.answers. */
  answers?: ReadonlyMap<string, string> | undefined;
  /**
   * Opt-in feature groups. Overrides the set recorded at install time; absent
   * means "whatever this deployment already enabled".
   */
  groups?: EnvGroup[] | undefined;
  /**
   * The release version to deploy, overriding the suggested patch bump.
   *
   * Rejected outright when it does not sort ABOVE the clone's current version
   * -- see app-version.ts. Absent means "suggest the patch bump".
   */
  appVersion?: string | undefined;
  /** Deploy the clone's current version unchanged: no write, no commit, no push. */
  noVersionBump?: boolean | undefined;
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
  /** Set when the remote has not moved, so the rest of the pipeline stands down. */
  unchanged?: boolean | undefined;
  /** The result of the `version` step, read by `publish-version`. */
  version?: VersionStepResult | undefined;
}

/** Certificates are renewed within this window, not on every deploy. */

function envFilePath(deployRoot: string): string {
  return join(composeCwd(deployRoot), '.env');
}

async function compose(
  context: UpdateContext,
  extra: readonly string[],
  options?: { timeoutMs?: number },
): Promise<void> {
  const result = await context.runCommand(composeArgv(extra, composeProjectFor(context.state)), {
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
/**
 * Where this deployment's vhost lives.
 *
 * Prefers the recorded value. The fallback reproduces the old derivation only
 * for records written before the field existed -- it is a compatibility path,
 * not the answer.
 */
function proxyRootFor(context: UpdateContext): string {
  return (
    context.state.proxyRoot ?? join(context.options.deployRoot, '..', '..', 'proxy')
  );
}

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
            // From the record, not reconstructed. Deriving it as
          // `<deployRoot>/../../proxy` silently ignored a non-default
          // --proxy-root given at install time, and wrote the vhost somewhere
          // the proxy does not read.
          proxyRoot: proxyRootFor(context),
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

        // "In the template and not in the file" is NOT the same question as
        // "what did this revision add?". A key is permanently absent for three
        // unrelated reasons - a declined optional, a `never` key, and an
        // opt-in feature group the deployment never enabled - and none of them
        // is drift. `genuinelyNewKeys` applies all three; filtering on
        // `essential || secret` alone re-asked the ENTIRE wizard, database
        // connection included, on an update whose template had not changed.
        //
        // The feature-group class is the one that looks handled and is not:
        // those keys are NOT commented out, so `spec.optional` misses them.
        // Enabled groups come from the flag, else from what install recorded -
        // NEVER from reading the `.env`, for the reason `state.groups` gives.
        const groups = (context.options.groups ??
          (context.state.groups as EnvGroup[] | undefined) ??
          []) as readonly EnvGroup[];
        const added = genuinelyNewKeys(missing, { groups });

        if (added.length === 0) {
          context.journal.line(
            `Template has ${missing.length} variable(s) this deployment does not use; nothing new.`,
          );
          return;
        }

        const needsAnswer = added.filter((spec) => {
          const metadata = metadataFor(spec.key);
          return metadata.essential === true || metadata.secret === true;
        });

        context.journal.line(
          `This revision adds ${added.length} variable(s); ${needsAnswer.length} need a value.`,
        );

        if (needsAnswer.length === 0) {
          // Everything new has a usable default; add them and say so.
          const merged = new Map(current);
          for (const spec of added) {
            merged.set(spec.key, spec.defaultValue);
          }
          // The WRITER still gets the full template spec list, so section
          // banners and key order survive. Only the question list narrows.
          writeEnvFile(path, merged, specs);
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
          // ONLY the new keys. Handing over the full list is the other half of
          // the same defect: even a genuine one-variable revision re-asked
          // everything.
          specs: added,
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

        writeEnvFile(path, values, specs);
        context.env = values;
      },
    },
    {
      id: 'version',
      title: 'Choose the release version',
      // ⚠ `skipWhenUnchanged` FIRST, and it is load-bearing. An update that
      // finds the remote has not moved rebuilds nothing -- so bumping the
      // version here would commit and push a release for code nobody changed,
      // then find the remote HAS moved next time and do it again: a bump
      // treadmill driven entirely by its own commits. A version belongs to a
      // deploy that actually deployed something.
      // ⚠ `skipWhenUnchanged` ONLY, and it is load-bearing. An update that
      // finds the remote has not moved rebuilds nothing -- so bumping here
      // would commit and push a release for code nobody changed, then find the
      // remote HAS moved next time and do it again: a bump treadmill driven
      // entirely by its own commits. `--no-version-bump` is handled INSIDE the
      // step instead, because it still stamps the current version.
      skip: skipWhenUnchanged,
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
          ...(composeProjectFor(context.state) === undefined
            ? {}
            : { composeProject: composeProjectFor(context.state) }),
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
          // From the record, not reconstructed. Deriving it as
          // `<deployRoot>/../../proxy` silently ignored a non-default
          // --proxy-root given at install time, and wrote the vhost somewhere
          // the proxy does not read.
          proxyRoot: proxyRootFor(context),
        };

        const status = certificateStatus(target);
        if (!status.exists) {
          const email = context.env?.get('INITIAL_ADMIN_EMAIL') ?? '';
          if (email !== '') {
            await issueCertificate(target, {
              runCommand: context.runCommand,
              email,
              ...(context.hooks === undefined ? {} : { hooks: context.hooks }),
            });
          }
        }

        // Rewritten and re-validated so a change to the template reaches an
        // existing deployment; identical content is a no-op with no reload.
        //
        // ⚠ `maxBodyBytes` must be passed here exactly as install passes it.
        // Omitting it does not leave the existing value alone -- the vhost is
        // RE-RENDERED from scratch, so a missing option silently reverts
        // `client_max_body_size` to the 100m default and every upload larger
        // than that starts failing with a 413 after an unrelated update.
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
      skip: skipWhenUnchanged,
      async run(context) {
        const report = await collectHealth({
          runCommand: context.runCommand,
          deployRoot: context.options.deployRoot,
          bindPort: context.state.bindPort,
          ...(composeProjectFor(context.state) === undefined
            ? {}
            : { composeProject: composeProjectFor(context.state) }),
          ...(context.state.domain === undefined || context.options.skipProxy === true
            ? {}
            : { domain: context.state.domain }),
        });

        if (!isHealthy(report)) {
          throw new Error(
            `The stack restarted but is not healthy. Run \`${CLI_NAME} deploy status\` for the detail.`,
          );
        }
      },
    },
    {
      id: 'publish-version',
      title: 'Publish the release version',
      // Keyed on what the `version` step actually did, so every reason it did
      // not bump -- unchanged remote, --no-version-bump, a version already
      // ahead -- lands here as one condition rather than three.
      skip: (context) =>
        context.version?.bumped === true ? undefined : 'no version was bumped',
      async run(context) {
        // ⚠ PUSH LAST, AFTER VERIFY -- not at the health gate. Pushing to a
        // shared repository is irreversible and externally visible: a version
        // not pushed is re-derived next run, while a version pushed for a
        // deploy that did not finish is a commit someone has to reason about.
        const result = await publishVersion({
          checkoutPath: checkoutPathFor(context.options.deployRoot),
          ref: context.target?.ref ?? context.state?.ref ?? 'main',
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

export interface UpdateResult {
  changed: boolean;
  previousSha?: string | undefined;
  commitSha: string;
  journalPath: string;
  durationMs: number;
}

/**
 * The recorded state, or one rebuilt from the deployment itself.
 *
 * ⚠ An UNREADABLE state file is not an unrecorded deployment: the file is
 * there and this build cannot interpret it, which is a different problem
 * deserving a different message. `readState` throws in that case, and this
 * function deliberately does not catch it.
 */
async function resolveStateForUpdate(options: UpdateOptions): Promise<DeployState> {
  const recorded = readState(options.deployRoot);
  if (recorded !== undefined) return recorded;

  const evidence = describeEvidence(options.deployRoot);
  if (!evidence.isDeployment) {
    // Genuinely nothing here. Name which half is missing rather than asserting
    // a bare negative the operator cannot act on.
    const missing = [
      evidence.hasCheckout ? undefined : 'a checkout at repo/',
      evidence.hasEnv ? undefined : 'a readable environment file',
    ].filter((part): part is string => part !== undefined);

    throw new NotInstalledError(
      `No deployment found at ${options.deployRoot}: it is missing ${missing.join(' and ')}. ` +
        `Run \`${CLI_NAME} deploy install\` first, or pass --root if it is somewhere else.`,
    );
  }

  // The clone's own origin is the only honest source for these; the CLI must
  // never name a repository of its own.
  const target = await resolveRepoTarget({
    ...(options.ref === undefined ? {} : { refFlag: options.ref }),
    cwd: join(options.deployRoot, 'repo'),
    runCommand: options.runCommand ?? defaultRunCommand,
  });

  return adoptDeployment({
    deployRoot: options.deployRoot,
    repoUrl: target.url,
    ref: target.ref,
    // Left empty on purpose: the `fetch` step resolves the real HEAD, and a
    // guess here would be recorded as the deployed commit.
    commitSha: '',
    fallbackBindPort: DEFAULT_ADOPTED_BIND_PORT,
  });
}

/** Only used when an adopted `.env` names no APP_BIND_PORT. */
const DEFAULT_ADOPTED_BIND_PORT = 3535;

export async function runUpdate(options: UpdateOptions): Promise<UpdateResult> {
  // The precondition install does not have, and the reason this is its own
  // command: nothing to update is a different situation from nothing installed.
  //
  // But "nothing to update" is a question about the DEPLOYMENT, not about the
  // CLI's bookkeeping. Asking the second refused to update a live, serving
  // deployment because a JSON file was missing -- telling the operator there
  // was no deployment while they stood in one, and pointing them at `install`,
  // whose precondition is the opposite. Where the record is missing and the
  // evidence is there, ADOPT.
  const state = await resolveStateForUpdate(options);
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
    journal.finish('success', 'already up to date');
    return {
      changed: false,
      commitSha: context.commitSha ?? state.commitSha,
      journalPath: journal.path,
      durationMs: Date.now() - startedAt,
    };
  }

  writeState({
    ...state,
    ref: context.target?.ref ?? state.ref,
    commitSha: context.commitSha ?? state.commitSha,
    previousSha: context.previousSha,
    lastDeployedAt: new Date().toISOString(),
    lastCommand: 'update',
    appctlVersion: CLI_VERSION,
  } as DeployState);

  journal.finish('success');

  return {
    changed: true,
    ...(context.previousSha === undefined ? {} : { previousSha: context.previousSha }),
    commitSha: context.commitSha ?? state.commitSha,
    journalPath: journal.path,
    durationMs: Date.now() - startedAt,
  };
}


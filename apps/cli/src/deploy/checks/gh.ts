import type { DeployHooks } from '../hooks.js';
import type { Check, CheckContext, CheckResult } from './types.js';

// =============================================================================
// The GitHub CLI, and whether this server actually needs it  (issue #390)
// =============================================================================
//
// `gh` is not a prerequisite of a deployment. It is a prerequisite of ONE
// deployment: the one whose repository is private, reached over https, on a
// server that has no credential for it. Everywhere else - a public repository,
// or an ssh remote backed by a deploy key - git clones happily and `gh` is
// never invoked at all.
//
// So these two checks are `recommended`, and the BRANCH decides whether the
// result is `fail` or `warn`. That is the shape commit 4ff1dea established for
// `certbot-installed`, and the reason is rule 3 of the contract: severity is
// static and drives the exit code, so a check that must report differently in
// two situations does it by choosing its status, not by mutating its severity.
// A dynamic-severity mechanism would mean `requiredChecks()` could not be
// computed without running the checks first, which is exactly what install's
// preflight needs to do in advance.
//
// THE PRICE OF THAT, STATED PLAINLY: a promoted `fail` here is displayed as a
// failure and still exits 0, because `checksPassed` only consults `required`.
// It is a loud, correctly-worded warning, not a gate. Making it a gate would
// mean failing every public-repository deployment on this server for the
// absence of a tool it will never run.
//
// FORGE NEUTRALITY. Nothing in this file names a forge, an owner or a
// repository. The promotion keys off the URL's SHAPE - "https, and git cannot
// already read it" - which is the property that actually predicts whether the
// clone needs a credential. Hardcoding a hostname would reintroduce the exact
// template defect `repo.ts` is built to avoid, and its guard test exists
// because an earlier draft did precisely that.
// =============================================================================

/** Long enough for a network round trip, short enough not to look hung. */
const PROBE_TIMEOUT_MS = 20_000;

/**
 * Only what the credential helpers need, so `repo.ts` can call them.
 *
 * The same narrowing `RenewalProbeContext` makes in tls.ts, and for the same
 * reason: a full `CheckContext` demands a bind port and a proxy root that a
 * clone has no opinion about, and inventing values for them at the call site
 * would be a lie about what this reads.
 */
export type CredentialProbeContext = Pick<CheckContext, 'runCommand' | 'deployRoot'> & {
  repoUrl?: string | undefined;
};

/** Runs a command purely to see whether it works. Never throws. */
async function probe(
  context: CredentialProbeContext,
  argv: readonly string[],
  env?: NodeJS.ProcessEnv,
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const result = await context.runCommand(argv, {
      cwd: process.cwd(),
      timeoutMs: PROBE_TIMEOUT_MS,
      ...(env === undefined ? {} : { env }),
    });
    return { ok: true, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
  } catch (error) {
    const failure = error as { result?: { stdout?: string; stderr?: string } };
    return {
      ok: false,
      stdout: (failure.result?.stdout ?? '').trim(),
      stderr:
        (failure.result?.stderr ?? '').trim() ||
        (error instanceof Error ? error.message : String(error)),
    };
  }
}

/**
 * What the repository this deployment clones needs from a credential.
 *
 *   `not-needed` - an ssh remote (a deploy key's job, which `gh` cannot help
 *                  with), or an https remote git can already read.
 *   `needed`     - an https remote git cannot read without being credentialed.
 *   `unknown`    - no repository could be determined, so nothing is claimed.
 */
export type CredentialNeed = 'not-needed' | 'needed' | 'unknown';

/**
 * The repository URL, as a shape to reason about - never as something printed.
 *
 * An https URL may carry an embedded token, so this value never reaches a
 * `detail`, a `remedy` or a log line; only the CONCLUSION drawn from it does.
 */
async function resolveRepoUrl(
  context: CredentialProbeContext,
): Promise<string | undefined> {
  if (context.repoUrl !== undefined && context.repoUrl !== '') return context.repoUrl;

  // The deployed checkout first - on an update that is the repository being
  // redeployed - then the checkout appctl is being run from, which is what
  // `resolveRepoTarget` falls back to on a first install.
  for (const cwd of [`${context.deployRoot}/repo`, process.cwd()]) {
    const remote = await probe(context, ['git', '-C', cwd, 'remote', 'get-url', 'origin']);
    const url = remote.stdout.split('\n')[0]?.trim() ?? '';
    if (remote.ok && url !== '') return url;
  }
  return undefined;
}

/**
 * Whether the repository actually needs a credential this server lacks.
 *
 * `git ls-remote` is the probe because it asks the question directly rather
 * than inferring it: it succeeds for a public repository, succeeds for a
 * private one a credential helper already serves, and fails for one that needs
 * a credential nothing can supply. It reads; it writes nothing, clones
 * nothing, and touches no file - rule 4.
 *
 * GIT_TERMINAL_PROMPT=0 is what keeps that true in the failing case. Without
 * it git asks for a username on a terminal, and a `doctor` run that blocks
 * forever on a hidden prompt is worse than one that reports nothing.
 */
export async function assessCredentialNeed(
  context: CredentialProbeContext,
): Promise<CredentialNeed> {
  const url = await resolveRepoUrl(context);
  if (url === undefined) return 'unknown';

  // SHAPE, not hostname. An ssh remote is served by a deploy key; `gh` plays
  // no part in it, so its absence is never a promotion.
  if (!/^https?:\/\//i.test(url)) return 'not-needed';

  const reachable = await probe(
    context,
    ['git', 'ls-remote', '--exit-code', '--heads', url],
    { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  );
  return reachable.ok ? 'not-needed' : 'needed';
}

// =============================================================================
// ...AND ACTING ON IT, ONCE, BEFORE THE FIRST CLONE  (issue #391, epic #388)
// =============================================================================
//
// `assessCredentialNeed` above already answers "does this clone need a
// credential this server does not have". Installing one is the other half, and
// it lives HERE rather than in repo.ts deliberately: repo.ts names no forge, no
// owner, no repository and no URL - repo.test.ts asserts it - and the tool that
// can hand git a credential is a forge's own CLI. Keeping that knowledge in
// this file, and exporting the operation through `checks/index.ts`, lets repo.ts
// ask for "whatever credential this remote needs" without learning which forge
// is involved. A second detector was the alternative and is worse: the
// promotion rule the checks report and the action the clone takes would then be
// free to disagree about the same server.
// =============================================================================

/** What `prepareGitCredentials` did, as something a caller can report. */
export type CredentialSetup = 'not-needed' | 'configured' | 'unavailable' | 'failed';

export interface PrepareCredentialsOptions extends CredentialProbeContext {
  hooks?: DeployHooks | undefined;
}

/**
 * Credentials git for the upcoming clone, when it genuinely needs them.
 *
 * NEVER THROWS, and never blocks the clone. Every outcome other than
 * `configured` means "nothing was changed", and the clone proceeds to fail (or
 * succeed) on its own terms - `ensureCheckout` already turns an authentication
 * failure into an actionable message, and replacing that with an error about a
 * missing helper would be a worse diagnosis of the same problem.
 *
 * The three non-actions are kept apart because they have different fixes: an
 * ssh remote or a public repository needs nothing at all, an unauthenticated
 * CLI needs a login, and a setup that fails needs its own output read.
 */
export async function prepareGitCredentials(
  options: PrepareCredentialsOptions,
): Promise<CredentialSetup> {
  // The cheap, decisive question first: an ssh remote (a deploy key's job) and
  // an https remote git can already read are both `not-needed`, and neither
  // costs a subprocess beyond the probe that answers it.
  const need = await assessCredentialNeed(options);
  if (need !== 'needed') return 'not-needed';

  const authenticated = await probe(options, ['gh', 'auth', 'status']);
  if (!authenticated.ok) {
    // Not installed, or installed and logged out. Either way there is no
    // credential to hand over, and saying so is all this can do.
    options.hooks?.onProgress?.(
      'The repository needs a credential and none is available; the clone will report what it needs.',
    );
    return 'unavailable';
  }

  const setup = await probe(options, ['gh', 'auth', 'setup-git']);
  if (!setup.ok) {
    options.hooks?.onProgress?.('Could not configure git credentials; attempting the clone anyway.');
    return 'failed';
  }

  options.hooks?.onProgress?.('Configured git to use the credential already on this server.');
  return 'configured';
}

/**
 * `fail` when the clone genuinely cannot proceed without this, `warn` otherwise.
 *
 * Shared by both checks so the two can never promote on different reasoning.
 */
async function promote(
  context: CheckContext,
  detail: string,
  remedy: string,
): Promise<CheckResult> {
  const need = await assessCredentialNeed(context);
  return need === 'needed'
    ? {
        status: 'fail',
        detail: `${detail}; the repository is reached over https and git cannot read it unaided`,
        remedy,
      }
    : { status: 'warn', detail, remedy };
}

const ghInstalled: Check = {
  id: 'gh-installed',
  title: 'GitHub CLI',
  severity: 'recommended',
  async run(context) {
    const { ok, stdout } = await probe(context, ['gh', '--version']);
    if (ok) {
      return { status: 'pass', detail: stdout.split('\n')[0] ?? 'installed' };
    }

    return await promote(
      context,
      'not installed',
      'Install the GitHub CLI: apt-get install gh (Ubuntu 24.04 and newer; older releases need the cli.github.com apt repository added first).',
    );
  },
};

const ghAuthenticated: Check = {
  id: 'gh-authenticated',
  title: 'GitHub CLI authenticated',
  severity: 'recommended',
  requires: ['gh-installed'],
  async run(context) {
    // `gh auth status` prints to stderr in several released versions, and its
    // output can name accounts and hosts. Neither is echoed: the exit code is
    // the whole answer, and echoing the body risks putting a token in a report
    // the moment someone runs it with --show-token in a wrapper.
    const { ok } = await probe(context, ['gh', 'auth', 'status']);
    if (ok) return { status: 'pass', detail: 'authenticated' };

    return await promote(
      context,
      'not authenticated',
      'Authenticate it: gh auth login',
    );
  },
};

export const GH_CHECKS: readonly Check[] = [ghInstalled, ghAuthenticated];

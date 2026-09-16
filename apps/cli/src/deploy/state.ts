import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { CLI_NAME } from '../branding.js';
import { CliError, EXIT, type ExitCode } from '../errors.js';
import type { ProxyMode } from './proxy.js';

// =============================================================================
// What is deployed here  (issue #173, epic #168)
// =============================================================================
//
// `update` has to answer three questions before it does anything: is anything
// installed, where, and at which commit. `status` needs the same. This file is
// where the answer lives.
//
// IT IS NOT IN ~/.appctl/config.json, AND THAT IS NOT A STYLE CHOICE.
// `writeConfigFile` copies an ALLOW-LIST of fields and drops everything else on
// every write (see config.ts). Deploy state placed there would survive until
// the next `appctl login` and then vanish, turning a working deployment into
// one the CLI believes was never installed. Its own file, next to the
// deployment it describes, also means the state travels with the server rather
// than with whichever operator's home directory happened to run the install.
// =============================================================================

// =============================================================================
// Version 2: what was deployed, and where  (issue #392, epic #388)
// =============================================================================
//
// `host`, `proxy` and `history` exist because this file stopped being only the
// CLI's private bookkeeping. The API reads it and a page in the application
// renders it, so "which machine is this, behind which proxy, and what has been
// deployed here" has to be written down by the only process that knows it -
// the one doing the deploying. Nothing else on the server can reconstruct it
// afterwards: `git log` in the checkout cannot say when a deploy ran, whether
// it succeeded, or which appctl ran it.
//
// NO SECRET MAY EVER ENTER THIS FILE, and that is now a security property
// rather than a preference. It was always 0600 and it always described
// infrastructure; what changed in v2 is that its contents are served over HTTP
// and rendered in a browser. Nothing the env wizard collected, no connection
// string, no password, no token, no certificate material - only the metadata
// above. `state.test.ts` asserts this structurally by running the journal's
// redactor, seeded with every secret the metadata registry knows about, over a
// written state file and requiring it to change nothing.
// =============================================================================

/**
 * Bumped only when a field changes meaning.
 *
 * A version from the future is refused; version 1 is read forward. See
 * `readState`, which explains why the forward read is not optional.
 */
export const DEPLOY_STATE_VERSION = 2;

export const DEPLOY_STATE_FILENAME = '.appctl-deploy.json';

/** Deployment records kept in `DeployState.history`, newest first. */
export const MAX_DEPLOY_HISTORY = 20;

/**
 * The machine this deployment runs on, as it was at the last successful deploy.
 *
 * Every member is collected best-effort and INDEPENDENTLY - see
 * `collectHostFacts`, which never throws and never lets one failed probe lose
 * the rest. A probe that cannot answer records `unknown` rather than dropping
 * its field, so the shape the API validates does not vary with how much of the
 * host happened to be readable.
 */
export interface DeployHostFacts {
  hostname: string;
  /** PRETTY_NAME from /etc/os-release, e.g. "Ubuntu 24.04.1 LTS". */
  os: string;
  /** Kernel release, e.g. "6.8.0-45-generic". */
  kernel: string;
  arch: string;
  cpus: number;
  memoryBytes: number;
  dockerVersion: string;
  composeVersion: string;
  /**
   * The address the internet reaches this server on, when it can be known
   * LOCALLY.
   *
   * Absent behind NAT, and absent rather than guessed: see `collectHostFacts`
   * for why no IP-echo service is called to fill it in.
   */
  publicIp?: string | undefined;
}

/**
 * The shared proxy this deployment was published through.
 *
 * Recorded from the `ProxyRuntime` the `publish` step resolved, because that
 * resolution is the thing an operator cannot see afterwards: the vhost on disk
 * looks the same either way, and which of the two setups was assumed is
 * exactly what issue #389 turned on.
 */
export interface DeployProxyRecord {
  domain: string;
  bindPort: number;
  /**
   * The container the proxy runs in.
   *
   * ABSENT IN HOST MODE, because there is no container then - this mirrors
   * `ProxyRuntime.container` rather than inventing an empty string for a thing
   * that does not exist.
   */
  container?: string | undefined;
  mode: ProxyMode;
  /**
   * The certificate's expiry, when a deploy already knows it.
   *
   * Absent today, and deliberately so: `certificateStatus` reports existence
   * and a path, and `parseNotAfter` returns a rendered doctor result rather
   * than a timestamp, so filling this in would mean spawning `openssl` in the
   * publish step. That is a probe on the deploy's critical path for a value
   * `appctl deploy doctor` already reports, so the field stays optional and
   * unset until something that already reads the certificate can supply it.
   */
  certNotAfter?: string | undefined;
}

/** One deploy that finished. Append with `appendDeployment`. */
export interface DeploymentRecord {
  at: string;
  command: 'install' | 'update';
  commitSha: string;
  /** The revision this replaced. Absent on a first install. */
  previousSha?: string | undefined;
  ref: string;
  durationMs: number;
  appctlVersion: string;
  /**
   * How it ended.
   *
   * Only `success` is written today: a failed run must not leave behind a
   * record that reads as a deployment having happened, and the pipelines
   * append after the pipeline result is known to be clean. `failed` is in the
   * type because the shape is fixed and shared with the API - recording
   * attempts later is then a call site, not a schema change.
   */
  outcome: 'success' | 'failed';
}

export interface DeployState {
  version: typeof DEPLOY_STATE_VERSION;
  /** Resolved from the checkout's own origin; never hardcoded. See #179. */
  repoUrl: string;
  /** Branch, tag or SHA that was requested. */
  ref: string;
  /** The commit actually deployed. */
  commitSha: string;
  /** Public hostname the shared proxy serves this under, if published. */
  domain?: string | undefined;
  /** Loopback port the proxy forwards to. */
  bindPort: number;
  deployRoot: string;
  installedAt: string;
  lastDeployedAt: string;
  lastCommand: 'install' | 'update';
  /** Which appctl wrote this, for diagnosing a state file from the future. */
  appctlVersion: string;
  /** The revision this replaced, for a manual roll-back. */
  previousSha?: string | undefined;
  /**
   * Step ids that completed, so `--resume` can skip them.
   *
   * A rerun after a fixed database password should not rebuild images.
   */
  completedSteps?: string[] | undefined;
  /** The server, refreshed on every successful deploy. Absent when unknown. */
  host?: DeployHostFacts | undefined;
  /** Absent when `--skip-proxy` was used, or when there is no domain. */
  proxy?: DeployProxyRecord | undefined;
  /** NEWEST FIRST, capped at `MAX_DEPLOY_HISTORY`. */
  history?: DeploymentRecord[] | undefined;
}

/**
 * Version 1, exactly as it was, so the upgrade below is checked rather than
 * cast blind.
 *
 * Kept as a type and not a comment: the fields v1 had are what `upgradeFromV1`
 * is allowed to copy, and a future v3 needs this same record of what v2 was.
 */
interface DeployStateV1 {
  version: 1;
  repoUrl: string;
  ref: string;
  commitSha: string;
  domain?: string | undefined;
  bindPort: number;
  deployRoot: string;
  installedAt: string;
  lastDeployedAt: string;
  lastCommand: 'install' | 'update';
  appctlVersion: string;
  previousSha?: string | undefined;
  completedSteps?: string[] | undefined;
}

/**
 * Nothing is installed at this path.
 *
 * EXIT.USAGE: the command was pointed somewhere it cannot work, and the remedy
 * is to run a different command. #178 introduces EXIT.PRECONDITION for a failed
 * doctor check, which is a different condition - the server is not ready, as
 * opposed to the operator asking for the wrong thing - and this deliberately
 * does not borrow it.
 */
export class NotInstalledError extends CliError {
  readonly exitCode: ExitCode = EXIT.USAGE;
}

/** The file exists but this build cannot safely interpret it. */
export class DeployStateError extends CliError {
  readonly exitCode: ExitCode = EXIT.FAILURE;
}

export function deployStatePath(deployRoot: string): string {
  return join(deployRoot, DEPLOY_STATE_FILENAME);
}

/**
 * Reads a version 1 file as version 2.
 *
 * Field by field rather than a spread, for one reason worth stating: a v1 file
 * that has been hand-edited to carry a `history` or a `host` must not have
 * those smuggled through into what the API is told a v1 deployment recorded.
 * The three new members come out ABSENT, never empty - `history: []` would
 * claim this deployment has no past, when the truth is that nothing was
 * keeping one. The next successful deploy fills all three in.
 */
function upgradeFromV1(v1: DeployStateV1): DeployState {
  return {
    version: DEPLOY_STATE_VERSION,
    repoUrl: v1.repoUrl,
    ref: v1.ref,
    commitSha: v1.commitSha,
    ...(v1.domain === undefined ? {} : { domain: v1.domain }),
    bindPort: v1.bindPort,
    deployRoot: v1.deployRoot,
    installedAt: v1.installedAt,
    lastDeployedAt: v1.lastDeployedAt,
    lastCommand: v1.lastCommand,
    appctlVersion: v1.appctlVersion,
    ...(v1.previousSha === undefined ? {} : { previousSha: v1.previousSha }),
    ...(v1.completedSteps === undefined ? {} : { completedSteps: v1.completedSteps }),
  };
}

/**
 * Prepends a record to the history and caps it.
 *
 * Pure and total: a state with no history and a state with twenty both have an
 * answer, and neither the caller's state nor its array is mutated. Newest
 * first because every reader of this - the API, the page it feeds, an operator
 * with `jq` - wants the last deploy, and a reader that wants the oldest can
 * reverse twenty entries.
 *
 * The cap is the point of the helper. This file is read on every `update` and
 * rewritten on every deploy; an uncapped array grows without bound on a server
 * that deploys daily for years, and the entries nobody will ever read are
 * precisely the oldest ones. Twenty is a few months of weekly deploys.
 */
export function appendDeployment(
  state: DeployState,
  record: DeploymentRecord,
): DeployState {
  return {
    ...state,
    history: [record, ...(state.history ?? [])].slice(0, MAX_DEPLOY_HISTORY),
  };
}

/** Returns undefined when nothing is installed; throws when it is unreadable. */
export function readState(deployRoot: string): DeployState | undefined {
  const path = deployStatePath(deployRoot);

  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw new DeployStateError(
      `Cannot read ${path}: ${(error as Error).message}`,
      { cause: error },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new DeployStateError(
      `${path} is not valid JSON. It may have been edited by hand or a previous run may have been interrupted.`,
      { cause: error },
    );
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new DeployStateError(`${path} does not contain a deployment record.`);
  }

  const version = (parsed as { version?: unknown }).version;

  if (version === DEPLOY_STATE_VERSION) {
    return parsed as DeployState;
  }

  // A VERSION 1 FILE IS READ FORWARD, NOT REFUSED, and this branch is the
  // whole reason the version was bumped carefully rather than typed over.
  // Every deployment installed before v2 ships has `version: 1` sitting on
  // disk, and the first `appctl deploy update` afterwards READS that file
  // before it writes one. A plain `!== DEPLOY_STATE_VERSION` would therefore
  // greet every existing server with "remove the file to re-install" - telling
  // an operator to delete the record of a working deployment because this CLI
  // added three optional fields. The upgrade is total because those three
  // fields are optional: v1 knew nothing about the host, the proxy or the
  // deploy history, and absent is the honest answer rather than a guess.
  if (version === 1) {
    return upgradeFromV1(parsed as DeployStateV1);
  }

  // A version from the FUTURE is still refused, and that guard has not
  // softened. Reading it forward is a guess about fields this build has never
  // seen; misreading a state file means updating the wrong checkout or
  // reporting the wrong commit as deployed, and a newer appctl having written
  // it is the likeliest cause.
  throw new DeployStateError(
    `${path} has state version ${String(version)}, but this ${CLI_NAME} understands ${DEPLOY_STATE_VERSION}. Upgrade ${CLI_NAME}, or remove the file to re-install.`,
  );
}

/** Reads the state, or explains that there is nothing here to act on. */
export function requireState(deployRoot: string): DeployState {
  const state = readState(deployRoot);
  if (state === undefined) {
    throw new NotInstalledError(
      `No deployment found at ${deployRoot}. Run \`${CLI_NAME} deploy install\` first, or pass --root if it is somewhere else.`,
    );
  }
  return state;
}

/**
 * Writes the state atomically, 0600.
 *
 * The temp-file-then-rename dance is copied from `writeConfigFile`, whose long
 * comment explains why: a plain `writeFileSync(path, data, { mode })` applies
 * the mode ONLY when it creates the file, so rewriting an existing one silently
 * keeps whatever permissions it already had. `flag: 'wx'` makes the temp file's
 * creation - and therefore its mode - unambiguous, and the rename is atomic, so
 * an interrupted write cannot leave a half-written state file behind.
 */
export function writeState(state: DeployState): string {
  const path = deployStatePath(state.deployRoot);
  const temporary = `${path}.${process.pid}.tmp`;

  mkdirSync(state.deployRoot, { recursive: true });

  try {
    writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx',
    });
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw new DeployStateError(
      `Cannot write ${path}: ${(error as Error).message}`,
      { cause: error },
    );
  }

  return path;
}

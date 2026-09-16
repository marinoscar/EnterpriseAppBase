import { readFile, stat } from 'node:fs/promises';
import { hostname } from 'node:os';

import { Injectable, Logger } from '@nestjs/common';

import { resolveApiVersion } from '../openapi/version';
import {
  DEPLOY_HISTORY_MAX_ENTRIES,
  deployStateSchema,
  type DeployState,
} from './deploy-state.schema';

// =============================================================================
// DeploymentService — what is deployed here, and where (issue #392, epic #388)
// =============================================================================
//
// Two halves, and they are answered from completely different places:
//
//   * `runtime` — facts THIS PROCESS knows about itself. Always available,
//     never absent, never wrong.
//   * `deployment` — the record `appctl deploy` left on the VPS at
//     `<deployRoot>/.appctl-deploy.json`, read through a read-only bind mount.
//     Frequently absent, occasionally unreadable, always untrusted.
//
// THERE IS NO TABLE AND NO MIGRATION BEHIND THIS, deliberately. A row would
// have to be written by something, and the only thing that knows the commit,
// the host and the proxy is the installer — which runs on the VPS, outside this
// container, before this process exists. Writing it from inside the API would
// mean the API guessing at facts it cannot observe (it cannot see the host's
// kernel, its Docker version or its certificate), and a row written at boot
// would go stale the moment a container was restarted without a redeploy. The
// installer's own file is the only artefact with first-hand knowledge, so it is
// the source of truth and this service is a reader.
//
// -----------------------------------------------------------------------------
// ⚠ THE THREE RULES THIS FILE EXISTS TO ENFORCE
// -----------------------------------------------------------------------------
//
//  1. AN ABSENT FILE IS A NORMAL 200. Every environment that was not deployed
//     by `appctl` — every developer laptop, every CI run, every plain
//     `docker compose up` — has no state file, and that is the ordinary case
//     rather than a fault. A 404 or a 503 here would make "this is a local dev
//     box" indistinguishable from "the admin API is broken", and would put an
//     error in the client's console on every page load of a perfectly healthy
//     deployment. `configured: false` is the answer; the UI renders "not
//     configured" from it.
//
//  2. THE FILE IS UNTRUSTED INPUT. See `deploy-state.schema.ts`. Schema-invalid
//     content is reported, not thrown, and no value read out of it is ever
//     interpolated into anything.
//
//  3. NO FILESYSTEM ERROR MAY BECOME A 500. ENOENT, EACCES, a DIRECTORY where a
//     file was expected (which is exactly what Docker creates when a bind mount
//     names a host path that does not exist yet — see
//     `infra/compose/vps.compose.yml`), a truncated read, a half-written file
//     caught mid-rename: each maps to a `reason` and a `configured: false`. The
//     endpoint's job is to describe the deployment, and "I could not read it"
//     is a description.
// =============================================================================

/**
 * Environment variable naming the state file, set by the VPS compose overlay.
 *
 * ⚠ THERE IS NO DEFAULT PATH, ON PURPOSE. A default of
 * `/opt/infra/apps/.appctl-deploy.json` would make every developer machine and
 * every CI container `stat()` a path that belongs to a production layout, on
 * every request to this endpoint — guessing at a host filesystem the process is
 * not deployed on. Unset means "this deployment was not installed by `appctl`",
 * which is the truth, and is reported as `not-found` with a null path.
 */
export const DEPLOY_STATE_FILE_ENV = 'DEPLOY_STATE_FILE';

/**
 * How long a read of the state file is reused before the disk is touched again.
 *
 * WHY CACHE AT ALL: the admin page polls, and an endpoint that `stat()`s and
 * reads a bind-mounted host file on every request turns a refresh loop into
 * filesystem traffic for a value that changes at most once per deployment.
 *
 * WHY THIS SHORT: the window IS the staleness. `appctl deploy update` rewrites
 * the file and an operator reloads the page seconds later expecting the new
 * commit; five seconds is short enough that they never see the old one twice,
 * and long enough to collapse a burst of polls. It matches
 * `MAINTENANCE_PERSISTED_CACHE_MS`, which made the same trade for the same
 * reason. Failures are cached on the same clock — a missing file that is
 * checked every five seconds is the common case, and it must not become the
 * expensive one.
 */
export const DEPLOY_STATE_CACHE_MS = 5_000;

/**
 * Largest file this service will read.
 *
 * A real state file with a full 20-entry history is a few kilobytes. The bound
 * matters because the path is host-controlled: without it, anything that can
 * write to the deploy root can make an admin request read an arbitrarily large
 * file into memory. Over the cap is reported as `invalid` — whatever that file
 * is, it is not a deployment record.
 */
export const MAX_DEPLOY_STATE_BYTES = 64 * 1024;

/**
 * Why there is no deployment record, when there is none.
 *
 *  - `not-found`  — nothing to read: the variable is unset, or the path does
 *                   not exist. The ordinary case off a VPS.
 *  - `unreadable` — the path exists but this process cannot get bytes out of
 *                   it: permissions, or it is a directory rather than a file.
 *                   Operator-actionable, and a different fix from the others.
 *  - `invalid`    — bytes were read and they are not a deployment record:
 *                   malformed JSON, an unknown `version`, a field of the wrong
 *                   type, or a file too large to be one.
 */
export type DeploymentSourceReason = 'not-found' | 'unreadable' | 'invalid';

/** Live facts about the process answering the request. */
export interface DeploymentRuntimeInfo {
  apiVersion: string;
  startedAt: string;
  nodeVersion: string;
  nodeEnv: string;
  hostname: string;
}

/** Where the record was looked for, and what came of looking. */
export interface DeploymentSourceInfo {
  path: string | null;
  reason: DeploymentSourceReason | null;
}

export interface DeploymentInfo {
  configured: boolean;
  deployment: DeployState | null;
  runtime: DeploymentRuntimeInfo;
  source: DeploymentSourceInfo;
}

/** The outcome of one read attempt, cached as a unit. */
interface StateReadResult {
  path: string | null;
  state: DeployState | null;
  reason: DeploymentSourceReason | null;
}

@Injectable()
export class DeploymentService {
  private readonly logger = new Logger(DeploymentService.name);

  private cache: { result: StateReadResult; readAt: number } | null = null;

  /**
   * When this process started, frozen at construction.
   *
   * ⚠ COMPUTED ONCE, NOT PER REQUEST. `Date.now() - process.uptime() * 1000` is
   * an ARITHMETIC RECONSTRUCTION of the start instant, and both terms drift:
   * evaluating it on every request yields a slightly different timestamp every
   * time, so a client polling this endpoint would watch its "started at" value
   * jitter by milliseconds and a diffing UI would re-render on every poll. The
   * start instant is a constant of the process, so it is stored like one.
   *
   * Derived from `process.uptime()` rather than stamped in a module-load
   * constant because uptime measures the PROCESS, not the moment this file
   * happened to be imported — it is correct regardless of how much of the
   * module graph loaded before this service was constructed.
   */
  private readonly startedAt = new Date(
    Date.now() - process.uptime() * 1000,
  ).toISOString();

  async describe(): Promise<DeploymentInfo> {
    const result = await this.readState();

    return {
      configured: result.state !== null,
      deployment: result.state,
      runtime: {
        // The SAME resolver `/api/docs` stamps into `info.version`. A second
        // one here would answer differently the first time somebody set
        // `APP_VERSION` without also updating it, and two version numbers that
        // disagree are worse than none.
        apiVersion: resolveApiVersion(),
        startedAt: this.startedAt,
        nodeVersion: process.version,
        nodeEnv: process.env.NODE_ENV ?? 'development',
        // ⚠ THE CONTAINER'S hostname, which on Docker is the container id —
        // NOT the machine's. The host's own hostname is
        // `deployment.host.hostname`, captured by the installer outside any
        // container, and the two sit in the same response meaning different
        // things.
        //
        // The distinction is carried by the OBJECT this field sits in —
        // `runtime` is "the process answering you", `deployment.host` is "the
        // machine it was installed on" — and by the DTO's prose, not by the
        // field name. `containerHostname` was the alternative and would have
        // been self-describing; it was rejected because this name is the one
        // the response contract fixes and the web client reads, and a
        // better-named field nobody fetches is worse than a documented one
        // everybody does. If the two ever drift apart, the GROUPING is the
        // thing to preserve: never hoist this to the top level, where it would
        // sit beside a host record with nothing to tell them apart.
        hostname: hostname(),
      },
      source: {
        path: result.path,
        reason: result.reason,
      },
    };
  }

  /** Drops the cached read. Exists for tests and for a future manual refresh. */
  invalidateCache(): void {
    this.cache = null;
  }

  private async readState(): Promise<StateReadResult> {
    const now = Date.now();
    if (this.cache !== null && now - this.cache.readAt < DEPLOY_STATE_CACHE_MS) {
      return this.cache.result;
    }

    const result = await this.loadState();
    this.cache = { result, readAt: now };
    return result;
  }

  private async loadState(): Promise<StateReadResult> {
    const configured = process.env[DEPLOY_STATE_FILE_ENV]?.trim();

    if (configured === undefined || configured === '') {
      return { path: null, state: null, reason: 'not-found' };
    }

    // `stat` BEFORE `readFile`, and not as an optimisation: it is the only way
    // to tell ENOENT (normal) from a directory (the Docker bind-mount
    // accident) before a read turns the second into an EISDIR that reads like
    // a bug. It also bounds the read below.
    let info: Awaited<ReturnType<typeof stat>>;
    try {
      info = await stat(configured);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        // ENOTDIR: a path component is a file. Nothing is there either way.
        return { path: configured, state: null, reason: 'not-found' };
      }
      this.logger.warn(
        `Cannot stat the deployment state file at ${configured}: ${code ?? 'unknown error'}`,
      );
      return { path: configured, state: null, reason: 'unreadable' };
    }

    if (!info.isFile()) {
      // Almost always the bind mount that named a path Docker then created as
      // a directory. See `infra/compose/vps.compose.yml` for why the overlay
      // mounts the deploy ROOT and not this file.
      this.logger.warn(
        `The deployment state path ${configured} is not a regular file; ignoring it.`,
      );
      return { path: configured, state: null, reason: 'unreadable' };
    }

    if (info.size > MAX_DEPLOY_STATE_BYTES) {
      this.logger.warn(
        `The deployment state file at ${configured} is ${info.size} bytes, over the ` +
          `${MAX_DEPLOY_STATE_BYTES}-byte limit; ignoring it.`,
      );
      return { path: configured, state: null, reason: 'invalid' };
    }

    let raw: string;
    try {
      raw = await readFile(configured, 'utf8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // Genuinely racy: the installer replaces this file by rename, so a read
      // can land between the unlink and the link. The next poll resolves it,
      // and five seconds of `unreadable` is a far better outcome than a 500.
      this.logger.warn(
        `Cannot read the deployment state file at ${configured}: ${code ?? 'unknown error'}`,
      );
      return { path: configured, state: null, reason: 'unreadable' };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      // ⚠ THE PARSE ERROR IS NOT LOGGED. `JSON.parse` puts the offending input
      // in its message, and this file's contents are not ours to copy into a
      // log aggregator.
      this.logger.warn(
        `The deployment state file at ${configured} is not valid JSON; ignoring it.`,
      );
      return { path: configured, state: null, reason: 'invalid' };
    }

    const validated = deployStateSchema.safeParse(parsed);
    if (!validated.success) {
      // Field PATHS only, never values — the same rule as above. A path tells
      // an operator which key to fix; the value would tell a log reader what
      // the file says.
      const paths = validated.error.issues
        .slice(0, 5)
        .map((issue) => issue.path.join('.') || '(root)')
        .join(', ');
      this.logger.warn(
        `The deployment state file at ${configured} does not match any known state ` +
          `version; ignoring it. Offending fields: ${paths}`,
      );
      return { path: configured, state: null, reason: 'invalid' };
    }

    return { path: configured, state: this.trimHistory(validated.data), reason: null };
  }

  /**
   * Caps the served history at {@link DEPLOY_HISTORY_MAX_ENTRIES}.
   *
   * Done HERE rather than as a `.transform()` on the schema because the same
   * schema types the response DTO, and a Zod transform has no JSON Schema
   * representation — `nestjs-zod` throws while building the OpenAPI document
   * rather than degrading, which takes `/api/docs` down for the entire API at
   * boot. The schema stays declarative; the serving policy lives in the server.
   */
  private trimHistory(state: DeployState): DeployState {
    if (state.version !== 2 || state.history === undefined) return state;
    if (state.history.length <= DEPLOY_HISTORY_MAX_ENTRIES) return state;

    return { ...state, history: state.history.slice(0, DEPLOY_HISTORY_MAX_ENTRIES) };
  }
}

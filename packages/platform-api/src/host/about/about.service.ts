// =============================================================================
// AboutService — assembles the deployment report (issue #401, epic #397)
// =============================================================================
//
// Three independent facts, gathered with a strict rule between them: NO ONE OF
// THEM MAY TAKE DOWN THE OTHER TWO.
//
//   1. The API's own version, from the app's `apiVersion` option (the
//      reference app passes its `resolveApiVersion`). Always available; the
//      resolver never throws and falls back to `'0.0.0'`.
//   2. The deploy document on disk, read fresh per request.
//   3. A database liveness probe: one `SELECT 1` through the `PLATFORM_PRISMA`
//      host port, timed.
//
// Each is obtained inside its own failure boundary, and every failure becomes a
// field. Nothing here throws an HTTP exception, because the controller above it
// has exactly one status code to return and the reason is argued at length in
// `dto/about-response.dto.ts`.
// =============================================================================

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { PLATFORM_PRISMA, type PrismaClientLike } from '../../core/index';
import { DeploymentModeService } from '../deployment/deployment-mode.service';
import { ABOUT_OPTIONS, type ResolvedAboutOptions } from './about.options';
import { readDeployInfo, resolveDeployInfoPath } from './deploy-info';
import type { AboutResponse } from './dto/about-response.dto';

/**
 * When this process started, fixed once at module load. `process.uptime()` is
 * measured from process start, so subtracting it from "now" at load time gives
 * the start instant; computing it per request would drift by clock jitter.
 */
const PROCESS_STARTED_AT = new Date(Date.now() - process.uptime() * 1000).toISOString();

/**
 * Builds the deployment report served at `GET /api/admin/about`.
 *
 * @stability experimental
 */
@Injectable()
export class AboutService {
  private readonly logger = new Logger(AboutService.name);

  constructor(
    @Inject(ABOUT_OPTIONS) private readonly options: ResolvedAboutOptions,
    @Optional() @Inject(PLATFORM_PRISMA) private readonly prisma: PrismaClientLike | undefined,
    // #685. Memory only: the mode was parsed when the container built, so
    // reading it cannot fail and cannot cost the "always answers 200" rule.
    private readonly deployment: DeploymentModeService,
  ) {}

  /**
   * Builds the whole report.
   *
   * ⚠ NO CACHING ANYWHERE IN THIS METHOD, and that is a requirement rather than
   * an omission. `appctl deploy update` rewrites `info.json` in place against a
   * running container; a memoised read — even a short-lived one — would serve a
   * stale commit SHA immediately after the deploy that changed it, which is the
   * one moment anybody looks at this page.
   */
  async describe(): Promise<AboutResponse> {
    const path = resolveDeployInfoPath();
    const deployInfo = await readDeployInfo(path);
    const { database, databaseError } = await this.probeDatabase();

    const document = deployInfo.document;

    return {
      api: { version: this.options.apiVersion(), deploymentMode: this.deployment.mode },

      deployInfoStatus: deployInfo.status,
      deployInfoPath: deployInfo.path,
      deployInfoError: deployInfo.error,

      // Every one of these is `null` when no document was read. Deliberately
      // not "" or a placeholder object — see the DTO's note on fabricated
      // defaults, and note especially that `installedAt`/`updatedAt` never fall
      // back to the current time.
      app: document?.app ?? null,
      installedAt: document?.installedAt ?? null,
      updatedAt: document?.updatedAt ?? null,
      deployedBy: document?.deployedBy ?? null,
      domain: document?.domain ?? null,
      remote: document?.remote ?? null,

      // The third state rides here: a document whose `run.outcome` is
      // `'failure'` still arrives with `deployInfoStatus: 'ok'` and every other
      // field populated, plus `run.failedStep` naming where it stopped.
      run: document?.run ?? null,

      // Issue #392 additions — same `null`-when-no-document rule.
      lastCommand: document?.lastCommand ?? null,
      bindPort: document?.bindPort ?? null,
      proxy: document?.proxy ?? null,
      host: document?.host ?? null,
      history: document?.history ?? null,

      // Live, not from disk — the one part of this report always current.
      runtime: {
        processStartedAt: PROCESS_STARTED_AT,
        nodeVersion: process.version,
        environment: process.env.NODE_ENV?.trim() || null,
      },

      database,
      databaseError,
    };
  }

  /**
   * Asks the database whether it answers: one `SELECT 1` through the
   * `PLATFORM_PRISMA` host port, timed.
   *
   * ⚠ A FAILURE IS A FIELD, NOT A 503. The probe throws when the database does
   * not answer, which is the right contract for a readiness probe (it wants a
   * non-2xx). It is the wrong contract here, so the throw is caught and turned
   * back into data. Letting it escape would mean the one page that reports what
   * is deployed stops loading whenever the database is the thing that is
   * broken, hiding the API version, the commit SHA and the deploy document,
   * none of which need a database to be known.
   */
  private async probeDatabase(): Promise<
    Pick<AboutResponse, 'database' | 'databaseError'>
  > {
    if (!this.prisma) {
      return {
        database: null,
        databaseError: 'No database client is bound to PLATFORM_PRISMA, so there is nothing to probe.',
      };
    }

    const startedAt = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;

      return {
        database: { status: 'up', responseTime: `${Date.now() - startedAt}ms` },
        databaseError: null,
      };
    } catch (error) {
      // Logged at `warn`, not `error`: a page load is not an incident.
      this.logger.warn(
        `Database probe failed while building the about report: ${describe(error)}`,
      );

      return { database: null, databaseError: describe(error) };
    }
  }
}

/**
 * A message for the client that never leaks a stack trace.
 *
 * Only the MESSAGE is taken, never the error object: a stack trace must not
 * reach a response body. An error with no message, or a value that is not an
 * `Error`, still produces a sentence an operator can read.
 */
function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.message.length > 0 ? error.message : 'The database did not answer.';
  }

  return 'Unknown error';
}

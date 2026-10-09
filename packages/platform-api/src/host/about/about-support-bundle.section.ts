// =============================================================================
// The `versions` support-bundle section (issue #772, PP-13.1)
// =============================================================================
//
// The reference app's example of `SupportBundleRegistry.register`: a section
// contributed by the module that owns the facts (About stays in the app until
// it is packaged), registered from `onModuleInit` without importing the
// Doctor module (it is global).
//
// ALLOWLIST, NEVER SPREAD. `AboutService.describe()` is copied field by field
// into a new object, and the schema below is strict, so a field added to the
// About report later never reaches a support bundle until someone adds it
// here on purpose. Deliberately EXCLUDED:
//   - `host.hostname` and `domain`: they identify the customer;
//   - `deployInfoPath`: a local filesystem path;
//   - `deployInfoError` and `databaseError`: free text that may echo file
//     content or a connection string;
//   - `proxy.container`, `proxy.certificateExpiresAt` and `bindPort`;
//   - `run` (the last CLI run's step log);
//   - `history` beyond its length and its last entry.
//
// The About report always answers with partial truth, and so does this
// section: a missing deploy document is `deployInfoStatus: 'missing'` and
// `null` fields, never an error.
// =============================================================================

import { Injectable, OnModuleInit } from '@nestjs/common';
import { SupportBundleRegistry } from '../../doctor/index';
import type { SupportBundleSection } from '../../doctor/index';
import { z } from 'zod';

import { DEPLOYMENT_MODES } from '../deployment/deployment-mode';
import { AboutService } from './about.service';
import { DEPLOY_INFO_STATUSES } from './deploy-info.constants';

const nullableString = z.string().nullable();

export const versionsSectionSchema = z
  .object({
    api: z.object({ version: z.string(), deploymentMode: z.enum(DEPLOYMENT_MODES) }).strict(),
    app: z.object({ name: nullableString, version: nullableString, commitSha: nullableString, ref: nullableString }).strict().nullable(),
    deployedBy: z.object({ cli: nullableString, version: nullableString }).strict().nullable(),
    lastCommand: z.enum(['install', 'update']).nullable(),
    installedAt: nullableString,
    updatedAt: nullableString,
    deployInfoStatus: z.enum(DEPLOY_INFO_STATUSES),
    remote: z.object({ commitsBehind: z.number().nullable(), checkedAt: nullableString }).strict().nullable(),
    runtime: z.object({ nodeVersion: z.string(), environment: nullableString, processStartedAt: z.string() }).strict(),
    database: z.object({ status: z.string() }).strict().nullable(),
    host: z
      .object({
        os: nullableString,
        kernel: nullableString,
        arch: nullableString,
        cpus: z.number().int().nullable(),
        memoryBytes: z.number().int().nullable(),
        dockerVersion: nullableString,
        composeVersion: nullableString,
      })
      .strict()
      .nullable(),
    proxy: z.object({ mode: z.enum(['container', 'host']).nullable() }).strict().nullable(),
    history: z
      .object({
        count: z.number().int(),
        last: z
          .object({
            at: z.string(),
            command: z.enum(['install', 'update']),
            commitSha: nullableString,
            cliVersion: nullableString,
            durationMs: z.number().nullable(),
          })
          .strict()
          .nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();

export type VersionsSectionData = z.infer<typeof versionsSectionSchema>;

@Injectable()
export class AboutSupportBundleSection implements SupportBundleSection<VersionsSectionData>, OnModuleInit {
  readonly id = 'versions';
  readonly label = 'Versions';
  readonly schema = versionsSectionSchema;

  constructor(
    private readonly registry: SupportBundleRegistry,
    private readonly about: AboutService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async collect(): Promise<VersionsSectionData> {
    const report = await this.about.describe();
    // Newest first, as the deploy document orders it (`deploy-info.ts`).
    const last = report.history?.[0] ?? null;

    return {
      api: { version: report.api.version, deploymentMode: report.api.deploymentMode },
      app: report.app
        ? { name: report.app.name, version: report.app.version, commitSha: report.app.commitSha, ref: report.app.ref }
        : null,
      deployedBy: report.deployedBy ? { cli: report.deployedBy.cli, version: report.deployedBy.version } : null,
      lastCommand: report.lastCommand,
      installedAt: report.installedAt,
      updatedAt: report.updatedAt,
      deployInfoStatus: report.deployInfoStatus,
      remote: report.remote ? { commitsBehind: report.remote.commitsBehind, checkedAt: report.remote.checkedAt } : null,
      runtime: {
        nodeVersion: report.runtime.nodeVersion,
        environment: report.runtime.environment,
        processStartedAt: report.runtime.processStartedAt,
      },
      database: report.database ? { status: report.database.status } : null,
      host: report.host
        ? {
            os: report.host.os,
            kernel: report.host.kernel,
            arch: report.host.arch,
            cpus: report.host.cpus,
            memoryBytes: report.host.memoryBytes,
            dockerVersion: report.host.dockerVersion,
            composeVersion: report.host.composeVersion,
          }
        : null,
      proxy: report.proxy ? { mode: report.proxy.mode } : null,
      history: report.history
        ? {
            count: report.history.length,
            last: last
              ? {
                  at: last.at,
                  command: last.command,
                  commitSha: last.commitSha,
                  cliVersion: last.cliVersion,
                  durationMs: last.durationMs,
                }
              : null,
          }
        : null,
    };
  }
}

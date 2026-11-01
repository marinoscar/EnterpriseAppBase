// =============================================================================
// GET /api/admin/doctor/support-bundle, created per app (issue #772, PP-13.1)
// =============================================================================
//
// The controller-factory recipe (core README, "Host ports"), as the Doctor's
// own controller: the class is defined inside a function
// `DoctorModule.forRoot()` calls, with the access decorator the app's host
// supplies, so the route gets exactly the app's `@Auth()`.
//
// A SIBLING of `DoctorController`, not a new handler on it, so the Doctor's
// own OpenAPI operation (`doctor_getReport`) stays word for word what it was.
// Same path prefix, same permission (`system_settings:read` by default): the
// bundle describes the deployment's configuration and health, exactly what
// that permission covers, and no new permission is invented. A section that
// needs more (telemetry needs `telemetry:query`) declares it and is `omitted`
// for a caller without it.
//
// The body is the FILE, not the `{ data, meta }` envelope: the handler writes
// the reply itself (`@Res()`), like the telemetry export.
//
// Not `@AllowDuringMaintenance()`, the same as the Doctor route: the doctor
// section performs network I/O through the checks.
// =============================================================================

import { Controller, ForbiddenException, Get, Inject, Req, Res, Type } from '@nestjs/common';
import { ApiOperation, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { createZodDto } from 'nestjs-zod';
import { supportBundleSchema } from '@marinoscar/platform-contract/doctor';

import type { ResolvedDoctorModuleOptions } from '../doctor.options';
import { SUPPORT_BUNDLE_MAX_BYTES, SUPPORT_BUNDLE_SECTION_MAX_BYTES, SUPPORT_BUNDLE_SUBPATH } from './support-bundle.options';
import { SupportBundleService } from './support-bundle.service';

/**
 * The bundle's OpenAPI schema (from `@marinoscar/platform-contract/doctor`).
 *
 * @stability experimental
 */
export class SupportBundleDto extends createZodDto(supportBundleSchema) {}

/**
 * The shape of the controller class {@link createSupportBundleController} returns.
 *
 * @stability experimental
 */
export interface SupportBundleControllerInstance {
  /**
   * `GET <path>/support-bundle`: builds the bundle and sends it as a JSON attachment.
   *
   * @param request - the framework request (the caller is resolved from it).
   * @param reply - the Fastify reply the file is written to.
   */
  download(request: unknown, reply: FastifyReply): Promise<FastifyReply>;
}

function describeOperation(options: ResolvedDoctorModuleOptions): string {
  return (
    'Builds one JSON file for a support ticket: the doctor report, the deployment versions, ' +
    'a 24-hour telemetry summary and every section the application registers, each validated ' +
    'by its own strict schema and then passed through a central redaction pass that removes ' +
    'secrets and personal data (rules `v1`; `redaction.replacements` counts what it replaced). ' +
    'Raw logs, traces and query results are never included.\n\n' +
    '**Returned as an attachment** (`Content-Disposition: attachment; filename="support-bundle-' +
    `${options.supportBundle.appSlug}-<yyyyMMdd'T'HHmmss'Z'>.json"\`), not in the \`{ data }\` envelope.\n\n` +
    '**Per-section outcome.** `ok` (collected), `omitted` (a section-specific permission is missing — ' +
    'the telemetry section needs `telemetry:query` — or the capability is off) or `error` (the section ' +
    'threw, timed out or broke its schema; its data is dropped). The rest of the bundle is always intact.\n\n' +
    `**Bounded.** Sections run in parallel, each cut off after ${options.supportBundle.sectionTimeoutMs} ms ` +
    `unless it declares otherwise; ${SUPPORT_BUNDLE_SECTION_MAX_BYTES} bytes per section and ` +
    `${SUPPORT_BUNDLE_MAX_BYTES} bytes per bundle (larger sections are truncated). The doctor report is ` +
    'served from its cache, so a download never multiplies probes.\n\n' +
    'Audited as `support_bundle:download`. ' +
    `Requires \`${options.permission}\`.`
  );
}

/**
 * Creates the support bundle's controller class for one set of options: the
 * route at `<options.path>/support-bundle`, guarded by
 * `options.host.access.requirePermissions([options.permission])`.
 * `DoctorModule.forRoot()` calls it; an app never needs to.
 *
 * @param options - the resolved Doctor module options.
 * @returns a controller class named `SupportBundleController` with a `download` handler.
 *
 * @stability experimental
 */
export function createSupportBundleController(options: ResolvedDoctorModuleOptions): Type<SupportBundleControllerInstance> {
  const requireAccess = options.host.access.requirePermissions([options.permission]);

  @ApiTags('Doctor')
  @Controller(options.path)
  class SupportBundleController implements SupportBundleControllerInstance {
    constructor(@Inject(SupportBundleService) private readonly bundles: SupportBundleService) {}

    @Get(SUPPORT_BUNDLE_SUBPATH)
    @requireAccess
    @ApiOperation({
      summary: 'Download a redacted support bundle (Admin only)',
      description: describeOperation(options),
    })
    @ApiProduces('application/json')
    @ApiResponse({
      status: 200,
      description: 'The support bundle, as a JSON attachment.',
      type: SupportBundleDto,
      headers: {
        'Content-Disposition': {
          description: "`attachment; filename=\"support-bundle-<slug>-<yyyyMMdd'T'HHmmss'Z'>.json\"`",
          schema: { type: 'string' },
        },
        'Cache-Control': { description: '`no-store`', schema: { type: 'string' } },
      },
    })
    @ApiResponse({ status: 401, description: 'Not signed in' })
    @ApiResponse({ status: 403, description: `Missing \`${options.permission}\`` })
    async download(@Req() request: unknown, @Res() reply: FastifyReply): Promise<FastifyReply> {
      const actor = options.supportBundle.principal(request);
      if (!actor) throw new ForbiddenException('The caller could not be identified.');

      const built = await this.bundles.download(actor);

      return reply
        .status(200)
        .header('Content-Type', 'application/json; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${built.filename}"`)
        .header('Content-Length', String(built.body.length))
        .header('Cache-Control', 'no-store')
        .header('X-Content-Type-Options', 'nosniff')
        .send(built.body);
    }
  }

  return SupportBundleController;
}

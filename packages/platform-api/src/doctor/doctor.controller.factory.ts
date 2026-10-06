// =============================================================================
// GET /api/admin/doctor, created per app (issue #634; packaged by #696)
// =============================================================================
//
// THE CONTROLLER-FACTORY RECIPE (core README, "Host ports"). A packaged
// controller cannot import the app's `@Auth()`, and Nest applies decorators
// when a class is defined, before any container exists. So the class is
// defined HERE, inside a function `DoctorModule.forRoot()` calls, with the
// decorators the app's host supplies (`options.host.access`). The package
// owns the route, the OpenAPI text and the handler; the app owns the policy.
//
// ⚠ THE OPENAPI DOCUMENT MUST NOT CHANGE when an app moves from its own
// controller to this one:
//   - the class is named `DoctorController` and the handler `getReport`, which
//     the app's operationId factory turns into `doctor_getReport`;
//   - the decorators are applied in the order the app's controller used
//     (`@Get`, access, `@ApiOperation`, the two `@ApiQuery`, the two
//     `@ApiResponse`);
//   - the description text is generated from the options, and with the
//     defaults it is word for word what it was.
//
// `@Inject(DoctorService)` is explicit so dependency injection never depends
// on the decorator metadata of a class declared in a closure.
// =============================================================================

import { Controller, Get, Inject, Query, Type } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { DoctorService } from './doctor.service';
import type { ResolvedDoctorModuleOptions } from './doctor.options';
import { DoctorQueryDto } from './dto/doctor-query.dto';
import { DoctorReport, DoctorReportDto } from './dto/doctor-report.dto';

/**
 * The shape of the controller class {@link createDoctorController} returns.
 *
 * @stability experimental
 */
export interface DoctorControllerInstance {
  /**
   * `GET <path>`: runs the checks (or one category) and returns the report.
   *
   * @param query - the validated query (`category`, `refresh`).
   */
  getReport(query: DoctorQueryDto): Promise<DoctorReport>;
}

/** The operation description, generated from the options (identical with the defaults). */
function describeOperation(options: ResolvedDoctorModuleOptions): string {
  return (
    'Runs a read-only check of every capability this deployment has — database, ' +
    'authentication, maintenance mode, object storage, email, Web Push, AI, the job queue, ' +
    'worker nodes, database backups and telemetry — and returns one row per check with a ' +
    '`status` (`pass`, `warn`, `fail`, `skip`), a one-line `detail`, and on `warn`/`fail` a ' +
    '`remedy` plus the `settingsPath` of the page that fixes it.\n\n' +
    '**Always answers `200`.** A failing check is a row, not an error status.\n\n' +
    '**Read-only.** No check writes an object, a row or an audit event, sends mail or a ' +
    'push, or calls a model; the explicit "Test" buttons on each settings page remain the ' +
    'way to exercise a capability end to end.\n\n' +
    `**Bounded.** Checks run in parallel; each is cut off after ${options.defaultTimeoutMs} ms ` +
    'unless it declares otherwise, and a check whose dependency failed or was skipped is ' +
    'reported as `skip` without running.\n\n' +
    `**Cached** for ${options.cacheTtlMs / 1000} s per \`category\`; pass \`refresh=true\` to run ` +
    'again now. `generatedAt` says when the report was produced.\n\n' +
    '`verdict` is the worst status present, ordered `pass` < `skip` < `warn` < `fail`.\n\n' +
    `Requires \`${options.permission}\`.`
  );
}

/**
 * Creates the Doctor's controller class for one set of options: the route at
 * `options.path`, guarded by `options.host.access.requirePermissions([options.permission])`.
 * `DoctorModule.forRoot()` calls it; an app never needs to.
 *
 * @param options - the resolved module options.
 * @returns a controller class named `DoctorController` with a `getReport` handler.
 *
 * @stability experimental
 */
export function createDoctorController(options: ResolvedDoctorModuleOptions): Type<DoctorControllerInstance> {
  const requireAccess = options.host.access.requirePermissions([options.permission]);

  @ApiTags('Doctor')
  @Controller(options.path)
  class DoctorController implements DoctorControllerInstance {
    constructor(@Inject(DoctorService) private readonly doctor: DoctorService) {}

    @Get()
    @requireAccess
    @ApiOperation({
      summary: 'Run the configuration and health checks (Admin only)',
      description: describeOperation(options),
    })
    @ApiQuery({
      name: 'category',
      required: false,
      type: String,
      description:
        `Only the checks in this category. Shipped categories: ${options.categoryOrder.join(', ')}. ` +
        'An unknown category returns an empty report.',
    })
    @ApiQuery({
      name: 'refresh',
      required: false,
      enum: ['true', 'false'],
      description: '`true` bypasses the report cache.',
    })
    @ApiResponse({ status: 200, description: 'The doctor report.', type: DoctorReportDto })
    @ApiResponse({ status: 400, description: 'Invalid query parameter' })
    async getReport(@Query() query: DoctorQueryDto): Promise<DoctorReport> {
      const { category, refresh } = query as { category?: string; refresh?: boolean };

      return this.doctor.run({ category, refresh: refresh === true });
    }
  }

  return DoctorController;
}

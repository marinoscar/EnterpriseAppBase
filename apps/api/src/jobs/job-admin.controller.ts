// =============================================================================
// The queue's admin routes (issue #264, epic #254)
// =============================================================================
//
// Six routes over `JobAdminService`, mounted at `/api/admin/jobs`. The
// controller does nothing but bind, document and authorize; every decision
// about what a request means lives in the service, and every decision about
// what "stuck" means lives further down still, in `job-stuck.service.ts`.
//
// -----------------------------------------------------------------------------
// ⚠ LITERAL ROUTES ARE DECLARED BEFORE `:id`, AND THE ORDER IS LOAD-BEARING
// -----------------------------------------------------------------------------
//
// Nest matches routes in DECLARATION ORDER, not by specificity. Move
// `@Post(':id/retry')` above `@Post('retry-failed')` and the second route
// becomes unreachable: `POST /admin/jobs/retry-failed` would match `:id/retry`
// with `id = 'retry-failed'`... except it would not even get that far, because
// `retry-failed` has no `/retry` segment — it would instead be `POST :id` if
// one existed, and `reset-stuck` genuinely WOULD be swallowed by a `:id`
// route.
//
// The failure this prevents is the nastiest kind: no error at boot, no warning
// in the log, just an operator pressing "reset stuck jobs" and getting a 400
// about a malformed UUID — or, in a version of this file where `:id` took a
// plain string, a 404 for a job whose id is the literal text `reset-stuck`.
// `test/jobs/job-admin.integration.spec.ts` asserts the order by driving
// `POST /api/admin/jobs/reset-stuck` through the real router and checking that
// the sweep ran, so re-ordering these methods fails a test rather than a
// production incident.
//
// The declaration order below is therefore: `stats`, `retry-failed`,
// `reset-stuck`, `/`, then `:id/retry` and `:id`. Keep every literal above
// every parameterised route.
//
// -----------------------------------------------------------------------------
// TWO PERMISSIONS, SPLIT ON READ VERSUS WRITE
// -----------------------------------------------------------------------------
//
// `jobs:read` for `stats` and the list; `jobs:write` for the four routes that
// change a row. Both are seeded to ADMIN ONLY (`prisma/seed-data.ts`), and
// `@Auth({ roles: [ROLES.ADMIN], permissions: [...] })` states both — the role
// admits, the permission is what the guard checks. The pair is what a settings
// card's `permission` field must mirror byte-for-byte (CLAUDE.md, Settings UI
// Pattern rule 3), so the strings here are the API's half of that contract and
// must not be approximated on the other side.
//
// The split is not decoration. A read of this surface exposes job payload
// metadata, subject ids and the shape of a deployment's workload; a write can
// requeue every failed job in the queue. A later issue that wants to give an
// operations role visibility without control has a permission to hand out that
// does not also hand out the reset button.
// =============================================================================

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth } from '../auth/decorators/auth.decorator';
import { PERMISSIONS, ROLES } from '../common/constants/roles.constants';
import { ApiDataResponse } from '../common/decorators/api-data-response.decorator';
import { JobAdminService } from './job-admin.service';
import {
  ResetStuckDto,
  ResetStuckResultDto,
  RetryFailedDto,
  RetryFailedResultDto,
} from './dto/job-actions.dto';
import { JobListQueryDto, PROCESSED_WITHIN_VALUES } from './dto/job-list-query.dto';
import { JOB_STATUSES, JobDto } from './dto/job-response.dto';
import { JobStatsDto } from './dto/job-stats.dto';

@ApiTags('Jobs')
@Controller('admin/jobs')
export class JobAdminController {
  constructor(private readonly jobs: JobAdminService) {}

  // -------------------------------------------------------------------------
  // Literal routes. These MUST stay above `:id` — see the file header.
  // -------------------------------------------------------------------------

  @Get('stats')
  @Auth({ roles: [ROLES.ADMIN], permissions: [PERMISSIONS.JOBS_READ] })
  @ApiOperation({
    summary: 'Summarize the job queue',
    description:
      'Totals, a per-status breakdown, a per-type breakdown with display labels, how many ' +
      'pending jobs are waiting out a backoff, and how many running jobs the lease reaper ' +
      'would reclaim right now. `stuckRunning` is counted with the reaper\'s own predicate, ' +
      'against the threshold reported as `stuckThresholdMinutes`, so the number here and the ' +
      'rows a reset would touch can never disagree. Cached in-process for about two seconds — ' +
      'shorter than any sensible dashboard poll, so a deliberate refresh always sees fresh counts.',
  })
  @ApiResponse({ status: 200, description: 'Queue summary', type: JobStatsDto })
  async stats(): Promise<unknown> {
    return this.jobs.stats();
  }

  @Post('retry-failed')
  @Auth({ roles: [ROLES.ADMIN], permissions: [PERMISSIONS.JOBS_WRITE] })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Retry every failed job',
    description:
      'Moves failed jobs back to `pending` with their attempt and rate-limit budgets reset. ' +
      'Pass `type` to restrict the sweep to one job type. Idempotent: a job it retries is no ' +
      'longer failed, so calling it twice is harmless. A job whose deduplication key is already ' +
      'held by a pending or running job is counted in `skipped` rather than retried — the work ' +
      'it describes is already queued. At most 500 rows per call; check `remaining`.',
  })
  @ApiResponse({ status: 200, description: 'What the sweep did', type: RetryFailedResultDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  async retryFailed(@Body() dto: RetryFailedDto): Promise<unknown> {
    return this.jobs.retryFailed(dto.type);
  }

  @Post('reset-stuck')
  @Auth({ roles: [ROLES.ADMIN], permissions: [PERMISSIONS.JOBS_WRITE] })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reclaim jobs abandoned by their executor',
    description:
      'Runs the lease reaper on demand: running jobs whose claim has aged out, whose lease has ' +
      'expired, or that were never stamped at all are requeued, and those that have already ' +
      'spent their attempt budget are failed permanently. Send an empty body to use the ' +
      '`jobs.stuckThresholdMinutes` system setting — the same threshold the scheduled sweep ' +
      'uses. `olderThanMinutes` overrides it for this call only, and is echoed back as ' +
      '`thresholdMinutes`.',
  })
  @ApiResponse({ status: 200, description: 'What the sweep did', type: ResetStuckResultDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  async resetStuck(@Body() dto: ResetStuckDto): Promise<unknown> {
    return this.jobs.resetStuck(dto.olderThanMinutes);
  }

  @Get()
  @Auth({ roles: [ROLES.ADMIN], permissions: [PERMISSIONS.JOBS_READ] })
  @ApiOperation({
    summary: 'List jobs',
    description:
      'Newest first, filterable and paginated. `scheduled=true` selects pending jobs waiting ' +
      'out a backoff and OVERRIDES any `status` sent with it, because a job in backoff is ' +
      'pending by definition. `processedWithin` filters on when a job last did something — ' +
      '`finishedAt`, falling back to `createdAt` — so a job enqueued days ago that failed a ' +
      'minute ago still appears in the 4-hour window. Job payloads are not included.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, description: 'Max 100.' })
  @ApiQuery({ name: 'status', required: false, enum: JOB_STATUSES })
  @ApiQuery({ name: 'type', required: false, type: String })
  @ApiQuery({ name: 'subjectType', required: false, type: String })
  @ApiQuery({ name: 'subjectId', required: false, type: String })
  @ApiQuery({
    name: 'scheduled',
    required: false,
    enum: ['true', 'false'],
    description: 'true selects pending jobs in backoff and overrides `status`.',
  })
  @ApiQuery({ name: 'processedWithin', required: false, enum: PROCESSED_WITHIN_VALUES })
  @ApiDataResponse(JobDto, { pagination: 'flat', description: 'Paginated job list' })
  async list(@Query() query: JobListQueryDto): Promise<unknown> {
    return this.jobs.list(query);
  }

  // -------------------------------------------------------------------------
  // Parameterised routes. Nothing literal may be declared below this line.
  // -------------------------------------------------------------------------

  @Post(':id/retry')
  @Auth({ roles: [ROLES.ADMIN], permissions: [PERMISSIONS.JOBS_WRITE] })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Retry one job',
    description:
      'Resets the job to `pending` with its attempt count, error, schedule, rate-limit counters ' +
      'and claim all cleared, so any worker may take it immediately. Refused for a running job: ' +
      'an executor may still be working on it, and resetting the row would let a second worker ' +
      'take the same job. Use reset-stuck for a job whose executor is gone — it checks the lease.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'The job as it now stands', type: JobDto })
  @ApiResponse({ status: 400, description: 'The job is running and cannot be retried' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  @ApiResponse({
    status: 409,
    description: 'Another pending or running job already holds this job\'s deduplication key',
  })
  async retry(@Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.jobs.retry(id);
  }

  @Delete(':id')
  @Auth({ roles: [ROLES.ADMIN], permissions: [PERMISSIONS.JOBS_WRITE] })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete one job',
    description:
      'Removes the row. Refused for a running job: deleting it would not stop its executor, ' +
      'which would then finish, find no row to write to, and leave work that ran with no record ' +
      'that it existed — while its freed deduplication key let a duplicate be enqueued.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Job deleted' })
  @ApiResponse({ status: 400, description: 'The job is running and cannot be deleted' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.jobs.remove(id);
  }
}

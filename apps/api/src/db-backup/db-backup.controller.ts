// =============================================================================
// /api/admin/db-backup — the backup subsystem's admin routes (issue #283)
// =============================================================================
// (epic #254)
//
// Eight routes over one service, mounted under `admin/`. The controller does
// nothing but bind, document and authorize; every decision about what a request
// MEANS lives in `db-backup-admin.service.ts`, and every decision about what a
// backup IS lives further down still, in `db-backup-runner.service.ts`.
//
// MOUNTED AT `admin/db-backup` AND NOT AT `db-backup`, for the reason
// `NodesAdminController` gives about its own prefix: `JwtAuthGuard` treats
// path prefixes as part of what a non-session credential may reach, and a
// surface that hands out signed URLs to complete copies of the database belongs
// outside every such allowlist by construction rather than by a check somebody
// has to remember to write.
//
// -----------------------------------------------------------------------------
// ⚠ EVERY LITERAL ROUTE IS DECLARED ABOVE EVERY PARAMETERISED ROUTE, AND THE
// ORDER IS LOAD-BEARING
// -----------------------------------------------------------------------------
//
// Nest matches routes in DECLARATION ORDER, not by specificity. So the order
// below is: `config` (GET, PUT) and `runs` (POST, GET) first, and only then the
// parameterised block — `runs/:id/download`, `runs/:id/cancel`, `runs/:id`
// (GET) and `runs/:id` (DELETE), deepest first inside that block for the same
// reason.
//
// BE HONEST ABOUT TODAY: the literals here are one segment past the prefix
// (`config`) or one (`runs`), while every parameterised route is two or three
// (`runs/:id`, `runs/:id/download`), so no transposition of the methods in this
// file would currently shadow anything. That is a property of the CURRENT route
// table, not a rule — and it is exactly the reasoning that produces the bug the
// next time somebody adds `@Get(':id')` at the prefix root, or a `runs/:id/:x`
// route that would silently swallow `runs/latest`.
//
// The rule that survives is therefore the one `job-admin.controller.ts` and
// `nodes-admin.controller.ts` both state — EVERY LITERAL ABOVE EVERY
// PARAMETERISED ROUTE — and not "every literal that would currently break". The
// failure it prevents is the nastiest kind: no error at boot, no warning in the
// log, just an operator pressing a button and being told
// `400 Validation failed (uuid is expected)` by `ParseUUIDPipe`, in a file
// nobody would think to open. `test/db-backup/db-backup-admin.integration
// .spec.ts` drives `GET /api/admin/db-backup/config` through the real router
// and asserts it resolved as the config route, so re-ordering these methods
// fails a test rather than a production incident.
//
// -----------------------------------------------------------------------------
// TWO PERMISSIONS, SPLIT ON READ VERSUS WRITE — AND NOT THREE
// -----------------------------------------------------------------------------
//
// `db_backup:read` for the config read, the list, the single get and the
// download; `db_backup:write` for the config write, the manual trigger, the
// cancel and the delete. Both additionally gated on the Admin role, matching
// `job-admin.controller.ts` and `nodes-admin.controller.ts`: the ROLE admits,
// the PERMISSION is what the guard checks. These exact strings are the API's
// half of the contract a settings card's `permission` field must mirror byte
// for byte (CLAUDE.md, Settings UI Pattern rule 3), so they must not be
// approximated on the other side.
//
// `db_backup:restore` — the third permission seeded in `prisma/seed-data.ts` —
// appears NOWHERE in this file, and that is deliberate rather than an
// oversight. It gates #285's restore, which renames the live database and
// restarts the process; folding any route here under it would spend the one
// permission whose whole purpose is to be granted separately and on purpose.
//
// THE DOWNLOAD SITS ON THE READ SIDE, which is worth stating because it is the
// most powerful thing on this controller: the URL it returns is a
// credential-free capability over a complete copy of the database. It is still
// a read — it changes nothing — and inventing a third gate for it would mean
// `db_backup:read` grants the ability to see that a backup exists but not to
// use it, which is a distinction no deployment has asked for and which the
// short expiry in `BACKUP_DOWNLOAD_URL_EXPIRY_SECONDS` addresses better. What
// makes this acceptable is that `db_backup:read` is seeded to ADMIN ONLY.
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
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS, ROLES } from '../common/constants/roles.constants';
import { ApiDataResponse } from '../common/decorators/api-data-response.decorator';
import { DatabaseBackupAdminService } from './db-backup-admin.service';
import {
  BackupDownloadUrlDto,
  CancelBackupResultDto,
  DeleteBackupResultDto,
} from './dto/db-backup-actions.dto';
import {
  DatabaseBackupConfigDto,
  UpdateDatabaseBackupConfigDto,
} from './dto/db-backup-config.dto';
import { BackupRunListQueryDto } from './dto/db-backup-list-query.dto';
import {
  BACKUP_STATUSES,
  BACKUP_TRIGGERS,
  DatabaseBackupRunDto,
} from './dto/db-backup-run.dto';

@ApiTags('Database Backup')
@Controller('admin/db-backup')
export class DatabaseBackupController {
  constructor(private readonly backups: DatabaseBackupAdminService) {}

  // ---------------------------------------------------------------------------
  // Literal routes. Nothing parameterised may be declared above this block —
  // see the file header.
  // ---------------------------------------------------------------------------

  @Get('config')
  @Auth({ roles: [ROLES.ADMIN], permissions: [PERMISSIONS.DB_BACKUP_READ] })
  @ApiOperation({
    summary: 'Read the backup policy, and when it will next fire',
    description:
      'The stored `databaseBackup` settings namespace plus two fields that are computed on ' +
      'every read and stored nowhere. `nextRunAt` is the next instant the schedule is due, in ' +
      'UTC, projected by the same function the scheduler itself uses — so an administrator can ' +
      'confirm a schedule immediately instead of waiting a day to discover it was wrong. It ' +
      'walks calendar days in the configured timezone and converts each candidate to UTC ' +
      'independently, which is correct on both sides of a daylight-saving transition. It is ' +
      '`null` when backups are disabled, and also `null` when the stored timezone is one this ' +
      'runtime cannot resolve — this endpoint stays a 200 in that case precisely so the screen ' +
      'that can fix the setting still loads. `activeRunId` names the run currently holding the ' +
      'single-active-run slot; treat it as a display value, never as a pre-flight check, ' +
      'because the slot can be claimed by another instance between this read and your write.',
  })
  @ApiResponse({
    status: 200,
    description: 'The policy, plus nextRunAt and activeRunId',
    type: DatabaseBackupConfigDto,
  })
  async getConfig(): Promise<unknown> {
    return this.backups.getConfig();
  }

  @Put('config')
  @Auth({ roles: [ROLES.ADMIN], permissions: [PERMISSIONS.DB_BACKUP_WRITE] })
  @ApiOperation({
    summary: 'Update the backup policy',
    description:
      'A PARTIAL update: every field is optional and anything omitted keeps its stored value, ' +
      'so changing the hour does not require echoing back the whole policy. Writes through the ' +
      'system-settings service, which owns the merge and the row version, so this is not a ' +
      'second writer of that column. Two values are refused here rather than hours later ' +
      'inside a cron tick, because a bad one fails silently at 02:00 rather than at save time: ' +
      'a `timezone` this runtime cannot resolve (checked by performing the real schedule ' +
      'projection, so a timezone that saves is a timezone that schedules) and a ' +
      '`storageProvider` naming something other than the deployment\'s active provider (leave ' +
      'it empty to mean "whichever is active"). Both are a 400 with the offending field named ' +
      'in `details`. Returns exactly the body `GET config` returns, with `nextRunAt` ' +
      'recomputed, so the response shows the instant the change takes effect.',
  })
  @ApiResponse({
    status: 200,
    description: 'The policy as it now stands',
    type: DatabaseBackupConfigDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error, an unknown timezone, or a storage provider this deployment lacks',
  })
  async updateConfig(
    @Body() dto: UpdateDatabaseBackupConfigDto,
    @CurrentUser('id') userId: string
  ): Promise<unknown> {
    return this.backups.updateConfig(dto, userId);
  }

  // `202 Accepted` and not `201 Created`, deliberately. A `201` would say the
  // thing the caller asked for now exists — and what exists is a CLAIM, not a
  // backup: the dump is still streaming and may yet fail verification. `202` is
  // precisely "understood, started, not finished", which is what the returned
  // run's `running` status and its heartbeat then let the caller follow.
  @Post('runs')
  @Auth({ roles: [ROLES.ADMIN], permissions: [PERMISSIONS.DB_BACKUP_WRITE] })
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Take a backup now',
    description:
      'Claims the single active run slot and returns IMMEDIATELY with the new run, already ' +
      '`running`, while the dump streams into object storage in the background. It cannot be ' +
      'synchronous: a dump of a real database takes tens of minutes and every proxy in front ' +
      'of this API has a response timeout measured in seconds. Poll `GET runs/{id}` for ' +
      'progress — `bytesWritten` and `lastHeartbeatAt` advance about every twenty seconds. ' +
      'A `409` means a backup is already in flight; the id of that run is in ' +
      '`details.activeRunId`. The slot is arbitrated by a partial unique index in Postgres, ' +
      'so this answer is correct even when a scheduled run on another instance claims it in ' +
      'the same second.',
  })
  @ApiResponse({
    status: 202,
    description: 'The claimed run; the dump is still streaming',
    type: DatabaseBackupRunDto,
  })
  @ApiResponse({
    status: 400,
    description: 'The configured storage provider is not the active one',
  })
  @ApiResponse({
    status: 409,
    description: 'A backup is already running; see `details.activeRunId`',
  })
  async startRun(@CurrentUser('id') userId: string): Promise<unknown> {
    return this.backups.startRun(userId);
  }

  @Get('runs')
  @Auth({ roles: [ROLES.ADMIN], permissions: [PERMISSIONS.DB_BACKUP_READ] })
  @ApiOperation({
    summary: 'List backup runs',
    description:
      'Newest first, filterable by status and trigger, paginated. One row per attempt, ' +
      'including the ones that failed — a failed run carries how far it got in `bytesWritten` ' +
      'and why it stopped in `lastError`, which is the pair an operator triages with. Byte ' +
      'counts are DECIMAL STRINGS, not numbers: they are 64-bit columns and a JSON number ' +
      'rounds above 2^53.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, description: 'Max 100.' })
  @ApiQuery({ name: 'status', required: false, enum: BACKUP_STATUSES })
  @ApiQuery({ name: 'trigger', required: false, enum: BACKUP_TRIGGERS })
  @ApiDataResponse(DatabaseBackupRunDto, {
    pagination: 'flat',
    description: 'Paginated backup run list',
  })
  async listRuns(@Query() query: BackupRunListQueryDto): Promise<unknown> {
    return this.backups.listRuns(query);
  }

  // ---------------------------------------------------------------------------
  // Parameterised routes. Nothing literal may be declared below this line.
  // ---------------------------------------------------------------------------

  @Get('runs/:id/download')
  @Auth({ roles: [ROLES.ADMIN], permissions: [PERMISSIONS.DB_BACKUP_READ] })
  @ApiOperation({
    summary: 'Get a signed URL for one archive',
    description:
      'Returns a short-lived pre-signed URL that downloads the archive DIRECTLY FROM OBJECT ' +
      'STORAGE; the bytes never transit this API, which is the only workable shape for a file ' +
      'the size of a whole database. Treat the URL as a credential: anyone holding it can ' +
      'fetch a complete copy of this deployment\'s data with no token at all, which is why it ' +
      'expires in minutes — the expiry is checked when the download STARTS, so a slow transfer ' +
      'is not affected. Refused with a `400` unless the run is `completed`: a running run\'s ' +
      'object is half written, and a failed run\'s partial object was deleted by the failure ' +
      'path, so either URL would produce a file that is not a restorable archive.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'A signed, expiring URL', type: BackupDownloadUrlDto })
  @ApiResponse({ status: 400, description: 'The run is not completed' })
  @ApiResponse({ status: 404, description: 'No such run' })
  async download(@Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.backups.getDownloadUrl(id);
  }

  @Post('runs/:id/cancel')
  @Auth({ roles: [ROLES.ADMIN], permissions: [PERMISSIONS.DB_BACKUP_WRITE] })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel a running backup',
    description:
      'Stops the dump and tears down its upload, after which the run travels the ORDINARY ' +
      'failure path — partial archive deleted, row marked `failed` — because cancellation is ' +
      'deliberately not a second teardown mechanism. READ `outcome`, NOT ONLY THE STATUS ' +
      'CODE. A dump is stopped by signalling a child process, and only the API instance that ' +
      'started it holds that handle, so a run executing on another instance cannot be stopped ' +
      'from here: that answers `200` with `outcome: "not_running_here"` and changes nothing. ' +
      'It is not an error and retrying will not help — the staleness sweep releases the slot ' +
      'once the run\'s heartbeat stops. A run that has already finished is a `400`.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'What the cancel actually managed; check `outcome`',
    type: CancelBackupResultDto,
  })
  @ApiResponse({ status: 400, description: 'The run has already finished' })
  @ApiResponse({ status: 404, description: 'No such run' })
  async cancel(@Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.backups.cancelRun(id);
  }

  @Get('runs/:id')
  @Auth({ roles: [ROLES.ADMIN], permissions: [PERMISSIONS.DB_BACKUP_READ] })
  @ApiOperation({
    summary: 'Get one backup run',
    description:
      'The progress-polling endpoint. While a dump streams, `bytesWritten` and ' +
      '`lastHeartbeatAt` advance about every twenty seconds; when it finishes, `sizeBytes`, ' +
      '`checksumSha256` and `verifiedAt` are written together. `verifiedAt` is the field worth ' +
      'reading first: it is set only after the UPLOADED object was streamed back and proved to ' +
      'be a readable archive, so a completed run carrying it has been shown restorable-shaped ' +
      'at least once.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'The run', type: DatabaseBackupRunDto })
  @ApiResponse({ status: 404, description: 'No such run' })
  async getRun(@Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.backups.getRun(id);
  }

  @Delete('runs/:id')
  @Auth({ roles: [ROLES.ADMIN], permissions: [PERMISSIONS.DB_BACKUP_WRITE] })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete one backup run and its archive',
    description:
      'Removes the archive from object storage FIRST and the row SECOND. The row is the only ' +
      'index of what exists in the bucket, so the reverse order would leave a multi-gigabyte ' +
      'object nothing points at, billed forever. The object delete is best-effort and the ' +
      'response reports it as `objectDeleted`: `false` means storage had nothing to remove (or ' +
      'refused), the row is gone regardless, and a missing object therefore cannot leave a row ' +
      'that nobody can delete. Refused with a `400` while the run is `pending` or `running` — ' +
      'that row holds the active slot and its bytes are still being written, and deleting it ' +
      'would not stop the dump. Cancel it first; cancellation deletes the partial object for ' +
      'you. Returns a body rather than `204` because `objectDeleted` is a fact no status code ' +
      'can carry.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'The run was deleted; `objectDeleted` says what happened in storage',
    type: DeleteBackupResultDto,
  })
  @ApiResponse({ status: 400, description: 'The run is active and cannot be deleted' })
  @ApiResponse({ status: 404, description: 'No such run' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.backups.deleteRun(id);
  }
}

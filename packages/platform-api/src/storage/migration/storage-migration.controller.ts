import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';

import { Auth, CurrentUser } from '../../identity/index';
import { PERMISSIONS } from '../storage.constants';
import {
  StartStorageMigrationDto,
  StorageMigrationRunDto,
  StorageMigrationRunListDto,
  storageMigrationListQuerySchema,
  type StorageMigrationListQuery,
} from './dto/storage-migration.dto';
import { StorageMigrationService, type StorageMigrationRunPage, type StorageMigrationRunView } from './storage-migration.service';

// =============================================================================
// /api/admin/storage/migrations — copy-only storage provider migration (#1093)
// =============================================================================
//
// The same permission pair as `/api/admin/storage-config` (`storage_config:*`):
// a migration decides where the deployment's bytes live, exactly the authority
// the configuration screen already grants. Starting and cancelling write;
// listing and reading read.
// =============================================================================

/**
 * The `/api/admin/storage/migrations` routes (`storage_config:read|write`): start, list, read and cancel a copy-only provider migration.
 *
 * @internal
 *
 * @stability experimental
 */
@ApiTags('Storage Configuration')
@Controller('admin/storage/migrations')
export class StorageMigrationController {
  constructor(private readonly migrations: StorageMigrationService) {}

  @Post()
  @Auth({ permissions: [PERMISSIONS.STORAGE_CONFIG_WRITE] })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Start a copy-only storage provider migration (Admin only)',
    description:
      'Copies every `ready` object recorded on `sourceProvider` to `targetProvider`, one queue job per ' +
      'object: the bytes are streamed (never buffered), verified by reading them back (byte count and ' +
      'sha256), and only then is the row repointed. **The source object is never deleted**; it stays as a ' +
      'fallback. Returns at once; poll `GET /api/admin/storage/migrations/:runId` for progress.\n\n' +
      'Both drivers must be registered and configured, and must not name the same bucket (`400`, ' +
      '`details.reason`). **One run at a time**: `409` with the active run at `details.activeRunId`.',
  })
  @ApiResponse({ status: 201, description: 'The run was started', type: StorageMigrationRunDto })
  @ApiResponse({ status: 400, description: 'Validation error, an unknown or unconfigured driver, or the same bucket on both sides' })
  @ApiResponse({ status: 409, description: 'A run is already pending or running (`details.activeRunId`)' })
  async start(
    @Body() dto: StartStorageMigrationDto,
    @CurrentUser('id') userId: string,
  ): Promise<{ data: StorageMigrationRunView }> {
    return { data: await this.migrations.start(dto, userId) };
  }

  @Get()
  @Auth({ permissions: [PERMISSIONS.STORAGE_CONFIG_READ] })
  @ApiOperation({
    summary: 'List storage provider migrations (Admin only)',
    description: 'Runs newest first. The counts are recomputed from the runs\' items on every read.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, description: 'Runs per page (default: 20, max: 100)' })
  @ApiResponse({ status: 200, description: 'One page of runs', type: StorageMigrationRunListDto })
  async list(
    @Query(new ZodValidationPipe(storageMigrationListQuerySchema)) query: StorageMigrationListQuery,
  ): Promise<{ data: StorageMigrationRunPage }> {
    return { data: await this.migrations.list(query) };
  }

  @Get(':runId')
  @Auth({ permissions: [PERMISSIONS.STORAGE_CONFIG_READ] })
  @ApiOperation({
    summary: 'Get a storage provider migration (Admin only)',
    description: 'One run with live counts: total, migrated, failed, skipped and pending (queued or being copied).',
  })
  @ApiParam({ name: 'runId', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'The run', type: StorageMigrationRunDto })
  @ApiResponse({ status: 404, description: 'No such run' })
  async get(@Param('runId', ParseUUIDPipe) runId: string): Promise<{ data: StorageMigrationRunView }> {
    return { data: await this.migrations.get(runId) };
  }

  @Post(':runId/cancel')
  @Auth({ permissions: [PERMISSIONS.STORAGE_CONFIG_WRITE] })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel a storage provider migration (Admin only)',
    description:
      'Stops a pending or running run before its next unclaimed object: queued objects are marked ' +
      '`skipped` at once. An object being copied at that moment finishes (its copy is verified). ' +
      'Objects already repointed stay on the target, and every source object is untouched.',
  })
  @ApiParam({ name: 'runId', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'The cancelled run', type: StorageMigrationRunDto })
  @ApiResponse({ status: 404, description: 'No such run' })
  @ApiResponse({ status: 409, description: 'The run already finished' })
  async cancel(
    @Param('runId', ParseUUIDPipe) runId: string,
    @CurrentUser('id') userId: string,
  ): Promise<{ data: StorageMigrationRunView }> {
    return { data: await this.migrations.cancel(runId, userId) };
  }
}

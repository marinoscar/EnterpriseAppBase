// =============================================================================
// /api/exports (issue #744)
// =============================================================================
//
// Every route is `@Auth()` (any signed-in user); the PERMISSION IS THE
// SOURCE'S, checked by `ExportsService` against the caller's effective
// permissions, because one route serves sources with different permissions
// (`user-data`: `user_settings:read`; `org-data`: `org_members:read`). The
// body and the query are zod DTOs built from `@marinoscar/platform-contract/exports`.
// =============================================================================

import { Body, Controller, ForbiddenException, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  EXPORT_LIST_LIMIT,
  createExportSchema,
  exportListResponseSchema,
  exportSchema,
  exportSourcesResponseSchema,
  type CreateExport,
  type ExportListResponse,
  type ExportSourcesResponse,
  type ExportView,
} from '@marinoscar/platform-contract/exports';
import { createZodDto } from 'nestjs-zod';

import { ApiDataResponse } from '../core/index';
import type { Principal } from '../core/index';
import { Auth, CurrentPrincipal } from '../identity/index';
import { ExportsService, type ExportPrincipal } from './exports.service';

/**
 * `POST /api/exports` body.
 *
 * @stability experimental
 */
export class CreateExportDto extends createZodDto(createExportSchema) {}

/**
 * One export.
 *
 * @stability experimental
 */
export class ExportResponseDto extends createZodDto(exportSchema) {}

/**
 * `GET /api/exports`.
 *
 * @stability experimental
 */
export class ExportListResponseDto extends createZodDto(exportListResponseSchema) {}

/**
 * `GET /api/exports/sources`.
 *
 * @stability experimental
 */
export class ExportSourcesResponseDto extends createZodDto(exportSourcesResponseSchema) {}

/** The caller, from the request's principal (#724): its permissions are the active organization's. */
function principalOf(principal: Principal | undefined): ExportPrincipal {
  // A worker node's credential exports nothing.
  if (!principal || principal.kind !== 'user') throw new ForbiddenException('Exports are for signed-in users');
  return { id: principal.userId, permissions: principal.permissions, activeOrgId: principal.activeOrgId ?? null };
}

/**
 * The export routes. See the file header.
 *
 * @stability experimental
 */
@ApiTags('Exports')
@Controller('exports')
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  /**
   * The sources and formats the caller may use.
   *
   * @param user - the caller.
   * @returns the sources.
   */
  @Get('sources')
  @Auth()
  @ApiOperation({
    summary: 'List the export sources the caller may use',
    description:
      'Each source the caller holds the permission for (its own, or its cross-organization one), with the formats it ' +
      'offers and the request fields the export dialog draws. `crossOrg` says whether the caller may name another ' +
      'organization for an `org` source.',
  })
  @ApiDataResponse(ExportSourcesResponseDto, { description: 'The sources.' })
  sources(@CurrentPrincipal() user: Principal | undefined): ExportSourcesResponse {
    return this.exports.sources(principalOf(user));
  }

  /**
   * Queues an export.
   *
   * @param user - the caller.
   * @param body - the request.
   * @returns the export, `pending`.
   */
  @Post()
  @Auth()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Request a data export',
    description:
      'Queues an `export.run` job and answers `202` with the export (status `pending`). The export id is the job id. ' +
      '`request` is validated by the source\'s own schema. An `org` source exports the active organization, or ' +
      '`orgId` with the source\'s cross-organization permission. Poll `GET /api/exports/{id}` until `ready`; the requester ' +
      'is also notified (`export.ready` / `export.failed`).',
  })
  @ApiBody({ type: CreateExportDto })
  @ApiDataResponse(ExportResponseDto, { status: 202, description: 'Queued.' })
  @ApiResponse({ status: 400, description: 'Unknown source or format, or a request the source refuses' })
  @ApiResponse({ status: 403, description: "Missing the source's permission" })
  @ApiResponse({ status: 404, description: 'Unknown organization (cross-organization export)' })
  @ApiResponse({ status: 429, description: 'Too many exports in progress for this account or organization' })
  create(@CurrentPrincipal() user: Principal | undefined, @Body() body: CreateExportDto): Promise<ExportView> {
    return this.exports.create(principalOf(user), body as unknown as CreateExport);
  }

  /**
   * The caller's recent exports.
   *
   * @param user - the caller.
   * @returns the exports.
   */
  @Get()
  @Auth()
  @ApiOperation({
    summary: "List the caller's recent exports",
    description: `The ${EXPORT_LIST_LIMIT} most recent exports the caller asked for (or of the caller's own data), newest first, with derived status and \`download: null\`.`,
  })
  @ApiDataResponse(ExportListResponseDto, { description: 'The exports.' })
  list(@CurrentPrincipal() user: Principal | undefined): Promise<ExportListResponse> {
    return this.exports.list(principalOf(user));
  }

  /**
   * One export, with a fresh signed download while ready.
   *
   * @param user - the caller.
   * @param id - the export id.
   * @returns the export.
   */
  @Get(':id')
  @Auth()
  @ApiOperation({
    summary: 'Get one export',
    description:
      'The derived status (`pending`, `running`, `ready`, `expired`, `failed`) and, while `ready`, `download`: a short-lived ' +
      'signed GET with `Content-Disposition: attachment`. A failed export carries a fixed message, never the job error. `404` ' +
      "unless it is the caller's export, or an organization export the caller may export now.",
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Export (job) id' })
  @ApiDataResponse(ExportResponseDto, { description: 'The export.' })
  @ApiResponse({ status: 404, description: 'Export not found' })
  get(@CurrentPrincipal() user: Principal | undefined, @Param('id', ParseUUIDPipe) id: string): Promise<ExportView> {
    return this.exports.get(principalOf(user), id);
  }
}

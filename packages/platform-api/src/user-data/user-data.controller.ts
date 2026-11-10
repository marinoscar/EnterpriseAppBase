// =============================================================================
// The user-data slice's routes (issue #743, PP-9.1)
// =============================================================================
//
//   /api/user-data/summary, /deletions, /deletions/:jobId       user_settings:write
//   /api/admin/factory-reset/summary, /, /:jobId                 system:factory_reset
//   /api/admin/orgs/:orgId/offboarding/summary, /, /:jobId       orgs:offboard
//
// Every route declares its exact permission; every body is a zod DTO built
// from `@marinoscar/platform-contract/user-data`. The request routes answer
// `202` with the job (a new one, or the one already in flight).
// =============================================================================

import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, type Type } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  FACTORY_RESET_CONFIRMATION,
  FACTORY_RESET_PERMISSION,
  ORG_OFFBOARD_PERMISSION,
  USER_DATA_EVERYTHING_CONFIRMATION,
  USER_DATA_PERMISSION,
  factoryResetRequestSchema,
  factoryResetStatusSchema,
  factoryResetSummarySchema,
  orgOffboardingRequestSchema,
  orgOffboardingStatusSchema,
  orgOffboardingSummarySchema,
  userDataDeletionRequestSchema,
  userDataDeletionStatusSchema,
  userDataJobStartedSchema,
  userDataSummarySchema,
} from '@marinoscar/platform-contract/user-data';
import { createZodDto } from 'nestjs-zod';

import { ApiDataResponse } from '../core/index';
import { Auth, CurrentUser, type PermissionName, type RequestUser } from '../identity/index';
import { FactoryResetService, OrgOffboardingService, UserDataService } from './user-data.service';

/** @stability experimental */
export class UserDataSummaryDto extends createZodDto(userDataSummarySchema) {}
/** @stability experimental */
export class UserDataDeletionRequestDto extends createZodDto(userDataDeletionRequestSchema) {}
/** @stability experimental */
export class UserDataJobStartedDto extends createZodDto(userDataJobStartedSchema) {}
/** @stability experimental */
export class UserDataDeletionStatusDto extends createZodDto(userDataDeletionStatusSchema) {}
/** @stability experimental */
export class FactoryResetRequestDto extends createZodDto(factoryResetRequestSchema) {}
/** @stability experimental */
export class FactoryResetSummaryDto extends createZodDto(factoryResetSummarySchema) {}
/** @stability experimental */
export class FactoryResetStatusDto extends createZodDto(factoryResetStatusSchema) {}
/** @stability experimental */
export class OrgOffboardingRequestDto extends createZodDto(orgOffboardingRequestSchema) {}
/** @stability experimental */
export class OrgOffboardingSummaryDto extends createZodDto(orgOffboardingSummarySchema) {}
/** @stability experimental */
export class OrgOffboardingStatusDto extends createZodDto(orgOffboardingStatusSchema) {}

const USER = USER_DATA_PERMISSION as PermissionName;
const FACTORY = FACTORY_RESET_PERMISSION as PermissionName;
const OFFBOARD = ORG_OFFBOARD_PERMISSION as PermissionName;

/**
 * Builds the three controllers. `UserDataModule.forRoot()` calls it.
 *
 * @returns the controller classes, in OpenAPI path order.
 *
 * @stability experimental
 */
export function createUserDataControllers(): Type<unknown>[] {
  @ApiTags('User data')
  @Controller('user-data')
  class UserDataController {
    constructor(private readonly service: UserDataService) {}

    @Get('summary')
    @Auth({ permissions: [USER] })
    @ApiOperation({
      summary: 'What a data deletion would delete',
      description:
        'Per registered category: the rows the caller owns (in every organization) and, for files, the stored bytes. ' +
        'Plus every scope the caller may request, with its exact confirmation phrase and resolved categories. Read-only. ' +
        `Requires \`${USER_DATA_PERMISSION}\` (every role holds it).`,
    })
    @ApiDataResponse(UserDataSummaryDto, { description: 'Categories and scopes.' })
    summary(@CurrentUser() user: RequestUser) {
      return this.service.summary(user.id);
    }

    @Post('deletions')
    @HttpCode(HttpStatus.ACCEPTED)
    @Auth({ permissions: [USER] })
    @ApiOperation({
      summary: 'Delete my data (one scope)',
      description:
        `Queues \`user.data.purge\` for the caller and the scope. \`confirmation\` must be the scope's exact phrase ` +
        `(\`everything\`: \`${USER_DATA_EVERYTHING_CONFIRMATION}\`); anything else is a 400 \`CONFIRMATION_MISMATCH\`, an ` +
        'unknown scope a 400 `UNKNOWN_SCOPE`. One purge per user at a time: a second request returns the job in flight. ' +
        'The account, its sign-in identities, roles, memberships, the session and the audit log are kept. The `everything` ' +
        'scope deletes personal access tokens, so a CLI using a `pat_` token gets 401 afterwards.',
    })
    @ApiDataResponse(UserDataJobStartedDto, { status: 202, description: 'The purge job.' })
    @ApiResponse({ status: 400, description: '`CONFIRMATION_MISMATCH` or `UNKNOWN_SCOPE` (in `details.reason`)' })
    request(@CurrentUser() user: RequestUser, @Body() body: UserDataDeletionRequestDto) {
      return this.service.requestDeletion(user.id, body as { scope: string; confirmation: string });
    }

    @Get('deletions/:jobId')
    @Auth({ permissions: [USER] })
    @ApiParam({ name: 'jobId', format: 'uuid' })
    @ApiOperation({
      summary: 'Status of my data deletion',
      description: '`result` when succeeded (counts per category and model), `error` when failed. 404 unless it is the caller\'s own purge job.',
    })
    @ApiDataResponse(UserDataDeletionStatusDto, { description: 'The job status.' })
    @ApiResponse({ status: 404, description: 'Not the caller\'s purge job' })
    status(@CurrentUser() user: RequestUser, @Param('jobId', new ParseUUIDPipe()) jobId: string) {
      return this.service.status(user.id, jobId);
    }
  }

  @ApiTags('Factory reset')
  @Controller('admin/factory-reset')
  class FactoryResetController {
    constructor(private readonly service: FactoryResetService) {}

    @Get('summary')
    @Auth({ permissions: [FACTORY] })
    @ApiOperation({
      summary: 'What a factory reset would delete',
      description:
        'Deployment-wide counts: other users, organizations other than the default one, storage objects outside the ' +
        'prefixes that survive, job rows and rows per user-data category. `disabledReason` is ' +
        '`FACTORY_RESET_DISABLED_IN_SAAS` in `DEPLOYMENT_MODE=saas`. Read-only. Requires `system:factory_reset` (Admin only).',
    })
    @ApiDataResponse(FactoryResetSummaryDto, { description: 'The summary.' })
    summary(@CurrentUser() user: RequestUser) {
      return this.service.summary(user.id);
    }

    @Post()
    @HttpCode(HttpStatus.ACCEPTED)
    @Auth({ permissions: [FACTORY] })
    @ApiOperation({
      summary: 'Factory reset the deployment',
      description:
        `Queues \`admin.factory_reset\`. \`confirmation\` must be exactly \`${FACTORY_RESET_CONFIRMATION}\` (400 otherwise). ` +
        'Deletes every other user and all application data; keeps the caller, roles, configuration, backups (runs, archives ' +
        'and linked jobs) and the audit log. One per deployment at a time: a second request returns the job in flight. ' +
        '403 `FACTORY_RESET_DISABLED_IN_SAAS` in SaaS mode. Take a backup first.',
    })
    @ApiDataResponse(UserDataJobStartedDto, { status: 202, description: 'The reset job.' })
    @ApiResponse({ status: 400, description: 'Wrong phrase' })
    @ApiResponse({ status: 403, description: '`FACTORY_RESET_DISABLED_IN_SAAS`, or the permission is missing' })
    request(@CurrentUser() user: RequestUser, @Body() _body: FactoryResetRequestDto) {
      return this.service.request(user.id);
    }

    @Get(':jobId')
    @Auth({ permissions: [FACTORY] })
    @ApiParam({ name: 'jobId', format: 'uuid' })
    @ApiOperation({ summary: 'Status of a factory reset', description: '`result.counts` when succeeded, `error` when failed. 404 for another job type.' })
    @ApiDataResponse(FactoryResetStatusDto, { description: 'The job status.' })
    @ApiResponse({ status: 404, description: 'Not a factory reset job' })
    status(@Param('jobId', new ParseUUIDPipe()) jobId: string) {
      return this.service.status(jobId);
    }
  }

  @ApiTags('Organization offboarding')
  @Controller('admin/orgs/:orgId/offboarding')
  class OrgOffboardingController {
    constructor(private readonly service: OrgOffboardingService) {}

    @Get('summary')
    @Auth({ permissions: [OFFBOARD] })
    @ApiParam({ name: 'orgId', format: 'uuid' })
    @ApiOperation({
      summary: 'What offboarding an organization would delete',
      description:
        'Org-owned rows per model, members, invites, storage objects, the members left without any organization, and every ' +
        'registered precondition with its verdict. 409 `OFFBOARDING_REQUIRES_MULTI_ORG` in single-organization mode; ' +
        '`blockedReason` is `DEFAULT_ORG_NOT_OFFBOARDABLE` for the default organization. Requires `orgs:offboard` (Admin only).',
    })
    @ApiDataResponse(OrgOffboardingSummaryDto, { description: 'The summary.' })
    @ApiResponse({ status: 409, description: '`OFFBOARDING_REQUIRES_MULTI_ORG`' })
    summary(@Param('orgId', new ParseUUIDPipe()) orgId: string) {
      return this.service.summary(orgId);
    }

    @Post()
    @HttpCode(HttpStatus.ACCEPTED)
    @Auth({ permissions: [OFFBOARD] })
    @ApiParam({ name: 'orgId', format: 'uuid' })
    @ApiOperation({
      summary: 'Offboard an organization',
      description:
        "Queues `org.offboard`: deletes the organization's rows and objects, invites, memberships and the organization. " +
        "`confirmation` must be the organization's slug (400 `CONFIRMATION_MISMATCH`). `userDisposition` decides about members " +
        'left without any organization: `keep` (default) or `purge` (their data and account are deleted). A failing ' +
        'precondition answers 409 `OFFBOARDING_PRECONDITION_FAILED` (`details.preconditions`) unless `skipExport.reason` is ' +
        'given, which the audit event records. 409 `OFFBOARDING_REQUIRES_MULTI_ORG` in single mode, `DEFAULT_ORG_NOT_OFFBOARDABLE` ' +
        'for the default organization.',
    })
    @ApiDataResponse(UserDataJobStartedDto, { status: 202, description: 'The offboarding job.' })
    @ApiResponse({ status: 400, description: '`CONFIRMATION_MISMATCH`' })
    @ApiResponse({ status: 409, description: 'Single mode, the default organization, or a failing precondition' })
    request(@CurrentUser() user: RequestUser, @Param('orgId', new ParseUUIDPipe()) orgId: string, @Body() body: OrgOffboardingRequestDto) {
      return this.service.request(user.id, orgId, body as never);
    }

    @Get(':jobId')
    @Auth({ permissions: [OFFBOARD] })
    @ApiParam({ name: 'orgId', format: 'uuid' })
    @ApiParam({ name: 'jobId', format: 'uuid' })
    @ApiOperation({ summary: 'Status of an offboarding', description: '`result.counts` when succeeded, `error` when failed. 404 for another job.' })
    @ApiDataResponse(OrgOffboardingStatusDto, { description: 'The job status.' })
    @ApiResponse({ status: 404, description: 'Not an offboarding job of this organization' })
    status(@Param('orgId', new ParseUUIDPipe()) orgId: string, @Param('jobId', new ParseUUIDPipe()) jobId: string) {
      return this.service.status(orgId, jobId);
    }
  }

  return [UserDataController, FactoryResetController, OrgOffboardingController];
}

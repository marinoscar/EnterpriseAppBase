// =============================================================================
// `GET /api/onboarding` and `GET /api/admin/onboarding/metrics` (issue #745)
// =============================================================================
//
// Built by a factory because the admin permission is an option. Both routes
// are read-only. Writes to the stored state go through the existing
// `PATCH /api/user-settings` (with `If-Match`), in the `onboarding` namespace.
// =============================================================================

import { Controller, Get, Query, type Type } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ONBOARDING_METRICS_DAYS_DEFAULT,
  ONBOARDING_METRICS_DAYS_MAX,
  ONBOARDING_READ_PERMISSION,
  onboardingMetricsQuerySchema,
  onboardingMetricsResponseSchema,
  onboardingQuerySchema,
  onboardingResponseSchema,
  type OnboardingMetricsResponse,
  type OnboardingResponse,
} from '@marinoscar/platform-contract/onboarding';
import { createZodDto } from 'nestjs-zod';

import { ApiDataResponse } from '../core/index';
import { Auth, CurrentUser, type PermissionName, type RequestUser } from '../identity/index';
import { OnboardingMetricsService } from './onboarding-metrics';
import type { ResolvedOnboardingModuleOptions } from './onboarding.options';
import { OnboardingService } from './onboarding.service';

/**
 * The query DTO of `GET /api/onboarding`.
 *
 * @stability experimental
 */
export class OnboardingQueryDto extends createZodDto(onboardingQuerySchema) {}

/**
 * The response DTO of `GET /api/onboarding`.
 *
 * @stability experimental
 */
export class OnboardingResponseDto extends createZodDto(onboardingResponseSchema) {}

/**
 * The query DTO of the metrics route.
 *
 * @stability experimental
 */
export class OnboardingMetricsQueryDto extends createZodDto(onboardingMetricsQuerySchema) {}

/**
 * The response DTO of the metrics route.
 *
 * @stability experimental
 */
export class OnboardingMetricsResponseDto extends createZodDto(onboardingMetricsResponseSchema) {}

/**
 * Builds the two onboarding controllers for one set of options.
 * `OnboardingModule.forRoot()` calls it; an app does not.
 *
 * @param options - the resolved module options.
 * @returns the controller classes, in OpenAPI path order.
 *
 * @stability experimental
 */
export function createOnboardingControllers(options: ResolvedOnboardingModuleOptions): Type<unknown>[] {
  const admin = options.adminPermission;

  @ApiTags('Onboarding')
  @Controller('onboarding')
  class OnboardingController {
    constructor(private readonly onboarding: OnboardingService) {}

    @Get()
    @Auth({ permissions: [ONBOARDING_READ_PERMISSION] })
    @ApiOperation({
      summary: "Get the caller's onboarding checklists",
      description:
        'The onboarding UI state stored in the `onboarding` user-settings namespace (`settings`: ' +
        '`welcomeSeenAt`, `checklistDismissedAt`, `adminDismissedAt`, each `null` when unset, and ' +
        '`skipped`), plus checklists DERIVED from the data on every request, never stored.\n\n' +
        '`user` lists the steps the caller can act on: a step whose permission the caller lacks, or ' +
        'whose feature is off, is omitted, not shown as blocked. A `blocked` step carries ' +
        '`blockedReason`.\n\n' +
        `\`admin\` is non-null only when the caller holds \`${admin}\`. Its Doctor-backed steps are ` +
        '`done` when every mapped Doctor check passes (a `skip` is not a pass); a `todo` step\'s ' +
        "`detail` is the first non-passing check's remedy.\n\n" +
        'Writes go through `PATCH /api/user-settings` with `If-Match`, body `{ "onboarding": { ... } }`.\n\n' +
        `**Read-only**: never creates a settings row. Requires \`${ONBOARDING_READ_PERMISSION}\`.`,
    })
    @ApiQuery({
      name: 'refresh',
      required: false,
      enum: ['true', 'false'],
      description: '`true` bypasses the Doctor report cache for the Doctor-backed steps.',
    })
    @ApiDataResponse(OnboardingResponseDto, { description: 'The onboarding state and checklists.' })
    @ApiResponse({ status: 400, description: 'Invalid query parameter' })
    async get(@CurrentUser() user: RequestUser, @Query() query: OnboardingQueryDto): Promise<OnboardingResponse> {
      const { refresh } = query as { refresh?: boolean };
      return this.onboarding.get(
        { id: user.id, permissions: user.permissions, roles: user.roles, activeOrgId: user.activeOrgId ?? null },
        { refresh: refresh === true },
      );
    }
  }

  @ApiTags('Onboarding')
  @Controller('admin/onboarding')
  class OnboardingAdminController {
    constructor(private readonly metricsService: OnboardingMetricsService) {}

    @Get('metrics')
    @Auth({ permissions: [admin as PermissionName] })
    @ApiOperation({
      summary: 'Get new-user activation metrics (Admin only)',
      description:
        'Aggregates over the users created in the last `days` days (the cohort): its size, the ' +
        'step funnel (per user step with a funnel query, how many cohort users have it done now) ' +
        'and, per registered activation milestone, `eligible` (created at least the milestone\'s ' +
        'window ago), `activated` (reached it within the window), `activationRate` and ' +
        '`medianHours`.\n\n' +
        `**Read-only**, one aggregate statement: no per-user data is returned. Requires \`${admin}\`.`,
    })
    @ApiQuery({
      name: 'days',
      required: false,
      type: Number,
      description: `Cohort window in days, 1 to ${ONBOARDING_METRICS_DAYS_MAX} (default ${ONBOARDING_METRICS_DAYS_DEFAULT}).`,
    })
    @ApiDataResponse(OnboardingMetricsResponseDto, { description: 'The activation metrics.' })
    @ApiResponse({ status: 400, description: 'Invalid query parameter' })
    async metrics(@Query() query: OnboardingMetricsQueryDto): Promise<OnboardingMetricsResponse> {
      const { days } = query as { days: number };
      return this.metricsService.metrics(days);
    }
  }

  return [OnboardingController, OnboardingAdminController];
}

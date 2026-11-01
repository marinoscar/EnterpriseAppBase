import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  ALERT_ERROR_CODES,
  ALERT_KIND_IDS,
  ALERT_PERMISSIONS,
  type AlertIncident,
  type AlertKind,
  type AlertRule,
  type AlertRuleTestResponse,
  type AlertSummary,
} from '@marinoscar/platform-contract/alerts';

import { ApiDataResponse, ErrorDto } from '../core/index';
import { Auth, CurrentUser } from '../identity/index';
import { AlertsEvaluationService } from './alerts-evaluation.service';
import { AlertsIncidentsService, type AlertIncidentPage } from './alerts-incidents.service';
import { AlertsRulesService } from './alerts-rules.service';
import {
  AlertIncidentDto,
  AlertIncidentListQueryDto,
  AlertKindDto,
  AlertRuleDto,
  AlertRuleListQueryDto,
  AlertRuleTestResponseDto,
  AlertSummaryDto,
  CreateAlertRuleDto,
  UpdateAlertRuleDto,
} from './dto/alerts.dto';
import { alertRuleKindRegistry } from './kinds/alert-kind.registry';

const RULE_ID = { name: 'id', type: String, format: 'uuid', description: 'The rule id.' } as const;
const INCIDENT_ID = { name: 'id', type: String, format: 'uuid', description: 'The incident id.' } as const;
const NO_READ = { status: 403, description: 'Missing alerts:read', type: ErrorDto } as const;
const NO_WRITE = { status: 403, description: 'Missing alerts:write', type: ErrorDto } as const;
const NO_RULE = { status: 404, description: '`ALERT_RULE_NOT_FOUND`', type: ErrorDto } as const;
const NO_INCIDENT = { status: 404, description: '`ALERT_INCIDENT_NOT_FOUND`', type: ErrorDto } as const;
const BAD_CONFIG = { status: 400, description: '`ALERT_UNKNOWN_KIND` or `ALERT_INVALID_CONFIG`', type: ErrorDto } as const;

function configJsonSchema(kind: { configSchema: unknown }): Record<string, unknown> {
  try {
    return z.toJSONSchema(kind.configSchema as z.ZodType, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const BUILTIN_IDS: ReadonlySet<string> = new Set(Object.values(ALERT_KIND_IDS));

// =============================================================================
//   GET    /api/admin/alerts/rules                     alerts:read
//   POST   /api/admin/alerts/rules                     alerts:write
//   GET    /api/admin/alerts/rules/:id                 alerts:read
//   PATCH  /api/admin/alerts/rules/:id                 alerts:write
//   DELETE /api/admin/alerts/rules/:id                 alerts:write
//   POST   /api/admin/alerts/rules/:id/test            alerts:write
//   GET    /api/admin/alerts/kinds                     alerts:read
//   GET    /api/admin/alerts/incidents                 alerts:read
//   GET    /api/admin/alerts/incidents/:id             alerts:read
//   POST   /api/admin/alerts/incidents/:id/acknowledge alerts:write
//   GET    /api/admin/alerts/summary                   alerts:read
// =============================================================================

/**
 * The alerts admin routes: rules, the kind catalog, incidents and the firing
 * summary.
 *
 * @stability experimental
 */
@ApiTags('Alerts')
@Controller('admin/alerts')
export class AlertsAdminController {
  constructor(
    private readonly rules: AlertsRulesService,
    private readonly incidents: AlertsIncidentsService,
    private readonly evaluation: AlertsEvaluationService,
  ) {}

  /** Lists the rules. */
  @Get('rules')
  @Auth({ permissions: [ALERT_PERMISSIONS.READ] })
  @ApiOperation({ summary: 'List alert rules (Admin)', description: 'Every rule, oldest first, with its open incident count. Filter by `kind`, `severity` or `enabled`.' })
  @ApiDataResponse(AlertRuleDto, { isArray: true, description: 'The rules' })
  @ApiResponse(NO_READ)
  listRules(@Query() query: AlertRuleListQueryDto): Promise<AlertRule[]> {
    return this.rules.list(query);
  }

  /** Creates a rule. */
  @Post('rules')
  @HttpCode(HttpStatus.CREATED)
  @Auth({ permissions: [ALERT_PERMISSIONS.WRITE] })
  @ApiOperation({
    summary: 'Create an alert rule (Admin)',
    description: 'The `config` is validated against the kind\'s schema (`GET /kinds`). A rule is created disabled unless `enabled` is true.',
  })
  @ApiDataResponse(AlertRuleDto, { status: 201, description: 'The rule' })
  @ApiResponse(BAD_CONFIG)
  @ApiResponse(NO_WRITE)
  createRule(@Body() body: CreateAlertRuleDto, @CurrentUser('id') userId: string): Promise<AlertRule> {
    return this.rules.create(body, userId);
  }

  /** One rule. */
  @Get('rules/:id')
  @Auth({ permissions: [ALERT_PERMISSIONS.READ] })
  @ApiOperation({ summary: 'Get an alert rule (Admin)' })
  @ApiParam(RULE_ID)
  @ApiDataResponse(AlertRuleDto, { description: 'The rule' })
  @ApiResponse(NO_READ)
  @ApiResponse(NO_RULE)
  getRule(@Param('id', ParseUUIDPipe) id: string): Promise<AlertRule> {
    return this.rules.get(id);
  }

  /** Updates a rule. */
  @Patch('rules/:id')
  @Auth({ permissions: [ALERT_PERMISSIONS.WRITE] })
  @ApiOperation({
    summary: 'Update an alert rule (Admin)',
    description: 'A partial update; the kind cannot change. Disabling a rule closes its open incidents without a notification. A starter rule may be edited and disabled.',
  })
  @ApiParam(RULE_ID)
  @ApiDataResponse(AlertRuleDto, { description: 'The rule' })
  @ApiResponse(BAD_CONFIG)
  @ApiResponse(NO_WRITE)
  @ApiResponse(NO_RULE)
  updateRule(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateAlertRuleDto): Promise<AlertRule> {
    return this.rules.update(id, body);
  }

  /** Deletes a rule. */
  @Delete('rules/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auth({ permissions: [ALERT_PERMISSIONS.WRITE] })
  @ApiOperation({ summary: 'Delete an alert rule (Admin)', description: 'Deletes the rule and its incidents. A starter rule is refused with `ALERT_STARTER_RULE_PROTECTED` (409): disable it instead.' })
  @ApiParam(RULE_ID)
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse(NO_WRITE)
  @ApiResponse(NO_RULE)
  @ApiResponse({ status: 409, description: `\`${ALERT_ERROR_CODES.STARTER_RULE_PROTECTED}\``, type: ErrorDto })
  async deleteRule(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.rules.remove(id);
  }

  /** Evaluates a rule now without storing or dispatching anything. */
  @Post('rules/:id/test')
  @HttpCode(HttpStatus.OK)
  @Auth({ permissions: [ALERT_PERMISSIONS.WRITE] })
  @ApiOperation({
    summary: 'Test an alert rule (Admin)',
    description: 'Evaluates the rule once, now, and returns what it observed. Nothing is stored (no incident, no `lastEvaluatedAt`) and nothing is dispatched. An evaluation failure is returned in `error`, not as an HTTP error.',
  })
  @ApiParam(RULE_ID)
  @ApiDataResponse(AlertRuleTestResponseDto, { description: 'The observations' })
  @ApiResponse(NO_WRITE)
  @ApiResponse(NO_RULE)
  async testRule(@Param('id', ParseUUIDPipe) id: string): Promise<AlertRuleTestResponse> {
    const row = await this.rules.row(id);
    const started = Date.now();
    const evaluatedAt = new Date();
    try {
      const observations = await this.evaluation.observe(row, evaluatedAt);
      return { ruleId: id, kind: row.kind, evaluatedAt: evaluatedAt.toISOString(), durationMs: Date.now() - started, observations, error: null };
    } catch (error) {
      return {
        ruleId: id,
        kind: row.kind,
        evaluatedAt: evaluatedAt.toISOString(),
        durationMs: Date.now() - started,
        observations: [],
        error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
      };
    }
  }

  /** The registered kinds. */
  @Get('kinds')
  @Auth({ permissions: [ALERT_PERMISSIONS.READ] })
  @ApiOperation({ summary: 'List alert rule kinds (Admin)', description: 'Every registered kind with the JSON Schema of its `config`.' })
  @ApiDataResponse(AlertKindDto, { isArray: true, description: 'The kinds' })
  @ApiResponse(NO_READ)
  listKinds(): AlertKind[] {
    return alertRuleKindRegistry.list().map((kind) => ({
      id: kind.id,
      label: kind.label,
      description: kind.description,
      eventDriven: kind.eventDriven === true,
      builtin: BUILTIN_IDS.has(kind.id),
      configSchema: configJsonSchema(kind),
    }));
  }

  /** Lists incidents. */
  @Get('incidents')
  @Auth({ permissions: [ALERT_PERMISSIONS.READ] })
  @ApiOperation({ summary: 'List alert incidents (Admin)', description: 'Newest first. Filter by `state`, `severity` and `ruleId`; paged (`page`, `pageSize` up to 100).' })
  @ApiDataResponse(AlertIncidentDto, { pagination: 'flat', description: 'Paginated incidents' })
  @ApiResponse(NO_READ)
  listIncidents(@Query() query: AlertIncidentListQueryDto): Promise<AlertIncidentPage> {
    return this.incidents.list(query);
  }

  /** One incident. */
  @Get('incidents/:id')
  @Auth({ permissions: [ALERT_PERMISSIONS.READ] })
  @ApiOperation({ summary: 'Get an alert incident (Admin)' })
  @ApiParam(INCIDENT_ID)
  @ApiDataResponse(AlertIncidentDto, { description: 'The incident' })
  @ApiResponse(NO_READ)
  @ApiResponse(NO_INCIDENT)
  getIncident(@Param('id', ParseUUIDPipe) id: string): Promise<AlertIncident> {
    return this.incidents.get(id);
  }

  /** Acknowledges an incident. */
  @Post('incidents/:id/acknowledge')
  @HttpCode(HttpStatus.OK)
  @Auth({ permissions: [ALERT_PERMISSIONS.WRITE] })
  @ApiOperation({ summary: 'Acknowledge an alert incident (Admin)', description: 'Marks the incident as seen by you. Idempotent: the first acknowledgement is kept. It does not resolve the incident.' })
  @ApiParam(INCIDENT_ID)
  @ApiDataResponse(AlertIncidentDto, { description: 'The incident' })
  @ApiResponse(NO_WRITE)
  @ApiResponse(NO_INCIDENT)
  acknowledge(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string): Promise<AlertIncident> {
    return this.incidents.acknowledge(id, userId);
  }

  /** The firing summary. */
  @Get('summary')
  @Auth({ permissions: [ALERT_PERMISSIONS.READ] })
  @ApiOperation({ summary: 'Alerts summary (Admin)', description: 'Incidents firing now by severity, and the newest evaluation: what a dashboard banner shows.' })
  @ApiDataResponse(AlertSummaryDto, { description: 'The summary' })
  @ApiResponse(NO_READ)
  summary(): Promise<AlertSummary> {
    return this.incidents.summary();
  }
}

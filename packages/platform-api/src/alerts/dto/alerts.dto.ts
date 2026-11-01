import { createZodDto } from 'nestjs-zod';
import {
  alertIncidentListQuerySchema,
  alertIncidentSchema,
  alertKindSchema,
  alertRuleListQuerySchema,
  alertRuleSchema,
  alertRuleTestResponseSchema,
  alertSummarySchema,
  createAlertRuleSchema,
  updateAlertRuleSchema,
} from '@marinoscar/platform-contract/alerts';

/** `POST /api/admin/alerts/rules` body. @stability experimental */
export class CreateAlertRuleDto extends createZodDto(createAlertRuleSchema) {}

/** `PATCH /api/admin/alerts/rules/:id` body. @stability experimental */
export class UpdateAlertRuleDto extends createZodDto(updateAlertRuleSchema) {}

/** `GET /api/admin/alerts/rules` query. @stability experimental */
export class AlertRuleListQueryDto extends createZodDto(alertRuleListQuerySchema) {}

/** `GET /api/admin/alerts/incidents` query. @stability experimental */
export class AlertIncidentListQueryDto extends createZodDto(alertIncidentListQuerySchema) {}

/** A rule. @stability experimental */
export class AlertRuleDto extends createZodDto(alertRuleSchema) {}

/** The dry-run response. @stability experimental */
export class AlertRuleTestResponseDto extends createZodDto(alertRuleTestResponseSchema) {}

/** A registered kind. @stability experimental */
export class AlertKindDto extends createZodDto(alertKindSchema) {}

/** An incident. @stability experimental */
export class AlertIncidentDto extends createZodDto(alertIncidentSchema) {}

/** The firing summary. @stability experimental */
export class AlertSummaryDto extends createZodDto(alertSummarySchema) {}

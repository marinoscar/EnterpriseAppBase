import { createZodDto } from 'nestjs-zod';

import {
  telemetryExportRequestSchema,
  telemetryQueryRequestSchema,
  telemetryQueryResultSchema,
  telemetrySchemaSchema,
  type TelemetryQueryResult,
} from '@marinoscar/platform-contract/telemetry';

// =============================================================================
// Telemetry explorer — request and response shapes (issue #535, epic #528)
// =============================================================================
//
//   POST /api/admin/telemetry/query    TelemetryQueryRequestDto  → TelemetryQueryResultDto
//   GET  /api/admin/telemetry/schema                              → TelemetrySchemaDto
//   POST /api/admin/telemetry/export   TelemetryExportRequestDto → file (binary)
//
// The schemas and limits live in `@marinoscar/platform-contract/telemetry`
// (#702); this file wraps them as nestjs-zod DTOs and re-exports the names
// services import.
// =============================================================================

export {
  TELEMETRY_COLUMN_TYPES,
  TELEMETRY_EXPORT_FORMATS,
  TELEMETRY_QUERY_MAX_ROWS_CEILING,
  TELEMETRY_SQL_MAX_LENGTH,
  telemetryColumnSchema,
  telemetrySchemaColumnSchema,
  telemetrySchemaTableSchema,
} from '@marinoscar/platform-contract/telemetry';
export { telemetryExportRequestSchema, telemetryQueryRequestSchema, telemetryQueryResultSchema, telemetrySchemaSchema };
export type {
  TelemetryColumn,
  TelemetryColumnType,
  TelemetryExportFormat,
  TelemetrySchema,
  TelemetrySchemaTable,
} from '@marinoscar/platform-contract/telemetry';
/** The `POST /api/admin/telemetry/query` response (the contract's `TelemetryQueryResult`). */
export type TelemetryQueryRunResult = TelemetryQueryResult;

export class TelemetryQueryRequestDto extends createZodDto(telemetryQueryRequestSchema) {}
export class TelemetryQueryResultDto extends createZodDto(telemetryQueryResultSchema) {}
export class TelemetrySchemaDto extends createZodDto(telemetrySchemaSchema) {}
export class TelemetryExportRequestDto extends createZodDto(telemetryExportRequestSchema) {}

/**
 * Shared telemetry fixtures — issue #537, epic #528. Shapes follow the API
 * contract (#534 config/status, #535 query/schema/export, #536 assistant).
 *
 * `GET /telemetry/config` answers DISABLED by default (no store deployed);
 * a test that needs the explorer overrides it, or renders with
 * `wrapperOptions: { telemetryEnabled: true }` (see `utils/test-utils.tsx`).
 */
import type {
  TelemetryAdminConfig,
  TelemetryPublicConfig,
  TelemetryQueryResult,
  TelemetrySchema,
  TelemetryStatus,
} from '../../../services/telemetry';

export const mockTelemetryPublicConfigDisabled: TelemetryPublicConfig = {
  available: false,
  enabled: false,
  assistantEnabled: false,
};

export const mockTelemetryPublicConfigEnabled: TelemetryPublicConfig = {
  available: true,
  enabled: true,
  assistantEnabled: true,
};

export const mockTelemetryAdminConfig: TelemetryAdminConfig = {
  enabled: true,
  retentionDays: 30,
  query: { maxRows: 10000, timeoutSeconds: 30 },
  assistant: {
    enabled: true,
    provider: 'openai',
    modelId: 'gpt-5-mini',
    shareResults: false,
    maxResultRowsToModel: 100,
    maxSteps: 8,
  },
  available: true,
  retentionApplicable: true,
  version: 7,
  updatedAt: '2026-09-01T10:00:00.000Z',
  updatedBy: { id: 'admin-user-id', email: 'admin@example.com' },
};

export const mockTelemetryStatus: TelemetryStatus = {
  configured: true,
  reachable: true,
  version: 'PostgreSQL 16.3 GreptimeDB 1.2.1',
  database: 'telemetry',
  ttl: { raw: '30days', days: 30 },
  retentionDays: 30,
  tables: [
    { name: 'opentelemetry_traces', rows: 12345 },
    { name: 'opentelemetry_logs', rows: 678 },
  ],
  error: null,
};

export const mockTelemetryStatusUnconfigured: TelemetryStatus = {
  configured: false,
  reachable: false,
  version: null,
  database: 'telemetry',
  ttl: null,
  retentionDays: 30,
  tables: [],
  error: null,
};

export const mockTelemetrySchema: TelemetrySchema = {
  tables: [
    {
      name: 'opentelemetry_traces',
      rows: 12345,
      columns: [
        { name: 'timestamp', type: 'timestamp', semanticType: 'TIMESTAMP' },
        { name: 'trace_id', type: 'text', semanticType: 'FIELD' },
        { name: 'span_name', type: 'text', semanticType: 'TAG' },
        { name: 'span_attributes.http.route', type: 'text', semanticType: 'FIELD' },
      ],
    },
    {
      name: 'opentelemetry_logs',
      rows: null,
      columns: [
        { name: 'timestamp', type: 'timestamp', semanticType: 'TIMESTAMP' },
        { name: 'body', type: 'text', semanticType: 'FIELD' },
      ],
    },
  ],
};

export const mockTelemetryQueryResult: TelemetryQueryResult = {
  columns: [
    { name: 'service_name', type: 'text' },
    { name: 'trace_id', type: 'text' },
    { name: 'service_name', type: 'text' },
  ],
  rows: [
    ['api', 'abc123', 'api-dup'],
    ['web', 'def456', null],
  ],
  rowCount: 2,
  truncated: false,
  elapsedMs: 42,
};

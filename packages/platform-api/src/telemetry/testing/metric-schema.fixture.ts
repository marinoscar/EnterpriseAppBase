import type { TelemetrySchema } from '../dto/telemetry-query.dto';

// =============================================================================
// Test fixture: the metric tables the catalog reads, as the store reports them
// (issue #601)
// =============================================================================
//
// Tag columns per table, copied from `information_schema.columns` of a
// GreptimeDB v1.2.1 fed by collector 0.145.0 (hostmetrics, prometheus/self,
// postgresql, httpcheck, nginx — the configuration of
// infra/otel/otel-collector-config.yaml) and by the API's OTLP metric exporter
// (2026-09-30). `httpcheck_tls_cert_remaining_seconds` is only written for an
// `https://` target and is taken from docs/specs/telemetry.md §11.3. Every
// table also has `greptime_timestamp` (TIMESTAMP) and `greptime_value`
// (FIELD, Float64).
//
// Used by the unit tests (as a `TelemetrySchema`) and by the live GreptimeDB
// tier (to create look-alike tables).
// =============================================================================

/**
 * The tag columns of every metric table the platform catalog reads, as the
 * collector and the API's OTLP exporter write them (verified against a live
 * store).
 *
 * @stability experimental
 */
export const VERIFIED_METRIC_TAGS: Record<string, readonly string[]> = {
  app_backup_last_success_timestamp_seconds: [
    'app_instance_id',
    'host_name',
    'job',
    'service_name',
  ],
  app_jobs_duration_seconds_bucket: [
    'app_instance_id',
    'executor',
    'host_name',
    'job',
    'job_type',
    'le',
    'outcome',
    'service_name',
  ],
  app_jobs_oldest_pending_age_seconds: [
    'app_instance_id',
    'host_name',
    'job',
    'job_type',
    'service_name',
  ],
  app_jobs_queue_depth: [
    'app_instance_id',
    'host_name',
    'job',
    'job_type',
    'service_name',
    'status',
  ],
  app_jobs_settled_total: [
    'app_instance_id',
    'executor',
    'host_name',
    'job',
    'job_type',
    'outcome',
    'service_name',
  ],
  app_nodes_count: ['app_instance_id', 'health', 'host_name', 'job', 'service_name', 'status'],
  app_nodes_cpu_utilization: [
    'app_instance_id',
    'host_name',
    'job',
    'node_id',
    'node_name',
    'service_name',
  ],
  app_nodes_heap_limit_bytes: [
    'app_instance_id',
    'host_name',
    'job',
    'node_id',
    'node_name',
    'service_name',
  ],
  app_nodes_heap_used_bytes: [
    'app_instance_id',
    'host_name',
    'job',
    'node_id',
    'node_name',
    'service_name',
  ],
  app_nodes_memory_rss_bytes: [
    'app_instance_id',
    'host_name',
    'job',
    'node_id',
    'node_name',
    'service_name',
  ],
  app_nodes_slots_total: [
    'app_instance_id',
    'host_name',
    'job',
    'node_id',
    'node_name',
    'service_name',
  ],
  app_nodes_slots_used: [
    'app_instance_id',
    'host_name',
    'job',
    'node_id',
    'node_name',
    'service_name',
  ],
  app_nodes_state_dir_free_bytes: [
    'app_instance_id',
    'host_name',
    'job',
    'node_id',
    'node_name',
    'service_name',
  ],
  app_nodes_state_dir_total_bytes: [
    'app_instance_id',
    'host_name',
    'job',
    'node_id',
    'node_name',
    'service_name',
  ],
  app_nodes_types_no_eligible_node: [
    'app_instance_id',
    'host_name',
    'job',
    'job_type',
    'service_name',
  ],
  greptime_mito_write_stalling_count: [
    'host_name',
    'instance',
    'job',
    'service_instance_id',
    'service_name',
    'worker',
  ],
  httpcheck_duration_milliseconds: ['host_name', 'http_url'],
  httpcheck_error: ['error_message', 'host_name', 'http_url'],
  httpcheck_status: [
    'host_name',
    'http_method',
    'http_status_class',
    'http_status_code',
    'http_url',
  ],
  httpcheck_tls_cert_remaining_seconds: ['host_name', 'http_tls_cn', 'http_tls_issuer', 'http_url'],
  nginx_connections_current: ['host_name', 'state'],
  nginx_requests_total: ['host_name'],
  otelcol_exporter_queue_capacity: [
    'data_type',
    'exporter',
    'host_name',
    'instance',
    'job',
    'service_instance_id',
    'service_name',
    'service_version',
  ],
  otelcol_exporter_queue_size: [
    'data_type',
    'exporter',
    'host_name',
    'instance',
    'job',
    'service_instance_id',
    'service_name',
    'service_version',
  ],
  otelcol_exporter_send_failed_metric_points_total: [
    'exporter',
    'host_name',
    'instance',
    'job',
    'service_instance_id',
    'service_name',
    'service_version',
  ],
  otelcol_exporter_sent_metric_points_total: [
    'exporter',
    'host_name',
    'instance',
    'job',
    'service_instance_id',
    'service_name',
    'service_version',
  ],
  otelcol_receiver_refused_metric_points_total: [
    'host_name',
    'instance',
    'job',
    'receiver',
    'service_instance_id',
    'service_name',
    'service_version',
    'transport',
  ],
  postgresql_backends: ['host_name', 'instance', 'postgresql_database_name', 'service_instance_id'],
  postgresql_blks_hit_total: [
    'host_name',
    'instance',
    'postgresql_database_name',
    'service_instance_id',
  ],
  postgresql_blks_read_total: [
    'host_name',
    'instance',
    'postgresql_database_name',
    'service_instance_id',
  ],
  postgresql_commits_total: [
    'host_name',
    'instance',
    'postgresql_database_name',
    'service_instance_id',
  ],
  postgresql_connection_max: ['host_name', 'instance', 'service_instance_id'],
  postgresql_db_size_bytes: [
    'host_name',
    'instance',
    'postgresql_database_name',
    'service_instance_id',
  ],
  postgresql_deadlocks_total: [
    'host_name',
    'instance',
    'postgresql_database_name',
    'service_instance_id',
  ],
  postgresql_rollbacks_total: [
    'host_name',
    'instance',
    'postgresql_database_name',
    'service_instance_id',
  ],
  postgresql_table_size_bytes: [
    'host_name',
    'instance',
    'postgresql_database_name',
    'postgresql_table_name',
    'service_instance_id',
  ],
  system_cpu_load_average_1m: ['host_name'],
  system_cpu_utilization_ratio: ['cpu', 'host_name', 'state'],
  system_disk_io_bytes_total: ['device', 'direction', 'host_name'],
  system_filesystem_usage_bytes: ['device', 'host_name', 'mode', 'mountpoint', 'state', 'type'],
  system_filesystem_utilization_ratio: ['device', 'host_name', 'mode', 'mountpoint', 'type'],
  system_memory_utilization_ratio: ['host_name', 'state'],
  system_network_io_bytes_total: ['device', 'direction', 'host_name'],
  up: ['host_name', 'instance', 'job', 'service_instance_id', 'service_name', 'service_version'],
};

/**
 * The schema entry of one verified metric table (semantic types reported, as the store does).
 *
 * @param name - the table.
 * @param tags - its tag columns; default its verified ones.
 * @returns the table as `TelemetrySchemaService` reports it.
 *
 * @stability experimental
 */
export function metricTableSchema(name: string, tags = VERIFIED_METRIC_TAGS[name]): TelemetrySchema['tables'][number] {
  return {
    name,
    rows: null,
    columns: [
      { name: 'greptime_timestamp', type: 'timestamp(3)', semanticType: 'TIMESTAMP' },
      { name: 'greptime_value', type: 'double', semanticType: 'FIELD' },
      ...tags.map((tag) => ({ name: tag, type: 'string', semanticType: 'TAG' })),
    ],
  };
}

/**
 * A schema holding every verified metric table (or only `only`).
 *
 * @param only - the table names to include; default all of them.
 * @returns the schema.
 *
 * @stability experimental
 */
export function metricCatalogSchema(only?: readonly string[]): TelemetrySchema {
  const names = only ?? Object.keys(VERIFIED_METRIC_TAGS);
  return { tables: names.map((name) => metricTableSchema(name)) };
}

/**
 * Tag columns of the `app_*` metric tables an app emits with its own
 * `AppMetricsService`, shaped like EvoPath's AI Coach (issue #703, PP-4.6): the
 * counters and the histogram its `coach` group reads. They are written by the
 * API's OTLP exporter exactly like the platform's `app_jobs_*` tables
 * (`app_instance_id`, `host_name`, `job` and `service_name` come with every
 * table, then one tag per declared attribute) and are named by the table rule of
 * the telemetry spec. Not part of the platform catalog; the readiness test and
 * the registry tests register an app group over them.
 *
 * @stability experimental
 */
export const APP_SAMPLE_METRIC_TAGS: Record<string, readonly string[]> = {
  app_coach_audio_failed_total: ['app_instance_id', 'host_name', 'job', 'provider', 'reason', 'service_name'],
  app_coach_audio_generated_total: ['app_instance_id', 'host_name', 'job', 'provider', 'service_name'],
  app_coach_nudge_opened_total: ['app_instance_id', 'channel', 'host_name', 'job', 'persona', 'service_name'],
  app_coach_nudge_sent_total: ['app_instance_id', 'channel', 'host_name', 'job', 'persona', 'service_name'],
  app_coach_nudge_suppressed_total: ['app_instance_id', 'host_name', 'job', 'persona', 'reason', 'service_name'],
  app_health_summary_duration_seconds_bucket: ['app_instance_id', 'host_name', 'job', 'le', 'outcome', 'service_name'],
};

/**
 * A schema holding the app sample tables of {@link APP_SAMPLE_METRIC_TAGS}
 * (or only `only`).
 *
 * @param only - the table names to include; default all of them.
 * @returns the schema.
 *
 * @stability experimental
 */
export function appSampleMetricSchema(only?: readonly string[]): TelemetrySchema {
  const names = only ?? Object.keys(APP_SAMPLE_METRIC_TAGS);
  return { tables: names.map((name) => metricTableSchema(name, APP_SAMPLE_METRIC_TAGS[name])) };
}

/**
 * Tag columns of the five `app_*` counter tables the reference app's `activity`
 * group reads (`app.auth.logins`, `app.auth.refreshes`, `app.ai.requests`,
 * `app.ai.tokens`, `app.notifications.deliveries`). The tag set is the metric's
 * declared attributes (`apps/api/src/common/otel/platform-app-metrics.ts`) plus
 * the four every `app_*` table carries; the names follow the spec's table
 * naming rule (dots become `_`, `_total` appended).
 *
 * @stability experimental
 */
export const APP_ACTIVITY_METRIC_TAGS: Record<string, readonly string[]> = {
  app_ai_requests_total: ['app_instance_id', 'host_name', 'job', 'key_source', 'model', 'operation', 'provider', 'service_name', 'status'],
  app_ai_tokens_total: ['app_instance_id', 'host_name', 'job', 'model', 'operation', 'provider', 'service_name', 'token_type'],
  app_auth_logins_total: ['app_instance_id', 'host_name', 'job', 'outcome', 'provider', 'service_name'],
  app_auth_refreshes_total: ['app_instance_id', 'host_name', 'job', 'outcome', 'service_name'],
  app_notifications_deliveries_total: ['app_instance_id', 'channel', 'event', 'host_name', 'job', 'outcome', 'service_name'],
};

/**
 * A schema holding the activity tables of {@link APP_ACTIVITY_METRIC_TAGS}
 * (or only `only`).
 *
 * @param only - the table names to include; default all of them.
 * @returns the schema.
 *
 * @stability experimental
 */
export function appActivityMetricSchema(only?: readonly string[]): TelemetrySchema {
  const names = only ?? Object.keys(APP_ACTIVITY_METRIC_TAGS);
  return { tables: names.map((name) => metricTableSchema(name, APP_ACTIVITY_METRIC_TAGS[name])) };
}

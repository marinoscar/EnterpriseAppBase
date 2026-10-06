import type { EnvSpecFragment, EnvVarMetadata } from '../core/index.js';

// =============================================================================
// The telemetry slice's env-key metadata  (PP-4.5, #706)
// =============================================================================
//
// Moved from the reference CLI's closed `ENV_METADATA` map. Every key here is
// declared by `infra/compose/.env.example`; this fragment only annotates them.
// All of them sit in the `observability` group, which a VPS deployment always
// enables.
// =============================================================================

/**
 * The feature group every telemetry key belongs to. A host CLI that gates
 * keys by group must know it.
 *
 * @stability experimental
 */
export type TelemetryEnvGroup = 'observability';

/**
 * One telemetry key's annotation: the platform's `EnvVarMetadata`, always in
 * {@link TelemetryEnvGroup}.
 *
 * @stability experimental
 */
export interface TelemetryEnvVarMetadata extends EnvVarMetadata {
  /** Always `observability`. */
  group: TelemetryEnvGroup;
}

/**
 * The shape of {@link telemetryEnvSpecFragment}: an `EnvSpecFragment` whose
 * entries all name {@link TelemetryEnvGroup}, so a host can check at compile
 * time that it knows the group.
 *
 * @stability experimental
 */
export interface TelemetryEnvSpecFragment extends EnvSpecFragment {
  /** Always `telemetry`. */
  readonly id: 'telemetry';
  /** Annotations by key; every entry carries `group: 'observability'`. */
  readonly metadata: Readonly<Record<string, TelemetryEnvVarMetadata>>;
}

/**
 * The env-spec fragment for the telemetry stack: the PostgreSQL monitor login,
 * the OpenTelemetry exporter settings and the GreptimeDB store.
 *
 * Register it once with `registerEnvSpecFragment(telemetryEnvSpecFragment)`.
 *
 * @stability experimental
 */
export const telemetryEnvSpecFragment: TelemetryEnvSpecFragment = {
  id: 'telemetry',
  metadata: {
    // The telemetry collector's PostgreSQL login (issue #598), a pg_monitor role
    // that must already exist on the server - so never generated, only asked.
    // Asked as a PAIR (both `essential`) because a password asked on its own
    // would be paired with POSTGRES_USER, which it does not belong to. Blank is
    // a real answer for both: telemetry.compose.yml then falls back to the
    // API's own POSTGRES_USER / POSTGRES_PASSWORD, which works on any server
    // without a new role. `allowBlank` is what keeps that blank from failing an
    // unattended install, and from failing `deploy update` on a deployment
    // written before these keys existed.
    POSTGRES_MONITOR_USER: { group: 'observability', essential: true, allowBlank: true },
    POSTGRES_MONITOR_PASSWORD: {
      group: 'observability',
      essential: true,
      secret: true,
      allowBlank: true,
    },

    OTEL_ENABLED: { group: 'observability' },
    OTEL_EXPORTER_OTLP_ENDPOINT: { group: 'observability' },
    OTEL_SERVICE_NAME: { group: 'observability' },

    // GreptimeDB telemetry store (telemetry.compose.yml). Three accounts with
    // three privileges: the collector writes, the explorer / AI assistant / BI
    // tools read, and only the retention (TTL) setting uses the admin account.
    //
    // The passwords are generated, never asked (#567), and as hex: they are
    // embedded in GreptimeDB's `user=password,...` provider string, so `,`, `=`
    // and `:` must never appear in them.
    GREPTIME_HOST: { group: 'observability' },
    GREPTIME_HTTP_PORT: { group: 'observability' },
    GREPTIME_PG_PORT: { group: 'observability' },
    // Loopback host port vps.telemetry.compose.yml publishes the PG protocol on.
    GREPTIME_BIND_PG_PORT: { group: 'observability' },
    GREPTIME_DB: { group: 'observability' },
    GREPTIME_WRITER_USER: { group: 'observability' },
    GREPTIME_WRITER_PASSWORD: {
      group: 'observability',
      secret: true,
      generate: 'hex-32',
      autoGenerate: true,
    },
    GREPTIME_READER_USER: { group: 'observability' },
    GREPTIME_READER_PASSWORD: {
      group: 'observability',
      secret: true,
      generate: 'hex-32',
      autoGenerate: true,
    },
    GREPTIME_ADMIN_USER: { group: 'observability' },
    GREPTIME_ADMIN_PASSWORD: {
      group: 'observability',
      secret: true,
      generate: 'hex-32',
      autoGenerate: true,
    },
  },
};

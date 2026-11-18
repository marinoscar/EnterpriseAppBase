import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { commentedAssignments, composeEnvSpecs, PLATFORM_DOCUMENTED_OPTIONAL_KEYS } from './env-fragments.js';
import { parseEnvExample } from './env-spec.js';

// =============================================================================
// The env template as fragments  (PP-8.9, #715)
// =============================================================================

const REPO = resolve(__dirname, '..', '..', '..', '..', '..');
const read = (path: string): string => readFileSync(resolve(REPO, path), 'utf8');

/**
 * The reference app's ordered question list, captured before #715 moved the
 * CLI. Never regenerated to make this pass: a difference is a variable the
 * wizard now asks in another place, or no longer asks.
 */
const REFERENCE_KEYS = [
  'NODE_ENV', 'PORT', 'APP_URL', 'APP_BIND_PORT', 'CORS_ORIGIN', 'POSTGRES_HOST', 'POSTGRES_PORT',
  'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB', 'POSTGRES_SSL', 'POSTGRES_MONITOR_USER',
  'POSTGRES_MONITOR_PASSWORD', 'JWT_SECRET', 'JWT_ACCESS_TTL_MINUTES', 'JWT_REFRESH_TTL_DAYS',
  'AUTH_PRINCIPAL_CACHE_TTL_SECONDS', 'COOKIE_SECRET', 'SECRETS_ENCRYPTION_KEY', 'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET', 'GOOGLE_CALLBACK_URL', 'MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET',
  'MICROSOFT_CALLBACK_URL', 'INITIAL_ADMIN_EMAIL', 'TEST_AUTH_ENABLED', 'DEVICE_CODE_EXPIRY_MINUTES',
  'DEVICE_CODE_POLL_INTERVAL', 'DEVICE_TOKEN_EXPIRY_DAYS', 'DEVICE_PAT_EXPIRY_DAYS', 'MAINTENANCE_MODE',
  'DEPLOYMENT_MODE', 'OTEL_ENABLED', 'OTEL_EXPORTER_OTLP_ENDPOINT', 'OTEL_SERVICE_NAME', 'LOG_LEVEL',
  'OTEL_DEBUG', 'GREPTIME_HOST', 'GREPTIME_HTTP_PORT', 'GREPTIME_PG_PORT', 'GREPTIME_BIND_PG_PORT',
  'GREPTIME_DB', 'GREPTIME_WRITER_USER', 'GREPTIME_WRITER_PASSWORD', 'GREPTIME_READER_USER',
  'GREPTIME_READER_PASSWORD', 'GREPTIME_ADMIN_USER', 'GREPTIME_ADMIN_PASSWORD', 'STACK_AGENT_TOKEN',
  'MAX_FILE_SIZE', 'ALLOWED_MIME_TYPES', 'SIGNED_URL_EXPIRY', 'STORAGE_PART_SIZE', 'SES_REGION',
  'JOBS_MAX_ATTEMPTS', 'JOBS_RETRY_BASE_MS', 'JOBS_RETRY_MAX_MS', 'JOBS_RATELIMIT_MAX_HITS',
  'JOBS_RATELIMIT_BASE_MS', 'JOBS_RATELIMIT_MAX_MS', 'JOBS_WORKER_CONCURRENCY', 'JOBS_POLL_MS',
  'JOBS_WORKER_MODE', 'JOBS_JOB_TIMEOUT_MS', 'JOBS_SYSTEM_MODE_EXTRA_TYPES', 'JOBS_REAPER_ENABLED',
  'NODE_STALE_OFFLINE_ENABLED', 'NODE_OFFLINE_PRUNE_ENABLED', 'NODE_SECRET_SWEEP_ENABLED',
  'DB_BACKUP_SCHEDULE_ENABLED', 'EVENT_BUS_ADAPTER', 'DEPLOYMENT_NETWORK', 'TENANCY_MODE',
];

describe('composeEnvSpecs over the reference app', () => {
  const fragments = [read('packages/platform-infra/env/base.env.example'), read('infra/compose/app.env.example')];

  it('gives the same ordered list as before the move (snapshot)', () => {
    expect(composeEnvSpecs(fragments).map((spec) => spec.key)).toEqual(REFERENCE_KEYS);
  });

  it('gives exactly what init and deploy read from the composed .env.example', () => {
    expect(composeEnvSpecs(fragments).map((spec) => spec.key)).toEqual(
      parseEnvExample(read('infra/compose/.env.example')).map((spec) => spec.key),
    );
  });

  it('refuses a key declared by two fragments', () => {
    expect(() => composeEnvSpecs(['A=1\n', 'A=2\n'])).toThrow(/"A" is declared by two/);
  });
});

describe('commentedAssignments (the conformance case)', () => {
  it('passes the platform base with its documented optional keys, and the app fragment with none', () => {
    expect(commentedAssignments(read('packages/platform-infra/env/base.env.example'), PLATFORM_DOCUMENTED_OPTIONAL_KEYS)).toEqual([]);
    expect(commentedAssignments(read('infra/compose/app.env.example'))).toEqual([]);
  });

  it('fails a fragment carrying a commented KEY=value line', () => {
    const fragment = ['# The coach API token.', 'COACH_TOKEN=', '', '# For example:', '# COACH_MODEL=small', ''].join('\n');
    expect(commentedAssignments(fragment)).toEqual(['COACH_MODEL']);
  });
});

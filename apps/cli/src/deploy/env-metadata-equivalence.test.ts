import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { listEnvSpecFragments } from '@marinoscar/platform-cli/core';
import { describe, expect, it } from 'vitest';

import { ENV_METADATA, metadataFor } from './env-metadata.js';
import { parseEnvExample } from './env-spec.js';

// =============================================================================
// metadataFor() is unchanged by the move to env-spec fragments  (PP-4.5, #706)
// =============================================================================
//
// `BEFORE` is the full `ENV_METADATA` map as it stood on main before the
// telemetry rows moved to `telemetryEnvSpecFragment`, captured by running
// `metadataFor` over every key of that map. Function-valued fields (`derive`,
// `validate`) are compared by presence: their behaviour is covered in
// env-spec.test.ts.
//
// ⚠ NEVER REGENERATE `BEFORE` FROM THE CURRENT CODE. Its whole value is that it
// was written down before the change; regenerating it would make this test
// agree with whatever the code does.
// =============================================================================

const BEFORE: Readonly<Record<string, Record<string, string | boolean>>> = {
  NODE_ENV: { fixed: 'production' },
  APP_URL: { derive: '[function]' },
  POSTGRES_HOST: { essential: true },
  POSTGRES_PORT: { validate: '[function]' },
  POSTGRES_USER: { essential: true },
  POSTGRES_PASSWORD: { essential: true, secret: true },
  POSTGRES_DB: { essential: true },
  POSTGRES_MONITOR_USER: { group: 'observability', essential: true, allowBlank: true },
  POSTGRES_MONITOR_PASSWORD: { group: 'observability', essential: true, secret: true, allowBlank: true },
  JWT_SECRET: { essential: true, secret: true, generate: 'base64-32', validate: '[function]' },
  COOKIE_SECRET: { essential: true, secret: true, generate: 'base64-32', validate: '[function]' },
  SECRETS_ENCRYPTION_KEY: { secret: true, generate: 'base64-32', validate: '[function]' },
  GOOGLE_CLIENT_ID: { essential: true, validate: '[function]' },
  GOOGLE_CLIENT_SECRET: { essential: true, secret: true, validate: '[function]' },
  GOOGLE_CALLBACK_URL: { derive: '[function]' },
  MICROSOFT_CLIENT_ID: { group: 'microsoft-oauth' },
  MICROSOFT_CLIENT_SECRET: { group: 'microsoft-oauth', secret: true },
  MICROSOFT_CALLBACK_URL: { group: 'microsoft-oauth', derive: '[function]' },
  INITIAL_ADMIN_EMAIL: { essential: true, validate: '[function]' },
  TEST_AUTH_ENABLED: { never: true },
  OTEL_ENABLED: { group: 'observability' },
  OTEL_EXPORTER_OTLP_ENDPOINT: { group: 'observability' },
  OTEL_SERVICE_NAME: { group: 'observability' },
  GREPTIME_HOST: { group: 'observability' },
  GREPTIME_HTTP_PORT: { group: 'observability' },
  GREPTIME_PG_PORT: { group: 'observability' },
  GREPTIME_BIND_PG_PORT: { group: 'observability' },
  GREPTIME_DB: { group: 'observability' },
  GREPTIME_WRITER_USER: { group: 'observability' },
  GREPTIME_WRITER_PASSWORD: { group: 'observability', secret: true, generate: 'hex-32', autoGenerate: true },
  GREPTIME_READER_USER: { group: 'observability' },
  GREPTIME_READER_PASSWORD: { group: 'observability', secret: true, generate: 'hex-32', autoGenerate: true },
  GREPTIME_ADMIN_USER: { group: 'observability' },
  GREPTIME_ADMIN_PASSWORD: { group: 'observability', secret: true, generate: 'hex-32', autoGenerate: true },
  STACK_AGENT_TOKEN: { secret: true, generate: 'hex-32', autoGenerate: true },
  SES_REGION: { group: 'email' },
  EVENT_BUS_ADAPTER: { validate: '[function]' },
};

const REAL_TEMPLATE = resolve(__dirname, '..', '..', '..', '..', 'infra', 'compose', '.env.example');

/** Functions replaced by a marker, so two maps compare by field presence. */
function normalise(metadata: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(metadata).map(([field, value]) => [field, typeof value === 'function' ? '[function]' : value]),
  );
}

describe('metadataFor after the move to env-spec fragments', () => {
  it.each(Object.keys(BEFORE))('resolves %s exactly as before', (key) => {
    expect(normalise(metadataFor(key))).toEqual(BEFORE[key]);
  });

  it('still covers every key the old map had, in the app map or a fragment', () => {
    // A superset, not equality: keys added to ENV_METADATA after the move
    // (DEPLOYMENT_MODE, ...) are legitimate; losing one of BEFORE is not.
    const now = new Set<string>();
    for (const fragment of listEnvSpecFragments()) {
      for (const key of Object.keys(fragment.metadata)) now.add(key);
    }
    expect(Object.keys(BEFORE).filter((key) => !now.has(key))).toEqual([]);
  });

  it('kept STACK_AGENT_TOKEN in the app map and moved every telemetry row out of it', () => {
    expect(ENV_METADATA.STACK_AGENT_TOKEN).toBeDefined();
    const telemetryKeys = Object.keys(ENV_METADATA).filter((key) =>
      /^(OTEL_|GREPTIME_|POSTGRES_MONITOR_)/.test(key),
    );
    expect(telemetryKeys).toEqual([]);
  });

  it('only annotates, in any fragment, keys that exist in the real template', () => {
    const known = new Set(parseEnvExample(readFileSync(REAL_TEMPLATE, 'utf8')).map((spec) => spec.key));
    for (const fragment of listEnvSpecFragments()) {
      expect(Object.keys(fragment.metadata).filter((key) => !known.has(key)), fragment.id).toEqual([]);
    }
  });
});

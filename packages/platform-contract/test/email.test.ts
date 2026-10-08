// The email contract (issue #737): the stored settings and the response carry
// no secret-bearing field, the PUT body accepts the two secrets write-only and
// the blank forms, and the subpath loads in both module formats.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

import * as email from '../src/email/index.js';
import {
  DEFAULT_EMAIL_SETTINGS,
  DEFAULT_SMTP_PORT,
  EMAIL_PROVIDER_KINDS,
  IMPLICIT_TLS_SMTP_PORT,
  emailSettingsResponseSchema,
  emailSettingsSchema,
  testEmailResultSchema,
  updateEmailSettingsSchema,
} from '../src/email/index.js';

const require = createRequire(import.meta.url);

const SECRET_NAMES = ['smtpPassword', 'password', 'secret', 'apiKey', 'accessKeyId', 'secretAccessKey', 'sesSecretAccessKey'];

describe('@marinoscar/platform-contract/email', () => {
  it('keeps the transport list closed and the SMTP ports', () => {
    expect(EMAIL_PROVIDER_KINDS).toEqual(['ses', 'smtp']);
    expect(DEFAULT_SMTP_PORT).toBe(587);
    expect(IMPLICIT_TLS_SMTP_PORT).toBe(465);
    expect(emailSettingsSchema.parse(DEFAULT_EMAIL_SETTINGS)).toEqual({ provider: null, enabled: false });
  });

  it('has no secret-named field in the stored settings or the response', () => {
    for (const schema of [emailSettingsSchema, emailSettingsResponseSchema]) {
      const keys = Object.keys(schema.shape);
      for (const name of SECRET_NAMES) expect(keys).not.toContain(name);
    }
  });

  it('strips a secret submitted to the stored settings', () => {
    const parsed = emailSettingsSchema.parse({ provider: 'smtp', enabled: true, smtpPassword: 'hunter2-hunter2' });
    expect(parsed).not.toHaveProperty('smtpPassword');
  });

  it('accepts the write-only secrets and the blank forms on PUT', () => {
    const body = updateEmailSettingsSchema.parse({
      provider: 'smtp',
      enabled: true,
      smtpHost: '',
      smtpPort: null,
      smtpPassword: 'p@ss',
      sesSecretAccessKey: '',
    });
    expect(body).toMatchObject({ smtpHost: '', smtpPort: null, smtpPassword: 'p@ss', sesSecretAccessKey: '' });
    expect(updateEmailSettingsSchema.safeParse({ provider: 'carrier-pigeon', enabled: true }).success).toBe(false);
  });

  it('parses a test-send result', () => {
    expect(
      testEmailResultSchema.parse({
        success: false,
        sentTo: 'admin@example.test',
        providerKind: null,
        messageId: null,
        error: 'No email provider is selected.',
        attemptedAt: '2026-10-08T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('loads through require() with the same keys', () => {
    const cjs = require('../dist/cjs/email/index.js') as Record<string, unknown>;
    expect(Object.keys(cjs).sort()).toEqual(Object.keys(email).sort());
  });
});

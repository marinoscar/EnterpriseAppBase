// The email contract (issue #737): the stored settings and the response carry
// no secret-bearing field, the PUT body accepts the two secrets write-only and
// the blank forms, and the subpath loads in both module formats.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

import * as email from '../src/email/index.js';
import {
  DEFAULT_EMAIL_SETTINGS,
  BUILTIN_EMAIL_PROVIDER_KINDS,
  DEFAULT_SMTP_PORT,
  EMAIL_PROVIDER_KINDS,
  EMAIL_TRANSPORT_ID_PATTERN,
  LEGACY_EMAIL_FLAT_FIELDS,
  LEGACY_EMAIL_FLAT_FIELD_TARGETS,
  IMPLICIT_TLS_SMTP_PORT,
  emailSettingsResponseSchema,
  emailSettingsSchema,
  testEmailResultSchema,
  updateEmailSettingsSchema,
} from '../src/email/index.js';

const require = createRequire(import.meta.url);

const SECRET_NAMES = ['smtpPassword', 'password', 'secret', 'apiKey', 'accessKeyId', 'secretAccessKey', 'sesSecretAccessKey'];

describe('@marinoscar/platform-contract/email', () => {
  it('lists the built-in transports (the deprecated alias is the same list) and the SMTP ports', () => {
    expect(BUILTIN_EMAIL_PROVIDER_KINDS).toEqual(['ses', 'smtp']);
    expect(EMAIL_PROVIDER_KINDS).toBe(BUILTIN_EMAIL_PROVIDER_KINDS);
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

  it('accepts any well-formed transport id, built-in or not, and refuses a malformed one', () => {
    expect(emailSettingsSchema.parse({ provider: 'log', enabled: true }).provider).toBe('log');
    expect(emailSettingsSchema.parse({ provider: 'my-relay-2', enabled: true }).provider).toBe('my-relay-2');
    for (const bad of ['', 'x', 'Upper', '1abc', 'has space', 'a'.repeat(49)]) {
      expect(EMAIL_TRANSPORT_ID_PATTERN.test(bad)).toBe(false);
      expect(emailSettingsSchema.safeParse({ provider: bad, enabled: true }).success).toBe(false);
    }
  });

  it('reads a row stored before transports were pluggable (flat fields, no `transports`)', () => {
    const stored = {
      provider: 'smtp',
      enabled: true,
      fromAddress: 'no-reply@example.test',
      smtpHost: 'smtp.example.test',
      smtpPort: 465,
      smtpUseTls: true,
      smtpUsername: 'mailer',
      sesRegion: 'eu-west-1',
      sesAccessKeyId: 'AKIAEXAMPLE',
    };
    expect(emailSettingsSchema.parse(stored)).toEqual(stored);
  });

  it('maps every legacy flat field to a built-in transport setting', () => {
    expect(Object.keys(LEGACY_EMAIL_FLAT_FIELD_TARGETS).sort()).toEqual([...LEGACY_EMAIL_FLAT_FIELDS].sort());
    expect(LEGACY_EMAIL_FLAT_FIELD_TARGETS.smtpHost).toEqual({ transport: 'smtp', setting: 'host' });
  });

  it('accepts the transports patch (null removes) and per-transport secrets on PUT', () => {
    const body = updateEmailSettingsSchema.parse({
      provider: 'log',
      enabled: true,
      transports: { smtp: { host: 'h' }, log: null },
      secrets: { log: { apiKey: 'k', other: null, blank: '' } },
    });
    expect(body.transports).toEqual({ smtp: { host: 'h' }, log: null });
    expect(body.secrets).toEqual({ log: { apiKey: 'k', other: null, blank: '' } });
    expect(updateEmailSettingsSchema.safeParse({ provider: 'log', enabled: true, transports: { 'Bad Id': {} } }).success).toBe(false);
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
    expect(updateEmailSettingsSchema.safeParse({ provider: 'carrier pigeon', enabled: true }).success).toBe(false);
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

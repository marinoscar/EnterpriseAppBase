import { describe, expect, it } from 'vitest';

import {
  generateBase64Key,
  generateHexKey,
  generateValue,
  isPlaceholderValue,
  needsAutoGenerate,
  validateBase64Key32,
  validateEmail,
  validatePort,
} from './env-values.js';

describe('env value helpers', () => {
  it('generates 32-byte keys in the requested encoding', () => {
    expect(Buffer.from(generateBase64Key(), 'base64')).toHaveLength(32);
    expect(generateHexKey()).toMatch(/^[0-9a-f]{64}$/);
    expect(generateValue('hex-32')).toMatch(/^[0-9a-f]{64}$/);
    expect(validateBase64Key32(generateValue('base64-32'))).toBeUndefined();
  });

  it('recognises template placeholders and replaces only those', () => {
    expect(isPlaceholderValue('change-me-please')).toBe(true);
    expect(isPlaceholderValue('your-secret')).toBe(true);
    expect(isPlaceholderValue('greptime', 'greptime')).toBe(true);
    expect(isPlaceholderValue('a-real-value', '')).toBe(false);

    expect(needsAutoGenerate(undefined)).toBe(true);
    expect(needsAutoGenerate('')).toBe(true);
    expect(needsAutoGenerate('change-me')).toBe(true);
    expect(needsAutoGenerate('0f'.repeat(32))).toBe(false);
  });

  it('validates base64 keys, emails and ports', () => {
    expect(validateBase64Key32('')).toBeUndefined();
    expect(validateBase64Key32('not base64!')).toMatch(/valid base64/);
    expect(validateBase64Key32(Buffer.alloc(16).toString('base64'))).toMatch(/exactly 32 bytes/);

    expect(validateEmail('admin@example.test')).toBeUndefined();
    expect(validateEmail('admin')).toBe('must be an email address');

    expect(validatePort('5432')).toBeUndefined();
    expect(validatePort('0')).toMatch(/between 1 and 65535/);
    expect(validatePort('65536')).toMatch(/between 1 and 65535/);
  });
});

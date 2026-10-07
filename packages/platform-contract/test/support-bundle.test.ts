// The support bundle envelope (issue #772).
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

import {
  SUPPORT_BUNDLE_SECTION_STATUSES,
  supportBundleSchema,
  supportBundleSectionResultSchema,
} from '../src/doctor/index.js';

const require = createRequire(import.meta.url);
const manifest = require('../package.json') as { exports: Record<string, unknown> };

const BUNDLE = {
  bundleVersion: 1,
  generatedAt: '2026-10-06T12:00:00.000Z',
  redaction: { rules: 'v1', replacements: 3 },
  sections: {
    meta: { status: 'ok', data: { sections: ['meta', 'doctor'] } },
    doctor: { status: 'ok', data: null, truncated: true },
    telemetry: { status: 'omitted', reason: 'requires telemetry:query' },
    versions: { status: 'error', error: 'timed out after 10000 ms' },
  },
};

describe('@marinoscar/platform-contract/doctor: support bundle', () => {
  it('accepts a bundle with every section status', () => {
    expect(supportBundleSchema.parse(BUNDLE)).toEqual(BUNDLE);
    expect(SUPPORT_BUNDLE_SECTION_STATUSES).toEqual(['ok', 'omitted', 'error']);
  });

  it('rejects another bundle version or rule set', () => {
    expect(supportBundleSchema.safeParse({ ...BUNDLE, bundleVersion: 2 }).success).toBe(false);
    expect(supportBundleSchema.safeParse({ ...BUNDLE, redaction: { rules: 'v2', replacements: 0 } }).success).toBe(false);
    expect(supportBundleSchema.safeParse({ ...BUNDLE, redaction: { rules: 'v1', replacements: 1.5 } }).success).toBe(false);
  });

  it('requires the field of each status: a reason for omitted, an error for error', () => {
    expect(supportBundleSectionResultSchema.safeParse({ status: 'omitted' }).success).toBe(false);
    expect(supportBundleSectionResultSchema.safeParse({ status: 'error' }).success).toBe(false);
    expect(supportBundleSectionResultSchema.safeParse({ status: 'skipped', reason: 'x' }).success).toBe(false);
  });

  it('is a dual subpath export: ESM under import, CJS under require', () => {
    expect(manifest.exports['./doctor']).toEqual({
      import: { types: './dist/esm/doctor/index.d.ts', default: './dist/esm/doctor/index.js' },
      require: { types: './dist/cjs/doctor/index.d.ts', default: './dist/cjs/doctor/index.js' },
    });
  });
});

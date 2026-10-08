// The credentials contract (issue #735): the presentation shapes carry no
// secret-bearing field, no row id and no owner id, and the subpath loads in
// both module formats.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import * as credentials from '../src/credentials/index.js';
import {
  CREDENTIAL_SOURCES,
  CREDENTIAL_TIERS,
  SECRET_BEARING_KEYS,
  credentialInfoSchema,
  orgCredentialInfoSchema,
  userCredentialInfoSchema,
} from '../src/credentials/index.js';

const require = createRequire(import.meta.url);

const INFO_SCHEMAS = Object.entries(credentials).filter(([name]) => name.endsWith('InfoSchema')) as Array<
  [string, z.ZodObject<z.ZodRawShape>]
>;

describe('@marinoscar/platform-contract/credentials', () => {
  it('lists the tiers and the resolution sources', () => {
    expect(CREDENTIAL_TIERS).toEqual(['system', 'org']);
    expect(CREDENTIAL_SOURCES).toEqual(['user', 'org', 'system', 'none']);
  });

  it('scans every *InfoSchema: none has a secret-bearing, id or owner property', () => {
    expect(INFO_SCHEMAS.map(([name]) => name).sort()).toEqual([
      'credentialInfoSchema',
      'orgCredentialInfoSchema',
      'userCredentialInfoSchema',
    ]);
    for (const [, schema] of INFO_SCHEMAS) {
      const keys = Object.keys(schema.shape);
      for (const forbidden of [...SECRET_BEARING_KEYS, 'id', 'userId', 'orgId']) expect(keys).not.toContain(forbidden);
    }
  });

  it('parses a credential info and strips anything else, a secret included', () => {
    const wire = {
      purpose: 'smtp',
      name: 'default',
      hint: '••••abcd',
      label: 'SMTP password',
      updatedByUserId: null,
      createdAt: '2026-10-08T00:00:00.000Z',
      updatedAt: '2026-10-08T00:00:00.000Z',
      secret: 'must-not-survive',
    };
    expect(credentialInfoSchema.parse(wire)).not.toHaveProperty('secret');
    expect(orgCredentialInfoSchema.parse(wire)).toMatchObject({ purpose: 'smtp', hint: '••••abcd' });
    expect(Object.keys(userCredentialInfoSchema.shape)).not.toContain('updatedByUserId');
  });

  it('loads through require() with the same keys', () => {
    const cjs = require('../dist/cjs/credentials/index.js') as Record<string, unknown>;
    expect(Object.keys(cjs).sort()).toEqual(Object.keys(credentials).sort());
  });
});

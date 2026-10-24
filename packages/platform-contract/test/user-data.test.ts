import { describe, expect, it } from 'vitest';

import {
  FACTORY_RESET_CONFIRMATION,
  USER_DATA_PATHS,
  factoryResetRequestSchema,
  orgOffboardingRequestSchema,
  userDataDeletionRequestSchema,
  userDataDeletionStatusSchema,
  userDataPurgeResultSchema,
  factoryResetSummarySchema,
  userDataSummarySchema,
} from '../src/user-data/index.js';

describe('@marinoscar/platform-contract/user-data', () => {
  it('keeps the factory reset phrase a literal', () => {
    expect(factoryResetRequestSchema.safeParse({ confirmation: FACTORY_RESET_CONFIRMATION }).success).toBe(true);
    expect(factoryResetRequestSchema.safeParse({ confirmation: 'factory reset' }).success).toBe(false);
    expect(factoryResetRequestSchema.safeParse({}).success).toBe(false);
  });

  it('accepts any scope id on the wire (scopes are a registry) and bounds it', () => {
    expect(userDataDeletionRequestSchema.safeParse({ scope: 'transcripts', confirmation: 'TRANSCRIPTS' }).success).toBe(true);
    expect(userDataDeletionRequestSchema.safeParse({ scope: '', confirmation: 'x' }).success).toBe(false);
    expect(userDataDeletionRequestSchema.safeParse({ scope: 'x'.repeat(65), confirmation: 'x' }).success).toBe(false);
  });

  it('parses an older purge result with missing maps as zeros', () => {
    expect(userDataPurgeResultSchema.parse({})).toEqual({
      categories: {},
      models: {},
      storageObjectsDeleted: 0,
      storageObjectsFailed: 0,
      cancelledJobs: 0,
      delegatedJobs: 0,
    });
    const status = userDataDeletionStatusSchema.parse({ jobId: 'j', status: 'succeeded', scope: 'everything', result: {}, error: null });
    expect(status.result?.storageObjectsFailed).toBe(0);
  });

  it('defaults the offboarding user disposition to keep and requires a skip reason', () => {
    expect(orgOffboardingRequestSchema.parse({ confirmation: 'acme' })).toEqual({ confirmation: 'acme', userDisposition: 'keep' });
    expect(orgOffboardingRequestSchema.safeParse({ confirmation: 'acme', skipExport: { reason: '' } }).success).toBe(false);
    expect(orgOffboardingRequestSchema.safeParse({ confirmation: 'acme', userDisposition: 'delete' }).success).toBe(false);
  });

  it('describes a summary with nullable bytes', () => {
    const parsed = userDataSummarySchema.parse({
      categories: [{ id: 'files', label: 'Files', description: 'd', content: true, count: 2, bytes: 10 }],
      scopes: [{ id: 'everything', label: 'Everything', description: 'd', layer: 'danger', confirmation: 'DELETE MY DATA', categories: ['files'] }],
      kept: ['Your account'],
    });
    expect(parsed.categories[0]!.bytes).toBe(10);
    expect(parsed.kept).toEqual(['Your account']);
  });

  it('carries the lists the pages print: kept on both summaries, deleted on the factory reset one (PP-14.24)', () => {
    expect(userDataSummarySchema.safeParse({ categories: [], scopes: [] }).success).toBe(false);
    const reset = factoryResetSummarySchema.parse({
      disabledReason: null,
      otherUsers: 1,
      organizations: 0,
      storageObjects: 2,
      jobs: 3,
      categories: [],
      deleted: ['Every other user'],
      kept: ['Roles and permissions'],
    });
    expect(reset.deleted).toEqual(['Every other user']);
    expect(reset.kept).toEqual(['Roles and permissions']);
    expect(factoryResetSummarySchema.safeParse({ ...reset, deleted: undefined }).success).toBe(false);
  });

  it('encodes the org id in the offboarding path', () => {
    expect(USER_DATA_PATHS.offboarding('a/b')).toBe('/admin/orgs/a%2Fb/offboarding');
  });
});

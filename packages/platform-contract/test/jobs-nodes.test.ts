// The jobs and nodes slices' wire shapes (issue #734): the schemas the API
// wraps with createZodDto parse what the routes accept and return.
import { describe, expect, it } from 'vitest';

import {
  JOB_REASONS,
  JOB_STATUSES,
  MAX_INSIGHTS_WINDOW_DAYS,
  jobInsightsQuerySchema,
  jobListQuerySchema,
  jobSchema,
} from '../src/jobs/index.js';
import {
  MAX_NODE_CONCURRENCY,
  claimJobsSchema,
  createNodeCredentialSchema,
  heartbeatNodeSchema,
  nodeDownloadUrlSchema,
} from '../src/nodes/index.js';

const ORG = '11111111-1111-4111-8111-aaaaaaaaaaaa';

describe('jobs contract', () => {
  it('lists the four statuses and three reasons', () => {
    expect(JOB_STATUSES).toEqual(['pending', 'running', 'succeeded', 'failed']);
    expect(JOB_REASONS).toEqual(['upload', 'rerun', 'backfill']);
  });

  it('parses a listed job, orgId included (null for a system job)', () => {
    const row = {
      id: ORG,
      type: 'example.echo',
      typeLabel: 'Example echo',
      subjectType: null,
      subjectId: null,
      dedupKey: null,
      status: 'pending',
      reason: 'upload',
      priority: 0,
      providerKey: null,
      modelVersion: null,
      attempts: 0,
      lastError: null,
      createdAt: '2026-10-08T00:00:00.000Z',
      startedAt: null,
      finishedAt: null,
      scheduledFor: null,
      rateLimitedAt: null,
      rateLimitHits: 0,
      claimedByNodeId: null,
      leaseExpiresAt: null,
      executor: null,
      orgId: null,
    };
    expect(jobSchema.parse(row)).toEqual(row);
    expect(jobSchema.parse({ ...row, orgId: ORG }).orgId).toBe(ORG);
    expect(jobSchema.safeParse({ ...row, orgId: 'not-a-uuid' }).success).toBe(false);
  });

  it('defaults the list query and accepts an orgId filter as a UUID only', () => {
    expect(jobListQuerySchema.parse({})).toMatchObject({ page: 1, pageSize: 20, processedWithin: 'all' });
    expect(jobListQuerySchema.parse({ orgId: ORG }).orgId).toBe(ORG);
    expect(jobListQuerySchema.safeParse({ orgId: 'acme' }).success).toBe(false);
    expect(jobListQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false);
  });

  it('bounds the insights window', () => {
    expect(jobInsightsQuerySchema.parse({}).windowDays).toBe(7);
    expect(jobInsightsQuerySchema.safeParse({ windowDays: String(MAX_INSIGHTS_WINDOW_DAYS + 1) }).success).toBe(false);
  });
});

describe('nodes contract', () => {
  it('accepts a node with no download-url body (pre-#364 nodes)', () => {
    expect(nodeDownloadUrlSchema.parse(undefined)).toEqual({});
    expect(nodeDownloadUrlSchema.safeParse({ claimToken: 'nope' }).success).toBe(false);
  });

  it('bounds the claim and refuses unknown vitals', () => {
    expect(claimJobsSchema.safeParse({ limit: MAX_NODE_CONCURRENCY + 1 }).success).toBe(false);
    expect(heartbeatNodeSchema.safeParse({ vitals: { cpuPercent: 10, surprise: 1 } }).success).toBe(false);
  });

  it('requires a node credential name', () => {
    expect(createNodeCredentialSchema.safeParse({ name: '  ' }).success).toBe(false);
    expect(createNodeCredentialSchema.parse({ name: 'build box' })).toEqual({ name: 'build box' });
  });
});

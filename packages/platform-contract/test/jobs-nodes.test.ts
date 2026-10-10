// The jobs and nodes slices' wire shapes (issue #734): the schemas the API
// wraps with createZodDto parse what the routes accept and return.
import { describe, expect, it } from 'vitest';

import {
  JOB_REASONS,
  JOB_STATUSES,
  MAX_INSIGHTS_WINDOW_DAYS,
  RETENTION_MAX_DAYS,
  RETENTION_POLICY_KEYS,
  jobInsightsQuerySchema,
  jobListQuerySchema,
  jobSchema,
  jobsResponseSchema,
  jobsSettingsPatchSchema,
  jobsSettingsSchema,
  retentionResponseSchema,
  retentionSettingsPatchSchema,
  retentionSettingsSchema,
  systemJobsPatchSchema,
  systemJobsSchema,
  systemRetentionPatchSchema,
  systemRetentionSchema,
} from '../src/jobs/index.js';
import {
  MAX_NODE_CONCURRENCY,
  claimJobsSchema,
  createNodeCredentialSchema,
  heartbeatNodeSchema,
  nodeDownloadUrlSchema,
  nodesResponseSchema,
  nodesSettingsPatchSchema,
  nodesSettingsSchema,
  systemNodesPatchSchema,
  systemNodesSchema,
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

// The `jobs` and `nodes` system-settings namespaces' schemas (#865), moved
// from the reference app: the stored shapes, their partials and the wire branches.
describe('jobs and nodes settings namespaces', () => {
  const jobs = { history: { retentionDays: 30, purgeEnabled: true }, stuckThresholdMinutes: 30 };
  const nodes = { staleHeartbeatSeconds: 90, offlineStaleMultiplier: 4, offlineRetentionDays: 30, jobSecretBrokerEnabled: false };

  it('accepts the shipped values in the stored, PUT and response shapes', () => {
    for (const schema of [systemJobsSchema, jobsSettingsSchema, jobsResponseSchema]) expect(schema.parse(jobs)).toEqual(jobs);
    for (const schema of [systemNodesSchema, nodesSettingsSchema, nodesResponseSchema]) expect(schema.parse(nodes)).toEqual(nodes);
  });

  it('keeps every bound: a week of stuck threshold, ten years of retention, 5 s to a day of heartbeat', () => {
    expect(systemJobsSchema.safeParse({ ...jobs, stuckThresholdMinutes: 10081 }).success).toBe(false);
    expect(jobsSettingsSchema.safeParse({ ...jobs, history: { retentionDays: 3651, purgeEnabled: true } }).success).toBe(false);
    expect(systemNodesSchema.safeParse({ ...nodes, staleHeartbeatSeconds: 4 }).success).toBe(false);
    expect(nodesSettingsSchema.safeParse({ ...nodes, offlineStaleMultiplier: 101 }).success).toBe(false);
  });

  it('parses a partial PATCH branch field by field, and applies no default', () => {
    expect(jobsSettingsPatchSchema.parse({ history: { purgeEnabled: false } })).toEqual({ history: { purgeEnabled: false } });
    expect(systemJobsPatchSchema.parse({})).toEqual({});
    expect(nodesSettingsPatchSchema.parse({ jobSecretBrokerEnabled: true })).toEqual({ jobSecretBrokerEnabled: true });
    expect(systemNodesPatchSchema.parse({})).toEqual({});
  });
});

describe('the retention namespace schemas (#898)', () => {
  const policy = { enabled: true, days: 30 };
  const retention = { notifications: policy, notificationDeliveries: policy, auditEvents: policy, aiRuns: policy };

  it('names one policy per governed table, in the stored key order', () => {
    expect(RETENTION_POLICY_KEYS).toEqual(['notifications', 'notificationDeliveries', 'auditEvents', 'aiRuns']);
    expect(Object.keys(systemRetentionSchema.shape)).toEqual([...RETENTION_POLICY_KEYS]);
  });

  it('keeps the 1 to 3650 day bound on the stored and the PUT shapes, and none on the response', () => {
    for (const schema of [systemRetentionSchema, retentionSettingsSchema]) {
      expect(schema.safeParse(retention).success).toBe(true);
      expect(schema.safeParse({ ...retention, aiRuns: { enabled: true, days: RETENTION_MAX_DAYS + 1 } }).success).toBe(false);
      expect(schema.safeParse({ ...retention, aiRuns: { enabled: true, days: 0 } }).success).toBe(false);
    }
    expect(retentionResponseSchema.safeParse({ ...retention, aiRuns: { enabled: true, days: 99999 } }).success).toBe(true);
  });

  it('parses a leaf PATCH and applies no default', () => {
    expect(retentionSettingsPatchSchema.parse({ auditEvents: { enabled: true } })).toEqual({ auditEvents: { enabled: true } });
    expect(systemRetentionPatchSchema.parse({})).toEqual({});
  });
});

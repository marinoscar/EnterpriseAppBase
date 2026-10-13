// The jobs and nodes slices' wire shapes (issue #734): the schemas the API
// wraps with createZodDto parse what the routes accept and return.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  BUILTIN_JOB_REASONS,
  BUILTIN_RETENTION_POLICY_KEYS,
  JOB_REASONS,
  JOB_STATUSES,
  MAX_INSIGHTS_WINDOW_DAYS,
  RETENTION_MAX_DAYS,
  RETENTION_POLICY_KEYS,
  buildRetentionSchemas,
  jobReasonSchema,
  retentionPolicyKeySchema,
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
  BUILTIN_NODE_SPAN_NAMES,
  MAX_NODE_CONCURRENCY,
  NODE_APP_SPAN_NAME_PATTERN,
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
    expect(BUILTIN_JOB_REASONS).toBe(JOB_REASONS);
  });

  it('opens the reason vocabulary to a pattern: built-ins and app ids pass, the wrong shape does not', () => {
    for (const ok of ['upload', 'rerun', 'backfill', 'import', 'csv-import', 'tenant.sync_2']) {
      expect(jobReasonSchema.safeParse(ok).success).toBe(true);
    }
    for (const bad of ['', 'x', 'Upload', '1import', 'has space', 'a'.repeat(49), "x'; drop table jobs;--"]) {
      expect(jobReasonSchema.safeParse(bad).success).toBe(false);
    }
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
      reasonLabel: 'Upload',
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

  it('accepts bounded extra vitals and refuses a bad key, a non-number, a huge number or a 17th key', () => {
    const vitals = (extra: unknown) => heartbeatNodeSchema.safeParse({ vitals: { cpuPercent: 10, extra } });
    const sixteen = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`transcode.k${i}`, i]));

    expect(vitals({ 'transcode.fps': 29.97, temperature_c: -4 }).success).toBe(true);
    expect(vitals(sixteen).success).toBe(true);
    expect(vitals({ ...sixteen, 'transcode.k16': 1 }).success).toBe(false);
    expect(vitals({ 'Bad Key': 1 }).success).toBe(false);
    expect(vitals({ 'x': 1 }).success).toBe(false);
    expect(vitals({ 'transcode.fps': '29' }).success).toBe(false);
    expect(vitals({ 'transcode.fps': 1e16 }).success).toBe(false);
    expect(vitals({ 'transcode.fps': { nested: 1 } }).success).toBe(false);
  });

  it('shapes the span names: five built-ins, and job.app.<name> for an executor', () => {
    expect(BUILTIN_NODE_SPAN_NAMES).toEqual(['job.download', 'job.execute', 'job.upload', 'job.submit', 'job.secret']);
    for (const ok of ['job.app.transcode', 'job.app.a1', 'job.app.t.frames-out_2']) expect(NODE_APP_SPAN_NAME_PATTERN.test(ok)).toBe(true);
    for (const bad of ['job.transcode', 'job.app.', 'job.app.X', 'job.app.1x', 'job.app.a', 'job.app.' + 'a'.repeat(49), 'job.app.a b', 'node.id']) {
      expect(NODE_APP_SPAN_NAME_PATTERN.test(bad)).toBe(false);
    }
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

describe('buildRetentionSchemas (the composed namespace, PP-14.19)', () => {
  const json = (schema: z.ZodType, io: 'input' | 'output' = 'input') => z.toJSONSchema(schema, { io });
  const builtins = BUILTIN_RETENTION_POLICY_KEYS.map((key) => ({ key }));

  it('composes the four built-ins into schemas whose JSON Schema equals the shipped ones (the OpenAPI document does not move)', () => {
    const built = buildRetentionSchemas(builtins);

    expect(json(built.stored)).toEqual(json(systemRetentionSchema));
    expect(json(built.put)).toEqual(json(retentionSettingsSchema));
    expect(json(built.patch)).toEqual(json(systemRetentionPatchSchema));
    expect(json(built.wirePatch)).toEqual(json(retentionSettingsPatchSchema));
    expect(json(built.response)).toEqual(json(retentionResponseSchema));
  });

  it('adds an app policy after the built-ins with its own bounds, and strips a key nobody registered', () => {
    const built = buildRetentionSchemas([...builtins, { key: 'importRows', minDays: 7, maxDays: 90 }]);
    const policy = { enabled: true, days: 30 };
    const value = { notifications: policy, notificationDeliveries: policy, auditEvents: policy, aiRuns: policy, importRows: policy };

    expect(Object.keys(built.stored.shape)).toEqual([...BUILTIN_RETENTION_POLICY_KEYS, 'importRows']);
    expect(built.stored.safeParse(value).success).toBe(true);
    expect(built.stored.safeParse({ ...value, importRows: { enabled: true, days: 6 } }).success).toBe(false);
    expect(built.stored.safeParse({ ...value, importRows: { enabled: true, days: 91 } }).success).toBe(false);
    expect(built.wirePatch.parse({ importRows: { days: 14 }, unknown: { days: 1 } })).toEqual({ importRows: { days: 14 } });
    expect(built.response.safeParse({ ...value, importRows: { enabled: false, days: 9999 } }).success).toBe(true);
  });

  it('refuses a bad key, a repeated key and bounds outside 1..3650', () => {
    expect(() => buildRetentionSchemas([{ key: 'Bad' }])).toThrow(/not a valid retention policy key/);
    expect(() => buildRetentionSchemas([{ key: 'ok' }, { key: 'ok' }])).toThrow(/appears twice/);
    expect(() => buildRetentionSchemas([{ key: 'ok', minDays: 0 }])).toThrow(/whole-day bounds/);
    expect(() => buildRetentionSchemas([{ key: 'ok', maxDays: RETENTION_MAX_DAYS + 1 }])).toThrow(/whole-day bounds/);
    expect(() => buildRetentionSchemas([{ key: 'ok', minDays: 10, maxDays: 5 }])).toThrow(/whole-day bounds/);
    expect(retentionPolicyKeySchema.safeParse('importRows').success).toBe(true);
    expect(retentionPolicyKeySchema.safeParse('import-rows').success).toBe(false);
  });
});

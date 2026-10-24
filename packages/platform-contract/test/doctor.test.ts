// The Doctor contract (issue #701): the schemas accept the report the API sends
// today, reject a row that drops a nullable-not-optional field, and parse the
// query the way the route always has.
import { describe, expect, it } from 'vitest';

import {
  DOCTOR_STATUSES,
  DOCTOR_STATUS_RANK,
  doctorCheckReportSchema,
  doctorQuerySchema,
  doctorReportSchema,
  doctorStatusSchema,
  type DoctorCheckReport,
  type DoctorReport,
} from '../src/doctor/index.js';

function check(overrides: Partial<DoctorCheckReport> & Pick<DoctorCheckReport, 'id' | 'category'>): DoctorCheckReport {
  return {
    label: overrides.id,
    settingsPath: null,
    status: 'pass',
    detail: `${overrides.id} is fine`,
    remedy: null,
    error: null,
    data: null,
    durationMs: 5,
    ...overrides,
  };
}

// The `MIXED` report of apps/web/src/__tests__/pages/Admin/DoctorPage.test.tsx.
const MIXED: DoctorReport = {
  verdict: 'fail',
  generatedAt: new Date('2026-10-06T12:00:00.000Z').toISOString(),
  durationMs: 1840,
  checks: [
    check({ id: 'telemetry.capture', category: 'telemetry', label: 'Telemetry capture', status: 'skip', detail: 'Telemetry is switched off' }),
    check({ id: 'core.database', category: 'core', label: 'Database', detail: 'PostgreSQL answered' }),
    check({
      id: 'storage.bucket',
      category: 'storage',
      label: 'Bucket reachable',
      status: 'fail',
      detail: 'HeadBucket was refused',
      remedy: 'Widen the credential policy to allow s3:ListBucket.',
      error: 'AccessDenied: Access Denied (bucket: uploads)',
      settingsPath: '/admin/settings/storage',
    }),
    check({
      id: 'email.smtp',
      category: 'email',
      label: 'SMTP login',
      status: 'warn',
      detail: 'No SMTP server is configured',
      remedy: 'Configure SMTP to send email.',
      settingsPath: '/admin/settings/email',
    }),
    check({ id: 'fork.widgets', category: 'fork_widgets', label: 'Widget service', detail: 'Widgets answered', data: { latencyMs: 12, region: 'eu', cached: false, note: null } }),
  ],
};

describe('@marinoscar/platform-contract/doctor', () => {
  it('accepts the report the API sends today, unchanged', () => {
    expect(doctorReportSchema.parse(MIXED)).toEqual(MIXED);
  });

  it.each(['settingsPath', 'remedy', 'error', 'data'] as const)(
    'rejects a row without the nullable-not-optional field %s',
    (field) => {
      const row: Record<string, unknown> = { ...check({ id: 'core.database', category: 'core' }) };
      delete row[field];
      expect(doctorCheckReportSchema.safeParse(row).success).toBe(false);
      expect(doctorReportSchema.safeParse({ ...MIXED, checks: [row] }).success).toBe(false);
    },
  );

  it('rejects a generatedAt that is not an ISO 8601 date-time', () => {
    expect(doctorReportSchema.safeParse({ ...MIXED, generatedAt: 'yesterday' }).success).toBe(false);
  });

  it('rejects a status outside the four, and a fractional duration', () => {
    expect(doctorStatusSchema.safeParse('ok').success).toBe(false);
    expect(doctorCheckReportSchema.safeParse({ ...check({ id: 'a', category: 'core' }), durationMs: 1.5 }).success).toBe(false);
  });

  it("maps the query's refresh 'true' to true and 'false' to false, never by truthiness", () => {
    expect(doctorQuerySchema.parse({ refresh: 'true' })).toEqual({ refresh: true });
    expect(doctorQuerySchema.parse({ refresh: 'false' })).toEqual({ refresh: false });
    expect(doctorQuerySchema.parse({})).toEqual({});
    expect(doctorQuerySchema.safeParse({ refresh: 'yes' }).success).toBe(false);
  });

  it('accepts a lowercase category identifier and rejects anything else', () => {
    expect(doctorQuerySchema.parse({ category: 'fork_widgets' })).toEqual({ category: 'fork_widgets' });
    expect(doctorQuerySchema.safeParse({ category: 'Storage' }).success).toBe(false);
    expect(doctorQuerySchema.safeParse({ category: '-x' }).success).toBe(false);
  });

  it('keeps the severity order and the rank in step, and the wire enum holds the same statuses', () => {
    expect(DOCTOR_STATUSES).toEqual(['pass', 'skip', 'warn', 'fail']);
    expect(DOCTOR_STATUSES.map((status) => DOCTOR_STATUS_RANK[status])).toEqual([0, 1, 2, 3]);
    // The OpenAPI document has always published the enum in this order.
    expect(doctorStatusSchema.options).toEqual(['pass', 'warn', 'fail', 'skip']);
    expect([...doctorStatusSchema.options].sort()).toEqual([...DOCTOR_STATUSES].sort());
  });

  it('lets an app extend a row with .extend() without touching the contract', () => {
    const appRow = doctorCheckReportSchema.extend({ owner: doctorCheckReportSchema.shape.label });
    const row = { ...check({ id: 'fork.widgets', category: 'fork_widgets' }), owner: 'widgets-team' };
    expect(appRow.parse(row)).toEqual(row);
    expect(doctorCheckReportSchema.parse(row)).not.toHaveProperty('owner');
  });
});

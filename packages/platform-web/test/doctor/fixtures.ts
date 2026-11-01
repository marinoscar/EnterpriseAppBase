import type { DoctorCheckReport, DoctorReport } from '../../src/doctor/headless/index.js';

export function check(overrides: Partial<DoctorCheckReport> & Pick<DoctorCheckReport, 'id' | 'category'>): DoctorCheckReport {
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

export const MIXED: DoctorReport = {
  verdict: 'fail',
  generatedAt: new Date().toISOString(),
  durationMs: 1840,
  checks: [
    // Deliberately out of display order: the page sorts categories.
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
    check({ id: 'fork.widgets', category: 'fork_widgets', label: 'Widget service', detail: 'Widgets answered' }),
  ],
};

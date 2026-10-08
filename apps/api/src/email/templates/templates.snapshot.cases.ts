// =============================================================================
// Byte-for-byte fixtures of every platform email template (issue #737, PP-8.4)
// =============================================================================
//
// The inputs `templates.snapshot.spec.ts` renders. The expected output of each
// case is a JSON file in `./__fixtures__/` (subject, html, text, headers),
// captured from the templates BEFORE they moved into
// `@marinoscar/platform-api/email`, so the move (and the layout theme that
// came with it) is proven not to have changed one byte of what is sent.
//
// Deterministic by construction: every date is a fixed instant and no case
// reads the clock. One case per template carries hostile, markup-shaped input,
// so the fixtures also pin the escaping.
// =============================================================================

/** One rendering case: a template name, a case label and the data. */
export interface EmailSnapshotCase {
  readonly template: string;
  readonly label: string;
  readonly data: unknown;
}

const T0 = new Date('2026-03-04T05:06:07.000Z');
const T1 = new Date('2026-03-04T06:07:08.000Z');
const HOSTILE = `<script>alert("x")</script> & 'quotes'`;

export const EMAIL_SNAPSHOT_CASES: readonly EmailSnapshotCase[] = [
  {
    template: 'test-email',
    label: 'full',
    data: {
      recipientEmail: 'admin@example.test',
      providerKind: 'smtp',
      sentAt: T0,
      triggeredBy: 'Ada Admin',
      settingsUrl: 'https://app.example.test/admin/settings/email',
    },
  },
  {
    template: 'test-email',
    label: 'minimal',
    data: { recipientEmail: 'admin@example.test', providerKind: 'ses', sentAt: T0 },
  },
  {
    template: 'user-welcome',
    label: 'full',
    data: {
      recipientEmail: 'new@example.test',
      recipientName: 'Grace',
      roles: ['Admin', 'Viewer'],
      appUrl: 'https://app.example.test',
    },
  },
  {
    template: 'user-welcome',
    label: 'hostile',
    data: { recipientEmail: 'new@example.test', recipientName: HOSTILE, roles: [] },
  },
  {
    template: 'allowlist-invitation',
    label: 'full',
    data: {
      recipientEmail: 'guest@example.test',
      invitedBy: 'Ada Admin',
      signInUrl: 'https://app.example.test/login',
    },
  },
  {
    template: 'allowlist-invitation',
    label: 'minimal',
    data: { recipientEmail: 'guest@example.test' },
  },
  {
    template: 'role-changed',
    label: 'full',
    data: {
      recipientEmail: 'user@example.test',
      previousRoles: ['Viewer'],
      currentRoles: ['Admin', 'Contributor'],
      changedAt: T0,
      appUrl: 'https://app.example.test',
    },
  },
  {
    template: 'role-changed',
    label: 'removed-all',
    data: { recipientEmail: 'user@example.test', previousRoles: ['Admin'], currentRoles: [], changedAt: T0 },
  },
  {
    template: 'broadcast',
    label: 'full',
    data: {
      title: 'Planned maintenance',
      body: 'We will be down for an hour.\n\nThanks for your patience.',
      ctaLabel: 'Read more',
      ctaUrl: 'https://app.example.test/news/1',
      link: '/news/1',
      critical: true,
    },
  },
  {
    template: 'broadcast',
    label: 'hostile',
    data: { title: HOSTILE, body: `${HOSTILE}\nline two`, ctaUrl: 'javascript:alert(1)' },
  },
  {
    template: 'job-failed',
    label: 'full',
    data: {
      jobId: 'job-123',
      jobType: 'export.csv',
      error: `Boom: ${HOSTILE}`,
      attempts: 3,
      executor: 'node-7',
      failedAt: T0,
      appUrl: 'https://app.example.test',
    },
  },
  {
    template: 'job-failed',
    label: 'minimal',
    data: { jobId: 'job-124', jobType: 'export.csv', error: null, attempts: 1, executor: null, failedAt: T0 },
  },
  {
    template: 'node-offline',
    label: 'full',
    data: {
      nodeId: 'node-1',
      nodeName: 'builder-a',
      lastHeartbeatAt: T0,
      markedOfflineAt: T1,
      staleAfterMinutes: 5,
      appUrl: 'https://app.example.test',
    },
  },
  {
    template: 'node-offline',
    label: 'never-seen',
    data: { nodeId: 'node-2', nodeName: HOSTILE, lastHeartbeatAt: null, markedOfflineAt: T1, staleAfterMinutes: 1 },
  },
  {
    template: 'backup-failed',
    label: 'failed',
    data: {
      runId: 'run-1',
      outcome: 'failed',
      error: 'pg_dump exited with 1',
      startedAt: T0,
      failedAt: T1,
      trigger: 'schedule',
      appUrl: 'https://app.example.test',
    },
  },
  {
    template: 'backup-failed',
    label: 'stale',
    data: { runId: 'run-2', outcome: 'stale', error: null, startedAt: null, failedAt: T1, trigger: null },
  },
  {
    template: 'restore-completed',
    label: 'full',
    data: {
      runId: 'run-3',
      backupTakenAt: T0,
      completedAt: T1,
      triggeredBy: 'Ada Admin',
      preRestoreBackupId: 'run-2',
      appUrl: 'https://app.example.test',
    },
  },
  {
    template: 'restore-completed',
    label: 'minimal',
    data: { runId: 'run-4', backupTakenAt: null, completedAt: T1, triggeredBy: null, preRestoreBackupId: null },
  },
  // The three templates other slices own the words of (identity, sharing).
  // Not platform defaults of the email slice, but rendered through the same
  // layout, so they are pinned too.
  {
    template: 'org-invitation',
    label: 'full',
    data: {
      recipientEmail: 'guest@example.test',
      orgName: `Acme ${HOSTILE}`,
      roleName: 'Member',
      invitedBy: 'Ada Admin',
      signInUrl: 'https://app.example.test/login',
    },
  },
  {
    template: 'group-invitation',
    label: 'full',
    data: {
      recipientEmail: 'guest@example.test',
      groupName: 'Writers',
      role: 'editor',
      invitedBy: 'Ada Admin',
      expiresAt: '2026-04-01T00:00:00.000Z',
      signInUrl: 'https://app.example.test/login',
    },
  },
  {
    template: 'shared-with-you',
    label: 'full',
    data: {
      resourceType: 'document',
      resourceId: 'doc-1',
      role: 'viewer',
      title: 'Quarterly plan',
      sharedBy: 'Ada Admin',
      openUrl: 'https://app.example.test/docs/doc-1',
    },
  },
  {
    template: 'shared-with-you',
    label: 'role-changed',
    data: { resourceType: 'document', resourceId: 'doc-1', role: 'editor', previousRole: 'viewer' },
  },
];

/** The fixture file name of a case. */
export function snapshotFixtureName(c: EmailSnapshotCase): string {
  return `${c.template}.${c.label}.json`;
}

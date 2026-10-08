import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createEmailRenderContext, findEmailTemplate } from '@marinoscar/platform-api/email';

// Importing the registry barrel runs the notification manifest, which
// registers these three templates.
import '../../../../test/notifications/support/notifications';

// =============================================================================
// The slice-owned templates, byte for byte (issue #737)
// =============================================================================
//
// `org-invitation`, `group-invitation` and `shared-with-you` render through
// the email slice's layout. Their fixtures were captured before the email
// module moved into `@marinoscar/platform-api/email`; this proves the move
// changed nothing they send. Rendered with an explicit context whose product
// name is a neutral one (the fixtures store it in place of the reference
// app's; it is only ever interpolated), so a renamed fork keeps passing and
// the identity scan and rename codemod leave the fixtures alone.
// =============================================================================

const HOSTILE = `<script>alert("x")</script> & 'quotes'`;

const CASES: ReadonlyArray<{ template: string; label: string; data: unknown }> = [
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

const CONTEXT = createEmailRenderContext({ appName: 'Fixture App' });

describe('slice-owned email templates: byte-identical output', () => {
  it.each(CASES.map((c) => [`${c.template}.${c.label}`, c] as const))('%s', (name, c) => {
    const rendered = findEmailTemplate(c.template)!(c.data, CONTEXT);
    const expected = JSON.parse(readFileSync(join(__dirname, '__fixtures__', `${name}.json`), 'utf8')) as Record<string, unknown>;
    expect(rendered.subject).toBe(expected.subject);
    expect(rendered.html).toBe(expected.html);
    expect(rendered.text).toBe(expected.text);
    expect(rendered.headers ?? null).toEqual(expected.headers);
  });
});

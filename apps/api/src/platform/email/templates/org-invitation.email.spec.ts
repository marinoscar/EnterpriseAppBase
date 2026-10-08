import { configureEmailRendering } from '@marinoscar/platform-api/email';

import { EMAIL_MODULE_OPTIONS } from '../email.options';
import { orgInvitationEmail } from './org-invitation.email';

// Rendered with the app's own options, as the notification manifest does.
beforeAll(() => configureEmailRendering(EMAIL_MODULE_OPTIONS));

describe('orgInvitationEmail (#726)', () => {
  const base = {
    recipientEmail: 'new.member@example.com',
    orgName: 'Acme Corp',
    roleName: 'org_admin',
  };

  it('names the organization and the role in both parts', () => {
    const rendered = orgInvitationEmail(base);

    expect(rendered.html).toContain('Acme Corp');
    expect(rendered.text).toContain('Acme Corp');
    expect(rendered.text).toContain('as an administrator');
    expect(rendered.text).toContain('new.member@example.com');
  });

  it('keeps the administrator-typed organization name out of the subject', () => {
    expect(orgInvitationEmail(base).subject).not.toContain('Acme Corp');
  });

  it('renders the sign-in button only when a URL is known', () => {
    expect(orgInvitationEmail(base).text).not.toContain('https://');
    const withUrl = orgInvitationEmail({ ...base, signInUrl: 'https://app.example.com/login' });
    expect(withUrl.html).toContain('https://app.example.com/login');
    expect(withUrl.text).toContain('https://app.example.com/login');
  });

  it('attributes the invitation when the inviter is known', () => {
    expect(orgInvitationEmail({ ...base, invitedBy: 'Oscar' }).text).toContain('Oscar sent this invitation');
    expect(orgInvitationEmail(base).text).not.toContain('sent this invitation');
  });

  it('describes each org role in words, and an unknown role by its name', () => {
    expect(orgInvitationEmail({ ...base, roleName: 'contributor' }).text).toContain('as a contributor');
    expect(orgInvitationEmail({ ...base, roleName: 'viewer' }).text).toContain('as a viewer');
    expect(orgInvitationEmail({ ...base, roleName: 'coach' }).text).toContain('as coach');
  });
});

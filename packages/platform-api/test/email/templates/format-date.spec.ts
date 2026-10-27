import { currentEmailRenderContext, formatEmailDate, formatEmailDateTime, roleChangedEmail } from '../../../src/email/templates';
import { renderGroupInvitationEmail } from '../../../src/sharing/index';
import { configureTestEmail } from '../support';

configureTestEmail();

// 2026-10-27T02:42:00Z is the evening of Oct 26 in Chicago (CDT) and Costa Rica.
const WHEN = new Date('2026-10-27T02:42:00.000Z');

describe('formatEmailDateTime', () => {
  it('renders in the recipient zone, with the zone label and the UTC time alongside', () => {
    expect(formatEmailDateTime(WHEN, { timeZone: 'America/Chicago' })).toBe('Oct 26, 2026, 9:42 PM CDT (02:42 UTC)');
  });

  it('renders UTC without a duplicate suffix, for a missing, null or invalid zone', () => {
    expect(formatEmailDateTime(WHEN)).toBe('Oct 27, 2026, 2:42 AM UTC');
    expect(formatEmailDateTime(WHEN, { timeZone: null })).toBe('Oct 27, 2026, 2:42 AM UTC');
    expect(formatEmailDateTime(WHEN, { timeZone: 'Mars/Olympus' })).toBe('Oct 27, 2026, 2:42 AM UTC');
    expect(formatEmailDateTime(WHEN, { timeZone: 'UTC' })).toBe('Oct 27, 2026, 2:42 AM UTC');
  });

  it('accepts an ISO string and says so when the value is unparseable', () => {
    expect(formatEmailDateTime('2026-10-27T02:42:00Z', { timeZone: 'America/Chicago' })).toContain('CDT');
    expect(formatEmailDateTime('nope')).toBe('Unknown time');
  });
});

describe('formatEmailDate', () => {
  it('uses the zone calendar day and labels the zone', () => {
    expect(formatEmailDate(WHEN, { timeZone: 'America/Chicago' })).toBe('Oct 26, 2026 (CDT)');
    expect(formatEmailDate(WHEN)).toBe('Oct 27, 2026 (UTC)');
  });
});

describe('a template renders in the recipient zone', () => {
  const data = { recipientEmail: 'a@example.com', previousRoles: ['viewer'], currentRoles: ['admin'], changedAt: WHEN };

  it('role-changed prints the zoned time and keeps the UTC time for log matching', () => {
    const base = roleChangedEmail(data);
    const zoned = roleChangedEmail(data, { ...currentEmailRenderContext(), timeZone: 'America/Chicago' });
    expect(base.text).toContain('Oct 27, 2026, 2:42 AM UTC');
    expect(zoned.text).toContain('Oct 26, 2026, 9:42 PM CDT (02:42 UTC)');
    expect(zoned.html).toContain('Oct 26, 2026, 9:42 PM CDT (02:42 UTC)');
  });
});

describe('sharing kit date fallback', () => {
  const kit = (extra: object = {}) => ({
    appName: 'App',
    html: (strings: TemplateStringsArray, ...values: unknown[]) => String.raw({ raw: strings }, ...values),
    empty: '',
    renderLayout: (o: { bodyHtml: unknown }) => String(o.bodyHtml),
    plainText: (o: { lines: string[] }) => o.lines.join('\n'),
    headers: {},
    ...extra,
  });
  const data = { recipientEmail: 'a@example.com', groupName: 'G', role: 'viewer' as const, expiresAt: '2026-10-27T02:42:00.000Z' };

  it('labels the UTC date when the app passes no formatter', () => {
    expect(renderGroupInvitationEmail(data, kit() as never).text).toContain('expires on 2026-10-27 (UTC)');
  });

  it('uses the kit formatter when the app passes one', () => {
    const out = renderGroupInvitationEmail(data, kit({ formatDate: (v: string) => formatEmailDate(v, { timeZone: 'America/Chicago' }) }) as never);
    expect(out.text).toContain('expires on Oct 26, 2026 (CDT)');
  });
});

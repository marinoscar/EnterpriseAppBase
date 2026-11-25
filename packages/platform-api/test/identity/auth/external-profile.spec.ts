import { externalProfileProblem, normalizeExternalProfile, type ExternalProfile } from '../../../src/identity/auth/external-profile';

const base: ExternalProfile = { provider: 'x', subject: 's', email: 'a@b.co', emailVerified: true };

describe('normalizeExternalProfile', () => {
  it('keeps an https picture and a display name within bounds', () => {
    const p = { ...base, pictureUrl: 'https://cdn.example.com/p.png', displayName: 'A'.repeat(255) };
    expect(normalizeExternalProfile(p)).toEqual(p);
  });

  it.each(['http://x.test/p.png', 'javascript:alert(1)', 'data:image/png;base64,AA', '//x.test/p.png', 'p.png', `https://x.test/${'a'.repeat(2048)}`])(
    'drops the picture %#',
    (pictureUrl) => {
      expect(normalizeExternalProfile({ ...base, pictureUrl })).toEqual(base);
    },
  );

  it('drops a display name over 255 characters', () => {
    expect(normalizeExternalProfile({ ...base, displayName: 'A'.repeat(256) })).toEqual(base);
  });

  it('does not touch the identifying fields or raw', () => {
    const p = { ...base, raw: { groups: ['a'] }, pictureUrl: 'http://bad' };
    expect(normalizeExternalProfile(p)).toEqual({ ...base, raw: { groups: ['a'] } });
  });

  it('still reports a wrong type as a problem (a mapper bug, not a bad value)', () => {
    expect(externalProfileProblem({ ...base, pictureUrl: 5 })).toMatch(/pictureUrl/);
  });
});

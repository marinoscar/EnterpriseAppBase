// The Bearer challenge builder (PP-15.6): quoting, no line breaks, scope handling.
import { withTemporaryEntries } from '../../../src/core/index';
import { buildBearerChallenge, protectedResourceMetadataUrl, quoteChallengeValue } from '../../../src/identity/oauth-server/oauth-challenge';
import { oauthResourceRegistry } from '../../../src/identity/index';
import { APP_URL, NOTES_RESOURCE } from './support';

const withNotes = <T>(fn: () => T): T => withTemporaryEntries(oauthResourceRegistry, [NOTES_RESOURCE], fn) as T;

/** Parses `Bearer k="v", k2="v2"` (the quoted-string form this builder writes). */
function parse(header: string): Record<string, string> {
  expect(header.startsWith('Bearer ')).toBe(true);
  const out: Record<string, string> = {};
  for (const match of header.slice('Bearer '.length).matchAll(/([a-z_]+)="((?:[^"\\]|\\.)*)"/g)) {
    out[match[1]!] = match[2]!.replace(/\\(.)/g, '$1');
  }
  return out;
}

describe('quoteChallengeValue', () => {
  it('escapes a quote and a backslash', () => {
    expect(quoteChallengeValue('say "hi" \\ there')).toBe('say \\"hi\\" \\\\ there');
  });

  it('turns every control character, CR and LF included, into a space', () => {
    const quoted = quoteChallengeValue('line1\r\nline2\nline3\rx\u0000y\u007fz');
    expect(quoted).not.toMatch(/[\r\n\u0000-\u001f\u007f]/);
    expect(quoted).toBe('line1 line2 line3 x y z');
  });

  it('replaces non-ASCII, which cannot sit in a header, with a question mark', () => {
    expect(quoteChallengeValue('café ☃')).toBe('caf? ?');
  });
});

describe('buildBearerChallenge', () => {
  it('names the metadata document of the resource at the application root', () => {
    withNotes(() => {
      const header = buildBearerChallenge({ resourceId: 'notes', appUrl: APP_URL });
      expect(header).toBe(`Bearer resource_metadata="${APP_URL}/.well-known/oauth-protected-resource/api/notes-agent"`);
      expect(protectedResourceMetadataUrl(`${APP_URL}/`, '/api/notes-agent')).toBe(`${APP_URL}/.well-known/oauth-protected-resource/api/notes-agent`);
    });
  });

  it('carries the error, description and the space-separated scopes, in that order', () => {
    withNotes(() => {
      const header = buildBearerChallenge({
        resourceId: 'notes',
        appUrl: APP_URL,
        error: 'insufficient_scope',
        errorDescription: 'Needs more',
        scope: ['notes:read', 'notes:write', 'notes:read'],
      });
      expect(header).toBe(
        `Bearer resource_metadata="${APP_URL}/.well-known/oauth-protected-resource/api/notes-agent", error="insufficient_scope", error_description="Needs more", scope="notes:read notes:write"`,
      );
      expect(parse(header)).toMatchObject({ error: 'insufficient_scope', scope: 'notes:read notes:write' });
    });
  });

  it('never contains a line break and quotes a description that holds a quote, round-tripping through a parser', () => {
    withNotes(() => {
      const description = 'The "token"\r\nis bad\\\nSet-Cookie: x=y';
      const header = buildBearerChallenge({ resourceId: 'notes', appUrl: APP_URL, error: 'invalid_token', errorDescription: description });
      expect(header).not.toMatch(/[\r\n]/);
      const parsed = parse(header);
      expect(parsed['error_description']).toBe('The "token" is bad\\ Set-Cookie: x=y');
      // the quote inside the description did not end the value early
      expect(Object.keys(parsed)).toEqual(['resource_metadata', 'error', 'error_description']);
    });
  });

  it('drops scope characters that would break the quoted value', () => {
    withNotes(() => {
      const header = buildBearerChallenge({ resourceId: 'notes', appUrl: APP_URL, scope: ['a"b', 'c d', 'e\\f', '\r\n', 'ok:scope'] });
      expect(parse(header)['scope']).toBe('ab cd ef ok:scope');
      expect(header).not.toMatch(/[\r\n]/);
    });
  });

  it('refuses an unregistered resource and a missing application root', () => {
    expect(() => buildBearerChallenge({ resourceId: 'nope', appUrl: APP_URL })).toThrow(/unknown protected resource/);
    withNotes(() => expect(() => buildBearerChallenge({ resourceId: 'notes', appUrl: '' })).toThrow(/APP_URL|application URL/));
  });
});

import {
  COMMIT_SHA_ALLOWED_PATHS,
  REDACTED,
  SENSITIVE_KEY_PATTERN,
  redactString,
  redactValue,
} from '../../../src/doctor/support-bundle/redact';

// Table-driven: every rule of v1 with positive and negative cases. A positive
// case lists the exact output and how many replacements it counts; a negative
// case must come back unchanged with zero.

const SHA = '0123456789abcdef0123456789abcdef01234567';
const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
const PEM = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----';

const POSITIVE: Array<[rule: string, input: string, output: string, count: number]> = [
  ['pem block', `key: ${PEM} end`, 'key: [pem] end', 1],
  ['pem without an end line', '-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAKj34', '[pem]', 1],
  ['bearer token', 'Authorization: Bearer abc123.def-456', 'Authorization: Bearer [redacted]', 1],
  ['bearer jwt (one replacement, not two)', `Bearer ${JWT}`, 'Bearer [redacted]', 1],
  ['bare jwt', `token was ${JWT} here`, 'token was [jwt] here', 1],
  ['url userinfo', 'postgres://admin:hunter2@db.internal:5432/app', 'postgres://[redacted]@db.internal:5432/app', 1],
  ['url query', 'GET https://hooks.example.test/x?sig=abc&exp=1 failed', 'GET https://hooks.example.test/x?[redacted] failed', 1],
  ['path query', 'GET /api/files?token=abc failed', 'GET /api/files?[redacted] failed', 1],
  ['personal access token', 'used pat_0a1b2c3d4e5f6a7b', 'used [token]', 1],
  ['node token', 'node nod_9f8e7d6c5b4a39281', 'node [token]', 1],
  ['aws access key id', 'key AKIAIOSFODNN7EXAMPLE and ASIAY34FZKBOKMUTVV7A', 'key [aws-key] and [aws-key]', 2],
  ['email', 'contact Jane.Doe+ops@example.co.uk now', 'contact [email] now', 1],
  ['ipv4', 'from 10.0.12.7:5432 and 192.168.1.1.', 'from [ip]:5432 and [ip].', 2],
  ['ipv6', 'peer 2001:db8::8a2e:370:7334 and ::1.', 'peer [ip] and [ip].', 2],
  ['ipv4-mapped ipv6', 'peer ::ffff:10.1.2.3', 'peer [ip]', 1],
  ['hex run of 32+', 'sha256 deadbeefdeadbeefdeadbeefdeadbeef', `sha256 ${REDACTED}`, 1],
  ['commit sha outside the allowlist', `commit ${SHA}`, `commit ${REDACTED}`, 1],
  ['uuid (a user id)', 'user 3f2b8c1e-9d4a-4e6b-a1c2-7d8e9f0a1b2c', `user ${REDACTED}`, 1],
  ['base64 run of 32+', 'secret dGhpcyBpcyBhIHNlY3JldCB2YWx1ZSAxMjM0NTY=', `secret ${REDACTED}`, 1],
  ['letters-only mixed-case base64', 'k QmFzZTY0RW5jb2RlZFNlY3JldEtleVZhbHVlcw', `k ${REDACTED}`, 1],
];

const NEGATIVE: Array<[rule: string, input: string]> = [
  ['pem: prose about keys', 'Upload the BEGIN and END lines of the key.'],
  ['bearer: prose', 'Requests carrying an Authorization: Bearer header are counted.'],
  ['jwt: a single eyJ segment', 'eyJhbGciOiJIUzI1NiJ9 alone'],
  ['url without userinfo or query', 'https://example.test/api/health answered'],
  ['email: an npm scope', '@marinoscar/platform-api 0.0.0'],
  ['token: prefixes inside words', 'compat_mode and synod_meeting'],
  ['aws: too short', 'AKIA1234'],
  ['ipv4: a four-part version inside a longer one', 'release 1.2.3.4.5'],
  ['ipv4: an out-of-range octet', '256.1.1.1'],
  ['ipv6: a time', 'at 12:34:56 UTC'],
  ['ipv6: an ISO timestamp', '2026-10-06T12:34:56.000Z'],
  ['ipv6: a C++ scope', 'std::string'],
  ['long run: a url path', '/api/admin/telemetry/stack/deploy/history/latest'],
  ['long run: snake_case identifier', 'telemetry_connection_doctor_check_identifier_long'],
  ['long run: camelCase identifier', 'TelemetryConnectionDoctorCheckIdentifierLong'],
  ['long run: short hex', 'deadbeef'],
  ['semver and node versions', 'v24.1.0 6.8.0-1012-azure 28.3.2'],
];

describe('redactString (rules v1)', () => {
  it.each(POSITIVE)('%s', (_rule, input, output, count) => {
    expect(redactString(input)).toEqual({ value: output, replacements: count });
  });

  it.each(NEGATIVE)('leaves alone: %s', (_rule, input) => {
    expect(redactString(input)).toEqual({ value: input, replacements: 0 });
  });
});

describe('SENSITIVE_KEY_PATTERN', () => {
  it.each([
    'password',
    'smtpPass',
    'clientSecret',
    'accessToken',
    'apiKey',
    'api_key',
    'private-key',
    'authorization',
    'cookie',
    'credentialId',
    'fingerprint',
    'keyHint',
    'sentryDsn',
    'connectionString',
    'connection_string',
  ])('matches %s', (key) => {
    expect(SENSITIVE_KEY_PATTERN.test(key)).toBe(true);
  });

  it.each(['status', 'detail', 'version', 'commitSha', 'checks', 'tiles', 'host', 'label'])('ignores %s', (key) => {
    expect(SENSITIVE_KEY_PATTERN.test(key)).toBe(false);
  });
});

describe('redactValue', () => {
  it('replaces the value of a sensitive key, whatever its type, and counts it', () => {
    const { value, replacements } = redactValue({
      password: 'hunter2',
      nested: { apiKey: { id: 1 }, tokens: [1, 2] },
      secret: null,
      ok: 'fine',
    });

    expect(value).toEqual({ password: REDACTED, nested: { apiKey: REDACTED, tokens: REDACTED }, secret: null, ok: 'fine' });
    expect(replacements).toBe(3);
  });

  it('rewrites strings inside arrays and nested objects', () => {
    const { value, replacements } = redactValue({ reasons: ['from 10.0.0.1', 'by ops@example.com'], n: 3, b: true });

    expect(value).toEqual({ reasons: ['from [ip]', 'by [email]'], n: 3, b: true });
    expect(replacements).toBe(2);
  });

  it('rewrites property names too, keeping colliding keys apart', () => {
    const { value, replacements } = redactValue({ 'a@example.com': 1, 'b@example.com': 2 });

    expect(value).toEqual({ '[email]': 1, '[email]#2': 2 });
    expect(replacements).toBe(2);
  });

  it('never mutates its input', () => {
    const input = { detail: 'ops@example.com', list: ['10.0.0.1'] };
    const copy = JSON.parse(JSON.stringify(input));

    redactValue(input);

    expect(input).toEqual(copy);
  });

  describe('the commit SHA allowlist', () => {
    const bundle = (sha: string) => ({
      app: { commitSha: sha, name: 'x' },
      history: { count: 1, last: { commitSha: sha } },
      other: { commitSha: sha },
    });

    it('lists exactly the versions paths', () => {
      expect(COMMIT_SHA_ALLOWED_PATHS).toEqual([
        'sections.versions.data.app.commitSha',
        'sections.versions.data.history.last.commitSha',
      ]);
    });

    it('keeps a 40-hex SHA only at the allowlisted paths', () => {
      const { value, replacements } = redactValue(bundle(SHA), { path: ['sections', 'versions', 'data'] });

      expect(value.app.commitSha).toBe(SHA);
      expect(value.history.last.commitSha).toBe(SHA);
      expect(value.other.commitSha).toBe(REDACTED);
      expect(replacements).toBe(1);
    });

    it('redacts the same SHA under any other section', () => {
      const { value } = redactValue(bundle(SHA), { path: ['sections', 'doctor', 'data'] });

      expect(value.app.commitSha).toBe(REDACTED);
      expect(value.history.last.commitSha).toBe(REDACTED);
    });

    it('redacts anything at an allowlisted path that is not exactly a 40-hex SHA', () => {
      const longer = `${SHA}${SHA}`;
      const { value } = redactValue(bundle(longer), { path: ['sections', 'versions', 'data'] });
      const mixed = redactValue(bundle(`${SHA} by ops@example.com`), { path: ['sections', 'versions', 'data'] }).value;

      expect(value.app.commitSha).toBe(REDACTED);
      expect(mixed.app.commitSha).toBe(`${REDACTED} by [email]`);
    });
  });
});

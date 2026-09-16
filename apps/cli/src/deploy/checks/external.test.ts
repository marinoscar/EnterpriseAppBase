import { describe, expect, it } from 'vitest';

import { CommandFailedError, type CommandResult, type RunCommandOptions } from '../executor.js';
import { DATABASE_CHECKS, databaseSettings } from './database.js';
import { DNS_CHECKS } from './dns.js';
import { GH_CHECKS, prepareGitCredentials } from './gh.js';
import { ALL_CHECKS } from './index.js';
import {
  RENEWAL_SCRIPT_PATHS,
  TLS_CHECKS,
  compareServedCertificate,
  extractPem,
  findRenewalOwner,
  parseNotAfter,
} from './tls.js';
import { runChecks, type Check, type CheckContext, type CheckFs } from './types.js';

type Canned = { exitCode: number; stdout?: string; stderr?: string };
type Responder = (argv: readonly string[], options: RunCommandOptions) => Canned | undefined;

function fakeRunCommand(respond: Responder): typeof import('../executor.js').runCommand {
  return (async (argv: readonly string[], options: RunCommandOptions): Promise<CommandResult> => {
    const canned = respond(argv, options) ?? { exitCode: 127, stderr: `${argv[0]}: command not found` };
    const result: CommandResult = {
      argv: [...argv],
      cwd: options.cwd,
      exitCode: canned.exitCode,
      stdout: canned.stdout ?? '',
      stderr: canned.stderr ?? '',
      durationMs: 1,
      timedOut: false,
    };
    if (result.exitCode !== 0) throw new CommandFailedError(result.stderr || 'failed', result);
    return result;
  }) as typeof import('../executor.js').runCommand;
}

const presentFs: CheckFs = { exists: () => true, isDirectory: () => true, isWritable: () => true };
const absentFs: CheckFs = { exists: () => false, isDirectory: () => false, isWritable: () => false };

const ENV = new Map([
  ['POSTGRES_HOST', 'db.internal'],
  ['POSTGRES_PORT', '5432'],
  ['POSTGRES_USER', 'appuser'],
  ['POSTGRES_PASSWORD', 'p@ss/word#1'],
  ['POSTGRES_DB', 'appdb'],
]);

function context(overrides: Partial<CheckContext> = {}): CheckContext {
  return {
    runCommand: fakeRunCommand(() => ({ exitCode: 0, stdout: '1' })),
    deployRoot: '/opt/infra/apps/demo',
    bindPort: 3535,
    proxyRoot: '/opt/infra/proxy',
    domain: 'app.example.test',
    env: ENV,
    fs: presentFs,
    ...overrides,
  };
}

function find(checks: readonly Check[], id: string): Check {
  const check = checks.find((candidate) => candidate.id === id);
  if (check === undefined) throw new Error(`no check ${id}`);
  return check;
}

describe('databaseSettings', () => {
  it('reads the POSTGRES_* values the deployment will use', () => {
    expect(databaseSettings(ENV)).toEqual({
      host: 'db.internal',
      port: '5432',
      user: 'appuser',
      password: 'p@ss/word#1',
      database: 'appdb',
      ssl: false,
    });
  });

  it('is undefined when no environment has been resolved yet', () => {
    expect(databaseSettings(undefined)).toBeUndefined();
  });
});

describe('database checks', () => {
  it('skips rather than fails when there is no environment yet', async () => {
    // Before an install there is no .env; reporting that as a broken database
    // would send someone looking at the wrong thing.
    const result = await find(DATABASE_CHECKS, 'database-reachable').run(
      context({ env: undefined }),
    );

    expect(result.status).toBe('skip');
  });

  it('never puts the password or a connection URL in its argv', async () => {
    const seen: string[][] = [];
    const envs: Array<NodeJS.ProcessEnv | undefined> = [];

    await find(DATABASE_CHECKS, 'database-credentials').run(
      context({
        runCommand: fakeRunCommand((argv, options) => {
          seen.push([...argv]);
          envs.push(options.env);
          return { exitCode: 0, stdout: '1' };
        }),
      }),
    );

    const flat = seen.flat().join(' ');
    // The password reaches psql through PGPASSWORD, so there is no URL to leak
    // into a journal line, a detail or a remedy.
    expect(flat).not.toContain('p@ss/word#1');
    expect(flat).not.toContain('postgresql://');
    expect(envs[0]?.PGPASSWORD).toBe('p@ss/word#1');
  });

  it('reports a rejected password distinctly from a missing database', async () => {
    const badPassword = await find(DATABASE_CHECKS, 'database-credentials').run(
      context({
        runCommand: fakeRunCommand(() => ({
          exitCode: 2,
          stderr: 'psql: error: FATAL:  password authentication failed for user "appuser"',
        })),
      }),
    );

    expect(badPassword.status).toBe('fail');
    expect(badPassword.detail).toContain('password authentication failed');
    expect(badPassword.remedy).toContain('POSTGRES_PASSWORD');

    const missingDb = await find(DATABASE_CHECKS, 'database-exists').run(
      context({
        runCommand: fakeRunCommand(() => ({
          exitCode: 2,
          stderr: 'psql: error: FATAL:  database "appdb" does not exist',
        })),
      }),
    );

    expect(missingDb.status).toBe('fail');
    expect(missingDb.remedy).toContain('createdb');
    // Migrations create tables, never the database itself.
    expect(missingDb.remedy).toContain('Migrations create tables');
  });

  it('reports a pg_hba rejection as its own case', async () => {
    const result = await find(DATABASE_CHECKS, 'database-credentials').run(
      context({
        runCommand: fakeRunCommand(() => ({
          exitCode: 2,
          stderr: 'psql: error: FATAL:  no pg_hba.conf entry for host "10.0.0.5"',
        })),
      }),
    );

    expect(result.detail).toContain('pg_hba.conf');
    expect(result.remedy).toContain('pg_hba.conf');
  });

  it('warns when the user cannot create tables', async () => {
    const result = await find(DATABASE_CHECKS, 'database-privileges').run(
      context({ runCommand: fakeRunCommand(() => ({ exitCode: 0, stdout: 'f' })) }),
    );

    expect(result.status).toBe('warn');
    expect(result.remedy).toContain('GRANT CREATE');
  });

  it('skips the TLS check unless POSTGRES_SSL is true', async () => {
    const result = await find(DATABASE_CHECKS, 'database-ssl').run(context());
    expect(result.status).toBe('skip');
  });

  it('warns when TLS was asked for but the session is plaintext', async () => {
    const result = await find(DATABASE_CHECKS, 'database-ssl').run(
      context({
        env: new Map([...ENV, ['POSTGRES_SSL', 'true']]),
        runCommand: fakeRunCommand(() => ({ exitCode: 0, stdout: 'f' })),
      }),
    );

    expect(result.status).toBe('warn');
    // The setting was giving false assurance, which is worse than being off.
    expect(result.detail).toContain('not encrypted');
  });

  it('passes PGSSLMODE when TLS is requested', async () => {
    const seen: string[][] = [];
    await find(DATABASE_CHECKS, 'database-ssl').run(
      context({
        env: new Map([...ENV, ['POSTGRES_SSL', 'true']]),
        runCommand: fakeRunCommand((argv) => {
          seen.push([...argv]);
          return { exitCode: 0, stdout: 't' };
        }),
      }),
    );

    expect(seen.flat()).toContain('PGSSLMODE=require');
  });
});

describe('dns checks', () => {
  it('skips when no domain was given', async () => {
    const result = await find(DNS_CHECKS, 'dns-resolves').run(context({ domain: undefined }));
    expect(result.status).toBe('skip');
  });

  it('fails when the name does not resolve', async () => {
    const result = await find(DNS_CHECKS, 'dns-resolves').run(
      context({ resolveHost: async () => [] }),
    );

    expect(result.status).toBe('fail');
    expect(result.remedy).toContain('DNS record');
  });

  it('passes when the record points at one of this host addresses', async () => {
    const result = await find(DNS_CHECKS, 'dns-points-here').run(
      context({
        resolveHost: async () => ['203.0.113.10'],
        ownAddresses: async () => ['203.0.113.10', 'fe80::1'],
      }),
    );

    expect(result.status).toBe('pass');
  });

  it('names both addresses when they disagree', async () => {
    // Behind a CDN this is expected, and the operator needs to recognise it.
    const result = await find(DNS_CHECKS, 'dns-points-here').run(
      context({
        resolveHost: async () => ['198.51.100.7'],
        ownAddresses: async () => ['203.0.113.10'],
      }),
    );

    expect(result.status).toBe('fail');
    expect(result.detail).toContain('198.51.100.7');
    expect(result.detail).toContain('203.0.113.10');
    expect(result.remedy).toContain('CDN');
  });

  it('warns rather than fails when this host address cannot be determined', async () => {
    // A limit of the check, not evidence that DNS is wrong - and an external
    // echo service is deliberately not consulted.
    const result = await find(DNS_CHECKS, 'dns-points-here').run(
      context({
        resolveHost: async () => ['198.51.100.7'],
        ownAddresses: async () => [],
      }),
    );

    expect(result.status).toBe('warn');
  });
});

describe('tls checks', () => {
  it('treats no certificate as a pass on a first install', async () => {
    const result = await find(TLS_CHECKS, 'certificate-present').run(
      context({ fs: absentFs }),
    );

    // Issuing one is exactly what install does next.
    expect(result.status).toBe('pass');
    expect(result.detail).toContain('none yet');
  });

  it('reports an existing certificate', async () => {
    const result = await find(TLS_CHECKS, 'certificate-present').run(context());
    expect(result.detail).toContain('already issued');
  });

  it('warns when no renewal mechanism can be found', async () => {
    const result = await find(TLS_CHECKS, 'certificate-renewal').run(
      context({
        fs: { ...presentFs, exists: (path: string) => !path.includes('cron.d') },
        runCommand: fakeRunCommand(() => ({ exitCode: 1, stderr: 'disabled' })),
      }),
    );

    expect(result.status).toBe('warn');
    // A certificate nobody renews is a 90-day timer on an outage.
    expect(result.remedy).toContain('90 days');
  });

  it('skips the expiry check when openssl is unavailable', async () => {
    const result = await find(TLS_CHECKS, 'certificate-validity').run(
      context({ runCommand: fakeRunCommand(() => undefined) }),
    );

    expect(result.status).toBe('skip');
  });
});

// =============================================================================
// Two checks for the containerised proxy (issue #389, epic #388)
// =============================================================================

describe('certificate-renewal-paths', () => {
  it('skips when there is no domain', async () => {
    const result = await find(TLS_CHECKS, 'certificate-renewal-paths').run(
      context({ domain: undefined }),
    );

    expect(result.status).toBe('skip');
  });

  it('skips when no certificate has been issued yet', async () => {
    const result = await find(TLS_CHECKS, 'certificate-renewal-paths').run(
      context({ fs: absentFs }),
    );

    expect(result.status).toBe('skip');
  });

  it('passes in host mode, without inspecting any renewal config', async () => {
    const fs: CheckFs = {
      ...presentFs,
      readDir: () => {
        throw new Error('must not be called in host mode');
      },
    };
    const result = await find(TLS_CHECKS, 'certificate-renewal-paths').run(
      context({ proxyMode: 'host', fs }),
    );

    expect(result.status).toBe('pass');
  });

  it('fails and names the offending file when a renewal config records a host path', async () => {
    const fs: CheckFs = {
      ...presentFs,
      readDir: () => ['app.example.test.conf', 'other.example.test.conf'],
      readFile: (path: string) =>
        path.endsWith('app.example.test.conf')
          ? 'archive_dir = /opt/infra/proxy/letsencrypt/archive/app.example.test\n'
          : 'archive_dir = /etc/letsencrypt/archive/other.example.test\n',
    };
    const result = await find(TLS_CHECKS, 'certificate-renewal-paths').run(
      context({ proxyMode: 'container', fs }),
    );

    expect(result.status).toBe('fail');
    expect(result.detail).toContain('app.example.test.conf');
    expect(result.detail).not.toContain('other.example.test.conf');
    expect(result.remedy).toContain('certbot renew');
  });

  it('passes when every renewal config already uses the container paths', async () => {
    const fs: CheckFs = {
      ...presentFs,
      readDir: () => ['app.example.test.conf'],
      readFile: () => 'archive_dir = /etc/letsencrypt/archive/app.example.test\n',
    };
    const result = await find(TLS_CHECKS, 'certificate-renewal-paths').run(
      context({ proxyMode: 'container', fs }),
    );

    expect(result.status).toBe('pass');
  });

  it('skips when there is no renewal configuration yet', async () => {
    const fs: CheckFs = { ...presentFs, readDir: () => [] };
    const result = await find(TLS_CHECKS, 'certificate-renewal-paths').run(
      context({ proxyMode: 'container', fs }),
    );

    expect(result.status).toBe('skip');
  });
});

describe('certificate-served', () => {
  const PEM_A =
    '-----BEGIN CERTIFICATE-----\nAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n-----END CERTIFICATE-----';
  const PEM_B =
    '-----BEGIN CERTIFICATE-----\nBBBBBBBBBBBBBBBBBBBBBBBBBBBB\n-----END CERTIFICATE-----';

  it('skips when there is no domain', async () => {
    const result = await find(TLS_CHECKS, 'certificate-served').run(
      context({ domain: undefined }),
    );

    expect(result.status).toBe('skip');
  });

  it('skips when there is no certificate on disk to compare against', async () => {
    const result = await find(TLS_CHECKS, 'certificate-served').run(
      context({ fs: absentFs }),
    );

    expect(result.status).toBe('skip');
  });

  it('passes when the served certificate matches the one on disk', async () => {
    const fs: CheckFs = { ...presentFs, readFile: () => PEM_A };
    const result = await find(TLS_CHECKS, 'certificate-served').run(
      context({ fs, runCommand: fakeRunCommand(() => ({ exitCode: 0, stdout: PEM_A })) }),
    );

    expect(result.status).toBe('pass');
  });

  it('warns, with a remedy naming a reload, when the served certificate differs', async () => {
    const fs: CheckFs = { ...presentFs, readFile: () => PEM_A };
    const result = await find(TLS_CHECKS, 'certificate-served').run(
      context({
        fs,
        proxyMode: 'container',
        proxyContainer: 'infra-proxy-1',
        runCommand: fakeRunCommand((argv) =>
          argv[0] === 'openssl' ? { exitCode: 0, stdout: PEM_B } : { exitCode: 0, stdout: 'true' },
        ),
      }),
    );

    expect(result.status).toBe('warn');
    expect(result.remedy).toContain('docker exec infra-proxy-1 nginx -s reload');
  });

  it('skips rather than fails when openssl is missing', async () => {
    const fs: CheckFs = { ...presentFs, readFile: () => PEM_A };
    const result = await find(TLS_CHECKS, 'certificate-served').run(
      context({ fs, runCommand: fakeRunCommand(() => undefined) }),
    );

    expect(result.status).toBe('skip');
  });

  it('skips rather than fails when the connection is refused', async () => {
    const fs: CheckFs = { ...presentFs, readFile: () => PEM_A };
    const result = await find(TLS_CHECKS, 'certificate-served').run(
      context({
        fs,
        runCommand: fakeRunCommand(() => ({ exitCode: 1, stderr: 'connect: connection refused' })),
      }),
    );

    expect(result.status).toBe('skip');
  });

  it('skips rather than fails on garbage output that is not a certificate', async () => {
    const fs: CheckFs = { ...presentFs, readFile: () => PEM_A };
    const result = await find(TLS_CHECKS, 'certificate-served').run(
      context({
        fs,
        runCommand: fakeRunCommand(() => ({ exitCode: 0, stdout: 'not a certificate at all' })),
      }),
    );

    expect(result.status).toBe('skip');
  });
});

describe('extractPem', () => {
  it('extracts the first PEM block from surrounding noise', () => {
    const pem = '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----';
    expect(extractPem(`CONNECTED(...)\n${pem}\nsome trailer text`)).toBe(pem);
  });

  it('returns undefined when there is no PEM block', () => {
    expect(extractPem('nothing here looks like a certificate')).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(extractPem('')).toBeUndefined();
  });
});

describe('compareServedCertificate', () => {
  const PEM_A = '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----';
  const PEM_A_REWRAPPED = '-----BEGIN CERTIFICATE-----\n  AAAA  \n-----END CERTIFICATE-----';
  const PEM_B = '-----BEGIN CERTIFICATE-----\nBBBB\n-----END CERTIFICATE-----';

  it('passes when the certificates are identical modulo whitespace', () => {
    const result = compareServedCertificate(PEM_A, PEM_A_REWRAPPED, 'nginx -s reload');
    expect(result.status).toBe('pass');
  });

  it('warns and names the reload command when they differ', () => {
    const result = compareServedCertificate(PEM_A, PEM_B, 'docker exec proxy-nginx nginx -s reload');
    expect(result.status).toBe('warn');
    expect(result.remedy).toContain('docker exec proxy-nginx nginx -s reload');
  });

  it('skips, never fails, when either side has no PEM block', () => {
    expect(compareServedCertificate('garbage', PEM_A, 'nginx -s reload').status).toBe('skip');
    expect(compareServedCertificate(PEM_A, 'garbage', 'nginx -s reload').status).toBe('skip');
    expect(compareServedCertificate('garbage', 'garbage', 'nginx -s reload').status).toBe('skip');
  });
});

describe('parseNotAfter', () => {
  const now = new Date('2026-01-01T00:00:00Z');

  it('passes on a certificate with plenty of life left', () => {
    const result = parseNotAfter('notAfter=Jun  1 12:00:00 2026 GMT', now);
    expect(result.status).toBe('pass');
  });

  it('warns within thirty days', () => {
    const result = parseNotAfter('notAfter=Jan 20 12:00:00 2026 GMT', now);
    expect(result.status).toBe('warn');
    expect(result.detail).toContain('19 day');
  });

  it('warns on an expired certificate', () => {
    const result = parseNotAfter('notAfter=Dec  1 12:00:00 2025 GMT', now);
    expect(result.status).toBe('warn');
    expect(result.detail).toContain('expired');
  });

  it('warns when the output cannot be read', () => {
    expect(parseNotAfter('nonsense', now).status).toBe('warn');
  });
});

// =============================================================================
// The GitHub CLI pair, and the promotion rule  (issue #390, epic #388)
// =============================================================================

describe('gh checks', () => {
  /** Everything absent except git, which answers about the remote and the fetch. */
  const withGit =
    (remote: string, reachable: boolean) =>
    (argv: readonly string[]): Canned | undefined => {
      const line = argv.join(' ');
      if (line.startsWith('git ls-remote')) {
        return reachable
          ? { exitCode: 0, stdout: 'abc123\trefs/heads/main' }
          : { exitCode: 128, stderr: 'fatal: could not read Username: terminal prompts disabled' };
      }
      if (line.includes('remote get-url')) return { exitCode: 0, stdout: remote };
      return undefined;
    };

  it('passes when gh is installed and authenticated', async () => {
    const respond: Responder = (argv) => {
      const line = argv.join(' ');
      if (line === 'gh --version') return { exitCode: 0, stdout: 'gh version 2.62.0 (2024-11-14)' };
      if (line === 'gh auth status') return { exitCode: 0, stdout: 'Logged in' };
      return undefined;
    };

    const installed = await find(GH_CHECKS, 'gh-installed').run(
      context({ runCommand: fakeRunCommand(respond) }),
    );
    const authenticated = await find(GH_CHECKS, 'gh-authenticated').run(
      context({ runCommand: fakeRunCommand(respond) }),
    );

    expect(installed.status).toBe('pass');
    expect(installed.detail).toContain('2.62.0');
    expect(authenticated.status).toBe('pass');
  });

  it('warns, never fails, for an ssh remote - that is a deploy key, not gh', async () => {
    const result = await find(GH_CHECKS, 'gh-installed').run(
      context({
        repoUrl: 'git@example.test:team/app.git',
        runCommand: fakeRunCommand(() => undefined),
      }),
    );

    expect(result.status).toBe('warn');
    expect(result.remedy).toContain('apt-get install gh');
  });

  it('warns for an https remote git can already read - a public repository', async () => {
    const result = await find(GH_CHECKS, 'gh-installed').run(
      context({
        repoUrl: 'https://forge.test/team/app.git',
        runCommand: fakeRunCommand(withGit('https://forge.test/team/app.git', true)),
      }),
    );

    expect(result.status).toBe('warn');
  });

  it('promotes to fail when the https remote needs a credential git has not got', async () => {
    const result = await find(GH_CHECKS, 'gh-installed').run(
      context({
        repoUrl: 'https://forge.test/team/app.git',
        runCommand: fakeRunCommand(withGit('https://forge.test/team/app.git', false)),
      }),
    );

    expect(result.status).toBe('fail');
    expect(result.detail).toContain('https');
    expect(result.remedy).toContain('apt-get install gh');
  });

  it('promotes gh-authenticated on the same reasoning, with its own remedy', async () => {
    const promoted = await find(GH_CHECKS, 'gh-authenticated').run(
      context({
        repoUrl: 'https://forge.test/team/app.git',
        runCommand: fakeRunCommand((argv) =>
          argv.join(' ') === 'gh --version'
            ? { exitCode: 0, stdout: 'gh version 2.62.0' }
            : withGit('https://forge.test/team/app.git', false)(argv),
        ),
      }),
    );

    expect(promoted.status).toBe('fail');
    expect(promoted.remedy).toContain('gh auth login');

    const unpromoted = await find(GH_CHECKS, 'gh-authenticated').run(
      context({
        repoUrl: 'https://forge.test/team/app.git',
        runCommand: fakeRunCommand((argv) =>
          argv.join(' ') === 'gh --version'
            ? { exitCode: 0, stdout: 'gh version 2.62.0' }
            : withGit('https://forge.test/team/app.git', true)(argv),
        ),
      }),
    );

    expect(unpromoted.status).toBe('warn');
  });

  it('warns rather than promoting when no repository can be determined', async () => {
    // Nothing is claimed from an absent answer: a probe that cannot see a
    // remote has not established that a credential is needed.
    const result = await find(GH_CHECKS, 'gh-installed').run(
      context({ runCommand: fakeRunCommand(() => undefined) }),
    );

    expect(result.status).toBe('warn');
  });

  it('reads origin out of the checkout when no repository was handed over', async () => {
    // install's preflight runs BEFORE anything is cloned, so it has no target
    // to pass; the promotion still has to work there.
    const seen: string[][] = [];
    const result = await find(GH_CHECKS, 'gh-installed').run(
      context({
        runCommand: fakeRunCommand((argv) => {
          seen.push([...argv]);
          return withGit('https://forge.test/team/app.git', false)(argv);
        }),
      }),
    );

    expect(seen.some((argv) => argv.join(' ').includes('remote get-url origin'))).toBe(true);
    expect(result.status).toBe('fail');
  });

  it('never prompts for a credential, and never prints the URL', async () => {
    // A doctor run that blocks forever on a hidden username prompt is worse
    // than one that reports nothing; and an https URL can carry a token, so
    // only the CONCLUSION drawn from it is ever reported.
    const envs: Array<NodeJS.ProcessEnv | undefined> = [];
    const url = 'https://tok3n@forge.test/team/app.git';

    const result = await find(GH_CHECKS, 'gh-installed').run(
      context({
        repoUrl: url,
        runCommand: fakeRunCommand((argv, options) => {
          if (argv.join(' ').startsWith('git ls-remote')) envs.push(options.env);
          return withGit(url, false)(argv);
        }),
      }),
    );

    expect(envs[0]?.GIT_TERMINAL_PROMPT).toBe('0');
    expect(`${result.detail} ${result.remedy ?? ''}`).not.toContain('tok3n');
    expect(`${result.detail} ${result.remedy ?? ''}`).not.toContain('forge.test');
  });

  it('skips gh-authenticated when gh is not installed', async () => {
    const results = await runChecks(
      GH_CHECKS,
      context({ runCommand: fakeRunCommand(() => undefined) }),
    );

    expect(results[1]?.id).toBe('gh-authenticated');
    expect(results[1]?.status).toBe('skip');
    expect(results[1]?.detail).toContain('gh-installed');
  });
});

// =============================================================================
// CREATEDB, inspected and never exercised  (issue #390, epic #388)
// =============================================================================

describe('database-create-privilege', () => {
  it('passes when the role may create databases', async () => {
    const result = await find(DATABASE_CHECKS, 'database-create-privilege').run(
      context({ runCommand: fakeRunCommand(() => ({ exitCode: 0, stdout: 't' })) }),
    );

    expect(result.status).toBe('pass');
    expect(result.detail).toContain('appuser');
  });

  it('warns, naming the grant, when it may not', async () => {
    const result = await find(DATABASE_CHECKS, 'database-create-privilege').run(
      context({ runCommand: fakeRunCommand(() => ({ exitCode: 0, stdout: 'f' })) }),
    );

    expect(result.status).toBe('warn');
    expect(result.remedy).toContain('ALTER ROLE appuser CREATEDB');
  });

  it('inspects the privilege rather than testing it by creating anything', async () => {
    // Rule 4. A leftover database from a crashed probe would be worse than
    // having no check at all.
    const seen: string[][] = [];
    const envs: Array<NodeJS.ProcessEnv | undefined> = [];
    await find(DATABASE_CHECKS, 'database-create-privilege').run(
      context({
        runCommand: fakeRunCommand((argv, options) => {
          seen.push([...argv]);
          envs.push(options.env);
          return { exitCode: 0, stdout: 't' };
        }),
      }),
    );

    const flat = seen.flat().join(' ');
    expect(flat).toContain('pg_roles');
    expect(flat).not.toMatch(/create\s+database/i);
    expect(flat).not.toContain('p@ss/word#1');
    expect(envs[0]?.PGPASSWORD).toBe('p@ss/word#1');
  });

  it('defers to the credentials check rather than duplicating its failure', async () => {
    const check = find(DATABASE_CHECKS, 'database-create-privilege');
    expect(check.requires).toContain('database-credentials');

    const unreadable = await check.run(
      context({
        runCommand: fakeRunCommand(() => ({ exitCode: 2, stderr: 'psql: error: FATAL: ...' })),
      }),
    );

    expect(unreadable.status).toBe('skip');
  });
});

// =============================================================================
// Which mechanism owns renewal  (issue #390, epic #388)
// =============================================================================

describe('findRenewalOwner', () => {
  const SCRIPT = RENEWAL_SCRIPT_PATHS[0] as string;

  /** Nothing exists except the paths named. */
  const onlyPaths = (...paths: readonly string[]): CheckFs => ({
    ...absentFs,
    exists: (path: string) => paths.includes(path),
  });

  it('reports the systemd timer when one is enabled', async () => {
    const owner = await findRenewalOwner({
      runCommand: fakeRunCommand((argv) =>
        argv.join(' ').startsWith('systemctl is-enabled') ? { exitCode: 0, stdout: 'enabled' } : undefined,
      ),
      proxyRoot: '/opt/infra/proxy',
      fs: absentFs,
    });

    expect(owner?.mechanism).toBe('systemd-timer');
    expect(owner?.reference).toBe('certbot.timer');
  });

  it('reports the cron.d entry when there is no timer', async () => {
    const owner = await findRenewalOwner({
      runCommand: fakeRunCommand(() => undefined),
      proxyRoot: '/opt/infra/proxy',
      fs: onlyPaths('/etc/cron.d/certbot'),
    });

    expect(owner?.mechanism).toBe('cron-d');
    expect(owner?.reference).toBe('/etc/cron.d/certbot');
  });

  it('reports a central script scheduled from root\'s crontab', async () => {
    // The target server's real arrangement: one script covering every
    // certificate on the box. Before #390 this reported "no renewal timer or
    // cron entry found", which invites installing a second schedule against
    // certificates something already renews.
    const owner = await findRenewalOwner({
      runCommand: fakeRunCommand((argv) =>
        argv.join(' ') === 'crontab -l'
          ? { exitCode: 0, stdout: `17 3 * * * ${SCRIPT} >> /var/log/renew.log 2>&1\n` }
          : undefined,
      ),
      proxyRoot: '/opt/infra/proxy',
      fs: onlyPaths(SCRIPT),
    });

    expect(owner?.mechanism).toBe('central-script');
    expect(owner?.reference).toBe(SCRIPT);
    expect(owner?.description).toContain('crontab');
  });

  it('finds a script under the proxy root, which moves with the deployment', async () => {
    const path = '/opt/infra/proxy/renew-certs.sh';
    const owner = await findRenewalOwner({
      runCommand: fakeRunCommand((argv) =>
        argv.join(' ') === 'crontab -l' ? { exitCode: 0, stdout: `0 4 * * * ${path}\n` } : undefined,
      ),
      proxyRoot: '/opt/infra/proxy',
      fs: onlyPaths(path),
    });

    expect(owner?.reference).toBe(path);
  });

  it('does not count a script nothing schedules', async () => {
    // A leftover script nobody runs is exactly the state that LOOKS like
    // renewal and is not.
    const owner = await findRenewalOwner({
      runCommand: fakeRunCommand((argv) =>
        argv.join(' ') === 'crontab -l' ? { exitCode: 0, stdout: '0 5 * * * /usr/bin/backup\n' } : undefined,
      ),
      proxyRoot: '/opt/infra/proxy',
      fs: onlyPaths(SCRIPT),
    });

    expect(owner).toBeUndefined();
  });

  it('does not count a commented-out crontab line', async () => {
    const owner = await findRenewalOwner({
      runCommand: fakeRunCommand((argv) =>
        argv.join(' ') === 'crontab -l' ? { exitCode: 0, stdout: `#17 3 * * * ${SCRIPT}\n` } : undefined,
      ),
      proxyRoot: '/opt/infra/proxy',
      fs: onlyPaths(SCRIPT),
    });

    expect(owner).toBeUndefined();
  });

  it('is undefined when nothing owns renewal', async () => {
    const owner = await findRenewalOwner({
      runCommand: fakeRunCommand(() => undefined),
      proxyRoot: '/opt/infra/proxy',
      fs: absentFs,
    });

    expect(owner).toBeUndefined();
  });
});

describe('certificate-renewal', () => {
  const SCRIPT = RENEWAL_SCRIPT_PATHS[0] as string;

  it('reports WHICH mechanism owns renewal, not merely that one does', async () => {
    // #391 reads the same helper to decide whether to schedule anything of its
    // own, so the check and the helper share one implementation and cannot
    // disagree about what it found.
    const result = await find(TLS_CHECKS, 'certificate-renewal').run(
      context({
        fs: { ...presentFs, exists: (path: string) => path.includes('fullchain') || path === SCRIPT },
        runCommand: fakeRunCommand((argv) =>
          argv.join(' ') === 'crontab -l' ? { exitCode: 0, stdout: `17 3 * * * ${SCRIPT}\n` } : undefined,
        ),
      }),
    );

    expect(result.status).toBe('pass');
    expect(result.detail).toContain(SCRIPT);
  });

  it('passes on an enabled systemd timer', async () => {
    const result = await find(TLS_CHECKS, 'certificate-renewal').run(
      context({
        runCommand: fakeRunCommand((argv) =>
          argv.join(' ').startsWith('systemctl is-enabled') ? { exitCode: 0, stdout: 'enabled' } : undefined,
        ),
      }),
    );

    expect(result.status).toBe('pass');
    expect(result.detail).toContain('certbot.timer');
  });

  it('skips when there is no domain, and when nothing has been issued', async () => {
    expect(
      (await find(TLS_CHECKS, 'certificate-renewal').run(context({ domain: undefined }))).status,
    ).toBe('skip');
    expect(
      (await find(TLS_CHECKS, 'certificate-renewal').run(context({ fs: absentFs }))).status,
    ).toBe('skip');
  });
});

describe('the complete registry', () => {
  it('runs host, database, DNS and TLS in that order', () => {
    const ids = ALL_CHECKS.map((check) => check.id);

    // Host first: a server with no docker should say so before it starts
    // probing databases with a container it cannot run.
    expect(ids.indexOf('docker-installed')).toBeLessThan(ids.indexOf('database-reachable'));
    expect(ids.indexOf('database-reachable')).toBeLessThan(ids.indexOf('dns-resolves'));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every non-passing check a remedy, across the whole registry', async () => {
    const results = await runChecks(
      ALL_CHECKS,
      context({
        runCommand: fakeRunCommand(() => undefined),
        fs: absentFs,
        totalMemoryBytes: () => 512 * 1024 * 1024,
        portFree: async () => false,
        portListening: async () => false,
        resolveHost: async () => [],
        ownAddresses: async () => [],
      }),
    );

    const missing = results
      .filter((result) => result.status === 'fail' || result.status === 'warn')
      .filter((result) => (result.remedy ?? '') === '');

    expect(missing).toEqual([]);
  });
});


// =============================================================================
// Credentialing the clone  (issue #391, epic #388)
// =============================================================================
//
// `repo.ts` calls this before a FIRST clone and never learns which tool
// answered. These tests assert the two properties that keep that honest: it
// does nothing at all for a remote that needs nothing, and it never blocks the
// clone when it cannot help.
// =============================================================================

describe('prepareGitCredentials', () => {
  function recording(respond: Responder): {
    runCommand: typeof import('../executor.js').runCommand;
    calls: string[][];
  } {
    const calls: string[][] = [];
    const inner = fakeRunCommand(respond);
    const runCommand = (async (argv: readonly string[], options: RunCommandOptions) => {
      calls.push([...argv]);
      return await inner(argv, options);
    }) as typeof import('../executor.js').runCommand;
    return { runCommand, calls };
  }

  it('does nothing for an ssh remote', async () => {
    // A deploy key's job. No forge CLI plays any part in it, so nothing is run
    // beyond the shape test - which needs no subprocess at all.
    const { runCommand, calls } = recording(() => ({ exitCode: 0 }));

    const setup = await prepareGitCredentials({
      runCommand,
      deployRoot: '/opt/infra/apps/demo',
      repoUrl: 'git@example.test:o/r.git',
    });

    expect(setup).toBe('not-needed');
    expect(calls).toEqual([]);
  });

  it('does nothing for an https remote git can already read', async () => {
    const { runCommand, calls } = recording((argv) =>
      argv[1] === 'ls-remote' ? { exitCode: 0, stdout: 'sha\trefs/heads/main' } : undefined,
    );

    const setup = await prepareGitCredentials({
      runCommand,
      deployRoot: '/opt/infra/apps/demo',
      repoUrl: 'https://example.test/o/r',
    });

    expect(setup).toBe('not-needed');
    // The probe, and nothing else: a public repository must not drag a CLI
    // that may not even be installed into the path of every deployment.
    expect(calls).toHaveLength(1);
  });

  it('configures git when the repository needs a credential this server has', async () => {
    const { runCommand, calls } = recording((argv) =>
      argv[1] === 'ls-remote'
        ? { exitCode: 128, stderr: 'could not read Username' }
        : { exitCode: 0 },
    );

    const setup = await prepareGitCredentials({
      runCommand,
      deployRoot: '/opt/infra/apps/demo',
      repoUrl: 'https://example.test/o/private',
    });

    expect(setup).toBe('configured');
    expect(calls.map((argv) => argv.join(' '))).toContain('gh auth setup-git');
  });

  it('stands aside, without throwing, when no credential is available', async () => {
    // The clone then fails on its own terms, and `ensureCheckout` already
    // turns that into an actionable message about repository access.
    const { runCommand } = recording(() => ({ exitCode: 1, stderr: 'not logged in' }));

    const setup = await prepareGitCredentials({
      runCommand,
      deployRoot: '/opt/infra/apps/demo',
      repoUrl: 'https://example.test/o/private',
    });

    expect(setup).toBe('unavailable');
  });
});

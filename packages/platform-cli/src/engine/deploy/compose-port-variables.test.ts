import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { portVariableFor } from './compose-port-variables.js';
import { composeFilesFor } from './compose-files.js';
import type { PublishedPort } from './compose-ports.js';

// =============================================================================
// Which .env key moves a published port?  (#1024)
// =============================================================================
//
// The remedy of `stack-ports-free` names the variable. It is DERIVED from the
// compose files, so the test that matters reads the REAL generated files: when
// platform-infra renames GREPTIME_BIND_PG_PORT or drops the override, this fails
// instead of an operator being told to set a key that does nothing.
// =============================================================================

const COMPOSE_DIR = resolve(__dirname, '..', '..', '..', '..', '..', 'infra', 'compose');
const env = (entries: Record<string, string> = {}): Map<string, string> => new Map(Object.entries(entries));
const port = (service: string, number: number, hostIp = '127.0.0.1', protocol = 'tcp'): PublishedPort => ({ service, hostIp, port: number, protocol });

describe('portVariableFor against the real compose files', () => {
  const files = composeFilesFor(undefined, COMPOSE_DIR).map((name) => readFileSync(join(COMPOSE_DIR, name), 'utf8'));

  it('names APP_BIND_PORT for nginx, not the base file\'s NGINX_PORT (`!override` drops it)', () => {
    expect(portVariableFor({ port: port('nginx', 3535), files, env: env() })).toBe('APP_BIND_PORT');
    expect(portVariableFor({ port: port('nginx', 3600), files, env: env({ APP_BIND_PORT: '3600' }) })).toBe('APP_BIND_PORT');
  });

  it('names GREPTIME_BIND_PG_PORT for greptimedb, by default and when the operator changed it', () => {
    expect(portVariableFor({ port: port('greptimedb', 14003), files, env: env() })).toBe('GREPTIME_BIND_PG_PORT');
    expect(portVariableFor({ port: port('greptimedb', 14100), files, env: env({ GREPTIME_BIND_PG_PORT: '14100' }) })).toBe(
      'GREPTIME_BIND_PG_PORT',
    );
  });

  it('names nothing for a port no entry evaluates to', () => {
    // 14000 is the dev-only HTTP port telemetry.compose.yml publishes and the VPS file overrides away.
    expect(portVariableFor({ port: port('greptimedb', 14000), files, env: env() })).toBeUndefined();
    expect(portVariableFor({ port: port('nginx', 9999), files, env: env() })).toBeUndefined();
  });
});

describe('portVariableFor on small files', () => {
  const base = ['services:', '  web:', '    ports:', '      - "${WEB_PORT:-8080}:80"', '      - "9000:81"'].join('\n');

  it('traces a plain merge: both the earlier and the later entry are candidates', () => {
    const later = ['services:', '  web:', '    ports:', '      - "${EXTRA_PORT:-8081}:82"'].join('\n');

    expect(portVariableFor({ port: port('web', 8080, ''), files: [base, later], env: env() })).toBe('WEB_PORT');
    expect(portVariableFor({ port: port('web', 8081, ''), files: [base, later], env: env() })).toBe('EXTRA_PORT');
  });

  it('drops the earlier entries after `ports: !override` and after `!reset`', () => {
    for (const tag of ['!override', '!reset']) {
      const later = ['services:', '  web:', `    ports: ${tag}`, '      - "${OTHER_PORT:-8080}:80"'].join('\n');

      expect(portVariableFor({ port: port('web', 8080, ''), files: [base, later], env: env() })).toBe('OTHER_PORT');
    }
    const cleared = ['services:', '  web:', '    ports: !override []'].join('\n');
    expect(portVariableFor({ port: port('web', 8080, ''), files: [base, cleared], env: env() })).toBeUndefined();
  });

  it('returns undefined for a literal port: no variable moves it', () => {
    expect(portVariableFor({ port: port('web', 9000, ''), files: [base], env: env() })).toBeUndefined();
  });

  it('applies the operator\'s value and compose\'s default rules', () => {
    // set -> the value; unset or empty with `:-` -> the default.
    expect(portVariableFor({ port: port('web', 7000, ''), files: [base], env: env({ WEB_PORT: '7000' }) })).toBe('WEB_PORT');
    expect(portVariableFor({ port: port('web', 8080, ''), files: [base], env: env({ WEB_PORT: '' }) })).toBe('WEB_PORT');
    expect(portVariableFor({ port: port('web', 8080, ''), files: [base], env: env({ WEB_PORT: '7000' }) })).toBeUndefined();
  });

  it('matches host address and protocol, and ignores other services', () => {
    const files = [
      ['services:', '  web:', '    ports:', '      - "127.0.0.1:${A_PORT:-5000}:80"', '      - "${B_PORT:-5000}:80/udp"', '  other:', '    ports:', '      - "${C_PORT:-5000}:80"'].join('\n'),
    ];

    expect(portVariableFor({ port: port('web', 5000, '127.0.0.1'), files, env: env() })).toBe('A_PORT');
    expect(portVariableFor({ port: port('web', 5000, '', 'udp'), files, env: env() })).toBe('B_PORT');
    expect(portVariableFor({ port: port('other', 5000, ''), files, env: env() })).toBe('C_PORT');
    expect(portVariableFor({ port: port('web', 5000, '10.0.0.1'), files, env: env() })).toBeUndefined();
  });

  it('reads items at the key\'s own indent, comments and trailing comments', () => {
    const files = [['services:', '  web:', '    # a comment', '    ports:', '    - "${W_PORT:-6000}:80"   # trailing', '    restart: always'].join('\n')];

    expect(portVariableFor({ port: port('web', 6000, ''), files, env: env() })).toBe('W_PORT');
  });
});

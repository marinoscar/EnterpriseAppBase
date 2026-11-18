// =============================================================================
// nginx connection and file-descriptor limits for long-lived SSE  (issue #684)
// =============================================================================
//
// Every server-sent-event stream (/api/notifications/stream, the AI and the
// telemetry assistant streams) holds TWO connections in nginx for its whole
// lifetime: the client side and the upstream side. The stock
// `worker_connections 1024` saturated one worker at about 500 open tabs.
//
// Raising it only works as a set: worker_rlimit_nofile must cover
// worker_connections, and the container's hard `nofile` ulimit must cover
// worker_rlimit_nofile, or nginx hits "Too many open files" instead. The API
// holds one socket per proxied stream, so it carries the same ulimit. This is
// configuration, not code, so it is asserted by reading the files the
// deployment actually uses, the way ai-stream-nginx.spec.ts does -- with
// regex helpers rather than a YAML dependency.
// =============================================================================

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '..', '..', '..');
const conf = readFileSync(resolve(repoRoot, 'infra/nginx/nginx.conf'), 'utf8');
const compose = readFileSync(resolve(repoRoot, 'infra/compose/base.compose.yml'), 'utf8');

/** nginx.conf with comments removed, so the arithmetic comment block cannot satisfy a match. */
const directives = conf.replace(/#.*$/gm, '');

/** The text before the first block: nginx's main context. */
const mainContext = directives.slice(0, directives.search(/^\s*(events|http)\s*\{/m));

/** The body of the `events { … }` block (it has no nested blocks). */
function eventsBlock(): string {
  const match = directives.match(/^\s*events\s*\{([^}]*)\}/m);
  if (!match) throw new Error('no events block in infra/nginx/nginx.conf');
  return match[1];
}

function numericDirective(block: string, name: string): number {
  const match = block.match(new RegExp(`^\\s*${name}\\s+(\\d+)\\s*;`, 'm'));
  if (!match) throw new Error(`no numeric "${name}" directive`);
  return Number(match[1]);
}

/** The lines of one top-level service in base.compose.yml (two-space indented key under `services:`). */
function serviceBlock(name: string): string {
  const lines = compose.split('\n');
  const start = lines.findIndex((line) => line === `  ${name}:`);
  if (start === -1) throw new Error(`no service "${name}" in infra/compose/base.compose.yml`);

  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    // The next service, or the next top-level key, ends this one.
    if (/^ {0,2}\S/.test(line) && !line.trimStart().startsWith('#')) break;
    body.push(line);
  }
  return body.join('\n');
}

function nofile(service: string): { soft: number; hard: number } {
  const match = serviceBlock(service).match(
    /^ {4}ulimits:\s*\n\s+nofile:\s*\n\s+soft:\s*(\d+)\s*\n\s+hard:\s*(\d+)/m,
  );
  if (!match) throw new Error(`service "${service}" sets no ulimits.nofile soft/hard`);
  return { soft: Number(match[1]), hard: Number(match[2]) };
}

describe('nginx connection limits for SSE (infra/nginx/nginx.conf)', () => {
  const workerConnections = numericDirective(eventsBlock(), 'worker_connections');
  const rlimit = numericDirective(mainContext, 'worker_rlimit_nofile');

  it('keeps worker_processes auto', () => {
    expect(mainContext).toMatch(/^\s*worker_processes\s+auto\s*;/m);
  });

  it('sets worker_connections to at least 8192 (each SSE stream takes two)', () => {
    expect(workerConnections).toBeGreaterThanOrEqual(8192);
    expect(workerConnections).toBe(16384);
  });

  it('sets worker_rlimit_nofile in the main context, at least worker_connections', () => {
    expect(rlimit).toBe(65536);
    expect(rlimit).toBeGreaterThanOrEqual(workerConnections);
  });

  it('accepts several connections per wake-up', () => {
    expect(eventsBlock()).toMatch(/^\s*multi_accept\s+on\s*;/m);
  });

  it('explains the two-connections-per-stream arithmetic in a comment', () => {
    expect(conf).toMatch(/#.*TWO connections/);
    expect(conf).toMatch(/#.*worker_processes x worker_connections \/ 2/);
  });
});

describe('container nofile limits (infra/compose/base.compose.yml)', () => {
  const rlimit = numericDirective(mainContext, 'worker_rlimit_nofile');

  it.each(['nginx', 'api'])('%s carries a nofile ulimit at least worker_rlimit_nofile', (service) => {
    const { soft, hard } = nofile(service);

    expect(hard).toBeGreaterThanOrEqual(rlimit);
    expect(soft).toBeGreaterThanOrEqual(rlimit);
    expect(soft).toBeLessThanOrEqual(hard);
  });

  it('pins both services at 65536', () => {
    expect(nofile('nginx')).toEqual({ soft: 65536, hard: 65536 });
    expect(nofile('api')).toEqual({ soft: 65536, hard: 65536 });
  });
});

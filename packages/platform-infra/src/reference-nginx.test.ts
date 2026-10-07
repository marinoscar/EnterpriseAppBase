// =============================================================================
// The composed nginx configuration, run by a real nginx
// =============================================================================
//
// Two configurations, each exactly as base.compose.yml mounts it into the
// container (nginx.conf, csp.conf, platform/, app.d/):
//
//   - the reference app's infra/nginx, as installed by `platform-infra sync`;
//   - the same with EvoPath's overlay fixtures in app.d/ (two SSE locations
//     through platform/sse-proxy.conf, geolocation=(self)), proving those
//     differences need no platform file edit.
//
// Each is checked with `nginx -t`, then served against a stub API to prove
// what a browser receives: every response, the app's SSE routes included,
// carries the security headers. The container paths (/etc/nginx, the
// upstream host names, the ports) are rewritten into a scratch directory so a
// local nginx can run it unprivileged. Without an nginx binary the suite is
// skipped with a message; GitHub's Ubuntu runners have one, and CI also runs
// `nginx -t` in the pinned image (ci.yml).
// =============================================================================

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url));
const REPO_ROOT = join(PACKAGE_ROOT, '..', '..');
const REFERENCE = join(REPO_ROOT, 'infra', 'nginx');
const EVOPATH_APP_D = join(PACKAGE_ROOT, 'test', 'fixtures', 'overlays', 'evopath', 'nginx', 'app.d');

const HAS_NGINX = spawnSync('nginx', ['-v'], { encoding: 'utf8' }).status === 0;
if (!HAS_NGINX) {
  console.warn('[platform-infra] no `nginx` binary: the nginx -t and header tests are SKIPPED here. CI runs them.');
}

/** The security headers platform/security-headers.conf sets, read from the file itself. */
function securityHeaderNames(): string[] {
  const text = readFileSync(join(REFERENCE, 'platform', 'security-headers.conf'), 'utf8');
  return [...text.matchAll(/^add_header\s+([\w-]+)/gm)].map((m) => m[1]!.toLowerCase());
}

/** Copies a directory, rewriting every text file with `rewrite`. */
function copyRewritten(from: string, to: string, rewrite: (text: string) => string): void {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const source = join(from, name);
    const target = join(to, name);
    if (statSync(source).isDirectory()) copyRewritten(source, target, rewrite);
    else writeFileSync(target, rewrite(readFileSync(source, 'utf8')));
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolvePort(typeof address === 'object' && address !== null ? address.port : 0));
    });
  });
}

interface Stack {
  dir: string;
  port: number;
  nginx?: ChildProcess;
  api?: Server;
}

/**
 * Lays out /etc/nginx as base.compose.yml mounts it, in a scratch directory,
 * with `appD` as app.d/ (default: the reference app's).
 */
async function layout(appD = join(REFERENCE, 'app.d')): Promise<Stack & { apiPort: number }> {
  const dir = mkdtempSync(join(tmpdir(), 'platform-infra-nginx-'));
  const [port, statusPort, apiPort] = [await freePort(), await freePort(), await freePort()];
  const rewrite = (text: string): string =>
    text
      .replaceAll('/etc/nginx/', `${dir}/etc/`)
      .replace(/^(\s*)listen 80;/m, `$1listen 127.0.0.1:${port};`)
      .replace(/^(\s*)listen 8081;/m, `$1listen 127.0.0.1:${statusPort};`)
      .replace(/server api:3000;/, `server 127.0.0.1:${apiPort};`)
      .replace(/server web:5173;/, `server 127.0.0.1:${apiPort};`)
      .replace(/^pid .*;$/m, `pid ${dir}/nginx.pid;`)
      .replace(/^error_log \S+/m, `error_log ${dir}/error.log`)
      .replace(/access_log \/var\/log\/nginx\/access\.log main;/, `access_log ${dir}/access.log main;`)
      .replace(
        /^http \{$/m,
        `http {\n    client_body_temp_path ${dir}/tmp/body;\n    proxy_temp_path ${dir}/tmp/proxy;\n` +
          `    fastcgi_temp_path ${dir}/tmp/fastcgi;\n    uwsgi_temp_path ${dir}/tmp/uwsgi;\n    scgi_temp_path ${dir}/tmp/scgi;`,
      );
  const etc = join(dir, 'etc');
  mkdirSync(join(dir, 'tmp'), { recursive: true });
  mkdirSync(etc, { recursive: true });
  for (const file of ['nginx.conf', 'csp.conf']) writeFileSync(join(etc, file), rewrite(readFileSync(join(REFERENCE, file), 'utf8')));
  copyRewritten(join(REFERENCE, 'platform'), join(etc, 'platform'), rewrite);
  copyRewritten(join(REFERENCE, 'app.d'), join(etc, 'app.d'), rewrite);
  if (appD !== join(REFERENCE, 'app.d')) copyRewritten(appD, join(etc, 'app.d'), rewrite);
  if (existsSync('/etc/nginx/mime.types')) cpSync('/etc/nginx/mime.types', join(etc, 'mime.types'));
  else writeFileSync(join(etc, 'mime.types'), 'types { text/html html; }\n');
  return { dir, port, apiPort };
}

function nginxTest(dir: string): { status: number | null; output: string } {
  const result = spawnSync('nginx', ['-t', '-p', dir, '-e', join(dir, 'error.log'), '-c', join(dir, 'etc', 'nginx.conf')], {
    encoding: 'utf8',
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

/** Starts the stub API and nginx; resolves once nginx answers. */
async function start(stack: Stack & { apiPort: number }): Promise<void> {
  stack.api = createServer((request, response) => {
    const sse = request.url?.endsWith('/stream') === true;
    response.writeHead(200, { 'Content-Type': sse ? 'text/event-stream' : 'application/json' });
    response.end(sse ? 'data: {"ok":true}\n\n' : '{"ok":true}');
  });
  await new Promise<void>((resolveListen) => stack.api!.listen(stack.apiPort, '127.0.0.1', resolveListen));
  stack.nginx = spawn(
    'nginx',
    ['-p', stack.dir, '-e', join(stack.dir, 'error.log'), '-c', join(stack.dir, 'etc', 'nginx.conf'), '-g', 'daemon off; master_process off;'],
    { stdio: 'ignore' },
  );
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await fetch(`http://127.0.0.1:${stack.port}/nginx-health`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw new Error(`nginx did not start: ${readFileSync(join(stack.dir, 'error.log'), 'utf8')}`);
}

async function stop(stack: Stack | undefined): Promise<void> {
  if (stack === undefined) return;
  stack.nginx?.kill('SIGTERM');
  await new Promise<void>((r) => (stack.api ? stack.api.close(() => r()) : r()));
  rmSync(stack.dir, { recursive: true, force: true });
}

describe.skipIf(!HAS_NGINX)('the reference app nginx configuration', () => {
  let stack: (Stack & { apiPort: number }) | undefined;
  beforeAll(async () => {
    stack = await layout();
    await start(stack);
  });
  afterAll(() => stop(stack));

  it('passes nginx -t with the empty app.d include points', () => {
    const result = nginxTest(stack!.dir);
    expect(result.output).toMatch(/syntax is ok/);
    expect(result.status).toBe(0);
  });

  it.each(['/', '/api/health', '/api/notifications/stream', '/api/ai/responses/stream', '/nginx-health'])(
    '%s carries every security header, the Permissions-Policy from app.d/',
    async (path) => {
      const response = await fetch(`http://127.0.0.1:${stack!.port}${path}`);
      for (const name of [...securityHeaderNames(), 'permissions-policy']) {
        expect(response.headers.get(name), `${path}: ${name}`).not.toBeNull();
      }
      expect(response.headers.get('permissions-policy')).toBe('camera=(), microphone=(self), geolocation=(), payment=()');
    },
  );
});

describe.skipIf(!HAS_NGINX)('EvoPath overlays in app.d/, with no platform file edited', () => {
  let stack: (Stack & { apiPort: number }) | undefined;
  beforeAll(async () => {
    stack = await layout(EVOPATH_APP_D);
    await start(stack);
  });
  afterAll(() => stop(stack));

  it('passes nginx -t', () => {
    const result = nginxTest(stack!.dir);
    expect(result.output).toMatch(/syntax is ok/);
    expect(result.status).toBe(0);
  });

  it.each(['/api/coach/chat/stream', '/api/ai/training/stream'])('%s streams through the snippet with every security header', async (path) => {
    const response = await fetch(`http://127.0.0.1:${stack!.port}${path}`, { method: 'POST', body: '{}' });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(await response.text()).toBe('data: {"ok":true}\n\n');
    for (const name of [...securityHeaderNames(), 'permissions-policy']) {
      expect(response.headers.get(name), `${path}: ${name}`).not.toBeNull();
    }
  });

  it('keeps the security headers in a location that adds a header of its own', async () => {
    const response = await fetch(`http://127.0.0.1:${stack!.port}/api/ai/training/stream`, { method: 'POST', body: '{}' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(response.headers.get('strict-transport-security')).toContain('max-age=');
  });

  it('serves the app’s Permissions-Policy everywhere', async () => {
    for (const path of ['/', '/api/coach/chat/stream']) {
      const response = await fetch(`http://127.0.0.1:${stack!.port}${path}`);
      expect(response.headers.get('permissions-policy'), path).toBe('camera=(), microphone=(self), geolocation=(self), payment=()');
    }
  });
});

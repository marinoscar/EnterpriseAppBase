import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { UsageError } from '../errors.js';
import { proxyRuntimeFor, renderVhost, type ProxyTarget } from './proxy.js';
import {
  DEFAULT_STREAM_TIMEOUT_SECONDS,
  assertValidProxyPath,
  listRegisteredProxyStreamPaths,
  freezeProxyStreamRegistry,
  registerProxyStreamPath,
  resetProxyStreamRegistryForTests,
} from './proxy-streams.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = '/opt/infra/proxy';
const target: ProxyTarget = { domain: 'app.example.test', bindPort: 3535, proxyRoot: root };

/** The location block of `path` inside a rendered vhost. */
function block(vhost: string, path: string): string {
  const start = vhost.indexOf(`location ${path} {`);
  expect(start, `location ${path} is rendered`).toBeGreaterThan(-1);
  return vhost.slice(start, vhost.indexOf('\n    }', start));
}

afterEach(() => resetProxyStreamRegistryForTests());

describe('renderVhost with app stream paths', () => {
  const runtime = proxyRuntimeFor('container', root);

  it('is byte-identical to the platform vhost when the app declares nothing', () => {
    const golden = readFileSync(join(here, '__fixtures__/vhost.platform.golden.conf'), 'utf8');
    expect(renderVhost(target, runtime)).toBe(golden);
  });

  it('streams an app SSE route unbuffered with the long timeout (the production bug)', () => {
    const vhost = renderVhost({ ...target, streamPaths: ['/api/coach/chat/stream'] }, runtime);
    const location = block(vhost, '/api/coach/chat/stream');

    expect(location).toContain('proxy_pass http://127.0.0.1:3535;');
    expect(location).toContain('proxy_buffering off;');
    expect(location).toContain('proxy_cache off;');
    expect(location).toContain(`proxy_read_timeout ${DEFAULT_STREAM_TIMEOUT_SECONDS}s;`);
    expect(location).toContain(`proxy_send_timeout ${DEFAULT_STREAM_TIMEOUT_SECONDS}s;`);
    expect(location).toContain("proxy_set_header Connection        '';");
    // The catch-all keeps its 60 s and its buffering.
    const catchAll = vhost.slice(vhost.indexOf('location / {\n        proxy_pass'));
    const catchAllBlock = catchAll.slice(0, catchAll.indexOf('\n    }'));
    expect(catchAllBlock).toContain('proxy_read_timeout    60s;');
    expect(catchAllBlock).not.toContain('proxy_buffering');
  });

  it('renders the same directives as a platform SSE location', () => {
    const vhost = renderVhost({ ...target, streamPaths: ['/api/coach/chat/stream'] }, runtime);
    const strip = (text: string) => text.split('\n').filter((line) => !line.includes('location ') && !line.includes('proxy_read_timeout') && !line.includes('proxy_send_timeout')).join('\n');
    expect(strip(block(vhost, '/api/coach/chat/stream'))).toBe(strip(block(vhost, '/api/notifications/stream')));
  });

  it('renders registry paths and honours a per-route timeout and buffering', () => {
    registerProxyStreamPath({ path: '/api/coach/report/stream', timeoutSeconds: 600 });
    const vhost = renderVhost(
      { ...target, extraLocations: [{ path: '/api/coach/export', timeoutSeconds: 900, buffering: true }] },
      runtime,
    );
    expect(block(vhost, '/api/coach/report/stream')).toContain('proxy_read_timeout 600s;');
    const buffered = block(vhost, '/api/coach/export');
    expect(buffered).toContain('proxy_read_timeout    900s;');
    expect(buffered).not.toContain('proxy_buffering off');
  });

  it('renders each path once, after the platform locations, and is deterministic', () => {
    registerProxyStreamPath('/api/coach/chat/stream');
    const input = { ...target, streamPaths: ['/api/coach/chat/stream', '/api/notifications/stream'] };
    const vhost = renderVhost(input, runtime);
    expect(vhost.match(/location \/api\/coach\/chat\/stream \{/g)).toHaveLength(1);
    expect(vhost.match(/location \/api\/notifications\/stream \{/g)).toHaveLength(1);
    expect(vhost.indexOf('/api/coach/chat/stream')).toBeGreaterThan(vhost.indexOf('/api/admin/telemetry/assistant/stream'));
    expect(renderVhost(input, runtime)).toBe(vhost);
  });

  it.each([
    ['a newline that would add a directive', '/x\n    proxy_pass http://evil;'],
    ['a semicolon', '/x; return 200'],
    ['a quote', '/x"y'],
    ['a single quote', "/x'y"],
    ['braces', '/x{}'],
    ['an opening brace', '/x {'],
    ['a space', '/x y'],
    ['a variable', '/x$host'],
    ['a comment marker', '/x#'],
    ['a backslash', '/x\\y'],
    ['a missing leading slash', 'api/x'],
    ['an empty path', ''],
    ['the catch-all', '/'],
    ['a dot-dot segment', '/api/../x'],
    ['a double slash', '/api//x'],
    ['a regex modifier', '~ /x'],
  ])('refuses %s before it reaches the config', (_label, path) => {
    expect(() => renderVhost({ ...target, streamPaths: [path] }, runtime)).toThrow(UsageError);
    expect(() => registerProxyStreamPath(path)).toThrow(UsageError);
    expect(listRegisteredProxyStreamPaths()).toHaveLength(0);
  });

  it('refuses a bad timeout or buffering flag', () => {
    const render = (extra: { timeoutSeconds: number; buffering: boolean }) =>
      renderVhost({ ...target, extraLocations: [{ path: '/api/x', ...extra }] }, runtime);
    expect(() => render({ timeoutSeconds: 0, buffering: false })).toThrow(UsageError);
    expect(() => render({ timeoutSeconds: 1.5, buffering: false })).toThrow(UsageError);
    expect(() => render({ timeoutSeconds: 1_000_000, buffering: false })).toThrow(UsageError);
    expect(() => render({ timeoutSeconds: 60, buffering: 'no' as unknown as boolean })).toThrow(UsageError);
  });
});

describe('registerProxyStreamPath', () => {
  it('throws on a duplicate and on a platform path', () => {
    registerProxyStreamPath('/api/coach/chat/stream');
    expect(() => registerProxyStreamPath('/api/coach/chat/stream')).toThrow(/already registered/);
    expect(() => registerProxyStreamPath('/api/ai/responses/stream')).toThrow(/platform's own/);
  });

  it('throws after the registry is frozen', () => {
    freezeProxyStreamRegistry('createCli built the CLI');
    expect(() => registerProxyStreamPath('/api/late')).toThrow(/createCli built the CLI/);
  });

  it('accepts ordinary URL paths', () => {
    for (const path of ['/api/a-b_c.d/e', '/events', '/v1/stream:watch', '/a/b@c+d,e=f~g']) {
      expect(() => assertValidProxyPath(path)).not.toThrow();
    }
  });
});

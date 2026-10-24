// =============================================================================
// App nginx locations keep the security headers (issue #714)
// =============================================================================
//
// infra/nginx/ is GENERATED from @marinoscar/platform-infra (`npm run
// platform:infra:sync`); an app adds routes in infra/nginx/app.d/, never by
// editing nginx.conf. nginx's add_header REPLACES rather than merges: a
// location that declares even one header of its own loses every server-level
// one, CSP and HSTS included, with no error anywhere. So every app location
// that ends up with an add_header must carry the whole security set, which is
// what platform/sse-proxy.conf (and platform/security-headers.conf) give it.
//
// Asserted statically here, against the reference app's app.d/ and EvoPath's
// overlay fixture, with includes resolved the way the container resolves
// them (base.compose.yml mounts infra/nginx/{platform,app.d} at
// /etc/nginx/{platform,app.d}). The package test
// (packages/platform-infra/src/reference-nginx.test.ts) proves the same
// against a running nginx.
// =============================================================================

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(__dirname, '..', '..', '..');
const nginxDir = resolve(repoRoot, 'infra/nginx');
const evopathAppD = resolve(repoRoot, 'packages/platform-infra/test/fixtures/overlays/evopath/nginx/app.d');

const read = (path: string): string => readFileSync(path, 'utf8');
const strip = (text: string): string =>
  text
    .split('\n')
    .map((line) => line.replace(/#.*$/, ''))
    .join('\n');

/** Every file under a directory, recursively. */
function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

/** Expands `include` directives, mapping /etc/nginx/ to the app's files and `appD` for app.d/. */
function expand(text: string, appD: string, depth = 0): string {
  if (depth > 5) throw new Error('include nesting deeper than 5');
  return strip(text).replace(/^\s*include\s+([^;]+);/gm, (_line, target: string) => {
    const path = target.trim();
    const mapped = path.startsWith('/etc/nginx/app.d/')
      ? join(appD, path.slice('/etc/nginx/app.d/'.length))
      : join(nginxDir, path.replace(/^\/etc\/nginx\//, ''));
    if (mapped.includes('*')) {
      const dir = mapped.slice(0, mapped.lastIndexOf('/'));
      return filesUnder(dir)
        .filter((file) => file.endsWith('.conf'))
        .sort()
        .map((file) => expand(read(file), appD, depth + 1))
        .join('\n');
    }
    return expand(read(mapped), appD, depth + 1);
  });
}

/** Each top-level `location ... { ... }` in a text, braces balanced. */
function locations(text: string): { spec: string; body: string }[] {
  const found: { spec: string; body: string }[] = [];
  const re = /\blocation\s+([^{]+)\{/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    let depth = 1;
    let i = match.index + match[0].length;
    while (depth > 0 && i < text.length) {
      if (text[i] === '{') depth++;
      if (text[i] === '}') depth--;
      i++;
    }
    found.push({ spec: match[1].trim(), body: text.slice(match.index + match[0].length, i - 1) });
    re.lastIndex = i;
  }
  return found;
}

const headerNames = (text: string): string[] =>
  [...text.matchAll(/^\s*add_header\s+([\w-]+)/gm)].map((m) => m[1].toLowerCase());

const SECURITY = headerNames(expand(read(join(nginxDir, 'platform/security-headers.conf')), join(nginxDir, 'app.d')));

describe('nginx include points (issue #714)', () => {
  const conf = strip(read(join(nginxDir, 'nginx.conf')));

  it('includes app.d/http at http level, before the first server', () => {
    const at = conf.indexOf('include /etc/nginx/app.d/http/*.conf;');
    expect(at).toBeGreaterThan(conf.indexOf('http {'));
    expect(at).toBeLessThan(conf.indexOf('server {'));
  });

  it('sets the security headers and app.d/server at the public server level', () => {
    const server = conf.slice(conf.indexOf('server {'), conf.indexOf('location '));
    expect(server).toContain('include /etc/nginx/platform/security-headers.conf;');
    expect(server).toContain('include /etc/nginx/app.d/server/*.conf;');
  });

  it('includes app.d/locations before `location /api`', () => {
    const at = conf.indexOf('include /etc/nginx/app.d/locations/*.conf;');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(conf.indexOf('location /api {'));
  });

  it('mounts platform/ and app.d/ where nginx.conf includes them from', () => {
    const compose = read(resolve(repoRoot, 'infra/compose/base.compose.yml'));
    expect(compose).toMatch(/^\s+- \.\.\/nginx\/platform:\/etc\/nginx\/platform:ro$/m);
    expect(compose).toMatch(/^\s+- \.\.\/nginx\/app\.d:\/etc\/nginx\/app\.d:ro$/m);
  });

  it('sets the whole security set, with exactly one Permissions-Policy from app.d/', () => {
    expect(SECURITY).toEqual(
      expect.arrayContaining([
        'x-frame-options',
        'x-content-type-options',
        'referrer-policy',
        'permissions-policy',
        'strict-transport-security',
        'content-security-policy',
      ]),
    );
    expect(SECURITY.filter((name) => name === 'permissions-policy')).toHaveLength(1);
  });
});

describe('platform/sse-proxy.conf', () => {
  const snippet = expand(read(join(nginxDir, 'platform/sse-proxy.conf')), join(nginxDir, 'app.d'));
  const directive = (name: string): string | undefined =>
    snippet.match(new RegExp(`^\\s*${name}\\s+([^;]+);`, 'm'))?.[1].trim();

  it('proxies to the API unbuffered, without the WebSocket upgrade header', () => {
    expect(directive('proxy_pass')).toBe('http://api_upstream');
    expect(directive('proxy_buffering')).toBe('off');
    expect(directive('proxy_cache')).toBe('off');
    expect(snippet).toMatch(/proxy_set_header\s+Connection\s+'';/);
  });

  it('repeats every security header', () => {
    expect(headerNames(snippet).sort()).toEqual([...SECURITY].sort());
  });
});

describe.each([
  ['the reference app', join(nginxDir, 'app.d')],
  ['the EvoPath overlay fixture', evopathAppD],
])('app locations of %s', (_name, appD) => {
  const files = filesUnder(join(appD, 'locations')).filter((file) => file.endsWith('.conf'));
  const appLocations = files.flatMap((file) => locations(expand(read(file), appD)));

  it('every location that sets a header of its own also sets every security header', () => {
    for (const { spec, body } of appLocations) {
      const own = headerNames(body);
      if (own.length === 0) continue; // inherits the server-level set untouched
      expect({ location: spec, missing: SECURITY.filter((name) => !own.includes(name)) }).toEqual({ location: spec, missing: [] });
    }
  });

  it('serves no stub_status from an app file', () => {
    for (const file of filesUnder(appD)) expect({ file, stub: /\bstub_status\b/.test(strip(read(file))) }).toEqual({ file, stub: false });
  });
});

describe('the EvoPath overlay fixture (no platform file edited)', () => {
  it('adds its two SSE routes through the snippet', () => {
    const found = filesUnder(join(evopathAppD, 'locations')).flatMap((file) => locations(strip(read(file))));
    expect(found.map((l) => l.spec)).toEqual(['/api/coach/chat/stream', '/api/ai/training/stream']);
    for (const { body } of found) expect(body).toContain('include /etc/nginx/platform/sse-proxy.conf;');
  });

  it('grants geolocation to its own origin in its Permissions-Policy override', () => {
    expect(read(join(evopathAppD, 'permissions-policy.conf'))).toMatch(/add_header Permissions-Policy "[^"]*geolocation=\(self\)/);
  });
});

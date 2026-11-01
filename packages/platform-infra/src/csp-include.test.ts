// =============================================================================
// The CSP include point, checked without nginx
// =============================================================================
//
// csp.conf and csp.dev.conf compose the default policy from `$csp_*_extra`
// maps that include the app's `app.d/csp/*.conf`. These tests need no nginx
// (the nginx -t and served-header checks are in reference-nginx.test.ts, which
// needs the binary): they pin that
//
//   - with no app files every variable is empty, so the policy equals the
//     string the platform shipped before the include point existed, byte for
//     byte;
//   - each variable is defined by a map that includes a glob under app.d/csp/
//     (a glob matching nothing is valid, which is why an empty directory works);
//   - nothing hooks script-src or the other directives that must stay a
//     visible edit, and the /api/docs policy is not extended.
// =============================================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const NGINX = join(fileURLToPath(new URL('../', import.meta.url)), 'nginx');

/** The policies as shipped before the include point existed. */
const PRODUCTION =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob: https:; font-src 'self' data:; connect-src 'self' https:; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";
const DEVELOPMENT =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob: https:; font-src 'self' data:; connect-src 'self' https:; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";
const DOCS =
  "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: blob: https:; font-src 'self' data: https://fonts.scalar.com; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";

const code = (file: string): string =>
  readFileSync(join(NGINX, file), 'utf8')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');

function policies(file: string): { def: string; docs: string } {
  const conf = code(file);
  return {
    def: /^\s*default\s+"([^"]*)";/m.exec(conf)?.[1] ?? '',
    docs: /^\s*~\^\/api\/docs\s+"([^"]*)";/m.exec(conf)?.[1] ?? '',
  };
}

describe.each([
  ['csp.conf', PRODUCTION],
  ['csp.dev.conf', DEVELOPMENT],
])('%s', (file, shipped) => {
  const conf = code(file);
  const { def, docs } = policies(file);
  const variables = [...def.matchAll(/\$(csp_[a-z_]+)/g)].map((match) => match[1]!);

  it('equals the shipped policy once the (empty) app variables are removed', () => {
    expect(def.replace(/\$csp_[a-z_]+/g, '')).toBe(shipped);
  });

  it('leaves the /api/docs policy exactly as shipped, with no hook', () => {
    expect(docs).toBe(DOCS);
  });

  it('hooks only connect-src, img-src, media-src, font-src, style-src and extra directives', () => {
    expect(new Set(variables)).toEqual(
      new Set(['csp_connect_src_extra', 'csp_img_src_extra', 'csp_media_src_extra', 'csp_font_src_extra', 'csp_style_src_extra', 'csp_extra']),
    );
    expect(def).not.toMatch(/script-src[^;]*\$/);
    expect(def).not.toMatch(/(default-src|object-src|base-uri|form-action)[^;]*\$/);
    expect(def.endsWith("frame-ancestors 'self'$csp_extra")).toBe(true);
  });

  it.each([...new Set(variables)])('defines $%s as a map that includes a glob under app.d/csp/', (name) => {
    const map = new RegExp(`map\\s+\\$uri\\s+\\$${name}\\s*\\{\\s*include\\s+/etc/nginx/app\\.d/csp/([a-z-]+)\\*\\.conf;\\s*\\}`).exec(conf);
    expect(map, `map for $${name}`).not.toBeNull();
    // A glob, so an empty directory (or no directory) is valid.
    expect(map![0]).toContain('*.conf');
  });

  it('keeps the csp_policy map last, defaulting nothing else', () => {
    expect(conf.trimEnd().endsWith('}')).toBe(true);
    expect(conf.lastIndexOf('map $uri $csp_policy')).toBeGreaterThan(conf.lastIndexOf('map $uri $csp_extra'));
  });
});

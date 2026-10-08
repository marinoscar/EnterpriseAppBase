import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// "No suite contains a hard-coded `apps/api/src`, `apps/web/src` or `ai/providers`
// path. Every path comes from options or a registry." (issue #742). A suite that
// names the reference app's layout cannot run in another app.

const SRC = join(__dirname, '..', '..', 'src');

const FORBIDDEN: ReadonlyArray<{ pattern: RegExp; what: string }> = [
  { pattern: /apps\/api\/src/, what: 'apps/api/src' },
  { pattern: /apps\/web\/src/, what: 'apps/web/src' },
  // Not the admin API's own URL (`/api/admin/ai/providers/<id>/key`), which is a route, not a directory.
  { pattern: /(?<!admin\/)ai\/providers/, what: 'ai/providers' },
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return files(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

/** Files that make up conformance suites: anything under a `testing` directory that is a suite, a check or a conformance entry. */
function suiteFiles(): string[] {
  return files(SRC).filter((file) => {
    const rel = relative(SRC, file).split('\\').join('/');
    return (
      /(^|\/)testing\//.test(rel) &&
      !/\.spec\.ts$/.test(rel) &&
      /(\.suite\.ts|conformance\.ts|-checks\.ts|\/suites\/[^/]+\.ts|conformance\/[^/]+\.ts)$/.test(rel)
    );
  });
}

/** Source without comments: prose may name the reference app; code may not. */
const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('conformance suites name no path of the reference app', () => {
  it('finds the suites at all, so a moved tree cannot pass vacuously', () => {
    const rels = suiteFiles().map((file) => relative(SRC, file).split('\\').join('/'));

    expect(rels.length).toBeGreaterThanOrEqual(15);
    expect(rels).toEqual(
      expect.arrayContaining([
        'testing/suites/cron-enqueue-only.ts',
        'jobs/testing/on-event-no-io.suite.ts',
        'ai/testing/conformance/ai-kill-switch.suite.ts',
        'ai/testing/conformance/ai-no-sdk-leak.suite.ts',
      ]),
    );
  });

  it('contains no hard-coded app, web or provider-directory path in code', () => {
    const offenders = suiteFiles().flatMap((file) => {
      const code = stripComments(readFileSync(file, 'utf8'));
      return FORBIDDEN.filter(({ pattern }) => pattern.test(code)).map(
        ({ what }) => `${relative(SRC, file).split('\\').join('/')}: ${what}`,
      );
    });

    expect(offenders).toEqual([]);
  });

  it('holds for the web suites too (packages/platform-web/src/settings/testing): they read the app’s data, not its files', () => {
    // platform-web is a browser package without Node types, so this check lives here.
    const WEB_SUITES = join(SRC, '..', '..', 'platform-web', 'src', 'settings', 'testing');
    const webFiles = files(WEB_SUITES).filter((file) => file.endsWith('.suite.ts'));

    expect(webFiles.length).toBeGreaterThanOrEqual(5);
    const offenders = webFiles.flatMap((file) => {
      const code = stripComments(readFileSync(file, 'utf8'));
      return FORBIDDEN.filter(({ pattern }) => pattern.test(code)).map(({ what }) => `${relative(WEB_SUITES, file)}: ${what}`);
    });
    expect(offenders).toEqual([]);

    // A browser package reads no file: nothing imports node:fs.
    const reading = webFiles.filter((file) => /from 'node:/.test(readFileSync(file, 'utf8'))).map((file) => relative(WEB_SUITES, file));
    expect(reading).toEqual([]);
  });

  it('the detector itself flags a planted path', () => {
    const planted = "const root = join(repo, 'apps/api/src');\n// fine in a comment: apps/web/src\nconst url = '/api/admin/ai/providers/openai/key';\nconst dir = 'ai/providers/openai/';";

    expect(FORBIDDEN.filter(({ pattern }) => pattern.test(stripComments(planted))).map(({ what }) => what)).toEqual([
      'apps/api/src',
      'ai/providers',
    ]);
    expect(FORBIDDEN.filter(({ pattern }) => pattern.test("const url = '/api/admin/ai/providers/openai/key';"))).toEqual([]);
  });
});

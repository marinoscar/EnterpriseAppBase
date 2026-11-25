// =============================================================================
// The Android library module shipped as files (android/platform-core, #746)
// =============================================================================
//
// The module's Kotlin is compiled and unit-tested by Gradle (CI's android.yml);
// this suite pins what the npm package must carry and the security rule that
// no source may embed a browser: the module itself, and the reference shell
// that includes it (apps/android, the grep test of the acceptance criteria).
// =============================================================================

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url));
const REPO_ROOT = join(PACKAGE_ROOT, '..', '..');
const CORE = join(PACKAGE_ROOT, 'android', 'platform-core');
const SHELL = join(REPO_ROOT, 'apps', 'android');
const PACKAGE_DIR = 'io/github/marinoscar/platform/android/core';

function walk(dir: string, exts: readonly string[]): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'build' ? [] : walk(path, exts);
    return exts.some((ext) => name.endsWith(ext)) ? [path] : [];
  });
}

/** API use that embeds a browser or bridges JavaScript to Kotlin (a comment saying "no WebView" is fine). */
const EMBEDDED_BROWSER_USE = [/\bimport\s+android\.webkit\b/, /\bWebView\s*\(/, /\bWebViewClient\b/, /addJavascriptInterface/, /@JavascriptInterface/, /<WebView\b/];

describe('android/platform-core', () => {
  it('ships the Gradle module, the identity script and the README', () => {
    for (const file of ['build.gradle.kts', 'identity.gradle.kts', 'consumer-rules.pro', 'README.md', 'src/main/AndroidManifest.xml']) {
      expect(existsSync(join(CORE, file)), file).toBe(true);
    }
  });

  it('is part of the published files, without Gradle output', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as { files: string[] };
    expect(pkg.files).toContain('android');
    expect(pkg.files).toContain('!android/platform-core/build');
  });

  it('keeps every Kotlin source in the neutral platform package', () => {
    const sources = walk(join(CORE, 'src'), ['.kt']);
    expect(sources.length).toBeGreaterThan(10);
    for (const file of sources) {
      const rel = relative(join(CORE, 'src'), file).split('\\').join('/');
      expect(rel, rel).toMatch(new RegExp(`^(main|test)/kotlin/${PACKAGE_DIR}/`));
      const declared = /^package\s+([\w.]+)/m.exec(readFileSync(file, 'utf8'))?.[1];
      expect(declared, rel).toBe(rel.replace(/^(main|test)\/kotlin\//, '').replace(/\/[^/]+\.kt$/, '').split('/').join('.'));
    }
  });

  it('declares its namespace and reads identity from identity.gradle.kts', () => {
    const build = readFileSync(join(CORE, 'build.gradle.kts'), 'utf8');
    expect(build).toContain('namespace = "io.github.marinoscar.platform.android.core"');
    expect(build).toContain('apply(from = file("identity.gradle.kts"))');
    for (const field of ['PRODUCT_NAME', 'STORAGE_PREFIX', 'DEEP_LINK_SCHEME', 'DEFAULT_SERVER_URL', 'TWA_HOST']) {
      expect(build).toContain(`"${field}"`);
    }
  });

  it('builds the launch URL with source, appVersion and appVersionCode', () => {
    const urls = readFileSync(join(CORE, 'src', 'main', 'kotlin', PACKAGE_DIR, 'config', 'ServerUrls.kt'), 'utf8');
    expect(urls).toContain('/?source=twa');
    expect(urls).toContain('&appVersion=');
    expect(urls).toContain('&appVersionCode=');
  });

  it('never embeds a browser or exposes a JavaScript interface', () => {
    for (const file of walk(join(CORE, 'src', 'main'), ['.kt', '.java', '.xml'])) {
      const text = readFileSync(file, 'utf8');
      for (const pattern of EMBEDDED_BROWSER_USE) expect(pattern.test(text), `${relative(CORE, file)}: ${pattern}`).toBe(false);
    }
  });
});

describe('apps/android (the reference shell)', () => {
  it('includes :platform-core from the installed package, with the monorepo fallback', () => {
    const settings = readFileSync(join(SHELL, 'settings.gradle.kts'), 'utf8');
    expect(settings).toContain('include(":platform-core")');
    expect(settings).toContain('../../node_modules/@marinoscar/platform-infra/android/platform-core');
    expect(settings).toContain('../../packages/platform-infra/android/platform-core');
  });

  it('contains no WebView in app/src/main', () => {
    const files = walk(join(SHELL, 'app', 'src', 'main'), ['.kt', '.java', '.xml']);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(readFileSync(file, 'utf8'), relative(SHELL, file)).not.toMatch(/WebView|android\.webkit|JavascriptInterface/);
    }
  });
});

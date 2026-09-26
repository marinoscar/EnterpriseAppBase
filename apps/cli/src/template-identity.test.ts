import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { APP_SLUG } from '@app/shared';

// buildPlan/derive are exported by scripts/rename.mjs for exactly this
// reason: this guard derives its codemod-target allowlist from the SAME plan
// the script runs, rather than hand-listing it. See scripts/rename.d.mts for
// the type declarations (rename.mjs itself stays plain JS).
import { buildPlan, derive } from '../../../scripts/rename.mjs';

// =============================================================================
// The template-renameability guard (issue #343, epic #341)
// =============================================================================
//
// WHY THIS LIVES IN apps/cli, NOT SOMEWHERE REPO-WIDE
// -----------------------------------------------------------------------------
// This file scans the ENTIRE repository, not just apps/cli. It lives here
// anyway, for three practical reasons:
//
//   - `apps/cli/vitest.config.ts` already scopes to `src/**/*.test.ts` and CI
//     already runs this workspace's test script, so there is no new job to
//     wire up.
//   - This package is real ESM (`"type": "module"`), so `node:fs` /
//     `node:child_process` and `import.meta.url` are natural here in a way
//     they are not in `apps/api` (CommonJS + ts-jest) or `apps/web` (browser
//     runtime, jsdom).
//   - There is precedent for a CLI test reaching outside `apps/cli`:
//     `apps/cli/src/node/worker-env.test.ts` and
//     `apps/cli/src/deploy/repo.test.ts` both already do it. This is the same
//     move, aimed at the whole tree instead of one other package.
//
// It is the keystone of the epic: `packages/shared/identity.json` plus
// `@app/shared` gives new code a rebrand-safe way to reference the product
// name, the repo, and the brand colours. Nothing stops new code from
// hardcoding the old strings again instead of importing them. This test is
// what makes CI catch that.
//
// -----------------------------------------------------------------------------
// WHY THE FORBIDDEN PATTERNS ARE DERIVED FROM identity.json, NEVER LISTED
// -----------------------------------------------------------------------------
// A denylist that spells out `'EnterpriseAppBase'` (or `'My App'`, or
// `'marinoscar'`) literally goes vacuously green the instant a fork renames —
// the old name is gone, the new one was never forbidden, and the guard is
// quietly protecting nothing. Worse, `scripts/rename.mjs` would then have to
// rewrite THIS FILE as part of a rename, which is circular: the codemod
// editing its own guard.
//
// Instead every pattern below is built from the CURRENT contents of
// `packages/shared/identity.json` at test-run time. Immediately after a fork
// runs `rename.mjs`, this test starts protecting the NEW name with no edit of
// its own required. This is the exact model `apps/cli/src/node/env-prefix.test.ts`
// uses for `ENV_PREFIX` — read that file first; it explains the same
// derive-don't-list reasoning for a different literal.
//
// -----------------------------------------------------------------------------
// WHY THE ALLOWLIST'S CODEMOD-TARGET ENTRIES ARE DERIVED TOO
// -----------------------------------------------------------------------------
// A codemod target legitimately carries the CURRENT name by construction —
// `scripts/rename.mjs`'s `buildPlan()` writes the product slug into
// `package.json`, the repo name into `infra/compose/test.compose.yml`'s
// container name, and so on, precisely so those files stay in sync on the
// next rename. `README.md` and `install.sh` were always allowlisted for
// exactly this reason. The trouble with hand-listing only those two: on a
// fork whose repo name happens to equal its product slug (the common case —
// "acme-hub" the repo, "acme-hub" the slug), `buildPlan()` also writes that
// same bare token into `infra/compose/.env.example`,
// `infra/compose/base.compose.yml` and `infra/compose/test.compose.yml` —
// files nobody had thought to allowlist, because on THIS template
// (`my-app` != `EnterpriseAppBase`) they never carry a colliding value.
//
// So the allowlist's codemod-target half is not hand-listed at all: it is
// computed by calling `buildPlan()` the exact same way `rename.mjs` does,
// against a synthetic "old" identity that differs from the current one in
// every field, and collecting every `file` the resulting plan touches. A new
// anchor added to `buildPlan()` later is allowlisted automatically — there is
// no second list to update — and the guard can never go red on the codemod's
// own output, no matter what a fork's repo name happens to equal.
// =============================================================================

const HERE = dirname(fileURLToPath(import.meta.url));
// apps/cli/src -> apps/cli -> apps -> <repo root>
const REPO_ROOT = join(HERE, '..', '..', '..');
const MANIFEST_PATH = join(REPO_ROOT, 'packages', 'shared', 'identity.json');

interface Identity {
  productName: string;
  tagline: string;
  repoSlug: string;
  themeColor: string;
  backgroundColor: string;
}

function readManifest(): Identity {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Identity;
}

describe('the manifest shape (packages/shared/identity.json)', () => {
  const identity = readManifest();

  it('has a non-empty productName', () => {
    expect(typeof identity.productName).toBe('string');
    expect(identity.productName.trim().length).toBeGreaterThan(0);
  });

  it('has a non-empty tagline', () => {
    expect(typeof identity.tagline).toBe('string');
    expect(identity.tagline.trim().length).toBeGreaterThan(0);
  });

  it('has a repoSlug shaped like owner/name', () => {
    expect(identity.repoSlug).toMatch(/^[\w.-]+\/[\w.-]+$/);
  });

  // Lowercase, 6-digit `#rrggbb` is load-bearing, not a style preference: a
  // PWA manifest's `theme_color`/`background_color` are parsed by the
  // PLATFORM, not by a CSS engine, and the 3-digit shorthand and `rgb(...)`
  // forms are not reliably accepted there. `scripts/rename.mjs` enforces the
  // same shape on the way in (`HEX` regex there); this asserts it held.
  it('has a lowercase 6-digit hex themeColor', () => {
    expect(identity.themeColor).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('has a lowercase 6-digit hex backgroundColor', () => {
    expect(identity.backgroundColor).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('exposes a non-empty APP_SLUG from @app/shared', () => {
    expect(typeof APP_SLUG).toBe('string');
    expect(APP_SLUG.trim().length).toBeGreaterThan(0);
  });
});

// =============================================================================
// The no-stale-identity-literal guard
// =============================================================================

/**
 * A synthetic "previous" identity, deliberately different from the CURRENT
 * manifest in every field. Used only to compute which files `buildPlan()`
 * touches (below) — never compared against real repository content, so the
 * actual values here are arbitrary as long as none of them collides with
 * whatever the current manifest happens to hold.
 */
const SYNTHETIC_OLD_IDENTITY = {
  productName: 'Synthetic Old Product',
  tagline: 'Synthetic tagline, used only to derive the codemod-target file list.',
  repoSlug: 'synthetic-owner/synthetic-old-repo',
  themeColor: '#000001',
  backgroundColor: '#000002',
};

/**
 * The same CLI name on both sides of the derivation. `buildPlan()` only adds
 * its two CLI-binary edits (`apps/cli/src/branding.ts`, `apps/cli/package.json`)
 * when `next.cliName !== old.cliName` — passing an identical value on both
 * sides means those two entries are never in the derived plan, and therefore
 * never allowlisted. That is deliberate: `branding.ts` imports `APP_NAME` and
 * must stay guarded by this test like any other source file.
 */
const SAME_CLI_NAME = 'appctl';

/**
 * Every file `scripts/rename.mjs` would edit when rebranding from the
 * synthetic identity above to the CURRENT manifest — computed by calling the
 * exact same `buildPlan()` the script runs, not a hand-written mirror of it.
 * See the "WHY THE ALLOWLIST'S CODEMOD-TARGET ENTRIES ARE DERIVED TOO" note
 * up top for why this replaced a hand-listed `README.md`/`apps/cli/README.md`/
 * `install.sh` set.
 */
function derivedCodemodTargetFiles(currentIdentity: Identity): ReadonlySet<string> {
  const old = derive(SYNTHETIC_OLD_IDENTITY, SAME_CLI_NAME);
  const next = derive(currentIdentity, SAME_CLI_NAME);
  const plan = buildPlan(old, next);
  return new Set(plan.map((edit) => edit.file));
}

/** Files allowed to carry an identity literal outright, each with its own reason. */
function buildAllowlist(currentIdentity: Identity): ReadonlySet<string> {
  return new Set<string>([
    // The definition itself — this IS where the values live.
    'packages/shared/identity.json',
    // A cross-realm `Symbol.for()` registry key. It is a REGISTRY KEY, not a
    // display string — see the file's own comment on `VERBATIM_ERROR_BODY` for
    // why it must be a stable, globally-unique string, not why it happens to be
    // spelled like the product name.
    'apps/api/src/common/exceptions/verbatim-error-body.exception.ts',
    // Every codemod target `scripts/rename.mjs`'s `buildPlan()` would edit —
    // README.md, install.sh, apps/cli/README.md, and, when a fork's repo name
    // collides with its product slug, infra/compose/.env.example,
    // infra/compose/base.compose.yml and infra/compose/test.compose.yml too.
    // Derived, not hand-listed — see the header comment.
    ...derivedCodemodTargetFiles(currentIdentity),
  ]);
}

// Deliberately NOT allowlisted, on purpose, spelled out so nobody "fixes" this
// guard by adding them back:
//   - apps/api/src/openapi/document.ts
//   - apps/api/src/openapi/description.ts
// Both now import `REPO_URL` from `@app/shared` instead of hardcoding the
// repository. This guard is what keeps them that way — allowlisting them
// would silently permit the regression it exists to catch. They are also
// never in the derived codemod-target set above: `buildPlan()` never touches
// either file, precisely because they derive at runtime instead.

const TEST_FILE_RE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const BINARY_EXT_RE = /\.(png|ico|jpg|jpeg|gif|woff2?|ttf|pdf|zip)$/i;
const EXTRA_EXEMPT: ReadonlySet<string> = new Set([
  // A generated lockfile, not authored prose; renaming rewrites it via
  // `npm install`, never via this codemod or this guard.
  'package-lock.json',
  // History is never rewritten.
  'CHANGELOG.md',
]);

/**
 * Enumerate every file the guard should consider.
 *
 * `git ls-files -z` rather than a filesystem walk, for three reasons stated
 * here because they are easy to lose on a later edit:
 *
 *   1. It respects `.gitignore` for free. `node_modules`, `dist`, and any
 *      build output never enter the scan, without this file having to know
 *      their names.
 *   2. It cannot wander into a directory that merely EXISTS on disk but was
 *      never committed — three build artifacts were untracked out of this
 *      repository and are still sitting on disk in some checkouts; a
 *      filesystem walk would happily scan them, a git-based one will not.
 *   3. It is what makes the non-vacuity check below meaningful: "scanned
 *      1059 tracked files" is a real claim about the repository, not an
 *      artifact of whatever happens to be present in this container.
 *
 * `-z` (NUL-separated) rather than newline-separated output, because a
 * filename could in principle contain a newline; NUL cannot appear in a path.
 *
 * If git itself fails, THIS TEST FAILS LOUDLY rather than falling back to an
 * empty list. A guard that silently scans nothing on a broken git and reports
 * green is worse than having no guard at all — it would look like protection
 * while providing none.
 */
function listTrackedFiles(): string[] {
  let output: string;
  try {
    output = execFileSync('git', ['ls-files', '-z'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
  } catch (err) {
    throw new Error(
      `template-identity guard: \`git ls-files -z\` failed, so this test cannot ` +
        `verify anything and must not report a pass. Underlying error: ${String(err)}`,
    );
  }
  return output.split('\0').filter(Boolean);
}

/** Escape regex metacharacters in a literal value. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a word-boundary pattern for one forbidden value.
 *
 * Plain substring matching would flag a product named `Bit` inside the word
 * `Bitmap`. `\b` is only meaningful next to a word character, so it is added
 * at an end of the pattern only when the value itself starts/ends with one
 * (a slug like `owner/repo` starts and ends with word characters; this still
 * does the right thing for values that don't).
 */
function wordBoundaryPattern(value: string): RegExp {
  const escaped = escapeRegExp(value);
  const lead = /^\w/.test(value) ? '\\b' : '';
  const tail = /\w$/.test(value) ? '\\b' : '';
  // Deliberately CASE-SENSITIVE (no `i` flag). This is what lets
  // `apps/api/src/common/crypto/secret-cipher.ts`'s HKDF label
  // `'enterpriseappbase:secret-cipher:v1:'` (lowercase) pass with no
  // allowlist entry — that label must NEVER change, because doing so makes
  // every already-stored credential permanently undecryptable. A
  // case-insensitive guard would force either rewriting that label (forbidden)
  // or adding a special-case allowlist entry to excuse it; case-sensitivity
  // needs neither.
  return new RegExp(`${lead}${escaped}${tail}`);
}

interface Offender {
  file: string;
  line: number;
  text: string;
  value: string;
}

function findOffenders(
  files: string[],
  patterns: { value: string; re: RegExp }[],
  allowlist: ReadonlySet<string>,
): Offender[] {
  const offenders: Offender[] = [];

  for (const file of files) {
    if (allowlist.has(file) || EXTRA_EXEMPT.has(file)) continue;
    if (TEST_FILE_RE.test(file)) continue; // .test.ts/.spec.ts/.test.tsx/.spec.tsx — see below
    if (BINARY_EXT_RE.test(file)) continue;

    let content: string;
    try {
      content = readFileSync(join(REPO_ROOT, file), 'utf8');
    } catch {
      // Unreadable (e.g. a binary file with an extension this list doesn't
      // know about, or a broken symlink) — nothing to scan as text.
      continue;
    }

    const lines = content.split('\n');
    lines.forEach((lineText, idx) => {
      for (const { value, re } of patterns) {
        if (re.test(lineText)) {
          offenders.push({ file, line: idx + 1, text: lineText.trim().slice(0, 160), value });
        }
      }
    });
  }

  return offenders;
}

describe('no stale identity literal outside the allowlist (issue #343, epic #341)', () => {
  const identity = readManifest();

  // `split` is typed as possibly-sparse under `noUncheckedIndexedAccess`, so the
  // halves have to be narrowed rather than asserted. Throwing here is the right
  // failure: a repoSlug that is not `owner/name` means the guard would silently
  // scan for `undefined` and pass while protecting nothing, which is the one
  // outcome this file exists to prevent. The shape test above covers the same
  // ground with a readable message; this is the belt to its braces.
  // `owner` is still destructured (and still validates the slug's shape) even
  // though it is no longer scanned for below — see the "bare owner" note on
  // `patterns` just below.
  const slugParts = identity.repoSlug.split('/');
  const [owner, repoName] = slugParts;
  if (slugParts.length !== 2 || !owner || !repoName) {
    throw new Error(
      `identity.json repoSlug must be "owner/name", got ${JSON.stringify(identity.repoSlug)}`,
    );
  }

  // Deliberately no bare-`owner` pattern. An owner alone is not identity: a
  // common owner name (a first name, a short handle) collides with unrelated
  // prose the moment it appears as an ordinary word — this guard flagged
  // `Device: oscar-laptop` in an unrelated DTO example on a real fork whose
  // owner happened to be "oscar". The full `owner/name` slug pattern still
  // catches every real repository reference (a URL, a clone command, an
  // env default), and `scripts/rename.mjs`'s own `residualScan` already makes
  // the identical choice — it scans productName/repoSlug/repoName but never
  // the bare owner — so this aligns the two.
  const patterns = [
    { value: identity.productName, re: wordBoundaryPattern(identity.productName) },
    { value: identity.repoSlug, re: wordBoundaryPattern(identity.repoSlug) },
    { value: repoName, re: wordBoundaryPattern(repoName) },
  ];

  const files = listTrackedFiles();
  const allowlist = buildAllowlist(identity);
  const derivedCodemodFiles = derivedCodemodTargetFiles(identity);

  it('scans a real corpus (the guard is not vacuously green)', () => {
    // ~1059 tracked files at the time this guard was written.
    expect(files.length).toBeGreaterThan(500);
  });

  it('derives a non-empty codemod-target allowlist that still contains README.md and install.sh', () => {
    // If `buildPlan()` ever silently shrank to nothing (a botched refactor of
    // rename.mjs, say), the allowlist above would silently shrink to just its
    // two permanent entries and this guard would go vacuously permissive for
    // the wrong reason — passing while allowlisting nothing it should. This
    // pins both ends: the derived set is non-empty, and it still contains the
    // two files that were always hand-allowlisted for being genuine, permanent
    // codemod targets.
    expect(derivedCodemodFiles.size).toBeGreaterThan(0);
    expect(derivedCodemodFiles.has('README.md')).toBe(true);
    expect(derivedCodemodFiles.has('install.sh')).toBe(true);
  });

  it('finds no occurrence of the product name, repo slug, or repo name outside the allowlist', () => {
    const offenders = findOffenders(files, patterns, allowlist);

    if (offenders.length > 0) {
      const report = offenders
        .map(
          (o) =>
            `  ${o.file}:${o.line}  [${o.value}]  ${o.text}\n` +
            `      -> import from '@app/shared' (APP_NAME/REPO_SLUG/REPO_URL/...) instead of ` +
            `hardcoding it, or give it an anchor in scripts/rename.mjs's buildPlan() if it ` +
            `genuinely is a codemod target no runtime read can reach, or add a one-line-reason ` +
            `allowlist entry to this test if it is neither (e.g. a registry key).`,
        )
        .join('\n');
      throw new Error(
        `Found ${offenders.length} stale identity literal(s) outside the allowlist:\n\n${report}`,
      );
    }

    expect(offenders).toEqual([]);
  });
});

// =============================================================================
// The two hand-written SVGs
// =============================================================================
//
// `apps/web/scripts/generate-icons.py` explicitly does NOT rasterise these two
// files — rendering an SVG needs a toolchain this template refuses to require
// — so nothing else keeps their hardcoded colour in step with a rebrand. A
// rename that missed them would leave the browser tab (favicon) or the PWA's
// master icon on the old brand colour forever.
//
// This deliberately does NOT scan the repository generally for THEME_COLOR:
// `#1976d2` (and `#ffffff`) legitimately appear elsewhere on purpose —
// `OAuthButton.tsx`, `theme/light.ts`, `theme/dark.ts`,
// `email/templates/layout.ts`, and three contrast-ratio test utilities (~15
// hits today) — so a general scan would be unworkable noise, not a guard.
// `scripts/rename.mjs`'s own `residualScan` makes the identical decision for
// the identical reason. These two files are singled out instead, anchored on
// the exact `fill="..."` attribute `rename.mjs` edits on the background rect.
describe('the hand-written brand SVGs carry the current THEME_COLOR', () => {
  const identity = readManifest();

  it.each(['apps/web/public/favicon.svg', 'apps/web/public/icons/source.svg'])(
    '%s has fill="<THEME_COLOR>" on its background rect',
    (relPath) => {
      const content = readFileSync(join(REPO_ROOT, relPath), 'utf8');
      expect(content).toContain(`fill="${identity.themeColor}"`);
    },
  );
});

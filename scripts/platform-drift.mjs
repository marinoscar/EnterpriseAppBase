#!/usr/bin/env node
// =============================================================================
// scripts/platform-drift.mjs — cross-repo drift report  (issue #674, epic #660)
// =============================================================================
//
// Compares ONE consumer repository (a product forked from this template)
// against the base and writes a JSON and a Markdown report: which files and
// modules are really different, which are identical once comment, whitespace
// and identity-rename noise is ignored, and which exist on one side only.
//
// -----------------------------------------------------------------------------
// WHY NORMALISE AT ALL
// -----------------------------------------------------------------------------
// A byte comparison (`cmp`) of two forks is dominated by noise:
//
//   - Issue-number comments are renumbered per repository ("(issue 600)" in
//     the base, "(issue 125)" in a fork) in dozens of otherwise equal files.
//   - Identity renames: the product name, repository slug and CLI binary name
//     (and its env prefix) differ by design in every fork.
//   - Migration ids drift: the same SQL lands under a different timestamp.
//
// So every text file is normalised on both sides before comparing: comments
// removed (with the TypeScript parser for code, so a `//` inside a string or a
// template literal is never mistaken for one), identity values replaced by the
// same placeholders on both sides, blank lines and indentation dropped.
//
// -----------------------------------------------------------------------------
// WHAT THIS SCRIPT DELIBERATELY DOES NOT DO
// -----------------------------------------------------------------------------
//
//   - It never writes to either repository. The only output is --out.
//   - It never fails because of drift: drift is data. Exit 0 on success, 2 on
//     bad arguments or unreadable paths.
//   - It does not shell out to `diff` (Windows is supported, see
//     scripts/dev.ps1); the line diff is the Myers O(ND) algorithm below.
//   - It does not detect moved files: a move is `base-only` + `app-only`.
//
// Runbook: docs/runbooks/platform-drift-report.md
// =============================================================================

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { derive } from './rename.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Bumped only when a consumer of drift-report.json would have to change. */
export const SCHEMA_VERSION = 1;

/** Normalised line count above which the line diff is skipped (`diffSkipped`). */
export const DIFF_LINE_CAP = 20_000;

// =============================================================================
// Areas and modules
// =============================================================================

/**
 * Every area the report knows, in report order. `root` is relative to each
 * repository root; `module(rel)` maps a path relative to `root` (always with
 * forward slashes) to the module it is aggregated under.
 */
export const AREAS = [
  { id: 'api', root: 'apps/api/src', module: firstSegment },
  { id: 'api-test', root: 'apps/api/test', module: firstSegment },
  { id: 'web', root: 'apps/web/src', module: webModule },
  { id: 'cli', root: 'apps/cli/src', module: firstSegment },
  { id: 'prisma', root: 'apps/api/prisma', module: prismaModule },
  { id: 'infra', root: 'infra', module: firstSegment },
  { id: 'stack-agent', root: 'apps/stack-agent/src', module: firstSegment },
  { id: 'android', root: 'apps/android', module: firstSegment },
  { id: 'packages', root: 'packages', module: firstSegment },
  { id: 'scripts', root: 'scripts', module: firstSegment },
  { id: 'github', root: '.github', module: firstSegment },
];

export const AREA_IDS = AREAS.map((a) => a.id);

const ROOT_MODULE = '(root)';

/** First path segment; a file directly under the area root is module `(root)`. */
function firstSegment(rel) {
  const parts = rel.split('/');
  return parts.length > 1 ? parts[0] : ROOT_MODULE;
}

/** `components/<x>` and `pages/<x>` are modules of their own; otherwise first segment. */
function webModule(rel) {
  const parts = rel.split('/');
  if ((parts[0] === 'components' || parts[0] === 'pages') && parts.length > 2) {
    return `${parts[0]}/${parts[1]}`;
  }
  return firstSegment(rel);
}

/** `schema.prisma` (and a multi-file `schema/`), `migrations`, `seed`. */
function prismaModule(rel) {
  const parts = rel.split('/');
  if (parts[0] === 'schema.prisma' || (parts[0] === 'schema' && parts.length > 1)) return 'schema.prisma';
  if (parts[0] === 'migrations') return 'migrations';
  if (/^seed([.-]|$)/.test(parts[0])) return 'seed';
  return firstSegment(rel);
}

// Directory names never walked, wherever they appear.
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', 'coverage', '.turbo', 'worktrees', '.git',
  // Android/Gradle and Python build state: machine-local, never authored.
  '.gradle', '.cxx', '.idea', '__pycache__',
]);

/** Files never compared: build metadata and git-ignored local env files (they can hold secrets). */
function skipFile(name) {
  if (name.endsWith('.tsbuildinfo')) return true;
  if (/^\.env(\..+)?$/.test(name) && !name.endsWith('.example')) return true;
  return false;
}

/** Every file under `dir`, as sorted forward-slash paths relative to `dir`. Symlinks are not followed. */
export function walk(dir) {
  const out = [];
  const visit = (abs, rel) => {
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) visit(join(abs, entry.name), childRel);
      } else if (entry.isFile() && !skipFile(entry.name)) {
        out.push(childRel);
      }
    }
  };
  visit(dir, '');
  return out.sort(compareStrings);
}

/** Locale-independent ordering, so two runs on two machines sort identically. */
function compareStrings(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

// =============================================================================
// Identity resolution and the replacement table
// =============================================================================

/** The placeholders, in table order. Each maps one identity variant on both sides. */
export const PLACEHOLDERS = [
  ['__PRODUCT__', 'productName'],
  ['__SLUG__', 'slug'],
  // The slug with underscores: the test database name (`<slug>_test`) and
  // other Postgres identifiers, which cannot carry a hyphen unquoted.
  ['__SLUG_SNAKE__', 'slugSnake'],
  ['__SERVICE__', 'serviceName'],
  ['__REPO_SLUG__', 'repoSlug'],
  ['__REPO_NAME__', 'repoName'],
  ['__CLI__', 'cliName'],
  ['__CLI_UPPER__', 'cliUpper'],
  ['__CLI_TITLE__', 'cliTitle'],
];

/**
 * Read one repository's identity: `packages/shared/identity.json` and the
 * first `bin` key of `apps/cli/package.json`, each overridable by a flag.
 * A value that cannot be found is `null`, and its placeholder is not applied.
 */
export function readIdentity(root, overrides = {}) {
  const manifest = readJson(join(root, 'packages', 'shared', 'identity.json'));
  const cliPkg = readJson(join(root, 'apps', 'cli', 'package.json'));
  const binKey = cliPkg && cliPkg.bin && typeof cliPkg.bin === 'object' ? Object.keys(cliPkg.bin)[0] : undefined;
  const raw = {
    productName: overrides.productName ?? manifest?.productName ?? null,
    repoSlug: overrides.repoSlug ?? manifest?.repoSlug ?? null,
    cliName: overrides.cliName ?? binKey ?? null,
  };
  return deriveIdentity(raw);
}

/** Expand {productName, repoSlug, cliName} into every variant, via rename.mjs's own `derive`. */
export function deriveIdentity({ productName, repoSlug, cliName }) {
  const hasName = typeof productName === 'string' && productName.trim() !== '';
  const hasRepo = typeof repoSlug === 'string' && /^[^/]+\/[^/]+$/.test(repoSlug);
  const hasCli = typeof cliName === 'string' && cliName !== '';
  const d = derive({ productName: hasName ? productName : 'x', repoSlug: hasRepo ? repoSlug : 'x/x' }, cliName);
  return {
    productName: hasName ? productName : null,
    slug: hasName ? d.slug : null,
    slugSnake: hasName ? d.slug.replace(/-/g, '_') : null,
    serviceName: hasName ? d.serviceName : null,
    repoSlug: hasRepo ? repoSlug : null,
    repoName: hasRepo ? d.repoName : null,
    cliName: hasCli ? cliName.toLowerCase() : null,
    // Same rule as toEnvPrefix() in apps/cli/src/branding.ts, without the `_`.
    cliUpper: hasCli ? cliName.toUpperCase().replace(/[^A-Z0-9]/g, '_') : null,
    cliTitle: hasCli ? cliName.charAt(0).toUpperCase() + cliName.slice(1).toLowerCase() : null,
  };
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Build the replacement table: one row per placeholder, with the base and app
 * values it stands for. A row whose value is unknown on either side carries
 * `applied: false` and is shown but not used.
 *
 * The table is applied SYMMETRICALLY: every base value and every app value is
 * replaced on BOTH sides. A fork that kept a base literal (a test fixture that
 * still says the base's repository name, a do-not-rename sentinel that still
 * carries the base CLI name) is then still equal to the base on that line,
 * instead of differing only because one side's copy was replaced.
 *
 * Placeholders that share a value anywhere are merged into one token (the
 * earliest in table order). Without that, a fork whose slug and repository
 * name are both `acme` would turn every `acme` into one token while the base
 * turns its two different values into two, and every such line would read as
 * modified.
 */
export function buildReplacements(baseIdentity, appIdentity) {
  const rows = PLACEHOLDERS.map(([placeholder, key]) => ({
    placeholder,
    base: baseIdentity[key] ?? null,
    app: appIdentity[key] ?? null,
  }));
  const applied = rows.filter((r) => r.base !== null && r.app !== null);

  // Union-find over placeholders that share a value in either column.
  const parent = new Map(applied.map((r) => [r.placeholder, r.placeholder]));
  const find = (p) => (parent.get(p) === p ? p : find(parent.get(p)));
  const owner = new Map();
  for (const r of applied) {
    for (const value of [r.base, r.app]) {
      const other = owner.get(value);
      if (other) parent.set(find(r.placeholder), find(other));
      else owner.set(value, r.placeholder);
    }
  }
  const order = PLACEHOLDERS.map(([p]) => p);
  const token = (p) => order.find((q) => parent.has(q) && find(q) === find(p));

  return rows.map((r) => {
    const isApplied = r.base !== null && r.app !== null;
    return { placeholder: r.placeholder, base: r.base, app: r.app, applied: isApplied,
      token: isApplied ? token(r.placeholder) : null };
  });
}

const replacerCache = new WeakMap();

/**
 * Replace every identity value in the table (base and app columns alike) with
 * its token. Longest value first (the alternation is ordered), and only on a
 * boundary that is not a letter or digit: `appctl` does not eat `appctlx`, but
 * the env prefix in `APPCTL_TOKEN` IS replaced (an underscore is a boundary
 * here, unlike `\b`). Case-sensitive, on purpose: each case variant is its
 * own row.
 */
export function applyReplacements(text, table) {
  if (!table || table.length === 0) return text;
  let r = replacerCache.get(table);
  if (r === undefined) {
    const map = new Map();
    for (const row of table) {
      if (!row.applied) continue;
      for (const value of [row.base, row.app]) if (value && !map.has(value)) map.set(value, row.token);
    }
    const values = [...map.keys()].sort((a, b) => b.length - a.length || compareStrings(a, b));
    r = values.length === 0
      ? null
      : { re: new RegExp(`(?<![A-Za-z0-9])(?:${values.map(escapeRegExp).join('|')})(?![A-Za-z0-9])`, 'g'), map };
    replacerCache.set(table, r);
  }
  return r ? text.replace(r.re, (m) => r.map.get(m)) : text;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// =============================================================================
// Normalisation
// =============================================================================

let tsModule;

/**
 * The TypeScript compiler, resolved from this repository's root (installed by
 * `npm ci` through the workspaces). Throws a TypeScriptMissingError when it
 * cannot be found; main() turns that into exit 2.
 */
export function loadTypeScript() {
  if (tsModule) return tsModule;
  const require = createRequire(join(REPO_ROOT, 'package.json'));
  try {
    tsModule = require('typescript');
  } catch {
    throw new TypeScriptMissingError();
  }
  return tsModule;
}

export class TypeScriptMissingError extends Error {
  constructor() {
    super(`cannot resolve the "typescript" package from ${REPO_ROOT}: run npm ci first.`);
    this.name = 'TypeScriptMissingError';
  }
}

const CODE_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.jsx']);

/**
 * Remove every comment from a TypeScript/JavaScript source.
 *
 * Uses the TypeScript PARSER (which drives `ts.createScanner` with trivia
 * kept) rather than a bare scanner pass: a bare scanner cannot tell a
 * regular-expression literal from a division, or where a template literal's
 * `${...}` ends, or JSX text from code, without the parse context; the parser
 * knows all three. The comments are then the trailing and leading comment
 * ranges in front of each token, exactly what the scanner reports as
 * `SingleLineCommentTrivia` and `MultiLineCommentTrivia`. A `//` inside a
 * string, a template literal or JSX text is never touched. A JSX comment
 * `{/* x *\/}` becomes `{}`.
 */
export function stripCodeComments(text, ext = '.ts') {
  const ts = loadTypeScript();
  const scriptKind = {
    '.tsx': ts.ScriptKind.TSX,
    '.jsx': ts.ScriptKind.JSX,
    '.js': ts.ScriptKind.JS,
    '.mjs': ts.ScriptKind.JS,
    '.cjs': ts.ScriptKind.JS,
  }[ext] ?? ts.ScriptKind.TS;
  const sf = ts.createSourceFile(`file${ext}`, text, ts.ScriptTarget.Latest, false, scriptKind);
  const starts = new Set();
  const ranges = [];
  // Trailing ranges are the comments on the same line as the previous token
  // (`x; // why`); leading ranges are the ones after the first newline.
  const collect = (pos) => {
    const found = [...(ts.getTrailingCommentRanges(text, pos) ?? []), ...(ts.getLeadingCommentRanges(text, pos) ?? [])];
    for (const range of found) {
      if (!starts.has(range.pos)) {
        starts.add(range.pos);
        ranges.push(range);
      }
    }
  };
  const isJsDoc = (n) => n.kind >= ts.SyntaxKind.FirstJSDocNode && n.kind <= ts.SyntaxKind.LastJSDocNode;
  const visit = (node) => {
    if (isJsDoc(node)) return; // a JSDoc node IS a comment; its range is collected from the next token
    const children = node.getChildren(sf);
    if (children.length === 0) {
      // JSX text has no trivia: `<a>// x</a>` is text, not a comment.
      if (node.kind !== ts.SyntaxKind.JsxText && node.kind !== ts.SyntaxKind.JsxTextAllWhiteSpaces) {
        collect(node.pos);
      }
      return;
    }
    for (const child of children) visit(child);
  };
  visit(sf);
  if (ranges.length === 0) return text;
  ranges.sort((a, b) => a.pos - b.pos);
  let out = '';
  let last = 0;
  for (const range of ranges) {
    if (range.pos < last) continue;
    out += text.slice(last, range.pos);
    last = range.end;
  }
  return out + text.slice(last);
}

/** Which comment syntax a non-code file uses, by name. `null`: compare as text. */
export function commentStyle(fileName) {
  const name = basename(fileName);
  const ext = extname(name).toLowerCase();
  if (CODE_EXTS.has(ext)) return 'code';
  if (ext === '.prisma') return 'slash';
  if (ext === '.sql') return 'sql';
  if (['.kt', '.kts', '.java', '.gradle', '.scss'].includes(ext)) return 'c';
  if (ext === '.css') return 'block';
  if (name === 'Dockerfile' || name.startsWith('Dockerfile.') || name.endsWith('.Dockerfile')) return 'hash';
  if (name.endsWith('.env.example') || name === '.gitignore' || name === '.dockerignore') return 'hash';
  if (['.yml', '.yaml', '.sh', '.bash', '.conf', '.toml', '.properties', '.ps1', '.py', '.template'].includes(ext)) {
    return 'hash';
  }
  return null;
}

/**
 * Quote-aware comment stripping for non-code text, one state machine for all
 * styles:
 *
 *   hash   `#` at line start or after whitespace (yaml, shell, nginx, env, Dockerfile)
 *   slash  `//` (Prisma, including `///` doc comments)
 *   sql    `--` and block comments
 *   c      `//` and block comments (Kotlin, Java, Gradle, SCSS)
 *   block  block comments only (CSS, where `//` appears in URLs)
 *
 * A marker inside single or double quotes is never a comment. Quotes do not
 * span lines except inside a block comment, which does.
 */
export function stripTextComments(text, style) {
  if (!style) return text;
  const lineComment = { hash: '#', slash: '//', sql: '--', c: '//', block: null }[style];
  const blocks = style === 'sql' || style === 'c' || style === 'block';
  let out = '';
  let inBlock = false;
  for (const line of text.split('\n')) {
    let kept = '';
    let quote = null;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inBlock) {
        if (ch === '*' && line[i + 1] === '/') {
          inBlock = false;
          i++;
        }
        continue;
      }
      if (quote) {
        kept += ch;
        if (ch === '\\' && style !== 'sql') {
          if (i + 1 < line.length) kept += line[++i];
        } else if (ch === quote) {
          quote = null;
        }
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        kept += ch;
        continue;
      }
      if (blocks && ch === '/' && line[i + 1] === '*') {
        inBlock = true;
        i++;
        continue;
      }
      if (lineComment && line.startsWith(lineComment, i)) {
        if (style !== 'hash' || i === 0 || /\s/.test(line[i - 1])) break;
      }
      kept += ch;
    }
    out += `${kept}\n`;
  }
  return out.slice(0, -1);
}

/**
 * Whitespace normalisation shared by every text file: `\r\n` to `\n`, each
 * line trimmed (indentation and trailing whitespace ignored), and blank lines
 * dropped. Dropping, not just collapsing: removing a comment leaves a blank
 * line where the other side may have none. Markdown keeps one blank line per
 * run, because there it separates paragraphs.
 */
export function normaliseWhitespace(text, { keepBlankRuns = false } = {}) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim());
  const out = [];
  for (const line of lines) {
    if (line === '') {
      if (keepBlankRuns && out.length > 0 && out[out.length - 1] !== '') out.push('');
      continue;
    }
    out.push(line);
  }
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}

/**
 * Issue references outside comments: `(#598)` in a test name, `issue 600` in
 * a log message. Each repository numbers its own issues, so a fork's copy of
 * a base test reads `(#123)` where the base reads `(#598)`; that is the same
 * noise the comments carry, inside a string. A `#<digits>` counts only after
 * whitespace, an opening bracket or a quote AND before whitespace, a closing
 * bracket or `,.:` (so `'#123456'`, a colour inside quotes, is untouched);
 * so do digits after the word issue/issues/epic/PR.
 * Applied to code and Markdown only, never to CSS or YAML, where `#123` can
 * be a colour or a comment marker that was already handled.
 */
export function normaliseIssueRefs(text) {
  return text
    .replace(/(?<=^|[\s([{'"`])#\d{1,6}(?=$|[\s)\],.:])/gm, '#__ISSUE__')
    .replace(/\b(issues?|epic|PR) #?\d{1,6}(?![0-9A-Za-z])/gi, '$1 #__ISSUE__');
}

/**
 * Normalise a code file: comments removed with the TypeScript parser, issue
 * references and identity values replaced (see normaliseIssueRefs and
 * applyReplacements), whitespace normalised.
 */
export function normaliseCode(text, ext = '.ts', table = []) {
  const stripped = stripCodeComments(text.replace(/\r\n?/g, '\n'), ext);
  return normaliseWhitespace(applyReplacements(normaliseIssueRefs(stripped), table));
}

/** Normalise any text file by name: code goes through normaliseCode, the rest by comment style. */
export function normaliseText(text, fileName, table = []) {
  const style = commentStyle(fileName);
  if (style === 'code') return normaliseCode(text, extname(fileName).toLowerCase(), table);
  const isMarkdown = extname(fileName).toLowerCase() === '.md';
  let stripped = stripTextComments(text.replace(/\r\n?/g, '\n'), style);
  if (isMarkdown) stripped = normaliseIssueRefs(stripped);
  return normaliseWhitespace(applyReplacements(stripped, table), { keepBlankRuns: isMarkdown });
}

// =============================================================================
// Line diff (Myers O(ND), counts only)
// =============================================================================

/**
 * Lines removed from `a` and added in `b`, from the length of a shortest
 * edit script (Myers 1986, forward pass only: O((N+M)D) time, O(N+M) memory).
 * Lines are interned to integers first, so the inner loop compares numbers.
 */
export function lineDiff(aLines, bLines) {
  const ids = new Map();
  const intern = (line) => {
    let id = ids.get(line);
    if (id === undefined) {
      id = ids.size;
      ids.set(line, id);
    }
    return id;
  };
  const a = Int32Array.from(aLines, intern);
  const b = Int32Array.from(bLines, intern);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const n = endA - start;
  const m = endB - start;
  if (n === 0 || m === 0) return { linesAdded: m, linesRemoved: n };

  const max = n + m;
  const v = new Int32Array(2 * max + 2);
  const off = max;
  let d = 0;
  outer: for (; d <= max; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[start + x] === b[start + y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) break outer;
    }
  }
  // d = removed + added, and n - removed = m - added (both equal the LCS).
  const lcs = (n + m - d) / 2;
  return { linesAdded: m - lcs, linesRemoved: n - lcs };
}

// =============================================================================
// Per-file classification
// =============================================================================

function isBinary(buf) {
  return buf.subarray(0, 8192).includes(0);
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Classify one path. `baseBuf`/`appBuf` are Buffers (or strings), `null` when
 * the file does not exist on that side. Returns
 * `{ status, linesAdded?, linesRemoved?, diffSkipped?, binary? }`.
 */
export function classify(baseBuf, appBuf, fileName, table = []) {
  if (baseBuf == null && appBuf == null) throw new Error(`classify: ${fileName} exists on neither side`);
  if (appBuf == null) return { status: 'base-only' };
  if (baseBuf == null) return { status: 'app-only' };
  const a = Buffer.isBuffer(baseBuf) ? baseBuf : Buffer.from(baseBuf);
  const b = Buffer.isBuffer(appBuf) ? appBuf : Buffer.from(appBuf);
  if (a.equals(b)) return { status: 'identical' };
  if (isBinary(a) || isBinary(b)) {
    // Binaries are compared by hash only, and they already differ as bytes.
    return { status: 'modified', linesAdded: null, linesRemoved: null, binary: true };
  }
  const na = normaliseText(a.toString('utf8'), fileName, table);
  const nb = normaliseText(b.toString('utf8'), fileName, table);
  if (na === nb) return { status: 'normalised-identical' };
  const la = na === '' ? [] : na.split('\n');
  const lb = nb === '' ? [] : nb.split('\n');
  if (la.length > DIFF_LINE_CAP || lb.length > DIFF_LINE_CAP) {
    return { status: 'modified', linesAdded: null, linesRemoved: null, diffSkipped: true };
  }
  return { status: 'modified', ...lineDiff(la, lb) };
}

// =============================================================================
// Aggregation
// =============================================================================

function emptySummary() {
  return { files: 0, identical: 0, normalisedIdentical: 0, modified: 0, baseOnly: 0, appOnly: 0,
    linesAdded: 0, linesRemoved: 0, identicalPercent: null };
}

const STATUS_FIELD = {
  identical: 'identical',
  'normalised-identical': 'normalisedIdentical',
  modified: 'modified',
  'base-only': 'baseOnly',
  'app-only': 'appOnly',
};

function addToSummary(summary, file) {
  summary.files++;
  summary[STATUS_FIELD[file.status]]++;
  if (typeof file.linesAdded === 'number') summary.linesAdded += file.linesAdded;
  if (typeof file.linesRemoved === 'number') summary.linesRemoved += file.linesRemoved;
}

/**
 * identical + normalised-identical, over every base file (files on both sides
 * plus base-only): the base is the denominator, as in the spec's "API files
 * identical to base (of 917)". `null` when the base has no file there.
 */
function finishSummary(summary) {
  const same = summary.identical + summary.normalisedIdentical;
  const denominator = same + summary.modified + summary.baseOnly;
  summary.identicalPercent = denominator === 0 ? null : Math.round((same / denominator) * 1000) / 10;
  return summary;
}

/** Area and module summaries for a list of file entries (already sorted). */
export function summarise(files) {
  const areas = {};
  const modules = new Map();
  for (const file of files) {
    areas[file.area] ??= emptySummary();
    addToSummary(areas[file.area], file);
    const key = `${file.area}\0${file.module}`;
    if (!modules.has(key)) modules.set(key, { area: file.area, module: file.module, ...emptySummary() });
    addToSummary(modules.get(key), file);
  }
  for (const s of Object.values(areas)) finishSummary(s);
  for (const s of modules.values()) finishSummary(s);
  const areaOrder = (id) => {
    const i = AREA_IDS.indexOf(id);
    return i === -1 ? AREA_IDS.length : i;
  };
  return {
    areas,
    modules: [...modules.values()].sort(
      (x, y) => areaOrder(x.area) - areaOrder(y.area) || compareStrings(x.module, y.module),
    ),
  };
}

// =============================================================================
// Migrations
// =============================================================================

const MIGRATION_ID = /^(\d{14})_(.+)$/;

/** The part of a migration id after its 14-digit timestamp (the whole id when it has none). */
export function migrationSuffix(id) {
  const m = MIGRATION_ID.exec(id);
  return m ? m[2] : id;
}

/** Every `migrations/<id>/migration.sql` under a Prisma directory, as sorted `{ id, sql }`. */
export function readMigrations(prismaDir) {
  const dir = join(prismaDir, 'migrations');
  if (!isDirectory(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const buf = readOrNull(join(dir, entry.name, 'migration.sql'));
    if (buf !== null) out.push({ id: entry.name, sql: buf.toString('utf8') });
  }
  return out.sort((a, b) => compareStrings(a.id, b.id));
}

/**
 * Match two migration histories. `base` and `app` are `{ id, sql }` lists.
 *
 * Normalised SQL hash first, then the name suffix:
 *
 *   shared                   same id, same SQL
 *   renamed                  same SQL, different id (the same change under another timestamp)
 *   same-name-different-sql  same suffix (or id), different SQL
 *   base-only / app-only     no match on the other side
 *
 * Greedy and deterministic: candidates are always taken in id order.
 */
export function matchMigrations(base, app, table = []) {
  const hashOf = (m) => sha256(normaliseText(m.sql, 'migration.sql', table));
  const b = [...base].sort((x, y) => compareStrings(x.id, y.id)).map((m) => ({ ...m, hash: hashOf(m), used: false }));
  const a = [...app].sort((x, y) => compareStrings(x.id, y.id)).map((m) => ({ ...m, hash: hashOf(m), used: false }));
  const entries = [];
  const pair = (status, bm, am) => {
    if (bm) bm.used = true;
    if (am) am.used = true;
    entries.push({ status, base: bm ? bm.id : null, app: am ? am.id : null });
  };
  // 1. Same id, same SQL.
  for (const bm of b) {
    const am = a.find((x) => !x.used && x.id === bm.id && x.hash === bm.hash);
    if (am) pair('shared', bm, am);
  }
  // 2. Same SQL under a different id.
  for (const bm of b) {
    if (bm.used) continue;
    const am = a.find((x) => !x.used && x.hash === bm.hash);
    if (am) pair('renamed', bm, am);
  }
  // 3. Same id, then same suffix, with different SQL.
  for (const bm of b) {
    if (bm.used) continue;
    const am = a.find((x) => !x.used && x.id === bm.id)
      ?? a.find((x) => !x.used && migrationSuffix(x.id) === migrationSuffix(bm.id));
    if (am) pair('same-name-different-sql', bm, am);
  }
  for (const bm of b) if (!bm.used) pair('base-only', bm, null);
  for (const am of a) if (!am.used) pair('app-only', null, am);

  const statusOrder = ['shared', 'renamed', 'same-name-different-sql', 'base-only', 'app-only'];
  entries.sort((x, y) => statusOrder.indexOf(x.status) - statusOrder.indexOf(y.status)
    || compareStrings(x.base ?? '', y.base ?? '') || compareStrings(x.app ?? '', y.app ?? ''));
  const count = (status) => entries.filter((e) => e.status === status).length;
  return {
    base: base.length,
    app: app.length,
    shared: count('shared'),
    renamed: count('renamed'),
    sameNameDifferentSql: count('same-name-different-sql'),
    baseOnly: count('base-only'),
    appOnly: count('app-only'),
    entries,
  };
}

// =============================================================================
// Prisma models
// =============================================================================

/**
 * Model names and their field names from one Prisma schema text, as an
 * object with sorted keys: `{ User: ['email', 'id', ...], ... }`. Comments
 * are stripped first; `@@` block attributes are not fields.
 */
export function parsePrismaModels(text) {
  const lines = stripTextComments(text.replace(/\r\n?/g, '\n'), 'slash').split('\n');
  const models = {};
  let current = null;
  for (const line of lines) {
    if (current === null) {
      const m = /^model (\w+) \{/.exec(line);
      if (m) {
        current = m[1];
        models[current] ??= [];
      }
      continue;
    }
    if (/^\}/.test(line)) {
      current = null;
      continue;
    }
    if (/^\s*@@/.test(line)) continue;
    const f = /^\s+(\w+)\s+\S+/.exec(line);
    if (f && !models[current].includes(f[1])) models[current].push(f[1]);
  }
  const sorted = {};
  for (const name of Object.keys(models).sort(compareStrings)) sorted[name] = models[name].sort(compareStrings);
  return sorted;
}

/** Every model in `schema.prisma` and in each `*.prisma` under `schema/` (a multi-file schema). */
export function readPrismaModels(prismaDir) {
  const texts = [];
  const single = readOrNull(join(prismaDir, 'schema.prisma'));
  if (single !== null) texts.push(single.toString('utf8'));
  const multi = join(prismaDir, 'schema');
  if (isDirectory(multi)) {
    for (const rel of walk(multi)) {
      if (rel.endsWith('.prisma')) texts.push(readFileSync(join(multi, rel), 'utf8'));
    }
  }
  const merged = {};
  for (const text of texts) {
    for (const [model, fields] of Object.entries(parsePrismaModels(text))) {
      merged[model] = [...new Set([...(merged[model] ?? []), ...fields])].sort(compareStrings);
    }
  }
  const sorted = {};
  for (const name of Object.keys(merged).sort(compareStrings)) sorted[name] = merged[name];
  return sorted;
}

/** Compare two `parsePrismaModels` results. */
export function compareModels(base, app) {
  const baseNames = Object.keys(base).sort(compareStrings);
  const appNames = Object.keys(app).sort(compareStrings);
  const presentInApp = baseNames.filter((n) => n in app);
  const changed = [];
  for (const name of presentInApp) {
    const addedFields = app[name].filter((f) => !base[name].includes(f));
    const removedFields = base[name].filter((f) => !app[name].includes(f));
    if (addedFields.length > 0 || removedFields.length > 0) changed.push({ model: name, addedFields, removedFields });
  }
  return {
    base: baseNames.length,
    app: appNames.length,
    presentInApp,
    missingFromApp: baseNames.filter((n) => !(n in app)),
    appOnly: appNames.filter((n) => !(n in base)),
    changed,
  };
}

// =============================================================================
// Building the report
// =============================================================================

function gitCommit(root) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

function readOrNull(path) {
  try {
    return readFileSync(path);
  } catch {
    return null;
  }
}

/**
 * Compare two repositories. Pure apart from reading both trees (and asking git
 * for each HEAD); main() handles arguments and output.
 *
 * opts: { baseRoot, appRoot, areas?: string[], baseIdentity?, appIdentity?, now?: Date }
 */
export function buildReport(opts) {
  const baseRoot = resolve(opts.baseRoot);
  const appRoot = resolve(opts.appRoot);
  const baseIdentity = opts.baseIdentity ?? readIdentity(baseRoot);
  const appIdentity = opts.appIdentity ?? readIdentity(appRoot);
  const table = buildReplacements(baseIdentity, appIdentity);
  const wanted = opts.areas ?? AREA_IDS;

  const files = [];
  const areaPresence = {};
  for (const area of AREAS) {
    if (!wanted.includes(area.id)) continue;
    const baseDir = join(baseRoot, area.root);
    const appDir = join(appRoot, area.root);
    const inBase = isDirectory(baseDir);
    const inApp = isDirectory(appDir);
    if (!inBase && !inApp) continue; // absent on both sides: not part of this report
    areaPresence[area.id] = { root: area.root, inBase, inApp };
    const baseFiles = inBase ? walk(baseDir) : [];
    const appFiles = inApp ? walk(appDir) : [];
    const all = [...new Set([...baseFiles, ...appFiles])].sort(compareStrings);
    for (const rel of all) {
      const result = classify(readOrNull(join(baseDir, rel)), readOrNull(join(appDir, rel)), rel, table);
      files.push({ area: area.id, module: area.module(rel), path: `${area.root}/${rel}`, ...result });
    }
  }
  const areaOrder = (id) => AREA_IDS.indexOf(id);
  files.sort((x, y) => areaOrder(x.area) - areaOrder(y.area) || compareStrings(x.module, y.module) || compareStrings(x.path, y.path));

  const { areas, modules } = summarise(files);
  for (const [id, presence] of Object.entries(areaPresence)) {
    areas[id] = { ...(areas[id] ?? finishSummary(emptySummary())), ...presence };
  }
  const orderedAreas = {};
  for (const id of AREA_IDS) if (areas[id]) orderedAreas[id] = areas[id];

  const wantsPrisma = wanted.includes('prisma');
  const baseRootPrisma = join(baseRoot, 'apps', 'api', 'prisma');
  const appRootPrisma = join(appRoot, 'apps', 'api', 'prisma');

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: (opts.now ?? new Date()).toISOString(),
    base: { root: baseRoot, commit: gitCommit(baseRoot), identity: baseIdentity },
    app: { root: appRoot, commit: gitCommit(appRoot), identity: appIdentity },
    replacements: table.map(({ placeholder, base, app, applied, token }) => ({ placeholder, base, app, applied, token })),
    areas: orderedAreas,
    modules,
    files,
    migrations: wantsPrisma
      ? matchMigrations(readMigrations(baseRootPrisma), readMigrations(appRootPrisma), table)
      : null,
    prismaModels: wantsPrisma
      ? compareModels(readPrismaModels(baseRootPrisma), readPrismaModels(appRootPrisma))
      : null,
  };
}

// =============================================================================
// Markdown
// =============================================================================

function pct(value) {
  return value === null ? 'n/a' : `${value}%`;
}

function cell(value) {
  return value === null || value === undefined ? '(unknown)' : `\`${String(value).replace(/\|/g, '\\|')}\``;
}

function lines(file) {
  if (file.binary) return 'binary';
  if (file.diffSkipped) return 'too large to diff';
  return `+${file.linesAdded} / -${file.linesRemoved}`;
}

/** Render the Markdown report. `maxModified` bounds the "most changed files" table. */
export function renderMarkdown(report, { maxModified = 50 } = {}) {
  const out = [];
  const p = (s = '') => out.push(s);
  p('# Platform drift report');
  p();
  p(`Generated ${report.generatedAt} by \`scripts/platform-drift.mjs\` (schema ${report.schemaVersion}).`);
  p();
  p('| | Root | Commit |');
  p('|---|---|---|');
  p(`| Base | \`${report.base.root}\` | ${report.base.commit ? `\`${report.base.commit}\`` : 'not a git checkout'} |`);
  p(`| App | \`${report.app.root}\` | ${report.app.commit ? `\`${report.app.commit}\`` : 'not a git checkout'} |`);
  p();
  p('## Identity replacements');
  p();
  p('Every value in this table, base or app, is replaced by its token on both sides before comparing, so these differences are ignored. ' +
    'A row marked "no" is unknown on one side and was not applied (pass the `--base-*`/`--app-*` flags).');
  p();
  p('| Placeholder | Base | App | Applied as |');
  p('|---|---|---|---|');
  for (const r of report.replacements) {
    p(`| \`${r.placeholder}\` | ${cell(r.base)} | ${cell(r.app)} | ${r.applied ? `\`${r.token}\`` : 'no'} |`);
  }
  p();
  p('## Areas');
  p();
  p('"Identical" counts identical plus normalised-identical files over every base file in the area ' +
    '(present on both sides, or base-only).');
  p();
  p('| Area | Root | Base files | Identical | Normalised-identical | Modified | Base-only | App-only | Lines +/- | Identical to base |');
  p('|---|---|---|---|---|---|---|---|---|---|');
  for (const [id, a] of Object.entries(report.areas)) {
    const baseFiles = a.identical + a.normalisedIdentical + a.modified + a.baseOnly;
    const root = `\`${a.root}\`${a.inBase ? '' : ' (not in base)'}${a.inApp ? '' : ' (not in app)'}`;
    p(`| ${id} | ${root} | ${baseFiles} | ${a.identical} | ${a.normalisedIdentical} | ${a.modified} | ${a.baseOnly} | ${a.appOnly} | +${a.linesAdded} / -${a.linesRemoved} | ${pct(a.identicalPercent)} |`);
  }
  p();
  p('## Modules by changed lines');
  p();
  const changed = report.modules
    .filter((m) => m.modified + m.baseOnly + m.appOnly > 0)
    .sort((x, y) => (y.linesAdded + y.linesRemoved) - (x.linesAdded + x.linesRemoved)
      || y.modified - x.modified || compareStrings(x.area, y.area) || compareStrings(x.module, y.module));
  if (changed.length === 0) {
    p('No module has drifted.');
  } else {
    p('| Area | Module | Files | Modified | Base-only | App-only | Lines +/- | Identical to base |');
    p('|---|---|---|---|---|---|---|---|');
    for (const m of changed) {
      p(`| ${m.area} | \`${m.module}\` | ${m.files} | ${m.modified} | ${m.baseOnly} | ${m.appOnly} | +${m.linesAdded} / -${m.linesRemoved} | ${pct(m.identicalPercent)} |`);
    }
  }
  p();
  p(`## Most changed files (top ${maxModified})`);
  p();
  const modified = report.files
    .filter((f) => f.status === 'modified')
    .sort((x, y) => ((y.linesAdded ?? 0) + (y.linesRemoved ?? 0)) - ((x.linesAdded ?? 0) + (x.linesRemoved ?? 0))
      || compareStrings(x.path, y.path))
    .slice(0, maxModified);
  if (modified.length === 0) {
    p('No file differs after normalisation.');
  } else {
    p('| File | Lines +/- |');
    p('|---|---|');
    for (const f of modified) p(`| \`${f.path}\` | ${lines(f)} |`);
  }
  p();
  renderMigrations(report, p);
  renderPrismaModels(report, p);
  p('## Zero-drift modules');
  p();
  p('Modules where every file exists on both sides and is identical or normalised-identical: ' +
    'the candidates for early adoption.');
  p();
  const zero = report.modules.filter((m) => m.files > 0 && m.files === m.identical + m.normalisedIdentical);
  if (zero.length === 0) {
    p('None.');
  } else {
    for (const m of zero) p(`- ${m.area}: \`${m.module}\` (${m.files} files)`);
  }
  p();
  return out.join('\n');
}

function renderMigrations(report, p) {
  const m = report.migrations;
  if (!m) return;
  p('## Migrations');
  p();
  p('Matched by normalised SQL first, then by the name after the 14-digit timestamp.');
  p();
  p('| Base | App | Shared | Renamed | Same name, different SQL | Base-only | App-only |');
  p('|---|---|---|---|---|---|---|');
  p(`| ${m.base} | ${m.app} | ${m.shared} | ${m.renamed} | ${m.sameNameDifferentSql} | ${m.baseOnly} | ${m.appOnly} |`);
  p();
  const list = (title, status, render) => {
    const rows = m.entries.filter((e) => e.status === status);
    if (rows.length === 0) return;
    p(`${title}:`);
    p();
    for (const e of rows) p(`- ${render(e)}`);
    p();
  };
  list('Renamed (same SQL, different id)', 'renamed', (e) => `\`${e.base}\` is \`${e.app}\` in the app`);
  list('Same name, different SQL', 'same-name-different-sql', (e) => `\`${e.base}\` / \`${e.app}\``);
  list('Base-only', 'base-only', (e) => `\`${e.base}\``);
  list('App-only', 'app-only', (e) => `\`${e.app}\``);
}

function renderPrismaModels(report, p) {
  const m = report.prismaModels;
  if (!m) return;
  p('## Prisma models');
  p();
  p(`Base models present in the app: ${m.presentInApp.length} of ${m.base}. Total models in the app: ${m.app}.`);
  p();
  const names = (list) => (list.length === 0 ? 'none' : list.map((n) => `\`${n}\``).join(', '));
  p(`- Missing from the app: ${names(m.missingFromApp)}`);
  p(`- App-only: ${names(m.appOnly)}`);
  p();
  if (m.changed.length > 0) {
    p('Shared models whose fields differ:');
    p();
    p('| Model | Fields added in the app | Fields removed in the app |');
    p('|---|---|---|');
    for (const c of m.changed) p(`| \`${c.model}\` | ${names(c.addedFields)} | ${names(c.removedFields)} |`);
    p();
  }
}

// =============================================================================
// Argument parsing
// =============================================================================

const USAGE = `
Compare one consumer repository against this base and write a drift report.

  node scripts/platform-drift.mjs --app <path-to-consumer-repo> [options]

Options:
  --app <path>                 The consumer repository's root. Required.
  --base <path>                The base repository's root. Default: this repository.
  --out <dir>                  Output directory. Default: ./drift-report (git-ignored).
  --format json|md|both        Which reports to write. Default: both.
  --areas <a,b,...>            Areas to compare. Default: every area present on either side.
                               Known: ${AREA_IDS.join(', ')}
  --app-cli-name <name>        Override the consumer's CLI binary name.
  --app-product-name <name>    Override the consumer's product name.
  --app-repo-slug <owner/name> Override the consumer's repository slug.
  --base-cli-name <name>       Override the base's CLI binary name.
  --base-product-name <name>   Override the base's product name.
  --base-repo-slug <owner/name> Override the base's repository slug.
  --max-modified <n>           Rows in the "most changed files" table. Default: 50.
  -h, --help                   This message.

Identity is read from packages/shared/identity.json and the first "bin" key
of apps/cli/package.json on each side; the flags override it.
Exit codes: 0 report written (drift is data, not failure), 2 bad arguments,
unreadable paths, or the typescript package is missing (run npm ci first).
Runbook: docs/runbooks/platform-drift-report.md
`.trimStart();

export class UsageError extends Error {}

/** Parse argv into options. Throws UsageError; never exits. */
export function parseArgs(argv) {
  const opts = { format: 'both', maxModified: 50, base: REPO_ROOT, out: 'drift-report', app: undefined,
    areas: undefined, appIdentity: {}, baseIdentity: {} };
  const identityFlags = {
    '--app-cli-name': ['appIdentity', 'cliName'],
    '--app-product-name': ['appIdentity', 'productName'],
    '--app-repo-slug': ['appIdentity', 'repoSlug'],
    '--base-cli-name': ['baseIdentity', 'cliName'],
    '--base-product-name': ['baseIdentity', 'productName'],
    '--base-repo-slug': ['baseIdentity', 'repoSlug'],
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') return { help: true };
    const known = ['--app', '--base', '--out', '--format', '--areas', '--max-modified', ...Object.keys(identityFlags)];
    if (!known.includes(arg)) throw new UsageError(`Unknown argument: ${arg}\n\n${USAGE}`);
    const value = argv[++i];
    if (value === undefined || value.startsWith('--')) throw new UsageError(`${arg} needs a value.`);
    if (identityFlags[arg]) {
      const [side, key] = identityFlags[arg];
      if (key === 'repoSlug' && !/^[^/\s]+\/[^/\s]+$/.test(value)) {
        throw new UsageError(`${arg} must be owner/name, got: ${value}`);
      }
      if (value.trim() === '') throw new UsageError(`${arg} cannot be empty.`);
      opts[side][key] = value;
      continue;
    }
    switch (arg) {
      case '--app': opts.app = value; break;
      case '--base': opts.base = value; break;
      case '--out': opts.out = value; break;
      case '--format':
        if (!['json', 'md', 'both'].includes(value)) throw new UsageError(`--format must be json, md or both, got: ${value}`);
        opts.format = value;
        break;
      case '--areas': {
        const areas = value.split(',').map((s) => s.trim()).filter(Boolean);
        const unknown = areas.filter((a) => !AREA_IDS.includes(a));
        if (areas.length === 0 || unknown.length > 0) {
          throw new UsageError(`--areas: unknown area(s) ${unknown.join(', ') || '(none given)'}; known: ${AREA_IDS.join(', ')}`);
        }
        opts.areas = areas;
        break;
      }
      case '--max-modified': {
        if (!/^\d+$/.test(value)) throw new UsageError(`--max-modified must be a non-negative integer, got: ${value}`);
        opts.maxModified = Number(value);
        break;
      }
    }
  }
  if (opts.app === undefined) throw new UsageError(`--app is required.\n\n${USAGE}`);
  return opts;
}

function die(message) {
  console.error(`\nplatform-drift: ${message}\n`);
  process.exit(2);
}

// =============================================================================
// Main
// =============================================================================

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof UsageError) die(err.message);
    throw err;
  }
  if (opts.help) {
    console.log(USAGE);
    return;
  }
  for (const [flag, path] of [['--base', opts.base], ['--app', opts.app]]) {
    if (!isDirectory(path)) die(`${flag} ${path}: not a readable directory.`);
    try {
      readdirSync(path);
    } catch {
      die(`${flag} ${path}: not a readable directory.`);
    }
  }
  try {
    loadTypeScript();
  } catch (err) {
    if (err instanceof TypeScriptMissingError) die(err.message);
    throw err;
  }

  const baseRoot = resolve(opts.base);
  const appRoot = resolve(opts.app);
  const report = buildReport({
    baseRoot,
    appRoot,
    areas: opts.areas,
    baseIdentity: readIdentity(baseRoot, opts.baseIdentity),
    appIdentity: readIdentity(appRoot, opts.appIdentity),
  });

  const outDir = resolve(opts.out);
  try {
    mkdirSync(outDir, { recursive: true });
  } catch (err) {
    die(`--out ${opts.out}: cannot create the directory (${err.message}).`);
  }
  const written = [];
  if (opts.format !== 'md') {
    const path = join(outDir, 'drift-report.json');
    writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
    written.push(path);
  }
  if (opts.format !== 'json') {
    const path = join(outDir, 'drift-report.md');
    writeFileSync(path, renderMarkdown(report, { maxModified: opts.maxModified }));
    written.push(path);
  }

  console.log('');
  for (const [id, a] of Object.entries(report.areas)) {
    console.log(`  ${id.padEnd(12)} ${pct(a.identicalPercent).padStart(6)} identical to base` +
      `  (${a.modified} modified, ${a.baseOnly} base-only, ${a.appOnly} app-only)`);
  }
  console.log('');
  for (const path of written) console.log(`  wrote ${path}`);
  console.log('');
}

// Guarded so importing this module (apps/cli/src/platform-drift-script.test.ts
// does, to reach the pure functions) has no side effects. Same guard as
// scripts/rename.mjs, robust to Windows drive-letter and slash differences.
const isDirectExecution =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectExecution) {
  main();
}


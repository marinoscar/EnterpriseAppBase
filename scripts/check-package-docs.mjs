#!/usr/bin/env node
// Catalog-completeness checker for the platform packages (issue #693).
//
// The Package documentation standard (docs/specs/platform-packages.md;
// authoring guide docs/PACKAGES.md) says documentation drift is a failing
// build. TypeDoc (docs-api/api.json, written by `npm run docs:packages`)
// already fails on an export without TSDoc; this script checks what TypeDoc
// cannot:
//
//   1. Every packages/platform-*/README.md, and the README of every slice the
//      package exports as a subpath (`./<slice>` -> src/<slice>/README.md; a
//      nested `./<slice>/<part>` subpath is catalogued in the same README),
//      has the 15 level-2 headings of the README outline, in order, and no
//      section is empty (a section with nothing to say says `None.` and why).
//   2. Every exported symbol carries `@stability stable|experimental`.
//   3. Every symbol tagged `@extensionPoint <kind>` is a row of the
//      Extension-point catalog of the README of its entry point, and the row's
//      Kind and Stability match the tags; every catalog row names a tagged
//      exported symbol (no stale rows).
//   4. Every Example link of a catalog row resolves to an existing file of the
//      reference app (apps/, infra/ or tests/), never into packages/.
//   5. Every exported subpath is an entry point in the package's typedoc.json.
//
// Output: one `file:line problem` line per problem (paths relative to the
// root), exit 1 if there is any. `--json` prints a JSON array of
// { file, line, message } instead, for CI annotations. `--root <dir>` checks
// another tree (the tests point it at fixtures). Node built-ins only.
//
// Usage: node scripts/check-package-docs.mjs [--root <dir>] [--json]
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The README outline, in order (docs/specs/platform-packages.md -> README outline). */
export const HEADINGS = [
  'Purpose and scope',
  'Install and peer dependencies',
  'Quick start',
  'Configuration',
  'Extension-point catalog',
  'Data',
  'Permissions and settings',
  'UI',
  'Infra',
  'Observability',
  'Security notes',
  'Conformance suite',
  'Upgrade notes',
  'Troubleshooting',
  'Links',
];

export const CATALOG_HEADING = 'Extension-point catalog';
export const CATALOG_COLUMNS = ['Name', 'Kind', 'Signature', 'When to use', 'Stability', 'Example'];
export const KINDS = ['option', 'registry', 'token', 'event', 'slot', 'theme-token', 'overlay', 'hook', 'component', 'schema'];
export const STABILITIES = ['stable', 'experimental'];
/** Where an Example link may point: the reference app, never a package. */
export const EXAMPLE_ROOTS = ['apps/', 'infra/', 'tests/'];

// TypeDoc ReflectionKind values used below (typedoc/dist/lib/models/kind.js).
const KIND_MODULE = 2;
const KIND_CONSTRUCTOR = 512;
const KIND_REFERENCE = 4194304;

// -----------------------------------------------------------------------------
// Small helpers
// -----------------------------------------------------------------------------

const toPosix = (p) => p.split(sep).join('/');

/** Blank every fenced code block, keeping line numbers (same rule as apps/api/test/docs-links.spec.ts). */
function stripFences(lines) {
  let inFence = false;
  return lines.map((line) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      return '';
    }
    return inFence ? '' : line;
  });
}

/** JSON with `//` and `/* *\/` comments (TypeDoc options files allow them). */
function parseJsonc(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2) + 1;
      if (i === 0) break;
    } else {
      out += c;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

/** Split a Markdown table row on unescaped pipes. */
function cells(line) {
  const parts = [];
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\' && line[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (line[i] === '|') {
      parts.push(cur.trim());
      cur = '';
    } else {
      cur += line[i];
    }
  }
  parts.push(cur.trim());
  if (parts[0] === '') parts.shift();
  if (parts.at(-1) === '') parts.pop();
  return parts;
}

/** A catalog Name cell as a symbol name: `register()` -> register, [`X`](..) -> X. */
function normalizeName(cell) {
  const link = /^\[([^\]]*)\]\([^)]*\)$/.exec(cell);
  const text = link ? link[1] : cell;
  return text.replace(/`/g, '').replace(/\(\)$/, '').trim();
}

const LINK_PATTERN = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/** The text of a TSDoc block tag (`@stability stable` -> "stable"), or undefined. */
function tagValues(comment, tag) {
  return (comment?.blockTags ?? [])
    .filter((t) => t.tag === tag)
    .map((t) =>
      (t.content ?? [])
        .map((part) => part.text)
        .join('')
        .trim()
        .split(/\s+/)[0] ?? '',
    );
}

/** A declaration's comments: on the declaration, or on its (call/get/set) signatures. */
function commentsOf(decl) {
  const out = [];
  if (decl.comment) out.push(decl.comment);
  for (const sig of [...(decl.signatures ?? []), decl.getSignature, decl.setSignature]) {
    if (sig?.comment) out.push(sig.comment);
  }
  return out;
}

const sourceLine = (decl) =>
  decl.sources?.[0]?.line ?? decl.signatures?.[0]?.sources?.[0]?.line ?? decl.getSignature?.sources?.[0]?.line ?? 1;

// -----------------------------------------------------------------------------
// README structure
// -----------------------------------------------------------------------------

/**
 * Checks the outline of one README and returns its catalog rows.
 * @returns {{ catalogLine: number, rows: Array<{ line: number, cells: string[] }> }}
 */
function checkReadme(root, readmePath, report) {
  const file = toPosix(relative(root, readmePath));
  const lines = stripFences(readFileSync(readmePath, 'utf8').split('\n'));
  const found = [];
  lines.forEach((line, i) => {
    const m = /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (m && !line.startsWith('###')) found.push({ text: m[1].split(':')[0].trim(), line: i + 1 });
  });

  const seen = new Set();
  for (const h of found) {
    if (!HEADINGS.includes(h.text)) {
      report(file, h.line, `unexpected level-2 heading "## ${h.text}"; the outline allows only the 15 template headings (use ### for subsections)`);
    } else if (seen.has(h.text)) {
      report(file, h.line, `duplicate heading "## ${h.text}"`);
    }
    seen.add(h.text);
  }
  for (const expected of HEADINGS) {
    if (!seen.has(expected)) report(file, 1, `missing heading "## ${expected}" (see docs/templates/package-README.md)`);
  }
  // Order: each template heading must come after the previous one present.
  let previous = null;
  for (const h of found) {
    const index = HEADINGS.indexOf(h.text);
    if (index < 0) continue;
    if (previous && index < HEADINGS.indexOf(previous.text)) {
      report(file, h.line, `heading "## ${h.text}" is out of order: it must come before "## ${previous.text}"`);
    } else {
      previous = h;
    }
  }

  // Sections: never empty.
  for (const [n, h] of found.entries()) {
    if (!HEADINGS.includes(h.text)) continue;
    const end = n + 1 < found.length ? found[n + 1].line - 1 : lines.length;
    const raw = readFileSync(readmePath, 'utf8').split('\n').slice(h.line, end);
    if (raw.every((line) => line.trim() === '')) {
      report(file, h.line, `section "## ${h.text}" is empty; write "None." and one sentence why`);
    }
  }

  // Catalog table.
  const catalog = found.find((h) => h.text === CATALOG_HEADING);
  const rows = [];
  if (!catalog) return { catalogLine: 1, rows, file };
  const next = found[found.indexOf(catalog) + 1];
  const body = lines.slice(catalog.line, next ? next.line - 1 : lines.length);
  const tableStart = body.findIndex((line) => line.trim().startsWith('|'));
  if (tableStart < 0) {
    const firstText = body.find((line) => line.trim() !== '');
    if (!firstText || !firstText.trim().startsWith('None.')) {
      report(file, catalog.line, `"## ${CATALOG_HEADING}" has neither the catalog table (| ${CATALOG_COLUMNS.join(' | ')} |) nor "None."`);
    }
    return { catalogLine: catalog.line, rows, file };
  }
  const header = cells(body[tableStart]);
  if (header.join('|') !== CATALOG_COLUMNS.join('|')) {
    report(file, catalog.line + tableStart + 1, `catalog table header must be | ${CATALOG_COLUMNS.join(' | ')} |, got | ${header.join(' | ')} |`);
    return { catalogLine: catalog.line, rows, file };
  }
  for (let i = tableStart + 2; i < body.length && body[i].trim().startsWith('|'); i++) {
    rows.push({ line: catalog.line + i + 1, cells: cells(body[i]) });
  }
  return { catalogLine: catalog.line, rows, file };
}

// -----------------------------------------------------------------------------
// TypeDoc JSON
// -----------------------------------------------------------------------------

/**
 * Entry points of a TypeDoc project and the symbols each exports.
 * @returns {Array<{ entry: string, exported: Map<string, object>, points: object[] }>}
 */
function readApi(pkgDir, pkgRel, apiJson, report) {
  const project = JSON.parse(readFileSync(apiJson, 'utf8'));
  const idMap = project.symbolIdMap ?? {};
  const children = project.children ?? [];
  const modules =
    children.length > 0 && children.every((c) => c.kind === KIND_MODULE) ? children : [project];

  return modules.map((mod) => {
    const entry = idMap[mod.id]?.packagePath ?? 'src/index.ts';
    const exported = new Map();
    const points = [];

    const visit = (decl, prefix, inheritedStability, topLevel) => {
      if (decl.kind === KIND_REFERENCE || decl.kind === KIND_CONSTRUCTOR || decl.inheritedFrom) return;
      const name = prefix ? `${prefix}.${decl.name}` : decl.name;
      const file = `${pkgRel}/${idMap[decl.id]?.packagePath ?? entry}`;
      const line = sourceLine(decl);
      const comments = commentsOf(decl);
      const stabilities = comments.flatMap((c) => tagValues(c, '@stability'));
      const kinds = comments.flatMap((c) => tagValues(c, '@extensionPoint'));
      exported.set(name, decl);

      for (const s of stabilities) {
        if (!STABILITIES.includes(s)) {
          report(file, line, `\`${name}\` has "@stability ${s}"; an exported symbol is ${STABILITIES.join(' or ')} (internal symbols are never exported)`);
        }
      }
      if (topLevel && stabilities.length === 0) {
        report(file, line, `exported symbol \`${name}\` has no @stability tag (@stability ${STABILITIES.join(' | ')})`);
      }
      const stability = stabilities[0] ?? inheritedStability;
      for (const kind of kinds) {
        if (!KINDS.includes(kind)) {
          report(file, line, `\`${name}\` has "@extensionPoint ${kind}"; the kind is one of ${KINDS.join(', ')}`);
        }
      }
      if (kinds.length > 0) points.push({ name, kind: kinds[0], stability, file, line });
      for (const child of decl.children ?? []) visit(child, name, stability, false);
    };

    for (const decl of mod === project ? children : (mod.children ?? [])) visit(decl, '', undefined, true);
    return { entry, exported, points };
  });
}

/**
 * The README that catalogs an entry point: src/index.ts -> README.md,
 * src/<slice>/index.ts -> src/<slice>/README.md, and a nested entry point of a
 * slice (src/<slice>/<part>/index.ts, a `./<slice>/<part>` subpath such as
 * `./doctor/headless`) -> the slice's README, src/<slice>/README.md.
 */
function readmeForEntry(entry) {
  const dir = posix.dirname(entry);
  if (dir === 'src' || dir === '.') return 'README.md';
  const [, slice] = dir.split('/');
  return dir.startsWith('src/') && slice ? `src/${slice}/README.md` : `${dir}/README.md`;
}

// -----------------------------------------------------------------------------
// Catalog rows against the tags
// -----------------------------------------------------------------------------

function checkCatalog(root, readmeAbs, parsed, entries, report) {
  const { file, rows, catalogLine } = parsed;
  const points = new Map(entries.flatMap((e) => e.points.map((p) => [p.name, p])));
  const exported = new Set(entries.flatMap((e) => [...e.exported.keys()]));
  const listed = new Set();
  const col = Object.fromEntries(CATALOG_COLUMNS.map((c, i) => [c, i]));

  for (const row of rows) {
    const value = (column) => row.cells[col[column]] ?? '';
    const name = normalizeName(value('Name'));
    const kind = value('Kind').replace(/`/g, '').trim();
    const stability = value('Stability').replace(/`/g, '').trim();
    if (!name) {
      report(file, row.line, 'catalog row has no Name');
      continue;
    }
    if (listed.has(name)) report(file, row.line, `catalog row \`${name}\` is listed twice`);
    listed.add(name);

    if (!KINDS.includes(kind)) report(file, row.line, `catalog row \`${name}\` has Kind "${kind}"; one of ${KINDS.join(', ')}`);
    if (!STABILITIES.includes(stability)) {
      report(file, row.line, `catalog row \`${name}\` has Stability "${stability}"; one of ${STABILITIES.join(', ')}`);
    }

    const point = points.get(name);
    if (!point) {
      report(
        file,
        row.line,
        exported.has(name)
          ? `catalog row \`${name}\` names an exported symbol without an @extensionPoint tag; tag it or remove the row`
          : `catalog row \`${name}\` names no exported symbol of this entry point (stale row?)`,
      );
    } else {
      if (KINDS.includes(kind) && kind !== point.kind) {
        report(file, row.line, `catalog row \`${name}\` has Kind "${kind}" but ${point.file}:${point.line} says "@extensionPoint ${point.kind}"`);
      }
      if (STABILITIES.includes(stability) && stability !== point.stability) {
        report(file, row.line, `catalog row \`${name}\` has Stability "${stability}" but ${point.file}:${point.line} says "@stability ${point.stability ?? '(none)'}"`);
      }
    }

    const links = [...value('Example').matchAll(LINK_PATTERN)].map((m) => m[1]);
    if (links.length === 0) report(file, row.line, `catalog row \`${name}\` has no Example link to the reference app`);
    for (const target of links) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#') || target.startsWith('/')) {
        report(file, row.line, `catalog row \`${name}\`: Example "${target}" must be a relative link to a file in the reference app`);
        continue;
      }
      const resolved = resolve(dirname(readmeAbs), target.split('#')[0]);
      const fromRoot = toPosix(relative(root, resolved));
      if (fromRoot.startsWith('packages/')) {
        report(file, row.line, `catalog row \`${name}\`: Example "${target}" points into packages/; link a working use in the reference app (${EXAMPLE_ROOTS.join(', ')})`);
      } else if (!EXAMPLE_ROOTS.some((r) => fromRoot.startsWith(r))) {
        report(file, row.line, `catalog row \`${name}\`: Example "${target}" is outside the reference app (${EXAMPLE_ROOTS.join(', ')})`);
      } else if (!existsSync(resolved) || !statSync(resolved).isFile()) {
        report(file, row.line, `catalog row \`${name}\`: Example "${target}" does not resolve to a file (resolved: ${fromRoot})`);
      }
    }
  }

  for (const point of points.values()) {
    if (!listed.has(point.name)) {
      report(file, catalogLine, `\`${point.name}\` (@extensionPoint ${point.kind}, ${point.file}:${point.line}) is missing from the Extension-point catalog`);
    }
  }
}

// -----------------------------------------------------------------------------
// Per package
// -----------------------------------------------------------------------------

/**
 * Subpath exports that are slices or parts of one: `./<name>` (or
 * `./<slice>/<part>`, e.g. `./doctor/headless`) with a src/<name>/ directory.
 * Each needs src/<name>/index.ts in typedoc.json; its README is the slice's.
 */
function exportedSubpaths(pkgDir, manifest) {
  const keys = manifest.exports && typeof manifest.exports === 'object' ? Object.keys(manifest.exports) : [];
  return keys
    .filter((k) => k.startsWith('./') && k !== '.' && !k.includes('*') && !/\.[a-z0-9]+$/i.test(k))
    .map((k) => k.slice(2))
    .filter((sub) => existsSync(join(pkgDir, 'src', sub)) && statSync(join(pkgDir, 'src', sub)).isDirectory());
}

/** The slices those subpaths belong to (their first segment), once each. */
function sliceOf(subpath) {
  return subpath.split('/')[0];
}

export function checkPackageDocs(root) {
  const problems = [];
  const report = (file, line, message) => problems.push({ file, line, message });
  const packagesDir = join(root, 'packages');
  const packages = existsSync(packagesDir)
    ? readdirSync(packagesDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name.startsWith('platform-') && existsSync(join(packagesDir, d.name, 'package.json')))
        .map((d) => d.name)
        .sort()
    : [];
  let readmes = 0;
  let points = 0;

  for (const name of packages) {
    const pkgDir = join(packagesDir, name);
    const pkgRel = `packages/${name}`;
    const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));

    // READMEs: the package's, every exported slice's, and any other slice README present.
    const readmePaths = new Map();
    const require = (rel) => {
      const abs = join(pkgDir, rel);
      if (!existsSync(abs)) {
        report(`${pkgRel}/${rel}`, 1, `missing README (copy docs/templates/${rel === 'README.md' ? 'package' : 'slice'}-README.md)`);
      } else {
        readmePaths.set(rel, abs);
      }
    };
    require('README.md');
    const subpaths = exportedSubpaths(pkgDir, manifest);
    const slices = [...new Set(subpaths.map(sliceOf))];
    for (const slice of slices) require(`src/${slice}/README.md`);
    const srcDir = join(pkgDir, 'src');
    if (existsSync(srcDir)) {
      for (const d of readdirSync(srcDir, { withFileTypes: true })) {
        const rel = `src/${d.name}/README.md`;
        if (d.isDirectory() && existsSync(join(pkgDir, rel))) readmePaths.set(rel, join(pkgDir, rel));
      }
    }
    const parsed = new Map([...readmePaths].map(([rel, abs]) => [rel, checkReadme(root, abs, report)]));
    readmes += parsed.size;

    // typedoc.json lists every exported slice.
    const typedocPath = join(pkgDir, 'typedoc.json');
    if (!existsSync(typedocPath)) {
      report(`${pkgRel}/typedoc.json`, 1, 'missing typedoc.json (see docs/PACKAGES.md)');
    } else {
      const entryPoints = (parseJsonc(readFileSync(typedocPath, 'utf8')).entryPoints ?? []).map((p) => p.replace(/^\.\//, ''));
      for (const sub of subpaths) {
        if (!entryPoints.some((p) => p === `src/${sub}/index.ts` || p === `src/${sub}/index.tsx`)) {
          report(`${pkgRel}/typedoc.json`, 1, `slice "./${sub}" is exported but src/${sub}/index.ts is not in entryPoints`);
        }
      }
    }

    // Tags against catalogs.
    const apiJson = join(pkgDir, 'docs-api', 'api.json');
    if (!existsSync(apiJson)) {
      report(`${pkgRel}/docs-api/api.json`, 1, 'missing; run `npm run docs:packages` first (TypeDoc writes it)');
      continue;
    }
    const entries = readApi(pkgDir, pkgRel, apiJson, report);
    points += entries.reduce((n, e) => n + e.points.length, 0);
    const byReadme = new Map();
    for (const entry of entries) {
      const rel = readmeForEntry(entry.entry);
      byReadme.set(rel, [...(byReadme.get(rel) ?? []), entry]);
    }
    for (const [rel, list] of byReadme) {
      if (!parsed.has(rel)) {
        if (rel !== 'README.md' && !slices.some((s) => rel === `src/${s}/README.md`)) {
          report(`${pkgRel}/${rel}`, 1, `missing README for entry point ${list[0].entry} (copy docs/templates/slice-README.md)`);
        }
        continue;
      }
      checkCatalog(root, readmePaths.get(rel), parsed.get(rel), list, report);
    }
    // A README whose entry point exports nothing still has its rows checked (all stale).
    for (const [rel, info] of parsed) {
      if (!byReadme.has(rel)) checkCatalog(root, readmePaths.get(rel), info, [], report);
    }
  }

  if (packages.length === 0) report('packages', 1, 'no packages/platform-* package found');
  return { problems, packages: packages.length, readmes, points };
}

// -----------------------------------------------------------------------------
// CLI
// -----------------------------------------------------------------------------

function main(argv) {
  const json = argv.includes('--json');
  const rootFlag = argv.indexOf('--root');
  const root =
    rootFlag >= 0 && argv[rootFlag + 1]
      ? resolve(argv[rootFlag + 1])
      : join(dirname(fileURLToPath(import.meta.url)), '..');
  const result = checkPackageDocs(root);

  if (json) {
    process.stdout.write(`${JSON.stringify(result.problems, null, 2)}\n`);
  } else {
    for (const p of result.problems) process.stdout.write(`${p.file}:${p.line} ${p.message}\n`);
  }
  if (result.problems.length > 0) {
    process.stderr.write(`check-package-docs: ${result.problems.length} problem(s); see docs/PACKAGES.md\n`);
    return 1;
  }
  if (!json) {
    process.stdout.write(
      `check-package-docs: ${result.packages} packages, ${result.readmes} READMEs, ${result.points} extension points OK\n`,
    );
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}

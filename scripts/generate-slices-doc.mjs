#!/usr/bin/env node
// Generates docs/SLICES.md, the one page that answers, for every platform
// slice: what it is and gives you, which of the six packages carry it (with
// the subpath imports), the admin cards and permissions it adds, the slices
// and peer dependencies it needs, and whether it can be used on its own.
//
// Run by `npm run docs:slices` (write) and `npm run check:slices-doc` (fail
// when the committed page differs from the generated one), the latter in
// .github/workflows/packages.yml next to check:package-docs and
// check:slice-peers.
//
// WHERE EACH FACT COMES FROM (nothing is typed twice)
// -----------------------------------------------------------------------------
//   slice list, slice dependencies   packages/platform-slices.json
//   peer dependencies                packages/platform-slice-peers.json
//                                    (own + inherited + `$implies` + `$runtime`),
//                                    through the functions of check-slice-peers.mjs;
//                                    "required" = what the universal slices need
//   import paths                     each package.json `exports`
//   what it is                       the first paragraph of the slice README
//                                    (packages/<pkg>/src/<slice>/README.md),
//                                    with issue references and links removed
//   admin cards                      object literals with a `title` and a
//                                    `/settings/...` or `/admin/settings/...`
//                                    `path` in the web slice's sources, plus the
//                                    cards the app registries declare for it
//                                    (apps/web/src/config/*Sections.tsx), looked
//                                    up by the paths listed in the notes
//   permissions                      object literals with `id`, `scope` and
//                                    `defaultGrants` in the API slice's sources
//                                    (the declarations the manifest slice
//                                    registers in `platformPermissionCatalog`)
//   the minimal consumer             tests/consumer-smoke/api-slim (its
//                                    package.json and src/main.ts, copied)
//
// WHAT IS HAND-MAINTAINED: packages/platform-slice-notes.json, one entry per
// slice: group, a one-line "gives", the standalone level and note, and the
// app-declared card paths. The check fails when a slice of the graph has no
// entry (or an entry names no slice), a field is missing, an app card path is
// not in the app registries, or the minimal consumer's dependencies drift from
// the peers of the slices it imports. So adding a slice forces a catalog entry.
//
// Usage: node scripts/generate-slices-doc.mjs [--root <dir>] [--write | --check | --print]
//   --write   write docs/SLICES.md (default)
//   --check   exit 1 when docs/SLICES.md differs from the generated page, or the notes are incomplete
//   --print   write the page to stdout
// Exit: 0 ok, 1 stale or invalid, 2 usage error.
//
// Importing this module runs nothing (`main()` is behind `isDirectExecution`),
// so apps/cli/src/slices-doc-script.test.ts imports the functions directly.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { effectivePeers, isTestPath, sliceOfPlatformImport, universalSlices } from './check-slice-peers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(HERE, '..');
const DOC_PATH = 'docs/SLICES.md';
const SOURCE_FILE = /\.(?:ts|tsx|mts|cts)$/;
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'docs-api']);

/** The six packages by layer, with the label the page uses for each. */
export const PACKAGES = [
  { dir: 'platform-api', label: 'API' },
  { dir: 'platform-web', label: 'Web' },
  { dir: 'platform-contract', label: 'Contract' },
  { dir: 'platform-db', label: 'DB' },
  { dir: 'platform-cli', label: 'CLI' },
  { dir: 'platform-infra', label: 'Infra' },
];

/** The groups of the notes file, in page order. */
export const GROUPS = [
  { id: 'foundation', title: 'Foundation slices', blurb: 'What every other slice stands on: the registry primitive and host ports, the OpenTelemetry core, the host plumbing, the permission manifest, the app shell and the data table.' },
  { id: 'feature', title: 'Feature slices', blurb: 'A capability an app mounts: its routes, jobs, settings, Doctor checks and, in the web package, its pages.' },
  { id: 'tooling', title: 'Tooling slices', blurb: 'The database, CLI and infrastructure tooling of the platform packages. They are subpath modules of the same packages, not features of the running app.' },
];

/** The standalone levels of the notes file, in the order the legend lists them. */
export const LEVELS = {
  yes: 'Yes: imports and runs with the foundation slices only',
  'with-slices': 'With slices: also needs the slices it depends on, wired',
  'app-ports': 'With app ports: also needs host ports or data the app supplies',
};

// -----------------------------------------------------------------------------
// Inputs
// -----------------------------------------------------------------------------

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readText(path) {
  return readFileSync(path, 'utf8');
}

let tsCache;
function loadTypeScript(root) {
  if (tsCache) return tsCache;
  try {
    tsCache = createRequire(join(root, 'package.json'))('typescript');
  } catch {
    tsCache = createRequire(import.meta.url)('typescript');
  }
  return tsCache;
}

/** Everything the page is built from, read from `root`. */
export function loadInputs(root = DEFAULT_ROOT) {
  const packagesDir = join(root, 'packages');
  const graph = readJson(join(packagesDir, 'platform-slices.json'));
  const peers = readJson(join(packagesDir, 'platform-slice-peers.json'));
  const notes = readJson(join(packagesDir, 'platform-slice-notes.json'));
  const manifests = {};
  for (const { dir } of PACKAGES) {
    const file = join(packagesDir, dir, 'package.json');
    if (existsSync(file)) manifests[dir] = readJson(file);
  }
  return { root, graph, peers, notes, manifests };
}

// -----------------------------------------------------------------------------
// Graph helpers
// -----------------------------------------------------------------------------

/** The package directories of the graph in layer order (`$comment` and unknown keys skipped). */
export function graphPackages(graph) {
  return PACKAGES.filter(({ dir }) => graph[dir]);
}

/** Every slice name that appears in any package of the graph. */
export function sliceNames(graph) {
  const names = new Set();
  for (const { dir } of graphPackages(graph)) for (const slice of Object.keys(graph[dir])) names.add(slice);
  return names;
}

/** The slice's direct dependencies in one package, `testing` left out (it is only reached from `<slice>/testing`). */
export function directDeps(graph, pkg, slice) {
  return (graph[pkg]?.[slice] ?? []).filter((dep) => dep !== 'testing');
}

/** The slice's transitive dependencies in one package (without itself and without `testing`). */
export function closureDeps(graph, pkg, slice) {
  const out = new Set();
  const queue = [slice];
  while (queue.length > 0) {
    for (const dep of directDeps(graph, pkg, queue.pop())) {
      if (!out.has(dep) && dep !== slice) {
        out.add(dep);
        queue.push(dep);
      }
    }
  }
  return [...out].sort();
}

/** Subpath imports of a slice from a package's `exports` map, shortest first: `['/telemetry', '/telemetry/testing']`. */
export function subpathsOf(manifest, slice) {
  const keys = Object.keys(manifest?.exports ?? {});
  const own = keys
    .filter((key) => key === `./${slice}` || key.startsWith(`./${slice}/`))
    .map((key) => key.slice(1));
  return own.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
}

/** The peers a package requires: what its universal slices need (closed over `$implies`). */
export function requiredPeers(pkg, graph, peers) {
  const declared = peers[pkg] ?? {};
  const implies = peers.$implies?.[pkg] ?? {};
  const runtime = peers.$runtime?.[pkg] ?? {};
  const out = new Set();
  for (const slice of universalSlices(pkg, peers.$universal, graph[pkg])) {
    for (const peer of effectivePeers(slice, graph[pkg], declared, implies, runtime)) out.add(peer);
  }
  return out;
}

/**
 * The peers to install for a slice beyond the package's required ones, and
 * those only its `/testing` entry point adds.
 */
export function slicePeers(pkg, slice, graph, peers) {
  const declared = peers[pkg] ?? {};
  const implies = peers.$implies?.[pkg] ?? {};
  const runtime = peers.$runtime?.[pkg] ?? {};
  const required = requiredPeers(pkg, graph, peers);
  const own = effectivePeers(slice, graph[pkg], declared, implies, runtime);
  const extra = [...own].filter((peer) => !required.has(peer)).sort();
  let testing = [];
  if (`${slice}/testing` in declared) {
    const all = effectivePeers(`${slice}/testing`, graph[pkg], declared, implies, runtime);
    testing = [...all].filter((peer) => !required.has(peer) && !own.has(peer)).sort();
  }
  return { extra, testing };
}

// -----------------------------------------------------------------------------
// Purpose: the README's first paragraph
// -----------------------------------------------------------------------------

/** The first prose paragraph after the H1 of a README, as one line. */
export function firstParagraph(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length && !/^#\s/.test(lines[i])) i += 1;
  i += 1;
  const paragraph = [];
  let fence = false;
  for (; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^```/.test(line)) fence = !fence;
    if (fence || /^```/.test(line)) continue;
    if (/^(#{1,6}\s|>|\||<|!\[|[-*]\s)/.test(line.trim()) && paragraph.length === 0) continue;
    if (line.trim() === '') {
      if (paragraph.length > 0) break;
      continue;
    }
    if (/^#{1,6}\s/.test(line)) break;
    paragraph.push(line.trim());
  }
  return paragraph.join(' ');
}

/**
 * One clean sentence from a README paragraph: links reduced to their text,
 * issue and epic references and `PP-x.y` tags removed, the leading
 * `` `@scope/package/slice`: `` label dropped, then the first sentence (outside
 * code spans), cut at a clause boundary when it runs long.
 */
export function purposeOf(paragraph, maxLength = 360) {
  let text = paragraph.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  // Parentheticals that carry a reference, innermost first.
  const refParen = /\s*\([^()]*(?:#\d|PP-\d)[^()]*\)/g;
  for (let n = 0; n < 4 && refParen.test(text); n += 1) text = text.replace(refParen, '');
  text = text
    .replace(/,?\s*(?:new with|new in|from|in|per|see)?\s*(?:the )?(?:issues?|epic)\s+#\d+(?:(?:,|\s+and)\s*#?\d+)*/gi, '')
    .replace(/\s*\bPP-\d+(?:\.\d+)?\b/g, '')
    .replace(/\s*#\d+\b/g, '')
    .replace(/^`@[a-z0-9-]+\/[a-z0-9-]+(?:\/[a-z0-9-/]+)?`\s*:\s*/i, '')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/\(\s*\)/g, '')
    .replace(/,\s*,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .trim();
  let end = text.length;
  let inCode = false;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '`') inCode = !inCode;
    if (inCode || text[i] !== '.') continue;
    const next = text[i + 1];
    if (next === undefined || (next === ' ' && /[A-Z`(]/.test(text[i + 2] ?? ''))) {
      end = i + 1;
      break;
    }
  }
  let sentence = text.slice(0, end).trim();
  if (sentence.length > maxLength) {
    const cut = Math.max(sentence.lastIndexOf(', ', maxLength - 20), sentence.lastIndexOf('; ', maxLength - 20), sentence.lastIndexOf(' ', maxLength - 20));
    sentence = `${sentence.slice(0, cut > 40 ? cut : maxLength - 20).replace(/[,;:\s]+$/, '')} ...`;
  }
  if (sentence.endsWith(':')) sentence = `${sentence.slice(0, -1)}.`;
  return sentence ? sentence[0].toUpperCase() + sentence.slice(1) : sentence;
}

// -----------------------------------------------------------------------------
// Source scans: cards and permissions
// -----------------------------------------------------------------------------

function walkSources(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) walkSources(full, out);
    } else if (SOURCE_FILE.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Non-test source files of `packages/<pkg>/src/<slice>/`, as `{ file, text }`. */
function sliceSources(root, pkg, slice) {
  const srcDir = join(root, 'packages', pkg, 'src');
  return walkSources(join(srcDir, slice))
    .filter((file) => !isTestPath(relative(srcDir, file).split(sep).join('/')))
    .map((file) => ({ file, text: readText(file) }));
}

/** The expression with `as const`, `satisfies` and parentheses peeled off. */
function unwrap(ts, node) {
  let current = node;
  while (current && (ts.isAsExpression(current) || ts.isParenthesizedExpression(current) || ts.isSatisfiesExpression?.(current) || ts.isNonNullExpression(current))) {
    current = current.expression;
  }
  return current;
}

/** `const NAME = 'text'` declarations of a set of sources, for resolving `title: NAME`. */
function stringConstants(ts, sources) {
  const out = new Map();
  for (const { file, text } of sources) {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const visit = (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const value = unwrap(ts, node.initializer);
        if (value && (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value))) out.set(node.name.text, value.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
}

function propertyMap(ts, objectLiteral) {
  const props = new Map();
  for (const prop of objectLiteral.properties) {
    if (ts.isPropertyAssignment(prop) && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))) props.set(prop.name.text, prop.initializer);
    else if (ts.isShorthandPropertyAssignment(prop)) props.set(prop.name.text, prop.name);
  }
  return props;
}

/** A string, or an array of strings, from an expression; `undefined` when it is neither. */
function literalValue(ts, node, constants) {
  const value = node && unwrap(ts, node);
  if (!value) return undefined;
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text;
  if (ts.isIdentifier(value)) return constants.get(value.text);
  if (ts.isArrayLiteralExpression(value)) {
    const items = value.elements.map((element) => literalValue(ts, element, constants));
    return items.every((item) => typeof item === 'string') ? items : undefined;
  }
  return undefined;
}

const CARD_PATH = /^\/(?:admin\/)?settings\//;

/** Every settings card (an object with `title` and a settings `path`) in a set of sources. */
function cardsIn(ts, sources, constants) {
  const cards = [];
  for (const { file, text } of sources) {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const visit = (node) => {
      if (ts.isObjectLiteralExpression(node)) {
        const props = propertyMap(ts, node);
        const path = literalValue(ts, props.get('path'), constants);
        const title = literalValue(ts, props.get('title'), constants);
        if (typeof path === 'string' && CARD_PATH.test(path) && typeof title === 'string') {
          const permission = literalValue(ts, props.get('permission'), constants);
          const feature = literalValue(ts, props.get('feature'), constants);
          cards.push({ title, path, permission: permission === undefined ? [] : [].concat(permission), feature: typeof feature === 'string' ? feature : null });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return cards;
}

function dedupeCards(cards) {
  const seen = new Set();
  return cards.filter((card) => {
    const key = `${card.path}|${card.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The cards the web slice itself declares (data the app spreads into its registry). */
export function packagedCards(root, slice) {
  const ts = loadTypeScript(root);
  const sources = sliceSources(root, 'platform-web', slice);
  return dedupeCards(cardsIn(ts, sources, stringConstants(ts, sources)))
    .map((card) => ({ ...card, declaredBy: 'package' }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** The cards in the app's registries, keyed by path. */
export function appCardIndex(root) {
  const ts = loadTypeScript(root);
  const dir = join(root, 'apps', 'web', 'src', 'config');
  const sources = ['adminSections.tsx', 'userSettingsSections.tsx']
    .map((name) => join(dir, name))
    .filter((file) => existsSync(file))
    .map((file) => ({ file, text: readText(file) }));
  const constants = stringConstants(ts, sources);
  const index = new Map();
  for (const card of cardsIn(ts, sources, constants)) if (!index.has(card.path)) index.set(card.path, { ...card, declaredBy: 'app' });
  return index;
}

/** Every permission an API slice declares: `{ id, scope }`, in source order. */
export function declaredPermissions(root, slice) {
  const ts = loadTypeScript(root);
  const out = [];
  const seen = new Set();
  for (const { file, text } of sliceSources(root, 'platform-api', slice)) {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const visit = (node) => {
      if (ts.isObjectLiteralExpression(node)) {
        const props = propertyMap(ts, node);
        const id = literalValue(ts, props.get('id'), new Map());
        const scope = literalValue(ts, props.get('scope'), new Map());
        if (typeof id === 'string' && /^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/.test(id) && (scope === 'system' || scope === 'org') && props.has('defaultGrants') && !seen.has(id)) {
          seen.add(id);
          out.push({ id, scope });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
}

/** `users:{read,write}` style groups of permission ids, org-scoped ones tagged. */
export function compactPermissions(permissions) {
  const groups = new Map();
  for (const { id, scope } of permissions) {
    const [resource, action] = id.split(':');
    const key = `${resource}|${scope}`;
    if (!groups.has(key)) groups.set(key, { resource, scope, actions: [] });
    groups.get(key).actions.push(action);
  }
  return [...groups.values()].map(({ resource, scope, actions }) => {
    const text = actions.length === 1 ? `\`${resource}:${actions[0]}\`` : `\`${resource}:{${actions.join(',')}}\``;
    return scope === 'org' ? `${text} (org)` : text;
  });
}

// -----------------------------------------------------------------------------
// The model
// -----------------------------------------------------------------------------

/** One slice: everything the page prints about it. */
export function buildSlice(inputs, slice) {
  const { root, graph, peers, notes, manifests } = inputs;
  const note = notes.slices[slice];
  const parts = [];
  for (const { dir, label } of graphPackages(graph)) {
    if (!(slice in graph[dir])) continue;
    const readme = `packages/${dir}/src/${slice}/README.md`;
    parts.push({
      pkg: dir,
      label,
      imports: subpathsOf(manifests[dir], slice),
      deps: directDeps(graph, dir, slice),
      closure: closureDeps(graph, dir, slice),
      ...slicePeers(dir, slice, graph, peers),
      readme: existsSync(join(root, readme)) ? readme : null,
    });
  }
  const firstReadme = parts.find((part) => part.readme);
  const purpose = firstReadme ? purposeOf(firstParagraph(readText(join(root, firstReadme.readme)))) : '';
  const appIndex = inputs.appIndex ?? (inputs.appIndex = appCardIndex(root));
  const cards = [
    ...(graph['platform-web'] && slice in graph['platform-web'] ? packagedCards(root, slice) : []),
    ...(note?.appCards ?? []).map((path) => appIndex.get(path)).filter(Boolean),
  ];
  const permissions = graph['platform-api'] && slice in graph['platform-api'] ? declaredPermissions(root, slice) : [];
  return { name: slice, group: note?.group, gives: note?.gives, level: note?.standalone?.level, standalone: note?.standalone?.note, purpose, parts, cards, permissions };
}

/** The whole model: groups in page order, slices in the notes' order. */
export function buildModel(inputs) {
  const { graph, peers, notes } = inputs;
  const slices = Object.keys(notes.slices).filter((name) => sliceNames(graph).has(name)).map((name) => buildSlice(inputs, name));
  const required = {};
  for (const { dir } of graphPackages(graph)) required[dir] = [...requiredPeers(dir, graph, peers)].sort();
  return { slices, required, example: loadExample(inputs) };
}

// -----------------------------------------------------------------------------
// Validation of the hand-maintained notes
// -----------------------------------------------------------------------------

/** Problems with the notes file against the graph, the app registries and the minimal consumer. Empty when fine. */
export function validateNotes(inputs) {
  const { graph, notes } = inputs;
  const problems = [];
  const names = sliceNames(graph);
  const entries = notes.slices ?? {};
  for (const name of names) {
    if (!(name in entries)) problems.push(`slice "${name}" is in packages/platform-slices.json but has no entry in packages/platform-slice-notes.json`);
  }
  for (const name of Object.keys(entries)) {
    if (!names.has(name)) problems.push(`packages/platform-slice-notes.json describes "${name}", which is no slice of packages/platform-slices.json`);
  }
  const groupIds = GROUPS.map((group) => group.id);
  const appIndex = (inputs.appIndex ??= appCardIndex(inputs.root));
  for (const [name, entry] of Object.entries(entries)) {
    if (!groupIds.includes(entry.group)) problems.push(`notes "${name}": group must be one of ${groupIds.join(', ')}`);
    if (typeof entry.gives !== 'string' || entry.gives.trim() === '') problems.push(`notes "${name}": "gives" must be a non-empty one-line string`);
    else if (/\n|#\d|PP-\d/.test(entry.gives)) problems.push(`notes "${name}": "gives" must be one line without issue references`);
    if (!(entry.standalone?.level in LEVELS)) problems.push(`notes "${name}": standalone.level must be one of ${Object.keys(LEVELS).join(', ')}`);
    if (typeof entry.standalone?.note !== 'string' || entry.standalone.note.trim() === '') problems.push(`notes "${name}": standalone.note must be a non-empty string`);
    else if (/#\d|PP-\d/.test(entry.standalone.note)) problems.push(`notes "${name}": standalone.note must not carry issue references`);
    for (const path of entry.appCards ?? []) {
      if (!appIndex.has(path)) problems.push(`notes "${name}": appCards path ${path} is declared by neither apps/web/src/config/adminSections.tsx nor userSettingsSections.tsx`);
    }
  }
  problems.push(...validateExample(inputs));
  return problems;
}

// -----------------------------------------------------------------------------
// The minimal consumer
// -----------------------------------------------------------------------------

/** The `$example` entry of the notes, with the files it points at; `null` when the notes name none. */
export function loadExample(inputs) {
  const { root, notes } = inputs;
  const spec = notes.$example;
  if (!spec) return null;
  const dir = join(root, spec.dir);
  const pkgFile = join(dir, 'package.json');
  const mainFile = join(dir, 'src', 'main.ts');
  if (!existsSync(pkgFile) || !existsSync(mainFile)) return { spec, missing: true };
  const manifest = readJson(pkgFile);
  const main = readText(mainFile);
  const code = main
    .split('\n')
    .filter((line, index, all) => !(line.startsWith('//') && all.slice(0, index).every((before) => before.startsWith('//') || before.trim() === '')))
    .join('\n')
    .replace(/^\n+/, '')
    .trimEnd();
  const dependencies = Object.entries(manifest.dependencies ?? {}).filter(([name]) => !name.startsWith('@marinoscar/'));
  return { spec, missing: false, dependencies, code };
}

/** Does the minimal consumer install exactly the peers of the slices it imports, and import nothing else? */
export function validateExample(inputs) {
  const example = loadExample(inputs);
  if (!example) return ['packages/platform-slice-notes.json has no "$example" (the minimal consumer the "Using one slice on its own" section copies)'];
  if (example.missing) return [`$example.dir ${example.spec.dir} needs package.json and src/main.ts`];
  const { graph, peers } = inputs;
  const pkg = example.spec.package;
  const problems = [];
  if (!graph[pkg]) return [`$example.package ${pkg} is not in packages/platform-slices.json`];
  const wanted = new Set(requiredPeers(pkg, graph, peers));
  const declared = peers[pkg] ?? {};
  const implies = peers.$implies?.[pkg] ?? {};
  const runtime = peers.$runtime?.[pkg] ?? {};
  for (const slice of example.spec.slices) {
    if (!(slice in graph[pkg])) problems.push(`$example.slices names "${slice}", which is no slice of ${pkg}`);
    else for (const peer of effectivePeers(slice, graph[pkg], declared, implies, runtime)) wanted.add(peer);
  }
  const installed = new Set(example.dependencies.map(([name]) => name));
  for (const peer of [...wanted].sort()) if (!installed.has(peer)) problems.push(`${example.spec.dir}/package.json does not install ${peer}, a peer of ${example.spec.slices.join(', ')}`);
  for (const name of [...installed].sort()) if (!wanted.has(name)) problems.push(`${example.spec.dir}/package.json installs ${name}, which none of ${example.spec.slices.join(', ')} needs`);
  const imported = new Set();
  for (const match of example.code.matchAll(/from '(@marinoscar\/platform-[a-z]+\/[^']+)'/g)) {
    const slice = sliceOfPlatformImport(match[1]);
    if (slice) imported.add(typeof slice === 'string' ? slice : slice.slice);
  }
  for (const slice of imported) if (!example.spec.slices.includes(slice)) problems.push(`${example.spec.dir}/src/main.ts imports the slice "${slice}", which $example.slices does not list`);
  return problems;
}

/** The telemetry host port tokens, read from the slice's `ports.ts`. */
export function telemetryPortTokens(root) {
  const file = join(root, 'packages', 'platform-api', 'src', 'telemetry', 'ports.ts');
  if (!existsSync(file)) return [];
  return [...readText(file).matchAll(/^export const (TELEMETRY_[A-Z_]+): unique symbol/gm)].map((match) => match[1]);
}

// -----------------------------------------------------------------------------
// Rendering
// -----------------------------------------------------------------------------

const codeList = (items) => (items.length > 0 ? items.map((item) => `\`${item}\``).join(', ') : 'none');
const esc = (text) => text.replace(/\|/g, '\\|');
const anchor = (name) => name.toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-');

function packageList(pkgs) {
  return PACKAGES.map(({ dir, label }) => (pkgs.has(dir) ? label : null)).filter(Boolean).join(', ');
}

function renderIndex(model) {
  const rows = ['| Slice | What it gives you | Carried by | Needs (slices) | Standalone |', '|---|---|---|---|---|'];
  for (const group of GROUPS) {
    for (const slice of model.slices.filter((s) => s.group === group.id)) {
      const needs = [...new Set(slice.parts.flatMap((part) => part.deps))].sort();
      const level = slice.level === 'yes' ? 'Yes' : slice.level === 'with-slices' ? 'With slices' : 'With app ports';
      rows.push(`| [\`${slice.name}\`](#${anchor(slice.name)}) | ${esc(slice.gives)} | ${packageList(new Set(slice.parts.map((part) => part.pkg)))} | ${codeList(needs)} | ${level} |`);
    }
  }
  return rows.join('\n');
}

function renderCards(slice) {
  if (slice.cards.length === 0) return 'None.';
  const rows = ['| Card | Route | Permission | Feature gate | Declared by |', '|---|---|---|---|---|'];
  for (const card of slice.cards) {
    rows.push(`| ${esc(card.title)} | \`${card.path}\` | ${card.permission.length > 0 ? codeList(card.permission) : 'none'} | ${card.feature ? `\`${card.feature}\`` : 'none'} | ${card.declaredBy === 'package' ? 'the package (data the app spreads into its registry)' : "the app's registry"} |`);
  }
  return rows.join('\n');
}

function renderSlice(slice) {
  const lines = [`### ${slice.name}`, '', `**What it gives you.** ${slice.gives}`, ''];
  if (slice.purpose) lines.push(`**What it is** (from its README). ${slice.purpose}`, '');
  const rows = ['| Part | Import paths | Depends on (slices) | Install beyond the required peers | README |', '|---|---|---|---|---|'];
  for (const part of slice.parts) {
    const imports = part.imports.length > 0 ? part.imports.map((path) => `\`${path}\``).join(', ') : 'no subpath export';
    const peers = part.extra.length > 0 ? codeList(part.extra) : 'none';
    const testing = part.testing.length > 0 ? `; \`/testing\` adds ${codeList(part.testing)}` : '';
    const readme = part.readme ? `[README](../${part.readme})` : 'none';
    rows.push(`| ${part.label} (\`${part.pkg}\`) | ${imports} | ${codeList(part.deps)} | ${peers}${testing} | ${readme} |`);
  }
  lines.push(rows.join('\n'), '');
  lines.push('**Admin and settings cards.**', '', renderCards(slice), '');
  const permissions = slice.permissions.length > 0 ? compactPermissions(slice.permissions).join(', ') : 'none declared by this slice';
  lines.push(`**Permissions it adds.** ${permissions}`, '');
  const apiPart = slice.parts.find((part) => part.pkg === 'platform-api');
  const closure = (apiPart ?? slice.parts[0]).closure;
  lines.push(`**Standalone (${LEVELS[slice.level].split(':')[0]}).** ${slice.standalone}${closure.length > 0 ? ` Transitive slice dependencies in ${(apiPart ?? slice.parts[0]).label}: ${codeList(closure)}.` : ''}`, '');
  return lines.join('\n');
}

function renderRequired(model) {
  const rows = ['| Package | Required peers (needed by every slice of the package) |', '|---|---|'];
  for (const { dir, label } of PACKAGES) {
    if (model.required[dir]) rows.push(`| ${label} (\`@marinoscar/${dir}\`) | ${codeList(model.required[dir])} |`);
  }
  return rows.join('\n');
}

function renderExample(model, root) {
  const example = model.example;
  if (!example || example.missing) return '';
  const { spec } = example;
  const deps = example.dependencies.map(([name, range]) => `${name}@${JSON.stringify(range).slice(1, -1)}`);
  const ports = telemetryPortTokens(root);
  return [
    '## Using one slice on its own',
    '',
    'Slices are subpath imports of one npm package, so using one is a matter of importing only its subpaths and installing only its peers. Nothing else of the package loads, and the optional peers of every other slice stay out of `node_modules`.',
    '',
    `The reference case is a backend-only telemetry consumer: ${spec.slices.map((slice) => `\`${slice}\``).join(', ')} of \`@marinoscar/${spec.package}\`, nothing else. It is a real project, [\`${spec.dir}\`](../${spec.dir}/), that CI installs from packed tarballs outside the repository (see [the consumer smoke README](../tests/consumer-smoke/README.md)).`,
    '',
    '### Install',
    '',
    '```bash',
    `npm install @marinoscar/${spec.package} \\`,
    ...deps.map((dep, index) => `  ${dep}${index < deps.length - 1 ? ' \\' : ''}`),
    '```',
    '',
    `That is ${codeList(model.required[spec.package].filter((name) => example.dependencies.some(([dep]) => dep === name)))} (the package's required peers) plus ${codeList(example.dependencies.map(([name]) => name).filter((name) => !model.required[spec.package].includes(name)))} (the optional peers of ${spec.slices.map((slice) => `\`${slice}\``).join(', ')}). The project's \`dependencies\` are validated against \`packages/platform-slice-peers.json\` by \`npm run check:slices-doc\`, so this list cannot drift from the slices it imports.`,
    '',
    '### The consumer',
    '',
    `Copied from [\`${spec.dir}/src/main.ts\`](../${spec.dir}/src/main.ts):`,
    '',
    '```ts',
    example.code,
    '```',
    '',
    '### What is proven, and what is not',
    '',
    `The smoke test ([\`${spec.dir}/test\`](../${spec.dir}/test/)) proves:`,
    '',
    `- ${spec.slices.map((slice) => `\`@marinoscar/${spec.package}/${slice}\``).join(', ')} load, and type-check under \`NodeNext\` with \`skipLibCheck\` off.`,
    '- `TelemetryModule.forRoot` returns its module metadata (module name, providers, controllers).',
    '- A Nest application context boots on `OtelMetricsModule`, resolves `MetricsHostService` and runs a `@Trace()` method.',
    '- The peers of the other slices (`@nestjs/jwt`, `@nestjs/passport`, `passport`, `@nestjs/event-emitter`, `@nestjs/terminus`, `@nestjs/platform-fastify`, `supertest`) are absent from `node_modules`.',
    '',
    'It does **not** prove:',
    '',
    `- **Booting \`TelemetryModule\`.** The module needs ${ports.length > 0 ? `its ${ports.length} host ports bound by the app (${codeList(ports)})` : 'its host ports bound by the app'} and the access decorators of the app's \`definePlatformHost\`. The smoke binds none of the ports and a dummy host.`,
    '- **Any other slice on its own.** For every slice, `npm run check:slice-peers` proves that the peers listed above cover its imports. That is the install contract; it is not a boot test.',
    '- **The other packages.** The web, CLI, DB and infra packages are covered by the full consumers (`tests/consumer-smoke/api`, `tests/consumer-smoke/web`) and the starter, not by a slim one.',
    '',
    'To use a different slice on its own, take its row in the tables above: import its paths, install its peers, bind the host ports its README lists, and mount it with its `forRoot`.',
    '',
  ].join('\n');
}

/** The page. */
export function renderDoc(model, root = DEFAULT_ROOT) {
  const lines = [
    '# Platform slices',
    '',
    '<!-- Generated by scripts/generate-slices-doc.mjs from packages/platform-slices.json, packages/platform-slice-peers.json, packages/platform-slice-notes.json, the package.json exports and the slice READMEs. Do not edit: run `npm run docs:slices`. -->',
    '',
    '> **Generated page.** Run `npm run docs:slices` after changing a slice, its README, its peers or its notes; `npm run check:slices-doc` (CI) fails when this page is stale. Hand-written facts live in [`packages/platform-slice-notes.json`](../packages/platform-slice-notes.json).',
    '',
    'One page for every platform slice: what it is and gives you, which of the six packages carry it and the subpath imports, the admin cards and permissions it adds, the slices and peer dependencies it needs, and whether it can be used on its own. Design and rationale: [platform-packages spec](specs/platform-packages.md); documentation standard: [PACKAGES.md](PACKAGES.md).',
    '',
    '## How slices, packages and npm relate',
    '',
    '- **Six npm packages, one per layer**: `@marinoscar/platform-api` (NestJS), `@marinoscar/platform-web` (React and MUI), `@marinoscar/platform-contract` (zod wire shapes), `@marinoscar/platform-db` (schema fragments, migrations, seed), `@marinoscar/platform-cli` (the CLI factory, TUI, node engine) and `@marinoscar/platform-infra` (Compose, nginx and env fragments).',
    '- **A slice is a subpath import, not a package.** `@marinoscar/platform-api/telemetry` and `@marinoscar/platform-web/telemetry/ui` are the telemetry slice in two packages. A capability usually spans several packages under one slice name; the "Carried by" column and each slice\'s table list them.',
    '- **Slices form a graph** ([`packages/platform-slices.json`](../packages/platform-slices.json)): a slice may import only the slices listed for it. Depending on a slice costs no extra npm package, because it is in the same package; it costs that slice\'s peers and its wiring (host ports, settings, permissions).',
    '- **Peers are per slice.** A package\'s `peerDependencies` are the union of what its slices need, but only what the always-needed slices (`core`) use is required; every other peer is `optional`. A slice\'s peers are its own plus those of its slice dependencies ([`packages/platform-slice-peers.json`](../packages/platform-slice-peers.json); rules in [PACKAGES.md](PACKAGES.md#peer-dependencies-per-slice)). npm does not install an optional peer, so an app installs the peers of the slices it imports.',
    '- **Host ports keep slices apart.** A slice imports no app code; whatever it needs from the app (a database client, settings, an object store, the access decorators) is a port the app binds when it mounts the slice with `forRoot`.',
    '',
    'The required peers of each package:',
    '',
    renderRequired(model),
    '',
    '## Slice index',
    '',
    'Standalone: **Yes** means the slice imports and runs with the foundation slices only; **With slices** also needs the slices in "Needs", wired; **With app ports** also needs host ports or data the app supplies. Only the backend-only telemetry consumer is proven by a test ([below](#using-one-slice-on-its-own)); for every other slice the guarantee is the peer contract.',
    '',
    renderIndex(model),
    '',
  ];
  for (const group of GROUPS) {
    const slices = model.slices.filter((slice) => slice.group === group.id);
    if (slices.length === 0) continue;
    lines.push(`## ${group.title}`, '', group.blurb, '');
    for (const slice of slices) lines.push(renderSlice(slice));
  }
  lines.push(renderExample(model, root));
  lines.push(
    '## Regenerating this page',
    '',
    '```bash',
    'npm run docs:slices         # write docs/SLICES.md',
    'npm run check:slices-doc    # fail when it differs from the generated page or the notes are incomplete',
    '```',
    '',
    'A new slice needs, in the same change: its entry in `packages/platform-slices.json` and `packages/platform-slice-peers.json`, its README, and an entry in `packages/platform-slice-notes.json` (group, one-line "gives", standalone level and note, and the paths of any cards the app registers for it).',
    '',
  );
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

/** Generates the page for `root`. Throws with every problem when the notes are incomplete. */
export function generate(root = DEFAULT_ROOT) {
  const inputs = loadInputs(root);
  const problems = validateNotes(inputs);
  if (problems.length > 0) {
    const error = new Error(`generate-slices-doc: ${problems.length} problem(s)\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
    error.problems = problems;
    throw error;
  }
  return renderDoc(buildModel(inputs), root);
}

// -----------------------------------------------------------------------------
// CLI
// -----------------------------------------------------------------------------

function main(argv) {
  let root = DEFAULT_ROOT;
  let mode = 'write';
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--root') root = resolve(argv[++i] ?? '');
    else if (argv[i] === '--write') mode = 'write';
    else if (argv[i] === '--check') mode = 'check';
    else if (argv[i] === '--print') mode = 'print';
    else {
      console.error(`generate-slices-doc: unknown argument ${argv[i]}\nUsage: node scripts/generate-slices-doc.mjs [--root <dir>] [--write | --check | --print]`);
      return 2;
    }
  }
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    console.error(`generate-slices-doc: ${root} is not a directory`);
    return 2;
  }
  let page;
  try {
    page = generate(root);
  } catch (error) {
    console.error(error.problems ? `${error.message}\n\nFix packages/platform-slice-notes.json (or the slice it names), then run: npm run docs:slices` : error.stack);
    return 1;
  }
  if (mode === 'print') {
    process.stdout.write(page);
    return 0;
  }
  const target = join(root, DOC_PATH);
  if (mode === 'check') {
    const current = existsSync(target) ? readText(target) : null;
    if (current !== page) {
      console.error(`generate-slices-doc: ${DOC_PATH} is ${current === null ? 'missing' : 'out of date'}. Run: npm run docs:slices (and commit the result).`);
      return 1;
    }
    console.log(`generate-slices-doc: ${DOC_PATH} is up to date.`);
    return 0;
  }
  writeFileSync(target, page);
  console.log(`generate-slices-doc: wrote ${DOC_PATH}.`);
  return 0;
}

const isDirectExecution = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectExecution) {
  process.exitCode = main(process.argv.slice(2));
}

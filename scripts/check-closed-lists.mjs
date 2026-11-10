#!/usr/bin/env node
// Closed id list guardrail (issue #946), run by the `packages` job in
// .github/workflows/packages.yml and by `npm run check:closed-lists`.
//
// WHY
// -----------------------------------------------------------------------------
// The extensibility audit found about seventy points of one shape: a list of
// ids that an app or a package would have to extend, written as a closed list
// (a TypeScript union, a `z.enum`, a `Record<FixedUnion, ...>`). Every addition
// then needs an edit under packages/platform-*. This check stops a new one from
// appearing unnoticed: a finding must either be opened (see
// docs/EXTENDING.md#open-an-id-vocabulary) or be listed, with a reason, in
// packages/closed-lists.allowlist.json.
//
// WHAT IS FLAGGED (each finding is a file and a symbol)
// -----------------------------------------------------------------------------
// Scanned: packages/platform-*/src/**/*.{ts,tsx}, not tests, fixtures, `.d.ts`,
// `dist`, `docs-api` or `node_modules`. A `testing/` folder is published source
// and IS scanned. The parser is the TypeScript compiler API, so comments and
// strings never produce a finding.
//
//   (a) const   An exported `const` initialised with an array of two or more
//               string literals followed by `as const` (or a type assertion
//               to a readonly tuple), whose name ends in _IDS, _KINDS, _TYPES,
//               _PROVIDERS, _ADAPTERS, _CHANNELS, _ROLES, _MODES, _GROUPS,
//               _UNITS or _NAMES.
//   (b) union   An exported type alias that is a union of two or more string
//               literals, whose name ends in Id, Kind, Type, Name, Mode or
//               Role, unless the union also contains `(string & {})`.
//   (c) z.enum  `z.enum(<flagged const>)` in packages/platform-contract.
//   (d) Record  A constant in a `ui/` folder of packages/platform-web whose
//               type (annotation, `satisfies` or `as`) is
//               `Record<<flagged union>, ...>`.
//
// RULES THAT KEEP THE LIST HONEST
// -----------------------------------------------------------------------------
//   - BUILTIN: a symbol named `BUILTIN_*` (a const) or `Builtin*` (a type) is
//     the built-in subset of an open vocabulary (the rule's own shape) and is
//     never a finding for (a) and (b). It is still tracked, so a `z.enum` over
//     it (c) or a `Record` over it in the web (d) is flagged: that would close
//     the vocabulary again.
//   - DEPRECATED ALIAS: the old `X_IDS` kept beside `BUILTIN_X_IDS` is a
//     finding like any other; its allowlist reason must read
//     `deprecated alias of BUILTIN_X_IDS` (a declaration tagged `@deprecated`
//     fails if its reason does not start with `deprecated alias of `).
//   - STALE: an allowlist entry that matches no finding fails (the symbol was
//     removed, renamed or opened).
//   - REASON: every entry needs a specific reason of at least 12 characters.
//
// Usage: node scripts/check-closed-lists.mjs [--root <dir>] [--print]
//   --print   print the findings as allowlist entries (reason TODO) and exit 0,
//             to start or refresh packages/closed-lists.allowlist.json.
// Exit:  0 clean, 1 violations, 2 usage error.
//
// Uses the `typescript` compiler (a root devDependency); otherwise Node
// built-ins only. It reads sources and builds nothing, so it needs no build of
// the packages. Importing this module runs nothing: `main()` is behind
// `isDirectExecution`, so apps/cli/src/closed-lists-script.test.ts imports the
// functions directly (same pattern as check-slice-peers.mjs).

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { isTestPath } from './check-slice-peers.mjs';

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWLIST_PATH = 'packages/closed-lists.allowlist.json';

export const HINT = 'open it with a registry, see docs/EXTENDING.md#open-an-id-vocabulary, or allowlist it with a reason';

const CONST_SUFFIXES = ['_IDS', '_KINDS', '_TYPES', '_PROVIDERS', '_ADAPTERS', '_CHANNELS', '_ROLES', '_MODES', '_GROUPS', '_UNITS', '_NAMES'];
const TYPE_SUFFIXES = ['Id', 'Kind', 'Type', 'Name', 'Mode', 'Role'];
const MIN_REASON = 12;
const SKIP_DIRS = new Set(['__tests__', '__fixtures__', 'test', 'tests', 'node_modules', 'dist', 'docs-api']);
const SOURCE_EXT = /\.(?:ts|tsx)$/;

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

/** Is a const name one the rule covers (a)? */
export function isFlaggedConstName(name) {
  return CONST_SUFFIXES.some((s) => name.endsWith(s));
}

/** Is a type alias name one the rule covers (b)? */
export function isFlaggedTypeName(name) {
  return TYPE_SUFFIXES.some((s) => name.endsWith(s));
}

/** A built-in subset of an open vocabulary: exempt from (a) and (b). */
export function isBuiltinName(name) {
  return name.startsWith('BUILTIN_') || /^Builtin[A-Z]/.test(name);
}

function hasExportModifier(ts, node) {
  return (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0;
}

function hasDeprecatedTag(ts, node) {
  return ts.getJSDocTags(node).some((t) => t.tagName.text === 'deprecated');
}

/** Strips parentheses and `satisfies` wrappers: `(x satisfies T)`, `(x)`. */
function unwrap(ts, expr) {
  let e = expr;
  while (ts.isParenthesizedExpression(e) || ts.isSatisfiesExpression(e)) e = e.expression;
  return e;
}

/** The string literals of an `as const` array expression, or `null` when it is not one. */
function constStringArray(ts, init) {
  const outer = unwrap(ts, init);
  if (!ts.isAsExpression(outer)) return null;
  const isConstAssertion = ts.isTypeReferenceNode(outer.type) && outer.type.typeName.getText() === 'const';
  const isReadonlyTuple = ts.isTypeOperatorNode(outer.type) && outer.type.operator === ts.SyntaxKind.ReadonlyKeyword;
  if (!isConstAssertion && !isReadonlyTuple) return null;
  const arr = unwrap(ts, outer.expression);
  if (!ts.isArrayLiteralExpression(arr)) return null;
  const values = [];
  for (const el of arr.elements) {
    const e = unwrap(ts, el);
    if (!ts.isStringLiteral(e) && !ts.isNoSubstitutionTemplateLiteral(e)) return null;
    values.push(e.text);
  }
  return values;
}

/** Is a type node `(string & {})` (the open-union marker), parenthesised or not? */
function isOpenStringMarker(ts, node) {
  let n = node;
  while (ts.isParenthesizedTypeNode(n)) n = n.type;
  if (!ts.isIntersectionTypeNode(n)) return false;
  const kinds = n.types.map((t) => t.kind);
  return (
    kinds.includes(ts.SyntaxKind.StringKeyword) &&
    n.types.some((t) => ts.isTypeLiteralNode(t) && t.members.length === 0)
  );
}

/** Literal members and the open marker of a union type node (or a single literal). */
function unionInfo(ts, typeNode) {
  const members = ts.isUnionTypeNode(typeNode) ? typeNode.types : [typeNode];
  let literals = 0;
  let open = false;
  for (const m of members) {
    let t = m;
    while (ts.isParenthesizedTypeNode(t)) t = t.type;
    if (isOpenStringMarker(ts, t)) open = true;
    else if (ts.isLiteralTypeNode(t) && (ts.isStringLiteral(t.literal) || ts.isNoSubstitutionTemplateLiteral(t.literal))) literals += 1;
  }
  return { literals, open };
}

/** `(typeof NAME)[number]` or `typeof NAME[number]`: the name, else `null`. */
function derivedFromConst(ts, typeNode) {
  let t = typeNode;
  while (ts.isParenthesizedTypeNode(t)) t = t.type;
  if (!ts.isIndexedAccessTypeNode(t)) return null;
  let obj = t.objectType;
  while (ts.isParenthesizedTypeNode(obj)) obj = obj.type;
  if (ts.isTypeOperatorNode(obj)) obj = obj.type;
  while (ts.isParenthesizedTypeNode(obj)) obj = obj.type;
  if (!ts.isTypeQueryNode(obj)) return null;
  return obj.exprName.getText();
}

/**
 * Parses one source file. Returns what it declares:
 *   consts   [{ name, deprecated, builtin }]  exported `as const` string arrays (2+) with a covered name
 *   unions   [{ name, deprecated, builtin }]  exported literal unions (2+, not open) with a covered name
 *   derived  [string]                         aliases of `(typeof CONST)[number]` (names only)
 *   zEnums   [string]                         identifiers passed to `z.enum(...)`
 *   records  [{ symbol, keys: string[] }]     constants typed `Record<K, ...>` (K = the type names used)
 */
export function scanSource(fileName, text, root = DEFAULT_ROOT) {
  const ts = loadTypeScript(root);
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
  const out = { consts: [], unions: [], derived: [], zEnums: [], records: [] };

  const recordKeys = (typeNode) => {
    let t = typeNode;
    while (t && ts.isParenthesizedTypeNode(t)) t = t.type;
    if (!t || !ts.isTypeReferenceNode(t) || t.typeName.getText() !== 'Record' || !t.typeArguments?.length) return null;
    const key = t.typeArguments[0];
    return ts.isTypeReferenceNode(key) ? [key.typeName.getText()] : [];
  };

  const visit = (node) => {
    if (ts.isVariableStatement(node)) {
      const exported = hasExportModifier(ts, node);
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        const name = decl.name.text;
        if (exported && isFlaggedConstName(name) && decl.initializer) {
          const values = constStringArray(ts, decl.initializer);
          if (values && values.length >= 2) {
            out.consts.push({ name, deprecated: hasDeprecatedTag(ts, node), builtin: isBuiltinName(name) });
          }
        }
        // (d): Record<K, ...> as annotation, `satisfies` or `as`.
        const typeNodes = [];
        if (decl.type) typeNodes.push(decl.type);
        let init = decl.initializer;
        while (init && (ts.isParenthesizedExpression(init) || ts.isSatisfiesExpression(init) || ts.isAsExpression(init))) {
          if (!ts.isParenthesizedExpression(init)) typeNodes.push(init.type);
          init = init.expression;
        }
        for (const tn of typeNodes) {
          const keys = recordKeys(tn);
          if (keys) out.records.push({ symbol: name, keys });
        }
      }
    } else if (ts.isTypeAliasDeclaration(node)) {
      const name = node.name.text;
      const derived = derivedFromConst(ts, node.type);
      if (derived) out.derived.push({ name, from: derived });
      if (hasExportModifier(ts, node) && isFlaggedTypeName(name)) {
        const { literals, open } = unionInfo(ts, node.type);
        if (literals >= 2 && !open) {
          out.unions.push({ name, deprecated: hasDeprecatedTag(ts, node), builtin: isBuiltinName(name) });
        }
      }
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === 'enum' &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === 'z' &&
        node.arguments.length > 0
      ) {
        const arg = unwrap(ts, node.arguments[0]);
        if (ts.isIdentifier(arg)) out.zEnums.push(arg.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, out);
    } else if (entry.isFile() && SOURCE_EXT.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Every scanned source file as `{ rel (to the repo root, forward slashes), pkg, inSrc, text }`. */
export function sourceFiles(root) {
  const packagesDir = join(root, 'packages');
  const files = [];
  if (!existsSync(packagesDir)) return files;
  for (const pkg of readdirSync(packagesDir).sort()) {
    if (!pkg.startsWith('platform-')) continue;
    const src = join(packagesDir, pkg, 'src');
    if (!statSync(src, { throwIfNoEntry: false })?.isDirectory()) continue;
    for (const file of walk(src).sort()) {
      const inSrc = relative(src, file);
      if (isTestPath(inSrc)) continue;
      files.push({ rel: relative(root, file).split(sep).join('/'), pkg, inSrc: inSrc.split(sep).join('/'), text: readFileSync(file, 'utf8') });
    }
  }
  return files;
}

/**
 * All findings of a repository: `[{ file, symbol, rule, deprecated }]`, sorted,
 * with `rule` one of `const`, `union`, `z.enum`, `record`.
 */
export function findClosedLists(root = DEFAULT_ROOT) {
  const scanned = sourceFiles(root).map((f) => ({ ...f, scan: scanSource(f.rel, f.text, root) }));

  // Names tracked across files: every covered const and union, BUILTIN included,
  // plus aliases derived from a tracked const.
  const trackedConsts = new Set();
  const trackedUnions = new Set();
  for (const f of scanned) {
    for (const c of f.scan.consts) trackedConsts.add(c.name);
    for (const u of f.scan.unions) trackedUnions.add(u.name);
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (const f of scanned) {
      for (const d of f.scan.derived) {
        if (trackedConsts.has(d.from) && !trackedUnions.has(d.name)) {
          trackedUnions.add(d.name);
          changed = true;
        }
      }
    }
  }

  const findings = [];
  for (const f of scanned) {
    for (const c of f.scan.consts) {
      if (!c.builtin) findings.push({ file: f.rel, symbol: c.name, rule: 'const', deprecated: c.deprecated });
    }
    for (const u of f.scan.unions) {
      if (!u.builtin) findings.push({ file: f.rel, symbol: u.name, rule: 'union', deprecated: u.deprecated });
    }
    if (f.pkg === 'platform-contract') {
      for (const name of new Set(f.scan.zEnums)) {
        if (trackedConsts.has(name)) findings.push({ file: f.rel, symbol: `z.enum(${name})`, rule: 'z.enum', deprecated: false });
      }
    }
    if (f.pkg === 'platform-web' && /(?:^|\/)ui\//.test(f.inSrc)) {
      for (const r of f.scan.records) {
        if (r.keys.some((k) => trackedUnions.has(k))) findings.push({ file: f.rel, symbol: r.symbol, rule: 'record', deprecated: false });
      }
    }
  }
  const seen = new Set();
  return findings
    .filter((x) => {
      const key = `${x.file}\0${x.symbol}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (a.file === b.file ? a.symbol.localeCompare(b.symbol) : a.file.localeCompare(b.file)));
}

/** Reads the allowlist (`{ entries: [{ file, symbol, reason }] }`); a missing file is an empty list. */
export function readAllowlist(root = DEFAULT_ROOT) {
  const path = join(root, ALLOWLIST_PATH);
  if (!existsSync(path)) return [];
  const json = JSON.parse(readFileSync(path, 'utf8'));
  return Array.isArray(json.entries) ? json.entries : [];
}

/**
 * Compares findings with the allowlist. Returns violations
 * `[{ rule, message }]`, rule one of `new`, `stale`, `entry`, `deprecated`.
 */
export function checkClosedLists(findings, entries) {
  const violations = [];
  const byKey = new Map();
  entries.forEach((e, i) => {
    const where = `${ALLOWLIST_PATH} entry ${i + 1}`;
    if (!e || typeof e.file !== 'string' || typeof e.symbol !== 'string' || typeof e.reason !== 'string') {
      violations.push({ rule: 'entry', message: `${where}: needs string "file", "symbol" and "reason"` });
      return;
    }
    if (e.reason.trim().length < MIN_REASON) {
      violations.push({ rule: 'entry', message: `${where} (${e.file} ${e.symbol}): the reason must say why it stays closed (at least ${MIN_REASON} characters)` });
    }
    const key = `${e.file}\0${e.symbol}`;
    if (byKey.has(key)) violations.push({ rule: 'entry', message: `${where}: ${e.file} ${e.symbol} is listed twice` });
    byKey.set(key, e);
  });

  const found = new Set();
  for (const f of findings) {
    const key = `${f.file}\0${f.symbol}`;
    found.add(key);
    const entry = byKey.get(key);
    if (!entry) {
      violations.push({ rule: 'new', message: `${f.file}: ${f.symbol} is a closed id list (${f.rule}). ${HINT}` });
    } else if (f.deprecated && !/^deprecated alias of /.test(entry.reason)) {
      violations.push({ rule: 'deprecated', message: `${f.file}: ${f.symbol} is tagged @deprecated; its allowlist reason must start with "deprecated alias of <BUILTIN_X>"` });
    }
  }
  for (const [key, e] of byKey) {
    if (!found.has(key)) {
      violations.push({ rule: 'stale', message: `${ALLOWLIST_PATH}: ${e.file} ${e.symbol} is no longer a closed list there (removed, renamed or opened); delete the entry` });
    }
  }
  return violations;
}

/** Scans a repository and compares it with its allowlist. */
export function checkRepository(root = DEFAULT_ROOT) {
  const findings = findClosedLists(root);
  const violations = checkClosedLists(findings, readAllowlist(root));
  return { findings, violations };
}

function main(argv) {
  let root = DEFAULT_ROOT;
  let print = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--root') root = resolve(argv[++i] ?? '');
    else if (argv[i] === '--print') print = true;
    else {
      console.error(`check-closed-lists: unknown argument ${argv[i]}\nUsage: node scripts/check-closed-lists.mjs [--root <dir>] [--print]`);
      return 2;
    }
  }
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    console.error(`check-closed-lists: ${root} is not a directory`);
    return 2;
  }
  const { findings, violations } = checkRepository(root);
  if (print) {
    console.log(JSON.stringify(findings.map(({ file, symbol }) => ({ file, symbol, reason: 'TODO' })), null, 2));
    return 0;
  }
  if (violations.length > 0) {
    console.error(`check-closed-lists: ${violations.length} violation(s)\n`);
    for (const v of violations) console.error(`  [${v.rule}] ${v.message}`);
    console.error('\nSee docs/PACKAGES.md#closed-id-lists.');
    return 1;
  }
  console.log(`check-closed-lists: ${findings.length} closed list(s), every one allowlisted with a reason, no stale entry.`);
  return 0;
}

const isDirectExecution = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectExecution) {
  process.exitCode = main(process.argv.slice(2));
}

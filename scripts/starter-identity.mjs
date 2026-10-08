#!/usr/bin/env node
// =============================================================================
// scripts/starter-identity.mjs — no identity left behind (issue #741)
// =============================================================================
//
// The starter's identity (`starter/packages/shared/identity.json`) is a
// placeholder. Every runtime read derives from that file, so the only places
// its values may appear as literals are the definition itself, the literal
// targets of the starter's rename plan, and the infra/ files platform-infra
// sync renders FROM it. This module finds every other occurrence:
//
//   - in starter/ itself (apps/cli/src/template-identity.test.ts), so new
//     starter code cannot hard-code the name the rename would miss;
//   - in a project `new-project.mjs create` produced (new-project-script.test.ts
//     and the CI `starter` job), where NO value of the starter's identity may
//     survive at all, apart from platform text copied verbatim from the
//     packages (the composed Prisma schema and the installed migrations).
//
// Usage: node scripts/starter-identity.mjs --root <created project> [--old <identity.json>]
// Exit: 0 clean, 1 findings, 2 usage error. Node built-ins only; importing it
// runs nothing.
// =============================================================================

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { buildStarterPlan, derive } from '../starter/scripts/rename.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const STARTER_DIR = join(REPO_ROOT, 'starter');
export const IDENTITY_FILE = 'packages/shared/identity.json';

/** The platform repository, which an app's docs link to (package READMEs, the seam-request template). */
export const PLATFORM_REPO_URL = 'https://github.com/marinoscar/EnterpriseAppBase';

const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git']);
const BINARY = /\.(png|ico|jpg|jpeg|gif|woff2?|ttf|pdf|zip|tgz)$/i;

/** Platform text copied verbatim from the packages: it may name the platform's own example CLI. */
export function isVerbatimPlatformFile(rel) {
  return rel.startsWith('apps/api/prisma/schema/') || rel.startsWith('apps/api/prisma/migrations/') || rel === 'apps/api/prisma/platform.lock';
}

export function readIdentity(root) {
  return JSON.parse(readFileSync(join(root, IDENTITY_FILE), 'utf8'));
}

/** Every file under `root`, relative, `/`-separated, without installs and build output. */
export function listFiles(root, dir = root) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(root, path));
    else out.push(relative(root, path).split('\\').join('/'));
  }
  return out.sort();
}

/** The files platform-infra sync rendered from the identity (its lock lists them). */
export function infraRenderedFiles(root) {
  const lockPath = join(root, 'infra', 'platform-infra.lock.json');
  if (!existsSync(lockPath)) return new Set();
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  return new Set(Object.values(lock.fragments ?? {}).flatMap((fragment) => Object.keys(fragment.files ?? {})));
}

/**
 * The literal values of one identity worth searching for, each with its
 * pattern: word boundaries at a word-character end, none after a prefix
 * (`APPCTL_` must match `APPCTL_TOKEN`). The bare owner is not searched for
 * (too generic), nor the colours (ambiguous; the SVG anchors cover them).
 */
export function identityPatterns(identity) {
  const d = derive(identity);
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = (value, { prefix = false } = {}) => {
    const lead = /^\w/.test(value) ? '\\b' : '';
    const tail = !prefix && /\w$/.test(value) ? '\\b' : '';
    return { value, re: new RegExp(`${lead}${escape(value)}${tail}`) };
  };
  return [
    pattern(d.productName),
    pattern(d.repoSlug),
    pattern(d.repoName),
    pattern(d.slug),
    pattern(d.cliName),
    pattern(d.envPrefix, { prefix: true }),
    pattern(d.testDb),
  ].filter((entry, index, all) => all.findIndex((other) => other.value === entry.value) === index);
}

/** A line with the platform repository's links removed: an app's docs may link the platform. */
function withoutPlatformLinks(line) {
  return line.split(PLATFORM_REPO_URL).join('');
}

/**
 * Occurrences of `identity`'s values in `files` (relative to `root`).
 * `exempt(file, line)` excuses a line; verbatim platform files are skipped.
 */
export function findIdentityLiterals(root, files, identity, exempt = () => false) {
  const patterns = identityPatterns(identity);
  const findings = [];
  for (const file of files) {
    if (BINARY.test(file) || isVerbatimPlatformFile(file)) continue;
    let text;
    try {
      text = readFileSync(join(root, file), 'utf8');
    } catch {
      continue;
    }
    text.split('\n').forEach((line, index) => {
      if (exempt(file, line)) return;
      const scanned = withoutPlatformLinks(line);
      for (const { value, re } of patterns) {
        if (re.test(scanned)) findings.push({ file, line: index + 1, value, text: line.trim().slice(0, 160) });
      }
    });
  }
  return findings;
}

/**
 * The exemption for starter/ itself: the definition, the lines that ARE the
 * rename plan's output for the current identity, and the infra files sync
 * renders from it.
 */
export function starterExemption(root = STARTER_DIR) {
  const identity = readIdentity(root);
  const placeholder = derive({
    productName: '__placeholder_product__',
    tagline: '__placeholder_tagline__',
    repoSlug: 'placeholder-owner/placeholder-repo',
    themeColor: '#000000',
    backgroundColor: '#000000',
    cliName: 'placeholder-cli',
  });
  const outputs = new Map();
  for (const edit of buildStarterPlan(placeholder, derive(identity))) {
    // A line never carries its own newline, so an anchor ending in one is compared without it.
    outputs.set(edit.file, [...(outputs.get(edit.file) ?? []), edit.replace.replace(/\n$/, '')]);
  }
  // The lock records the identity the fragments were rendered for.
  const rendered = new Set([...infraRenderedFiles(root), 'infra/platform-infra.lock.json']);
  return (file, line) =>
    file === IDENTITY_FILE || rendered.has(file) || (outputs.get(file) ?? []).some((literal) => line.includes(literal));
}

function main(argv) {
  let root;
  let oldPath = join(STARTER_DIR, IDENTITY_FILE);
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--root') root = resolve(argv[++i] ?? '');
    else if (argv[i] === '--old') oldPath = resolve(argv[++i] ?? '');
    else {
      console.error(`starter-identity: unknown argument ${argv[i]}`);
      return 2;
    }
  }
  if (!root) {
    console.error('Usage: node scripts/starter-identity.mjs --root <created project> [--old <identity.json>]');
    return 2;
  }
  const old = JSON.parse(readFileSync(oldPath, 'utf8'));
  const findings = findIdentityLiterals(root, listFiles(root), old);
  if (findings.length === 0) {
    console.log(`starter-identity: no value of the starter identity (${old.productName}, ${old.repoSlug}, ${old.cliName}) is left in ${root}.`);
    return 0;
  }
  console.error(`starter-identity: ${findings.length} leftover(s) of the starter identity in ${root}:`);
  for (const f of findings) console.error(`  ${f.file}:${f.line}  [${f.value}]  ${f.text}`);
  return 1;
}

const isDirectExecution = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectExecution) process.exitCode = main(process.argv.slice(2));

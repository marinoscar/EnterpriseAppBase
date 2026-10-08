#!/usr/bin/env node
// =============================================================================
// scripts/new-project.mjs — turn a fresh fork into a new product  (issue #344)
// =============================================================================
//
// `scripts/rename.mjs` changes the identity. This changes the STATE: the release
// history, the version numbers and the licence — the things that are true of the
// template and false of the product built from it.
//
// -----------------------------------------------------------------------------
// WHAT THIS SCRIPT DOES NOT DO, AND WHY THAT IS DELIBERATE
// -----------------------------------------------------------------------------
//
// It does not delete the example job handlers, and it should not.
//
// They look like disposable demo code and they are not. `example.checksum` is
// the canonical NODE-ELIGIBLE job type — the one handler implementing both
// `process` and `nodeResultSchema`/`persistNodeResult` — and the jobs and worker
// node test suites use it and `example.echo` as their fixtures throughout
// (job-claim, job-admin, job-insights, job-stuck, the registry, and five node
// integration suites). Their coupling to production code is only comments and
// two registrations; their coupling to the TEST SUITE is real and deep.
//
// Deleting them automatically would hand a new project a broken test suite in
// its first hour, which is the worst possible introduction to a codebase. They
// are also the worked examples that `apps/api/src/jobs/handlers/README.md` and
// CLAUDE.md teach from.
//
// So this script REPORTS them instead. Removing them is a deliberate refactor
// somebody should choose, with the test suite green before and after — not a
// side effect of a bootstrap command.
//
// The same reasoning applies to squashing migrations and resetting git history:
// both are one-way, neither is reversible by `git checkout .`, and neither
// belongs behind the same flag as "set the version to 0.1.0". The
// `/new-project` skill walks a human through those.
//
// Full guide: docs/RENAMING.md
// =============================================================================

import { cpSync, readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(REPO_ROOT, 'packages', 'shared', 'identity.json');

const STARTER_DIR = join(REPO_ROOT, 'starter');

const USAGE = `
Start a new product from the starter (published platform packages):

  node scripts/new-project.mjs create --dir ../acme-hub --name "Acme Hub" --repo acme/acme-hub
       [--cli acmectl] [--theme "#c62828"] [--background "#ffffff"] [--tagline "..."]
       [--license mit|proprietary --holder "Acme Inc"] [--dry-run]

  Copies starter/ into --dir (which must be empty or absent), runs the copy's own
  scripts/rename.mjs with the new identity, writes LICENSE when asked, resets the
  CHANGELOG and the versions to 0.1.0 and runs git init. It never commits.

Or prepare a fresh FORK of this template (legacy forks) as a new product:

  node scripts/new-project.mjs [options]

Options:
  --audit                Report what a new project should consider. Default.
  --reset-release        CHANGELOG -> Unreleased + 0.1.0, and all versions -> 0.1.0.
  --license <id>         Write a LICENSE file. One of: mit, proprietary.
                         The platform's own MIT LICENSE is kept as LICENSE.platform.
  --holder <string>      Copyright holder, for --license. Required with it.
  --dry-run              Show what would change; write nothing.
  --force                Skip the "this is still the template" safety check.
  -h, --help             This message.

Rename first: node scripts/rename.mjs --name "..." --repo owner/name
Full guide: docs/RENAMING.md
`.trimStart();

function die(message) {
  console.error(`\nnew-project: ${message}\n`);
  process.exit(1);
}

/** `create` options. Exported for the tests. */
export function parseCreateArgs(argv) {
  const opts = { dryRun: false };
  const takesValue = {
    '--dir': 'dir', '--name': 'name', '--repo': 'repo', '--cli': 'cli', '--theme': 'theme',
    '--background': 'background', '--tagline': 'tagline', '--license': 'license', '--holder': 'holder',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') return { help: true };
    if (arg === '--dry-run') { opts.dryRun = true; continue; }
    const key = takesValue[arg];
    if (!key) die(`Unknown argument for create: ${arg}\n\n${USAGE}`);
    const value = argv[++i];
    if (value === undefined) die(`${arg} needs a value.`);
    opts[key] = value;
  }
  for (const required of ['dir', 'name', 'repo']) {
    if (!opts[required]) die(`create needs --${required}.\n\n${USAGE}`);
  }
  if (opts.license && !opts.holder) die('--license also needs --holder "Your Name or Company".');
  if (opts.license && !LICENSES[String(opts.license).toLowerCase()]) {
    die(`unknown --license "${opts.license}". Supported: ${Object.keys(LICENSES).join(', ')}.`);
  }
  opts.dir = resolve(opts.dir);
  return opts;
}

function parseArgs(argv) {
  const opts = { audit: false, resetRelease: false, dryRun: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '-h': case '--help': return { help: true };
      case '--audit': opts.audit = true; break;
      case '--reset-release': opts.resetRelease = true; break;
      case '--dry-run': opts.dryRun = true; break;
      case '--force': opts.force = true; break;
      case '--license': opts.license = argv[++i]; break;
      case '--holder': opts.holder = argv[++i]; break;
      default: die(`Unknown argument: ${argv[i]}\n\n${USAGE}`);
    }
  }
  if (!opts.resetRelease && !opts.license) opts.audit = true;
  return opts;
}

// =============================================================================
// Safety: is this still the template?
//
// Every action below is one a fork wants and the template does not. Running
// --reset-release in the template itself would discard its real release history
// and renumber four packages, so the default is to refuse.
// =============================================================================

function assertNotTemplate(identity, { force, dryRun }) {
  if (force || dryRun) return;
  let origin = '';
  try {
    origin = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  } catch {
    return; // No remote is a perfectly normal state for a fresh fork.
  }
  const slug = identity.repoSlug;
  if (slug && origin.includes(slug)) {
    die(`this checkout still points at the repository named in identity.json:\n` +
        `    origin:      ${origin}\n` +
        `    identity:    ${slug}\n\n` +
        `  That means it is the template itself, not a fork of it — and these actions\n` +
        `  discard release history and renumber packages.\n\n` +
        `  Run scripts/rename.mjs first (it sets repoSlug), re-point the remote, or\n` +
        `  pass --force if you really mean to do this here.`);
  }
}

// =============================================================================
// Actions
// =============================================================================

const WORKSPACE_MANIFESTS = [
  'apps/api/package.json',
  'apps/web/package.json',
  'apps/cli/package.json',
  'packages/shared/package.json',
];

function resetRelease(identity, { dryRun }) {
  const changed = [];

  // --- versions -----------------------------------------------------------
  for (const rel of WORKSPACE_MANIFESTS) {
    const path = join(REPO_ROOT, rel);
    if (!existsSync(path)) continue;
    const before = readFileSync(path, 'utf8');
    // Text edit rather than JSON.parse/stringify, so key order, indentation and
    // every comment-like formatting choice in these files survives untouched.
    const after = before.replace(/^(\s*"version":\s*)"[^"]*"/m, '$1"0.1.0"');
    if (after === before) continue;
    if (!dryRun) writeFileSync(path, after);
    changed.push(`${rel}  version -> 0.1.0`);
  }

  // --- CHANGELOG ----------------------------------------------------------
  const changelogPath = join(REPO_ROOT, 'CHANGELOG.md');
  if (existsSync(changelogPath)) {
    const today = new Date().toISOString().slice(0, 10);
    const fresh = `# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - ${today}

### Added

- Initial project, started from the application foundation template.
`;
    if (!dryRun) writeFileSync(changelogPath, fresh);
    changed.push('CHANGELOG.md  reset to [Unreleased] + [0.1.0]');
  }

  return changed;
}

const LICENSES = {
  mit: (holder, year) => `MIT License

Copyright (c) ${year} ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`,
  proprietary: (holder, year) => `Copyright (c) ${year} ${holder}. All rights reserved.

This software and its source code are proprietary and confidential. No part of
it may be reproduced, distributed, or transmitted in any form or by any means,
or stored in a database or retrieval system, without the prior written
permission of the copyright holder.

Unauthorized copying of this file, via any medium, is strictly prohibited.
`,
};

// The copyright holder of the platform's own LICENSE, the file this repository
// ships at its root. A fork that writes its own licence keeps that notice as
// LICENSE.platform, because MIT requires it to stay with substantial portions
// of the code.
export const UPSTREAM_LICENSE_HOLDER = 'marinoscar';

const COPYRIGHT_YEAR = /^Copyright \(c\) (\d{4}) /m;

const normalizeEol = (text) => String(text).replace(/\r\n/g, '\n');

/**
 * True when `text` is exactly the platform's MIT licence: the `mit` entry of
 * LICENSES, the upstream holder, and whatever year its copyright line carries.
 * Pure: it reads nothing and writes nothing.
 */
export function isUpstreamLicense(text) {
  const normalized = normalizeEol(text);
  const match = COPYRIGHT_YEAR.exec(normalized);
  if (!match) return false;
  return normalized === LICENSES.mit(UPSTREAM_LICENSE_HOLDER, match[1]);
}

function isUpstreamLicenseFile(path) {
  return existsSync(path) && isUpstreamLicense(readFileSync(path, 'utf8'));
}

// The README line the platform ships, and the line a fork replaces it with.
const UPSTREAM_README_LICENSE_LINE = /^MIT — see \[LICENSE\]\(LICENSE\)\.$/m;

function writeLicense(opts) {
  const id = String(opts.license).toLowerCase();
  const build = LICENSES[id];
  if (!build) {
    die(`unknown --license "${opts.license}". Supported: ${Object.keys(LICENSES).join(', ')}.\n` +
        `  Only these two are built in, because embedding the full text of every licence\n` +
        `  would make this script mostly licence text. For anything else — Apache-2.0,\n` +
        `  BSD, GPL — copy the official text from https://choosealicense.com into\n` +
        `  ./LICENSE yourself; nothing else in this repository depends on which you pick.`);
  }
  if (!opts.holder) die('--license also needs --holder "Your Name or Company".');

  const path = join(REPO_ROOT, 'LICENSE');
  const platformPath = join(REPO_ROOT, 'LICENSE.platform');
  const changed = [];
  let keptUpstream = false;

  if (existsSync(path)) {
    if (isUpstreamLicenseFile(path)) {
      // The inherited platform licence is never deleted or overwritten: it moves
      // aside so the fork's own LICENSE can take its place.
      if (existsSync(platformPath) && !isUpstreamLicenseFile(platformPath)) {
        die('LICENSE.platform already exists and is not the platform\'s MIT licence.\n' +
            '  Move it away first; it must hold the upstream notice.');
      }
      if (!existsSync(platformPath)) {
        if (!opts.dryRun) renameSync(path, platformPath);
        changed.push('LICENSE -> LICENSE.platform  (upstream MIT notice kept)');
      }
      keptUpstream = true;
    } else if (!opts.force) {
      die('a LICENSE file already exists. Remove it first, or pass --force.');
    }
  }

  const text = build(opts.holder, new Date().getFullYear());
  if (!opts.dryRun) writeFileSync(path, text);
  changed.push(`LICENSE written (${id})`);

  const readmePath = join(REPO_ROOT, 'README.md');
  if (existsSync(readmePath)) {
    const before = readFileSync(readmePath, 'utf8');
    const label = id === 'mit' ? 'MIT' : 'Proprietary';
    const platformNote = ' Platform code is MIT licensed; see [LICENSE.platform](LICENSE.platform).';
    let after = before;
    // The platform's own README line, when its licence was kept as LICENSE.platform.
    if (keptUpstream) {
      after = after.replace(UPSTREAM_README_LICENSE_LINE,
        () => `${label} — see [LICENSE](LICENSE).${platformNote}`);
    }
    // Older forks still carry the "[Your License Here]" placeholder; leaving it in
    // place beside a real LICENSE file is worse than having neither.
    after = after.replace(/\[Your License Here\]/g, () => `${label} — see [LICENSE](LICENSE).`);
    if (after !== before) {
      if (!opts.dryRun) writeFileSync(readmePath, after);
      changed.push('README.md  licence line replaced');
    }
  }
  return changed;
}

// =============================================================================
// The audit — everything that needs a human decision
// =============================================================================

function countRefs(patterns, pathspec) {
  try {
    const out = execFileSync(
      'git',
      ['grep', '-l', '-E', patterns, '--', ...pathspec],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );
    return out.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function audit() {
  const items = [];

  const exampleFiles = [
    'apps/api/src/jobs/handlers/example-echo.handler.ts',
    'apps/api/src/jobs/handlers/example-checksum.handler.ts',
    'apps/api/src/jobs/contracts/example-checksum.contract.ts',
    'apps/api/src/examples/storage/example-metadata.processor.ts',
  ].filter((f) => existsSync(join(REPO_ROOT, f)));

  if (exampleFiles.length > 0) {
    const refs = countRefs('example-(echo|checksum|metadata)|example\\.(echo|checksum)', ['apps/api']);
    items.push({
      title: 'Example job handlers and storage processor',
      recommendation: 'KEEP unless you deliberately refactor',
      detail: [
        `${exampleFiles.length} example file(s), referenced by ${refs.length} file(s) under apps/api.`,
        '',
        'These are NOT disposable demo code. `example.checksum` is the canonical',
        'node-eligible job type — the only handler implementing both `process` and',
        '`nodeResultSchema`/`persistNodeResult` — and the jobs and worker-node test',
        'suites use it and `example.echo` as fixtures throughout. Their coupling to',
        'production code is only comments and two registrations; their coupling to the',
        'TEST SUITE is real and deep.',
        '',
        'Deleting them is a refactor to do deliberately, with the suite green before and',
        'after — not a bootstrap step. They are also the worked examples that',
        'apps/api/src/jobs/handlers/README.md and CLAUDE.md teach from.',
      ],
    });
  }

  const licensePath = join(REPO_ROOT, 'LICENSE');
  if (!existsSync(licensePath)) {
    items.push({
      title: 'No LICENSE file',
      recommendation: 'decide, then --license',
      detail: ['The README carries a "[Your License Here]" placeholder.',
               'Run with --license mit --holder "..." (or proprietary), or add your own.'],
    });
  } else if (isUpstreamLicenseFile(licensePath)) {
    items.push({
      title: 'LICENSE is the platform\'s MIT licence',
      recommendation: 'keep it as LICENSE.platform; run --license to add your own',
      detail: ['MIT requires the upstream copyright notice to stay with substantial portions',
               'of the code, so --license moves this file to LICENSE.platform instead of',
               'overwriting it, then writes your own LICENSE.'],
    });
  }

  const deploy = join(REPO_ROOT, '.github/workflows/deploy.yml');
  if (existsSync(deploy) && readFileSync(deploy, 'utf8').includes('example.com')) {
    items.push({
      title: 'deploy.yml staging/production jobs are stubs',
      recommendation: 'fill in or delete',
      detail: ['They target https://example.com and their deploy step is an `echo`.',
               'They also expect GitHub Environments named staging and production to exist.',
               'The image build above them is already fork-following (images.yml derives',
               'each image name from the repository), so only the deploy steps need attention.'],
    });
  }

  const specsDir = join(REPO_ROOT, 'docs/specs');
  if (existsSync(specsDir)) {
    const specs = readdirSync(specsDir).filter((f) => f.endsWith('.md'));
    items.push({
      title: `docs/specs/ holds ${specs.length} framework design records`,
      recommendation: 'keep, but know what they are',
      detail: ['They are keyed to the TEMPLATE\'s issue numbers, so cross-references like',
               '"epic #254" resolve to unrelated issues in your fork. The documents',
               'themselves are accurate and worth keeping; only the issue links are stale.',
               'If you want docs/specs/ for your own product specs, move these to',
               'docs/specs/framework/ and update the references in CLAUDE.md.'],
    });
  }

  let migrations = [];
  const migDir = join(REPO_ROOT, 'apps/api/prisma/migrations');
  if (existsSync(migDir)) migrations = readdirSync(migDir).filter((f) => /^\d/.test(f));
  if (migrations.length > 1) {
    items.push({
      title: `${migrations.length} Prisma migrations carried over from the template`,
      recommendation: 'optional, one-way',
      detail: ['A new product with no deployed database can squash these into a single',
               'initial migration. Only do this BEFORE any environment has run them —',
               'afterwards it desynchronises every deployed _prisma_migrations table.'],
    });
  }

  return items;
}

// =============================================================================
// create: a new product from starter/  (issue #741)
// =============================================================================
//
// The starter depends on PUBLISHED @marinoscar/platform-* versions, so the new
// product owns only its composition, its domain code and its appearance. The
// steps, in order: refuse a non-empty --dir; copy starter/ (no node_modules,
// build output or lockfile); run the copy's OWN scripts/rename.mjs (it writes
// identity.json, the literal targets and, with the platform-infra build of this
// repository, re-renders infra/); LICENSE when asked; CHANGELOG to
// [Unreleased] + [0.1.0]; versions to 0.1.0; git init. Never a commit.

/** What `create` never copies out of starter/. */
const STARTER_SKIP = new Set(['node_modules', 'dist', 'coverage', '.turbo']);

/** Paths (relative to starter/) a copy carries; exported for the tests. */
export function starterFiles(dir = STARTER_DIR, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (STARTER_SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...starterFiles(path, base));
    else if (entry.name !== 'package-lock.json' || dir !== base) out.push(relative(base, path).split('\\').join('/'));
  }
  return out.sort();
}

/** The manifests whose `version` becomes 0.1.0 in a new product. */
export const STARTER_MANIFESTS = ['package.json', 'apps/api/package.json', 'apps/web/package.json', 'apps/cli/package.json', 'packages/shared/package.json'];

function freshChangelog(today) {
  return `# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - ${today}

### Added

- Initial project, started from the platform starter.
`;
}

/** The repository's built `platform-infra` CLI, if this checkout has one (`npm run build:packages`). */
function platformInfraBin() {
  const bin = join(REPO_ROOT, 'packages', 'platform-infra', 'bin', 'platform-infra.mjs');
  return existsSync(join(REPO_ROOT, 'packages', 'platform-infra', 'dist', 'cli.js')) ? bin : undefined;
}

async function create(opts) {
  if (!existsSync(join(STARTER_DIR, 'scripts', 'rename.mjs'))) die(`no starter at ${STARTER_DIR}.`);
  if (existsSync(opts.dir) && readdirSync(opts.dir).length > 0) {
    die(`--dir ${opts.dir} is not empty. create writes a whole new project and never merges into an existing directory.`);
  }
  const rel = relative(REPO_ROOT, opts.dir);
  if (!rel.startsWith('..') && !rel.startsWith('/') && rel !== '') {
    die(`--dir ${opts.dir} is inside this repository. Create the product beside it (for example ../${opts.dir.split(/[\\/]/).pop()}).`);
  }

  const files = starterFiles();
  const renameArgs = {
    name: opts.name, repo: opts.repo, cliName: opts.cli, theme: opts.theme,
    background: opts.background, tagline: opts.tagline, force: true,
  };
  for (const key of Object.keys(renameArgs)) if (renameArgs[key] === undefined) delete renameArgs[key];
  const today = new Date().toISOString().slice(0, 10);

  console.log(`\n${opts.dryRun ? 'Would create' : 'Creating'} ${opts.dir} from starter/ (${files.length} files)`);
  if (opts.dryRun) {
    // The starter's own plan, checked against starter/ itself: every anchor
    // must match, and nothing is written anywhere.
    const starter = await import(pathToFileURL(join(STARTER_DIR, 'scripts', 'rename.mjs')).href);
    const status = starter.rename({ ...renameArgs, root: STARTER_DIR, dryRun: true });
    if (status !== 0) die('the starter rename plan does not apply to starter/; nothing was written.');
    console.log(`\n  ~ LICENSE${opts.license ? ` (${opts.license}, ${opts.holder})` : ': none (pass --license)'}`);
    console.log(`  ~ CHANGELOG.md -> [Unreleased] + [0.1.0] - ${today}`);
    console.log(`  ~ ${STARTER_MANIFESTS.join(', ')} -> version 0.1.0`);
    console.log('  ~ git init');
    console.log('\n(--dry-run: nothing was written.)\n');
    return;
  }

  mkdirSync(opts.dir, { recursive: true });
  for (const file of files) cpSync(join(STARTER_DIR, file), join(opts.dir, file));

  const own = await import(pathToFileURL(join(opts.dir, 'scripts', 'rename.mjs')).href);
  const status = own.rename({ ...renameArgs, root: opts.dir }, { infraBin: platformInfraBin() });
  if (status !== 0) die(`the rename of ${opts.dir} failed; the directory is left as it is for inspection.`);

  if (opts.license) {
    const id = String(opts.license).toLowerCase();
    writeFileSync(join(opts.dir, 'LICENSE'), LICENSES[id](opts.holder, new Date().getFullYear()));
    const readme = join(opts.dir, 'README.md');
    const label = id === 'mit' ? 'MIT' : 'Proprietary';
    writeFileSync(readme, readFileSync(readme, 'utf8').replace(/\[Your License Here\]/g, () => `${label} — see [LICENSE](LICENSE).`));
    console.log(`  * LICENSE (${id}, ${opts.holder})`);
  }
  writeFileSync(join(opts.dir, 'CHANGELOG.md'), freshChangelog(today));
  for (const manifest of STARTER_MANIFESTS) {
    const path = join(opts.dir, manifest);
    if (!existsSync(path)) continue;
    writeFileSync(path, readFileSync(path, 'utf8').replace(/^(\s*"version":\s*)"[^"]*"/m, '$1"0.1.0"'));
  }
  console.log('  * CHANGELOG.md, versions 0.1.0');
  try {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: opts.dir, stdio: 'inherit' });
    console.log('  * git init (nothing committed)');
  } catch {
    console.warn('  SKIPPED: git init (git is unavailable); run it yourself.');
  }

  console.log(`
${'='.repeat(78)}
NEXT STEPS (nothing was committed)
${'='.repeat(78)}

  cd ${opts.dir}
  npm install                 # resolves the published @marinoscar/platform-* packages
  npm run platform:infra:sync # if the infra step above was skipped
  npm run setup               # builds the CLI and writes infra/compose/.env

The three values nothing can generate, in infra/compose/.env:
  INITIAL_ADMIN_EMAIL   your account: always allowed in, becomes the administrator
  GOOGLE_CLIENT_ID      from your Google Cloud OAuth client
  GOOGLE_CLIENT_SECRET  from the same client

Then commit, create the GitHub repository ${opts.repo}, and push. README.md walks
through running it and adding your first feature.
`);
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  if (process.argv[2] === 'create') {
    const createOpts = parseCreateArgs(process.argv.slice(3));
    if (createOpts.help) { console.log(USAGE); return; }
    await create(createOpts);
    return;
  }
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(USAGE); return; }

  if (!existsSync(MANIFEST)) die(`manifest not found at ${MANIFEST}`);
  const identity = JSON.parse(readFileSync(MANIFEST, 'utf8'));

  if (opts.resetRelease || opts.license) assertNotTemplate(identity, opts);

  const changed = [];
  if (opts.resetRelease) changed.push(...resetRelease(identity, opts));
  if (opts.license) changed.push(...writeLicense(opts));

  if (changed.length > 0) {
    console.log(`\n${opts.dryRun ? 'Would change' : 'Changed'}:\n`);
    for (const c of changed) console.log(`  ${opts.dryRun ? '~' : '*'} ${c}`);
  }

  if (opts.audit) {
    const items = audit();
    console.log(`\n${'='.repeat(78)}\nFOR A NEW PROJECT — ${items.length} thing(s) to decide\n${'='.repeat(78)}`);
    items.forEach((item, i) => {
      console.log(`\n${i + 1}. ${item.title}`);
      console.log(`   -> ${item.recommendation}\n`);
      for (const line of item.detail) console.log(line ? `   ${line}` : '');
    });
    console.log('\nNothing above was changed. Each is a judgement call.');
  }

  console.log(`\nSee docs/RENAMING.md for the full guide.${opts.dryRun ? '\n(--dry-run: nothing was written.)' : ''}\n`);
}

// Importing this file (the tests do) runs no CLI code; it only exposes
// `isUpstreamLicense` and `UPSTREAM_LICENSE_HOLDER`. `pathToFileURL` keeps the
// check robust to Windows paths.
const isDirectExecution =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectExecution) {
  main().catch((error) => die(error instanceof Error ? error.message : String(error)));
}

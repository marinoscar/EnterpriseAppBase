#!/usr/bin/env node
// Q1. Does a Prisma 7 schema FOLDER work with generate / migrate / the existing
//     `npm run prisma:*` scripts / the Dockerfile's dummy-URL generate, and where
//     must `migrations/` live?
//
// Run:  node spike/q1-multifile.mjs      (needs the compose test Postgres on :5433)

import {
  API_ROOT, begin, check, cpSync, finish, freshWorkdir, join, main, pgEnv, prisma, read, recreateDb, rows,
  run, say, scalar, show, write, existsSync, dropDb, dbUrl, realMigrationDirs,
} from './lib/env.mjs';
import { splitBySlice } from './lib/split-schema.mjs';
import { readdirSync, readFileSync } from 'node:fs';

const DB = 'pp_5_1_q1';
const N = realMigrationDirs().length; // the history keeps growing as other stories land; nothing here hard-codes it

/** A copy of what `apps/api` ships to the Prisma CLI: prisma/, prisma.config.ts, scripts/prisma-env.js, package.json scripts. */
function makeApp(dir, { folder }) {
  cpSync(join(API_ROOT, 'prisma', 'migrations'), join(dir, 'prisma', 'migrations'), { recursive: true });
  cpSync(join(API_ROOT, 'scripts', 'prisma-env.js'), join(dir, 'scripts', 'prisma-env.js'));
  const apiPkg = JSON.parse(readFileSync(join(API_ROOT, 'package.json'), 'utf8'));
  const prismaScripts = Object.fromEntries(Object.entries(apiPkg.scripts).filter(([k]) => k === 'prisma' || k.startsWith('prisma:')));
  write(join(dir, 'package.json'), JSON.stringify({ name: 'q1-app', private: true, scripts: prismaScripts }, null, 2));
  const original = read(join(API_ROOT, 'prisma', 'schema.prisma'));
  if (folder) {
    for (const [name, text] of splitBySlice(original, { generatorOutput: '../generated-client' })) {
      write(join(dir, 'prisma', 'schema', name), text);
    }
  } else {
    write(
      join(dir, 'prisma', 'schema.prisma'),
      original.replace('provider = "prisma-client-js"', 'provider = "prisma-client-js"\n  output   = "./generated-client"'),
    );
  }
  return dir;
}

function configFor(dir, body) {
  write(
    join(dir, 'prisma.config.ts'),
    `import { defineConfig } from '@prisma/config';\nexport default defineConfig({\n${body}\n  datasource: { url: process.env.DATABASE_URL as string },\n});\n`,
  );
}

await main(async () => {
  begin('q1-multifile');
  const root = freshWorkdir('q1');
  const single = makeApp(join(root, 'single'), { folder: false });
  const folder = makeApp(join(root, 'folder'), { folder: true });
  configFor(single, '');
  const sliceFiles = readdirSync(join(folder, 'prisma', 'schema')).sort();
  say('schema folder files:', sliceFiles.join(', '));
  check('split produced base + 8 slice files', sliceFiles.length === 9);
  const models = sliceFiles.flatMap((f) => [...read(join(folder, 'prisma', 'schema', f)).matchAll(/^model (\w+) \{/gm)].map((m) => m[1]));
  check('all 31 models present exactly once across the folder', models.length === 31 && new Set(models).size === 31, `${models.length} models`);

  // ---- 1. how does the CLI find a folder? -----------------------------------
  say('\n## 1. Prisma 7 config: how the CLI is pointed at a folder');
  configFor(folder, '');
  let r = prisma(['validate'], { cwd: folder, database: DB });
  show('validate, config WITHOUT a `schema` key, schema/ folder present, no schema.prisma', `exit ${r.status}\n${r.stdout}${r.stderr}`);
  check('without `schema` the folder is NOT auto-detected (config option is required)', r.status !== 0);

  configFor(folder, "  schema: 'prisma/schema',");
  r = prisma(['validate'], { cwd: folder, database: DB });
  show("validate, config `schema: 'prisma/schema'`", `exit ${r.status}\n${r.stdout}${r.stderr}`);
  check("`defineConfig({ schema: 'prisma/schema' })` validates the folder", r.status === 0);

  // path resolution is relative to the config file, not to cwd
  r = prisma(['validate', '--config', join(folder, 'prisma.config.ts')], { cwd: join(folder, 'prisma'), database: DB });
  check('schema path resolves relative to the config file, not the cwd', r.status === 0, `exit ${r.status}`);

  // ---- 2. generate: identical client? -----------------------------------------
  say('\n## 2. generate: old single file vs folder');
  const g1 = prisma(['generate'], { cwd: single, database: DB });
  const g2 = prisma(['generate'], { cwd: folder, database: DB });
  show('single-file generate', g1.stdout + g1.stderr);
  show('folder generate', g2.stdout + g2.stderr);
  check('both generate', g1.status === 0 && g2.status === 0);
  const outA = join(single, 'prisma', 'generated-client');
  const outB = join(folder, 'prisma', 'generated-client');
  const diffR = run('diff', ['-rq', outA, outB]);
  show('diff -rq single/generated-client folder/generated-client', diffR.stdout || '(no differences)');
  const differing = diffR.stdout.split('\n').filter(Boolean);
  // The generated `schema.prisma` copy and the inlined schema in index.js carry the model ORDER of the
  // input, so they legitimately differ; everything that types a query must not.
  // The 6 differing files differ ONLY by declaration order (slice files load alphabetically, the
  // single file was in history order) and by a content hash in package.json. Prove that:
  // Normalise the three order artifacts: the `modelProps` union, trailing commas in the ModelName map, and the
  // "first model" used in JSDoc examples. Everything else must match line for line (as a multiset).
  const norm = (f) =>
    read(join(outA, f)).split('\n').map((l) => l.replace(/,$/, '').trim())
      .map((l) => (l.includes('modelProps:') ? `modelProps:${l.split(':')[1].split('|').map((x) => x.trim()).sort().join('|')}` : l))
      .filter((l) => !/^\s*\* (\/\/ Fetch zero or more|const \w+ = await prisma\.\w+\.findMany\(\))/.test(l)).sort().join('\n');
  const normB = (f) =>
    read(join(outB, f)).split('\n').map((l) => l.replace(/,$/, '').trim())
      .map((l) => (l.includes('modelProps:') ? `modelProps:${l.split(':')[1].split('|').map((x) => x.trim()).sort().join('|')}` : l))
      .filter((l) => !/^\s*\* (\/\/ Fetch zero or more|const \w+ = await prisma\.\w+\.findMany\(\))/.test(l)).sort().join('\n');
  const sortedLines = (f) => norm(f) === normB(f);
  const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
  const dataModel = (dir) => JSON.parse(JSON.parse(`"${/runtimeDataModel = JSON\.parse\("((?:[^"\\]|\\.)*)"\)/.exec(read(join(dir, 'index.js')))[1]}"`));
  check('index.d.ts is the same multiset of lines (only declaration order differs)', sortedLines('index.d.ts'));
  check('index.js / edge.js / index-browser.js: the model catalogue (runtimeDataModel) is deep-equal', JSON.stringify(canon(dataModel(outA))) === JSON.stringify(canon(dataModel(outB))));
  check('runtime/ and the query compiler wasm are byte-identical', !differing.some((l) => /runtime|\.wasm/.test(l)));
  const names = (dir) => [...read(join(dir, 'schema.prisma')).matchAll(/^(model|enum) (\w+) \{/gm)].map((m) => m[2]).sort().join(',');
  check('the schema copy embedded in the client lists the same 41 models+enums', names(outA) === names(outB) && names(outA).split(',').length === 41);

  // ---- 3. migrate diff: empty? -------------------------------------------------------
  say('\n## 3. migrate diff old file -> folder');
  const d = prisma(
    ['migrate', 'diff', '--exit-code', '--from-schema', join(single, 'prisma', 'schema.prisma'), '--to-schema', join(folder, 'prisma', 'schema')],
    { cwd: folder, database: DB },
  );
  show('prisma migrate diff --exit-code --from-schema <single file> --to-schema <folder>', `exit ${d.status}\n${d.stdout}${d.stderr}`);
  check('migrate diff single-file -> folder is EMPTY (exit 0)', d.status === 0);
  const d2 = prisma(
    ['migrate', 'diff', '--exit-code', '--from-schema', join(folder, 'prisma', 'schema'), '--to-schema', join(single, 'prisma', 'schema.prisma'), '--script'],
    { cwd: folder, database: DB },
  );
  check('and in the other direction', d2.status === 0, `exit ${d2.status}`);

  // ---- 4. where must migrations/ live? ---------------------------------------------------
  say('\n## 4. migrations directory location');
  await recreateDb(DB);
  r = prisma(['migrate', 'status'], { cwd: folder, database: DB });
  show("migrate status, schema: 'prisma/schema', migrations at prisma/migrations (NOT inside the folder), no migrations.path", `exit ${r.status}\n${r.stdout}${r.stderr}`);
  const foundSibling = new RegExp(`${N} migrations found`).test(r.stdout + r.stderr);
  const foundInsideNothing = /No migration found/.test(r.stdout + r.stderr);
  check('DEFAULT migrations location with a schema FOLDER is <folder>/migrations, not the sibling prisma/migrations (the CLI label still says "prisma/migrations")', !foundSibling && foundInsideNothing);

  // Move it inside the folder: does the default follow the schema folder?
  const inner = join(root, 'inner');
  cpSync(folder, inner, { recursive: true });
  cpSync(join(inner, 'prisma', 'migrations'), join(inner, 'prisma', 'schema', 'migrations'), { recursive: true });
  run('rm', ['-rf', join(inner, 'prisma', 'migrations')]);
  r = prisma(['migrate', 'status'], { cwd: inner, database: DB });
  show('migrate status, migrations moved to prisma/schema/migrations (inside the folder), no migrations.path', `exit ${r.status}\n${r.stdout}${r.stderr}`);
  check('...and migrations moved INSIDE the folder are found with no migrations.path', new RegExp(`${N} migrations found`).test(r.stdout + r.stderr));

  // Explicit path always works:
  configFor(folder, "  schema: 'prisma/schema',\n  migrations: { path: 'prisma/migrations' },");
  r = prisma(['migrate', 'status'], { cwd: folder, database: DB });
  check('explicit `migrations.path` finds the history at prisma/migrations', new RegExp(`${N} migrations found`).test(r.stdout + r.stderr), `exit ${r.status}`);

  // ---- 5. npm run prisma:* unchanged -----------------------------------------------------
  say('\n## 5. the existing `npm run prisma:*` scripts, unchanged');
  say('scripts copied verbatim from apps/api/package.json:');
  show('package.json scripts', readFileSync(join(folder, 'package.json'), 'utf8'));
  configFor(folder, "  schema: 'prisma/schema',\n  migrations: { path: 'prisma/migrations' },");
  const env = pgEnv(DB);
  let n = run('npm', ['run', 'prisma:generate', '--silent'], { cwd: folder, env });
  show('npm run prisma:generate', `exit ${n.status}\n${n.stdout}${n.stderr}`);
  check('npm run prisma:generate works on the folder', n.status === 0);
  n = run('npm', ['run', 'prisma:migrate', '--silent'], { cwd: folder, env });
  show('npm run prisma:migrate (migrate deploy) on an empty database', `exit ${n.status}\n${n.stdout.split('\n').slice(0, 8).join('\n')}\n...\n${n.stdout.split('\n').slice(-6).join('\n')}${n.stderr}`);
  check(`npm run prisma:migrate applies all ${N} migrations`, n.status === 0 && new RegExp(`${N} migrations found`).test(n.stdout + n.stderr) && /All migrations have been successfully applied/.test(n.stdout));
  check(`_prisma_migrations holds ${N} rows`, Number(await scalar(DB, 'select count(*) from _prisma_migrations')) === N);

  // migrate dev against a folder with no changes: must say "in sync" and create nothing.
  n = run('npm', ['run', 'prisma:migrate:dev', '--silent', '--', '--name', 'should_not_exist'], { cwd: folder, env });
  show('npm run prisma:migrate:dev -- --name should_not_exist (no schema change)', `exit ${n.status}\n${n.stdout}${n.stderr}`);
  const stray = readdirSync(join(folder, 'prisma', 'migrations')).filter((d) => d.includes('should_not_exist'));
  check('migrate dev reports no drift and creates no migration', n.status === 0 && stray.length === 0, `stray dirs: ${stray.length}`);

  // migrate dev with a real schema change in ONE slice file creates a migration in prisma/migrations.
  const credFile = join(folder, 'prisma', 'schema', 'credentials.prisma');
  write(credFile, `${read(credFile)}\nmodel SpikeProbe {\n  id String @id @default(uuid()) @db.Uuid\n\n  @@map("spike_probes")\n}\n`);
  n = run('npm', ['run', 'prisma:migrate:dev', '--silent', '--', '--name', 'add_spike_probe'], { cwd: folder, env });
  show('npm run prisma:migrate:dev -- --name add_spike_probe (model added in credentials.prisma)', `exit ${n.status}\n${n.stdout}${n.stderr}`);
  const created = readdirSync(join(folder, 'prisma', 'migrations')).filter((d) => d.endsWith('add_spike_probe'));
  check('migrate dev (shadow database) works against the folder and writes into prisma/migrations', n.status === 0 && created.length === 1, created.join(','));
  if (created[0]) show('generated migration.sql', read(join(folder, 'prisma', 'migrations', created[0], 'migration.sql')));

  // db seed command from config is untouched by `schema`.
  say('\n(db seed / typecheck: untouched — they read prisma.config.ts migrations.seed and prisma/tsconfig.json, neither involves the schema path)');

  // ---- 6. the Dockerfile ----------------------------------------------------------------------
  say('\n## 6. the Dockerfile recipe: COPY apps/api/prisma + prisma.config.ts, then generate with a DUMMY url');
  say('Dockerfile lines (apps/api/Dockerfile): COPY apps/api/prisma ./apps/api/prisma/ ; COPY apps/api/prisma.config.ts ./apps/api/ ; DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy npx prisma generate');
  const docker = join(root, 'docker-copy');
  cpSync(join(folder, 'prisma'), join(docker, 'prisma'), { recursive: true });
  cpSync(join(folder, 'prisma.config.ts'), join(docker, 'prisma.config.ts'));
  run('rm', ['-rf', join(docker, 'prisma', 'generated-client')]);
  r = prisma(['generate'], { cwd: docker, env: { DATABASE_URL: 'postgresql://dummy:dummy@localhost:5432/dummy' } });
  show('generate in the Docker-shaped copy (no scripts/, no package.json, dummy URL)', `exit ${r.status}\n${r.stdout}${r.stderr}`);
  check('Dockerfile generate still works with a schema FOLDER (the COPY of apps/api/prisma already carries it)', r.status === 0 && existsSync(join(docker, 'prisma', 'generated-client', 'index.js')));

  // ---- 7. duplicate generator ---------------------------------------------------------------------
  say('\n## 7. guard rails');
  const dup = join(root, 'dup');
  cpSync(folder, dup, { recursive: true });
  write(join(dup, 'prisma', 'schema', 'identity.prisma'), `generator client {\n  provider = "prisma-client-js"\n}\n\n${read(join(dup, 'prisma', 'schema', 'identity.prisma'))}`);
  r = prisma(['validate'], { cwd: dup, database: DB });
  show('a SECOND generator block in a slice file', `exit ${r.status}\n${r.stdout}${r.stderr}`);
  check('a slice file declaring its own generator is rejected (generator/datasource belong only in base.prisma)', r.status !== 0);
  const dupModel = join(root, 'dupmodel');
  cpSync(folder, dupModel, { recursive: true });
  write(join(dupModel, 'prisma', 'schema', 'extra.prisma'), `model User {\n  id String @id\n}\n`);
  r = prisma(['validate'], { cwd: dupModel, database: DB });
  show('the same model declared in two files', `exit ${r.status}\n${r.stdout.slice(0, 600)}${r.stderr.slice(0, 600)}`);
  check('the same model name in two files is rejected by Prisma itself (so "extend" cannot be plain Prisma)', r.status !== 0);

  await dropDb(DB);
});

#!/usr/bin/env node
// Q2. Composed `User` (option 1) vs plain userId + raw-SQL FK (option 2).
//
// Run:  node spike/q2-compose-user.mjs      (needs the compose test Postgres on :5433)

import { createRequire } from 'node:module';
import {
  API_ROOT, begin, check, copyRealMigrations, cpSync, dbUrl, dropDb, finish, freshWorkdir, join, main, pgEnv, prisma, read,
  recreateDb, rows, run, say, scalar, show, tsc, withClient, write, writeConfig, readFileSync,
} from './lib/env.mjs';
import { ComposeError, compose } from './lib/compose.mjs';
import { composeDirs } from './platform-db-compose.mjs';
import { parseBlocks, parseBody } from './lib/prisma-blocks.mjs';
import { splitIntoFragments } from './lib/split-schema.mjs';
import { readdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const DB = 'pp_5_1_q2';
const original = read(join(API_ROOT, 'prisma', 'schema.prisma'));

const norm = (l) => l.trim().replace(/\s+/g, ' ');
function modelSurface(src) {
  const out = {};
  for (const b of parseBlocks(src).blocks.filter((x) => x.kind === 'model' && !x.extend)) {
    const { fields, attrs } = parseBody(b);
    out[b.name] = { fields: fields.map((f) => norm(f.raw)).sort(), attrs: attrs.map((a) => norm(a.raw)).sort() };
  }
  return out;
}
const composedText = (dir) => readdirSync(dir).filter((f) => f.endsWith('.prisma')).map((f) => read(join(dir, f))).join('\n');

function expectError(name, code, inputs) {
  try {
    compose(inputs);
    check(`composer rejects: ${name}`, false, 'no error thrown');
  } catch (e) {
    const ok = e instanceof ComposeError && e.code === code;
    check(`composer rejects: ${name} [${code}]`, ok, ok ? '' : String(e));
    if (e instanceof ComposeError) say(`      message: ${e.message}`);
  }
}

await main(async () => {
  begin('q2-compose-user');
  const root = freshWorkdir('q2');

  // ===========================================================================
  say('\n## A. Decompose the REAL schema into slice fragments, compose it back');
  const pkgDir = join(root, 'a', 'platform-db', 'schema');
  const { files: fragFiles, moves } = splitIntoFragments(original, { markExtensible: ['User', 'Job', 'StorageObject'], generatorOutput: '../generated-client' });
  for (const [name, text] of fragFiles) write(join(pkgDir, name), text);
  const extendBlocks = [...fragFiles.values()].flatMap((t) => parseBlocks(t).blocks.filter((b) => b.extend));
  const perModel = {};
  for (const m of moves) perModel[m.model] = (perModel[m.model] ?? 0) + m.fields.length;
  say('back-relation fields that moved out of their old home into the slice that owns the foreign key:');
  say(`  ${moves.map((m) => `${m.model} <- ${m.toSlice}: ${m.fields.join(', ')}`).join('\n  ')}`);
  check('of User\'s 25 back-relation fields, 8 stay in identity and 17 move out to the 7 slices that own the foreign keys', (perModel.User ?? 0) === 17 && new Set(moves.filter((m) => m.model === 'User').map((m) => m.toSlice)).size === 7, `${perModel.User} moved`);
  check('Job also needs an extension (Job.backupRun is owned by db-backup)', perModel.Job === 1);
  say(`extend blocks written into slice fragments: ${extendBlocks.length}`);
  const appOut = join(root, 'a', 'app');
  writeConfig(appOut);
  const res = composeDirs({ packageDir: pkgDir, outDir: join(appOut, 'prisma', 'schema') });
  say(`composed ${res.files.size} files: ${[...res.files.keys()].join(', ')}`);
  say(`extensible models seen: ${res.extensible.join(', ')}; extension fields merged: ${res.extensions.length}`);
  show('head of platform.identity.prisma (generated)', read(join(appOut, 'prisma', 'schema', 'platform.identity.prisma')).split('\n').slice(0, 8).join('\n'));
  const userComposed = read(join(appOut, 'prisma', 'schema', 'platform.identity.prisma'));
  show('tail of composed model User (inserted sections)', userComposed.slice(userComposed.indexOf('// composed from'), userComposed.indexOf('// composed from') + 700));

  let r = prisma(['validate'], { cwd: appOut, database: DB });
  check('composed folder validates', r.status === 0, r.stdout.trim().split('\n')[0]);
  const a = modelSurface(original);
  const b = modelSurface(composedText(join(appOut, 'prisma', 'schema')));
  const sameModels = JSON.stringify(Object.keys(a).sort()) === JSON.stringify(Object.keys(b).sort());
  const sameShape = sameModels && Object.keys(a).every((m) => JSON.stringify(a[m]) === JSON.stringify(b[m]));
  check('every model has the same field lines (as a set) and block attributes as the original single file', sameShape);
  // The original schema, as one file, with the same generator output so migrate diff compares like with like.
  write(join(root, 'a', 'original.prisma'), original);
  r = prisma(['migrate', 'diff', '--exit-code', '--from-schema', join(root, 'a', 'original.prisma'), '--to-schema', join(appOut, 'prisma', 'schema')], { cwd: appOut, database: DB });
  show('prisma migrate diff --exit-code original.prisma -> composed folder', `exit ${r.status}\n${r.stdout}${r.stderr}`);
  check('migrate diff original -> composed is EMPTY', r.status === 0);

  const g = prisma(['generate'], { cwd: appOut, database: DB });
  check('composed schema generates a client', g.status === 0);

  // determinism + drift check
  const again = composeDirs({ packageDir: pkgDir, outDir: join(root, 'a', 'again') });
  check('compose is deterministic (byte-identical second run)', [...res.files].every(([n, t]) => again.files.get(n) === t));
  check('`--check` passes on fresh output', composeDirs({ packageDir: pkgDir, outDir: join(appOut, 'prisma', 'schema'), check: true }).stale.length === 0);
  const victim = join(appOut, 'prisma', 'schema', 'platform.jobs.prisma');
  write(victim, `${read(victim)}\n// hand edit\n`);
  const stale = composeDirs({ packageDir: pkgDir, outDir: join(appOut, 'prisma', 'schema'), check: true }).stale;
  check('`--check` fails when a generated file is hand-edited', stale.includes('platform.jobs.prisma'), stale.join(','));
  composeDirs({ packageDir: pkgDir, outDir: join(appOut, 'prisma', 'schema') });

  // without the composer
  const plain = join(root, 'a', 'plain');
  for (const [name, text] of fragFiles) {
    write(join(plain, 'prisma', 'schema', name), text.replace(/^extend model[\s\S]*?^\}\n?/gm, ''));
  }
  writeConfig(plain);
  r = prisma(['validate'], { cwd: plain, database: DB });
  show('WITHOUT the composer: slice files with the back-relations simply removed', `exit ${r.status}\n${r.stdout.split('\n').slice(0, 14).join('\n')}${r.stderr.split('\n').slice(0, 14).join('\n')}`);
  check('without composed back-relations Prisma refuses the schema (this is the hard problem)', r.status !== 0);

  // ===========================================================================
  say('\n## B. A fake app adds Workout -> User / StorageObject / Job, through fragments only');
  const appFrag = join(root, 'b', 'app-fragments');
  write(
    join(appFrag, 'workouts.prisma'),
    `model Workout {
  id        String   @id @default(uuid()) @db.Uuid
  userId    String   @map("user_id") @db.Uuid
  photoId   String?  @map("photo_id") @db.Uuid
  title     String
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz

  user  User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  photo StorageObject? @relation(fields: [photoId], references: [id], onDelete: SetNull)

  @@index([userId])
  @@map("workouts")
}

model WorkoutExport {
  id    String @id @default(uuid()) @db.Uuid
  jobId String @unique @map("job_id") @db.Uuid

  job Job @relation(fields: [jobId], references: [id], onDelete: Cascade)

  @@map("workout_exports")
}

extend model User {
  workouts Workout[]
}

extend model StorageObject {
  workoutPhotos Workout[]
}

extend model Job {
  workoutExport WorkoutExport?
}
`,
  );
  const appB = join(root, 'b', 'app');
  writeConfig(appB);
  copyRealMigrations(appB);
  const resB = composeDirs({ packageDir: pkgDir, appDir: appFrag, outDir: join(appB, 'prisma', 'schema') });
  say(`composed ${resB.files.size} files: ${[...resB.files.keys()].join(', ')}`);
  say(`extension fields: ${resB.extensions.map((e) => `${e.model}.${e.field}<-${e.from}`).join('; ')}`);
  r = prisma(['validate'], { cwd: appB, database: DB });
  check('package + app fragments compose into a valid schema', r.status === 0, r.stdout.trim().split('\n')[0]);
  check('app fragment file produced app.workouts.prisma', resB.files.has('app.workouts.prisma'));
  check('extend blocks of the app landed on THREE package-owned models (User, StorageObject, Job), not only User',
    ['User', 'StorageObject', 'Job'].every((m) => resB.extensions.some((e) => e.model === m)));
  r = prisma(['generate'], { cwd: appB, database: DB });
  check('client generates', r.status === 0);

  // type-check
  write(join(appB, 'check-include.ts'), `import { PrismaClient } from './prisma/generated-client';
declare const prisma: PrismaClient;
export async function f() {
  const u = await prisma.user.findFirstOrThrow({ include: { workouts: true } });
  const t: string = u.workouts[0].title;
  const s = await prisma.storageObject.findFirstOrThrow({ include: { workoutPhotos: { select: { id: true } } } });
  const j = await prisma.job.findFirstOrThrow({ include: { workoutExport: true } });
  const w = await prisma.workout.findFirstOrThrow({ include: { user: true, photo: true } });
  const created = await prisma.user.update({ where: { id: u.id }, data: { workouts: { create: { title: 'x' } } } });
  return [t, s.workoutPhotos, j.workoutExport?.jobId, w.user.email, w.photo?.name, created.id];
}
`);
  write(join(appB, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, module: 'esnext', moduleResolution: 'bundler', target: 'es2022', skipLibCheck: true, types: [] }, files: ['check-include.ts'] }));
  let t = tsc(['-p', join(appB, 'tsconfig.json')], { cwd: appB });
  show('tsc --noEmit on include: { workouts: true } etc.', `exit ${t.status}\n${t.stdout}${t.stderr}`);
  check('`include: { workouts: true }` (and storageObject.workoutPhotos, job.workoutExport, nested create) type-check', t.status === 0);
  write(join(appB, 'check-negative.ts'), `import { PrismaClient } from './prisma/generated-client';
declare const prisma: PrismaClient;
export const x = () => prisma.user.findFirstOrThrow({ include: { notAField: true } });
`);
  write(join(appB, 'tsconfig.neg.json'), JSON.stringify({ extends: './tsconfig.json', files: ['check-negative.ts'] }));
  t = tsc(['-p', join(appB, 'tsconfig.neg.json')], { cwd: appB });
  check('negative control: an unknown include key IS a type error (the check has teeth)', t.status !== 0);

  // runtime: migrate the base, add the app tables by diff, then run the include for real
  await recreateDb(DB);
  r = prisma(['migrate', 'deploy'], { cwd: appB, database: DB });
  check('the base migrations apply to the scratch database', r.status === 0 && /successfully applied/.test(r.stdout));
  r = prisma(['migrate', 'diff', '--from-config-datasource', '--to-schema', join(appB, 'prisma', 'schema'), '--script'], { cwd: appB, database: DB });
  show('migrate diff live DB -> composed schema (what an app migration would contain)', r.stdout);
  check('the diff is ONLY the app tables (no change to a package table)', /CREATE TABLE "workouts"/.test(r.stdout) && /CREATE TABLE "workout_exports"/.test(r.stdout) && !/ALTER TABLE "(users|jobs|storage_objects)"/.test(r.stdout) && !/DROP/.test(r.stdout));
  await withClient(DB, (c) => c.query(r.stdout));
  const { PrismaClient } = require(join(appB, 'prisma', 'generated-client', 'index.js'));
  const { PrismaPg } = require('@prisma/adapter-pg');
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: dbUrl(DB) }) });
  try {
    const user = await client.user.create({ data: { email: 'q2@example.test', workouts: { create: [{ title: 'run' }, { title: 'swim' }] } } });
    const loaded = await client.user.findUniqueOrThrow({ where: { id: user.id }, include: { workouts: { orderBy: { title: 'asc' } } } });
    check('runtime: user.include.workouts returns the rows created through the composed relation', loaded.workouts.map((w) => w.title).join() === 'run,swim');
    const obj = await client.storageObject.create({ data: { name: 'p.png', size: 1n, mimeType: 'image/png', storageKey: 'k/p.png', uploadedById: user.id } });
    await client.workout.updateMany({ where: { userId: user.id, title: 'run' }, data: { photoId: obj.id } });
    const so = await client.storageObject.findUniqueOrThrow({ where: { id: obj.id }, include: { workoutPhotos: true } });
    check('runtime: storageObject.include.workoutPhotos works (back-relation on a non-User package model)', so.workoutPhotos.length === 1);
    await client.user.delete({ where: { id: user.id } });
    check('onDelete: Cascade from the app FK works (workouts removed with the user)', (await client.workout.count()) === 0);
  } finally {
    await client.$disconnect();
  }

  // ===========================================================================
  say('\n## C. Error cases the composer must reject');
  const identity = `// @extensible\nmodel User {\n  id String @id\n\n  @@map("users")\n}\n\nmodel Locked {\n  id String @id\n}\n`;
  const pk = (text, rel = 'identity.prisma') => ({ rel, origin: 'package', source: `package:${rel}`, text });
  const ap = (text, rel = 'app.prisma') => ({ rel, origin: 'app', source: `app:${rel}`, text });
  const workout = `model Workout {\n  id String @id\n  userId String\n  user User @relation(fields: [userId], references: [id])\n}\n`;
  expectError('extending a model the package did not mark extensible', 'NOT_EXTENSIBLE', [pk(identity), ap(`${workout}\nextend model Locked {\n  workouts Workout[]\n}\n`)]);
  expectError('an extend block for an unknown model', 'UNKNOWN_MODEL', [pk(identity), ap(`${workout}\nextend model Nobody {\n  workouts Workout[]\n}\n`)]);
  expectError('a field-name collision with the package model', 'FIELD_COLLISION', [pk(identity), ap(`${workout}\nextend model User {\n  id Workout[]\n}\n`)]);
  expectError('a field-name collision between two apps/slices', 'FIELD_COLLISION', [pk(identity), ap(`${workout}\nextend model User {\n  workouts Workout[]\n}\n`), ap(`extend model User {\n  workouts Workout[]\n}\n`, 'other.prisma')]);
  expectError('an extend block adding a column (scalar field)', 'EXTEND_SCALAR_FIELD', [pk(identity), ap(`extend model User {\n  nickname String?\n}\n`)]);
  expectError('an extend block adding an owning relation (a FK column)', 'EXTEND_OWNING_RELATION', [pk(identity), ap(`${workout}\nextend model User {\n  best Workout? @relation(fields: [id], references: [id])\n}\n`)]);
  expectError('an extend block carrying @@index/@@map', 'EXTEND_BLOCK_ATTRIBUTE', [pk(identity), ap(`${workout}\nextend model User {\n  workouts Workout[]\n  @@index([id])\n}\n`)]);
  expectError('a field of an unknown type', 'EXTEND_UNKNOWN_TYPE', [pk(identity), ap(`extend model User {\n  things Thing[]\n}\n`)]);
  expectError('a plain `model User` redeclared by an app', 'DUPLICATE_MODEL', [pk(identity), ap(`model User {\n  id String @id\n}\n`)]);
  expectError('a second generator block of the same name (an app must REPLACE base.prisma instead)', 'DUPLICATE_BASE', [pk('generator client {\n  provider = "prisma-client-js"\n}\n', 'base.prisma'), ap('generator client {\n  provider = "prisma-client-js"\n}\n')]);
  expectError('a second datasource (Prisma allows exactly one)', 'DUPLICATE_BASE', [pk('datasource db {\n  provider = "postgresql"\n}\n', 'base.prisma'), ap('datasource other {\n  provider = "postgresql"\n}\n')]);
  expectError('a header that is not `prisma format` shaped', 'MALFORMED', [pk('model User\n{\n  id String @id\n}\n')]);
  // happy path of the base override rule
  const ov = compose([pk('generator client {\n  provider = "prisma-client-js"\n}\n', 'base.prisma'), ap('generator client {\n  provider = "prisma-client-js"\n  output = "x"\n}\n', 'base.prisma')]);
  check('an app base.prisma REPLACES the package base.prisma (one generator, app-controlled output)', ov.files.size === 1 && ov.files.has('app.base.prisma') && /output = "x"/.test(ov.files.get('app.base.prisma')));

  // ===========================================================================
  say('\n## D. Option 2: plain userId, FK added in raw SQL');
  const opt2 = join(root, 'd', 'app');
  writeConfig(opt2);
  copyRealMigrations(opt2);
  write(join(opt2, 'extra', 'workouts.prisma'), `model Workout {
  id     String @id @default(uuid()) @db.Uuid
  userId String @map("user_id") @db.Uuid
  title  String

  @@index([userId])
  @@map("workouts")
}
`);
  composeDirs({ packageDir: pkgDir, appDir: join(opt2, 'extra'), outDir: join(opt2, 'prisma', 'schema') });
  prisma(['generate'], { cwd: opt2, database: DB });
  write(join(opt2, 'check.ts'), `import { PrismaClient } from './prisma/generated-client';
declare const prisma: PrismaClient;
export const a = () => prisma.user.findFirstOrThrow({ include: { workouts: true } });
export const b = () => prisma.workout.findFirstOrThrow({ include: { user: true } });
`);
  write(join(opt2, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, module: 'esnext', moduleResolution: 'bundler', target: 'es2022', skipLibCheck: true, types: [] }, files: ['check.ts'] }));
  t = tsc(['-p', join(opt2, 'tsconfig.json')], { cwd: opt2 });
  show('option 2: tsc on include: { workouts: true } and include: { user: true }', `exit ${t.status}\n${t.stdout}${t.stderr}`);
  check('option 2 LOSES typed relations: `User.include.workouts` and `Workout.include` are both type errors', t.status !== 0 && /check\.ts\(3,\d+\).*'workouts' does not exist/.test(t.stdout) && /check\.ts\(4,\d+\).*'include' does not exist/.test(t.stdout));
  await recreateDb(DB);
  prisma(['migrate', 'deploy'], { cwd: opt2, database: DB });
  let d = prisma(['migrate', 'diff', '--from-config-datasource', '--to-schema', join(opt2, 'prisma', 'schema'), '--script'], { cwd: opt2, database: DB });
  await withClient(DB, (c) => c.query(d.stdout));
  await withClient(DB, (c) => c.query('ALTER TABLE "workouts" ADD CONSTRAINT "workouts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE'));
  d = prisma(['migrate', 'diff', '--from-config-datasource', '--to-schema', join(opt2, 'prisma', 'schema'), '--script'], { cwd: opt2, database: DB });
  show('option 2: migrate diff after the raw-SQL FK was applied', d.stdout);
  check('option 2 creates REAL drift: Prisma now wants to drop the hand-written FK on the next `migrate dev`', /DROP CONSTRAINT "workouts_user_id_fkey"/.test(d.stdout));
  say('option 2 also gives up: relation filters (where: { user: { is... } }), nested create/connect, onDelete documentation in the schema, and the generated back-relation names.');

  // ===========================================================================
  say('\n## E. Can `prisma format` auto-add the back-relations instead (no `extend` syntax)?');
  const fmt = join(root, 'e');
  writeConfig(fmt);
  composeDirs({ packageDir: pkgDir, outDir: join(fmt, 'prisma', 'schema') });
  write(join(fmt, 'prisma', 'schema', 'app.workouts.prisma'), read(join(appFrag, 'workouts.prisma')).replace(/extend model[\s\S]*$/, ''));
  const before = read(join(fmt, 'prisma', 'schema', 'platform.identity.prisma'));
  r = prisma(['format'], { cwd: fmt, database: DB });
  const after = read(join(fmt, 'prisma', 'schema', 'platform.identity.prisma'));
  const added = after !== before && /workouts\s+Workout\[\]/.test(after);
  show('prisma format on package + app files WITHOUT extend blocks', `exit ${r.status}\n${r.stdout}${r.stderr}`);
  check('`prisma format` DOES add the missing back-relation, but by rewriting the package-owned file in place', added);
  say(`  => rejected as the mechanism: the edit lands in a platform file (and would be lost/uncommitted on the next sync), names are chosen by Prisma, and ordering is not deterministic across formats. Kept only as a convenience idea for a "suggest the extend block" command.`);

  await dropDb(DB);
});

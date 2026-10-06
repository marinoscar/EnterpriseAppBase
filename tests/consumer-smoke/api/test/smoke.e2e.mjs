// The API consumer smoke (issue #697), run by `npm test` inside the temporary
// consumer project that ../../run.mjs creates outside the repository. It loads
// the compiled app (dist/, built by `npm run build` with tsc and decorator
// metadata) and the installed @marinoscar/platform-api, never the workspace.

import assert from 'node:assert/strict';
import { lstatSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, sep } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..');

const { createApp, buildOpenApiDocument } = require('../dist/main.js');
const doctor = require('@marinoscar/platform-api/doctor');
const core = require('@marinoscar/platform-api/core');

describe('installation', () => {
  it('installs @marinoscar/platform-api as a real directory inside this project, not a link', () => {
    const manifest = require.resolve('@marinoscar/platform-api/package.json');
    const dir = dirname(manifest);
    assert.equal(lstatSync(dir).isSymbolicLink(), false, `${dir} is a symlink`);
    const rel = relative(realpathSync(PROJECT), realpathSync(dir));
    assert.ok(!rel.startsWith('..') && !rel.startsWith(sep), `resolved outside the project: ${dir}`);
    const { version } = require('@marinoscar/platform-api/package.json');
    assert.match(version, /^\d+\.\d+\.\d+/);
  });
});

describe('fail-closed access contract', () => {
  it('DoctorModule.forRoot without a host throws', () => {
    assert.throws(() => doctor.DoctorModule.forRoot({}), /host.*required/);
  });

  it('definePlatformHost with a missing access function throws', () => {
    assert.throws(
      () => core.definePlatformHost({ access: { requirePermissions: () => () => undefined } }),
      /requireAuthenticated/,
    );
  });
});

describe('GET /api/admin/doctor', () => {
  let app;
  let base;

  before(async () => {
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    base = `http://127.0.0.1:${address.port}/api/admin/doctor`;
  });

  after(async () => {
    await app?.close();
  });

  const AUTHORISED = { 'x-smoke': '1', 'x-smoke-grants': doctor.DEFAULT_DOCTOR_PERMISSION };

  it('answers 401 without the smoke header', async () => {
    const res = await fetch(base);
    assert.equal(res.status, 401);
  });

  it('answers 403 when the caller lacks the Doctor permission', async () => {
    const res = await fetch(base, { headers: { 'x-smoke': '1', 'x-smoke-grants': 'something:else' } });
    assert.equal(res.status, 403);
  });

  it('answers 200 with the report, including the consumer checks and a computed verdict', async () => {
    const res = await fetch(base, { headers: AUTHORISED });
    assert.equal(res.status, 200);
    const report = await res.json();
    const byId = new Map(report.checks.map((check) => [check.id, check]));
    assert.equal(byId.get('smoke.consumer')?.status, 'pass');
    assert.equal(byId.get('smoke.consumer')?.label, 'Consumer smoke check');
    assert.equal(byId.get('smoke.dependent')?.status, 'warn');
    assert.equal(report.verdict, 'warn');
    assert.equal(typeof report.generatedAt, 'string');
    assert.equal(typeof report.durationMs, 'number');
  });

  it('filters by category', async () => {
    const res = await fetch(`${base}?category=smoke&refresh=true`, { headers: AUTHORISED });
    assert.equal(res.status, 200);
    const report = await res.json();
    assert.deepEqual(report.checks.map((check) => check.id).sort(), ['smoke.consumer', 'smoke.dependent']);
  });

  it('validates its query with the package DTO (400 on a bad refresh value)', async () => {
    const res = await fetch(`${base}?refresh=maybe`, { headers: AUTHORISED });
    assert.equal(res.status, 400);
  });

  it('documents the route in the consumer OpenAPI document', () => {
    const document = buildOpenApiDocument(app);
    assert.ok(document.paths['/api/admin/doctor']?.get, 'GET /api/admin/doctor is missing from OpenAPI');
  });
});

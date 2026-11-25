// The slim API consumer smoke (issue #914), run by `npm test` inside the
// temporary project ../../run.mjs creates outside the repository. It proves
// that `core`, `otel-core` and `telemetry` of @marinoscar/platform-api load,
// type-check (tsc, skipLibCheck off, in `npm run build`) and run with ONLY the
// peers those slices declare in packages/platform-slice-peers.json.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { bootSlim, telemetryModuleMetadata } = require('../dist/main.js');

/** Peers of platform-api that none of the three slices needs: they must not have been installed. */
const NOT_INSTALLED = [
  '@nestjs/jwt',
  '@nestjs/passport',
  'passport',
  '@nestjs/event-emitter',
  '@nestjs/terminus',
  '@nestjs/platform-fastify',
  'supertest',
];

describe('only the peers of core, otel-core and telemetry are installed', () => {
  for (const name of NOT_INSTALLED) {
    it(`${name} is absent`, () => {
      assert.equal(existsSync(join(PROJECT, 'node_modules', name)), false, `${name} was installed`);
    });
  }
});

describe('the slices load without the other peers', () => {
  it('requires the three subpaths', () => {
    for (const subpath of ['core', 'otel-core', 'telemetry']) {
      const mod = require(`@marinoscar/platform-api/${subpath}`);
      assert.ok(Object.keys(mod).length > 0, `${subpath} exports nothing`);
    }
  });

  it('TelemetryModule.forRoot returns the module metadata', () => {
    const dynamic = telemetryModuleMetadata();
    assert.equal(dynamic.module.name, 'TelemetryModule');
    assert.ok(Array.isArray(dynamic.providers) && dynamic.providers.length > 0);
    assert.ok(Array.isArray(dynamic.controllers) && dynamic.controllers.length > 0);
  });
});

describe('a Nest application context boots on otel-core', () => {
  let booted;
  after(async () => booted?.app.close());

  it('resolves the metrics host and runs a @Trace() method', async () => {
    booted = await bootSlim();
    assert.equal(await booted.greeter.hello('slim'), 'hello slim');
    assert.ok(booted.metrics);
  });
});

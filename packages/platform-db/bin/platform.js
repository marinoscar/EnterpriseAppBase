#!/usr/bin/env node
// `platform db compose [--check]`: the router of the platform tools (see
// src/bin/platform.ts). This shim is committed so npm can link the bin at
// install time, before the package is built; it runs the compiled dist/, so in
// this repository `npm run build:packages` comes first (same pattern as
// packages/platform-infra/bin/platform-infra.mjs).
'use strict';

let main;
try {
  ({ main } = require('../dist/bin/platform.js'));
} catch (e) {
  if (e && e.code === 'MODULE_NOT_FOUND' && String(e.message).includes('dist/bin/platform.js')) {
    process.stderr.write('platform: @marinoscar/platform-db is not built. Run "npm run build:packages" from the repository root.\n');
    process.exit(1);
  }
  throw e;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (e) => {
    process.stderr.write(`${e && e.stack ? e.stack : String(e)}\n`);
    process.exitCode = 1;
  },
);

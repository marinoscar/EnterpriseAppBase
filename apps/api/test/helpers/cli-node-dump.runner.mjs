// =============================================================================
// Runs the CLI's own node-side pg_dump (issue #725), for the backup RLS db spec
// =============================================================================
//
// A worker node dumps with @marinoscar/platform-cli's `node/pg-dump.ts`, an ESM
// package that must not import the API. The API's Jest runs CommonJS, so the
// spec starts this file in a child process (`node --import tsx`) instead of
// importing the CLI. Usage: NODE_DUMP_CONNECTION='<json>' node --import tsx
// cli-node-dump.runner.mjs <output-file>. Exit code 0 only when the dump
// exited 0 and every byte reached the file. NOT A SPEC FILE.
// =============================================================================

import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

import { spawnPgDump } from '../../../../packages/platform-cli/src/engine/node/pg-dump.ts';

const output = process.argv[2];
const raw = process.env.NODE_DUMP_CONNECTION;
if (!output || !raw) {
  console.error('usage: NODE_DUMP_CONNECTION=<json> cli-node-dump.runner.mjs <output-file>');
  process.exit(2);
}

const dump = spawnPgDump({ connection: JSON.parse(raw) });
await Promise.all([pipeline(dump.stdout, createWriteStream(output)), dump.done]);

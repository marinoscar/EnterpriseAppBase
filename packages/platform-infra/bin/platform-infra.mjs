#!/usr/bin/env node
// `platform-infra sync [--check] [--root <dir>]`: materialise the platform's
// infra fragments into the app (see src/sync.ts). Runs the compiled dist/, so
// in this repository `npm run build:packages` comes first.
import { main } from '../dist/cli.js';

process.exitCode = main(process.argv.slice(2));

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { APP_NAME, REPO_SLUG } from '@app/shared';
import { describe, expect, it } from 'vitest';

import { CLI_IDENTITY, CLI_NAME } from './branding.js';

// =============================================================================
// The app's CLI identity: the one constant a fork renames  (#140, #715)
// =============================================================================
//
// The platform CLI derives everything from the identity this app passes in
// (see identity.test.ts). What stays here is what only the APP can guard: the
// `bin` key npm reads before any code runs, and the product half coming from
// `@app/shared`.
// =============================================================================

describe('CLI_IDENTITY', () => {
  it('is seeded by CLI_NAME, with the product half from @app/shared', () => {
    expect(CLI_IDENTITY.name).toBe(CLI_NAME);
    expect(CLI_IDENTITY.displayName).toBe(`${APP_NAME} CLI`);
    expect(CLI_IDENTITY.productName).toBe(APP_NAME);
    expect(CLI_IDENTITY.repoSlug).toBe(REPO_SLUG);
  });
});

describe("package.json's bin field", () => {
  it('has exactly one key, and it equals the identity name', () => {
    // THE ONE PLACE THE CONSTANT CANNOT REACH: npm reads package.json before
    // any code runs, so `bin` necessarily repeats the name as a literal. This
    // test is the guard against that literal drifting from CLI_NAME.
    const here = dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(join(here, '..', 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as { bin?: unknown };

    expect(pkg.bin).toBeTypeOf('object');
    const keys = Object.keys(pkg.bin as Record<string, unknown>);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toBe(CLI_IDENTITY.name);
  });
});

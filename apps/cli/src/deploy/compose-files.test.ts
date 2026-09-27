import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseEnvExample } from './env-spec.js';
import { composeFileArgs, composeFilesFor } from './compose-files.js';

const COMPOSE_DIR = resolve(__dirname, '..', '..', '..', '..', 'infra', 'compose');

describe('composeFilesFor (#531)', () => {
  it('is the base VPS stack when no group is enabled', () => {
    const expected = ['base.compose.yml', 'prod.compose.yml', 'vps.compose.yml'];

    expect(composeFilesFor()).toEqual(expected);
    expect(composeFilesFor(undefined)).toEqual(expected);
    expect(composeFilesFor([])).toEqual(expected);
  });

  it('adds the telemetry stack and its VPS hardening when observability is enabled', () => {
    expect(composeFilesFor(['observability'])).toEqual([
      'base.compose.yml',
      'prod.compose.yml',
      'telemetry.compose.yml',
      'vps.compose.yml',
      'vps.telemetry.compose.yml',
    ]);
  });

  it('ignores groups that bring no compose file of their own', () => {
    expect(composeFilesFor(['email', 'microsoft-oauth'])).toEqual(composeFilesFor());
    expect(composeFilesFor(['email', 'observability'])).toEqual(
      composeFilesFor(['observability']),
    );
  });

  it('applies the VPS files after every file whose ports they override', () => {
    // ⚠ `ports: !override` only replaces what the files BEFORE it published.
    // A telemetry file layered after vps.telemetry.compose.yml would merge its
    // 0.0.0.0 ports straight back in.
    const files = composeFilesFor(['observability']);

    expect(files.indexOf('telemetry.compose.yml')).toBeLessThan(files.indexOf('vps.compose.yml'));
    expect(files.indexOf('telemetry.compose.yml')).toBeLessThan(
      files.indexOf('vps.telemetry.compose.yml'),
    );
    expect(files.at(-1)).toBe('vps.telemetry.compose.yml');
    expect(composeFilesFor().at(-1)).toBe('vps.compose.yml');
  });

  it('names only files the checkout actually has', () => {
    for (const file of composeFilesFor(['observability'])) {
      expect(existsSync(resolve(COMPOSE_DIR, file)), file).toBe(true);
    }
  });

  it('renders -f <file> pairs in the same order', () => {
    expect(composeFileArgs(['observability'])).toEqual(
      composeFilesFor(['observability']).flatMap((file) => ['-f', file]),
    );
  });
});

describe('vps.telemetry.compose.yml publishes nothing on a public interface', () => {
  const text = readFileSync(resolve(COMPOSE_DIR, 'vps.telemetry.compose.yml'), 'utf8');

  it('replaces, never merges, each telemetry service ports list', () => {
    // A plain `ports:` MERGES with telemetry.compose.yml's development
    // mappings and leaves them on 0.0.0.0; only `!override` replaces them.
    const portsLines = text.split('\n').filter((line) => /^\s+ports:/.test(line));

    expect(portsLines).toHaveLength(2);
    for (const line of portsLines) expect(line).toMatch(/ports: !override/);
  });

  it('binds every published port to 127.0.0.1', () => {
    const mappings = [...text.matchAll(/^\s+- "([^"]*:\d+)"\s*$/gm)].map((match) => match[1]);

    expect(mappings.length).toBeGreaterThan(0);
    for (const mapping of mappings) expect(mapping).toMatch(/^127\.0\.0\.1:/);
  });

  it('declares every variable it interpolates in .env.example', () => {
    // The CLI writes the deployment's `.env` from the template, so a variable
    // only this file knows about can never be set by `appctl deploy`.
    const template = readFileSync(resolve(COMPOSE_DIR, '.env.example'), 'utf8');
    const keys = new Set(parseEnvExample(template).map((spec) => spec.key));
    const used = [...text.matchAll(/\$\{([A-Z0-9_]+)/g)].map((match) => match[1]);

    expect(used).toContain('GREPTIME_BIND_PG_PORT');
    for (const key of used) expect(keys.has(key ?? ''), key).toBe(true);
  });
});

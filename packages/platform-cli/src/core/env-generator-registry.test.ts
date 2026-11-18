import { afterEach, describe, expect, it } from 'vitest';

import { generateValue } from './env-values.js';
import {
  freezeEnvGeneratorRegistry,
  generateWithKind,
  listEnvGenerators,
  registerEnvGenerator,
  resetEnvGeneratorRegistryForTests,
} from './env-generator-registry.js';

afterEach(() => resetEnvGeneratorRegistryForTests());

describe('the built-in generators', () => {
  it('are the same two as before, registered through the same function', () => {
    expect(listEnvGenerators().map((generator) => generator.kind)).toEqual(['base64-32', 'hex-32']);
    expect(generateValue('base64-32')).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(generateValue('hex-32')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('registerEnvGenerator', () => {
  it('makes a new kind available to generateValue', () => {
    registerEnvGenerator({ kind: 'token-8', generate: () => 'abcd1234' });
    expect(generateValue('token-8')).toBe('abcd1234');
  });

  it('names the registered kinds when one is unknown', () => {
    expect(() => generateWithKind('nope')).toThrow(/Unknown env generator kind "nope". Registered: base64-32, hex-32.*registerEnvGenerator/);
  });

  it.each([
    ['a newline', 'abc\nrm -rf /'],
    ['a space', 'a b'],
    ['a quote', 'a"b'],
    ['a dollar', '$(whoami)'],
    ['a semicolon', 'a;b'],
    ['a hash', 'a#b'],
    ['an empty string', ''],
    ['a non-string', 42 as unknown as string],
    ['more than 512 characters', 'a'.repeat(513)],
  ])('refuses a generated value with %s, so nothing hostile reaches the .env file', (_label, value) => {
    registerEnvGenerator({ kind: 'bad', generate: () => value });
    expect(() => generateValue('bad')).toThrow(/cannot be written to a .env file/);
  });

  it('refuses a malformed or taken kind, a missing function and a late registration', () => {
    expect(() => registerEnvGenerator({ kind: 'hex-32', generate: () => 'x' })).toThrow(/already registered/);
    expect(() => registerEnvGenerator({ kind: 'Bad Kind', generate: () => 'x' })).toThrow(/invalid/);
    expect(() => registerEnvGenerator({ kind: 'cmd', generate: 'openssl rand -hex 8' as unknown as () => string })).toThrow(/generate function/);
    freezeEnvGeneratorRegistry('createCli built the CLI');
    expect(() => registerEnvGenerator({ kind: 'late', generate: () => 'x' })).toThrow(/after createCli built the CLI/);
  });
});

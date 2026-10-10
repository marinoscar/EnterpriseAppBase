// Moved from the reference app (apps/web/src/__tests__, issue #727).
import { describe, it, expect } from 'vitest';
import { AUTH_ERROR_CODES, DEFAULT_AUTH_ERROR_CODE } from '@marinoscar/platform-contract/identity';
import {
  SIGN_IN_ERROR_CODES,
  DEFAULT_SIGN_IN_ERROR_CODE,
  createSignInErrorContent,
  resolveSignInErrorCode,
} from '../../src/identity/ui/index.js';

// The app built its copy with its product name; any name will do here.
const SIGN_IN_ERROR_CONTENT = createSignInErrorContent('Example App');

describe('signInErrorContent (#652)', () => {
  it('has copy for every code', () => {
    for (const code of SIGN_IN_ERROR_CODES) {
      expect(SIGN_IN_ERROR_CONTENT[code].headline).toBeTruthy();
    }
  });

  it('is the contract\'s closed set of codes, the one the API redirects with (#727)', () => {
    expect(SIGN_IN_ERROR_CODES).toBe(AUTH_ERROR_CODES);
    expect(DEFAULT_SIGN_IN_ERROR_CODE).toBe(DEFAULT_AUTH_ERROR_CODE);
    expect(Object.keys(SIGN_IN_ERROR_CONTENT).sort()).toEqual([...AUTH_ERROR_CODES].sort());
  });

  it('reserves error severity for faults', () => {
    const errors = SIGN_IN_ERROR_CODES.filter((c) => SIGN_IN_ERROR_CONTENT[c].severity === 'error');
    expect(errors.sort()).toEqual(['authentication_failed', 'server_misconfigured']);
  });

  it('resolves known codes and falls back for everything else', () => {
    expect(resolveSignInErrorCode('not_allowlisted')).toBe('not_allowlisted');
    expect(resolveSignInErrorCode('no_organization')).toBe('no_organization');
    for (const bad of [null, undefined, '', 'nope', '<b>x</b>', 'constructor', '__proto__']) {
      expect(resolveSignInErrorCode(bad)).toBe(DEFAULT_SIGN_IN_ERROR_CODE);
    }
  });
});

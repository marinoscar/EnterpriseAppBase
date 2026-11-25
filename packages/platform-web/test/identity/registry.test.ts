// The web sign-in provider registry (issue #727).

import { afterEach, describe, expect, it } from 'vitest';

import {
  getRegisteredAuthProvider,
  listRegisteredAuthProviders,
  registerAuthProvider,
} from '../../src/identity/headless/index.js';

describe('registerAuthProvider', () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => cleanups.splice(0).forEach((undo) => undo()));

  it('registers a look under a case-insensitive id and removes it again', () => {
    cleanups.push(registerAuthProvider({ id: 'OIDC', label: 'Continue with SSO' }));
    expect(getRegisteredAuthProvider('oidc')?.label).toBe('Continue with SSO');
    expect(listRegisteredAuthProviders().map((d) => d.id)).toEqual(['oidc']);
    cleanups.pop()?.();
    expect(getRegisteredAuthProvider('oidc')).toBeUndefined();
  });

  it('refuses a second registration of one id', () => {
    cleanups.push(registerAuthProvider({ id: 'okta', label: 'Okta' }));
    expect(() => registerAuthProvider({ id: 'Okta', label: 'Okta again' })).toThrow(/already registered/);
  });
});

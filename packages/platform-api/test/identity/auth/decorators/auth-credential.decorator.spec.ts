import 'reflect-metadata';
import { ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';

import { AuthCredential, authCredentialOf, type AuthCredentialInfo } from '../../../../src/identity/auth/decorators/auth-credential.decorator';
import * as decorators from '../../../../src/identity/auth/decorators/index';

/** The factory Nest registered for `@AuthCredential()` on a test method. */
function factoryOf(): (data: unknown, ctx: ExecutionContext) => AuthCredentialInfo | null {
  class Probe {
    handler(@AuthCredential() _credential: AuthCredentialInfo | null) {}
  }
  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, Probe, 'handler') as Record<
    string,
    { factory: (data: unknown, ctx: ExecutionContext) => AuthCredentialInfo | null }
  >;
  return Object.values(args)[0].factory;
}

function contextFor(request: unknown): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

describe('AuthCredential', () => {
  it.each<AuthCredentialInfo>([{ kind: 'jwt' }, { kind: 'pat', tokenId: 'pat-row-1' }, { kind: 'node' }])(
    'returns the credential the guard stamped (%o)',
    (credential) => {
      expect(authCredentialOf({ authCredential: credential })).toEqual(credential);
      expect(factoryOf()(undefined, contextFor({ authCredential: credential }))).toEqual(credential);
    },
  );

  it('is null on a request the guard never stamped (a @Public() route)', () => {
    expect(authCredentialOf({})).toBeNull();
    expect(authCredentialOf(undefined)).toBeNull();
    expect(factoryOf()(undefined, contextFor({}))).toBeNull();
  });

  it('is exported from the decorators barrel', () => {
    expect(decorators.AuthCredential).toBe(AuthCredential);
    expect(decorators.authCredentialOf).toBe(authCredentialOf);
  });
});

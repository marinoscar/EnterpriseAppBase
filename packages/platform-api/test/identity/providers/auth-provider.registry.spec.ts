import { withTemporaryEntries } from '../../../src/core/index';
import {
  authCredentialPurpose,
  authProviderStrategyName,
  authProviderRegistry,
  registerAuthProvider,
  type AuthProviderDefinition,
} from '../../../src/identity/auth/providers/auth-provider.registry';
import '../../../src/identity/auth/providers/google.provider';
import { resolveIdentityModuleOptions } from '../../../src/identity/identity.options';

const base: AuthProviderDefinition = {
  id: 'sso',
  isEnabled: () => true,
  createStrategy: () => ({ authenticate: () => undefined }) as never,
};

describe('the sign-in provider registry (PP-14.9)', () => {
  it('accepts a createStrategy provider, a class-based one and a custom one', async () => {
    class S {}
    class G {
      canActivate() {
        return true;
      }
    }
    await withTemporaryEntries(
      authProviderRegistry,
      [base, { id: 'classy', isEnabled: () => true, strategy: S, guard: G }, { id: 'popup', mode: 'custom' as const, isEnabled: () => true }],
      () => {
        expect(authProviderRegistry.ids()).toEqual(['google', 'sso', 'classy', 'popup']);
      },
    );
  });

  it('refuses a redirect provider with no way to build a strategy, naming the problem', () => {
    expect(() => registerAuthProvider({ id: 'bare', isEnabled: () => true })).toThrow(/strategy class with a guard class, or createStrategy/);
    expect(() => registerAuthProvider({ id: 'half', isEnabled: () => true, strategy: class {} as never })).toThrow(/guard must be a class/);
  });

  it('refuses a bad mode, mapProfile or egressHosts', () => {
    expect(() => registerAuthProvider({ ...base, id: 'm1', mode: 'popup' as never })).toThrow(/mode/);
    expect(() => registerAuthProvider({ ...base, id: 'm2', mapProfile: 'x' as never })).toThrow(/mapProfile/);
    expect(() => registerAuthProvider({ ...base, id: 'm3', egressHosts: 'github.com' as never })).toThrow(/egressHosts/);
  });

  it('keeps Google\'s registration: class-based, linking by verified address, with its remedy and hosts', () => {
    const google = authProviderRegistry.require('google');
    expect(google.strategy).toBeDefined();
    expect(google.guard).toBeDefined();
    expect(google.linkExistingByEmail).toBe(true);
    expect(google.egressHosts).toEqual(['accounts.google.com', 'oauth2.googleapis.com', 'www.googleapis.com']);
    expect(google.doctorRemedy).toMatch(/GOOGLE_CLIENT_ID/);
    expect(google.mapProfile!({ id: 'g', email: 'a@b.co', displayName: 'A', picture: 'u' })).toEqual({
      provider: 'google',
      subject: 'g',
      email: 'a@b.co',
      emailVerified: true,
      displayName: 'A',
      pictureUrl: 'u',
    });
  });

  it.each(['jwt', 'session'])('reserves the id "%s", the name of an existing Passport strategy', (id) => {
    expect(() => registerAuthProvider({ ...base, id })).toThrow(/reserved/);
  });

  it('names the Passport strategy auth-provider:<id>, so no id can replace another strategy', () => {
    expect(authProviderStrategyName('github')).toBe('auth-provider:github');
  });

  it('names the credential purpose auth_<id>', () => {
    expect(authCredentialPurpose('github')).toBe('auth_github');
  });
});

describe('IdentityModule.forRoot({ signInPolicy })', () => {
  it('accepts a binding and refuses anything else', () => {
    expect(resolveIdentityModuleOptions({ signInPolicy: { useClass: class {} as never } }).signInPolicy).toBeDefined();
    expect(resolveIdentityModuleOptions({}).signInPolicy).toBeUndefined();
    expect(() => resolveIdentityModuleOptions({ signInPolicy: {} as never })).toThrow(/signInPolicy must be a binding/);
  });
});

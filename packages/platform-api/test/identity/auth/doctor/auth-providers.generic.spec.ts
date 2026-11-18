import { DoctorCheckRegistry, EgressRegistry } from '../../../../src/doctor/index';
import { withTemporaryEntries } from '../../../../src/core/index';
import { AuthProvidersDoctorCheck } from '../../../../src/identity/auth/doctor/auth-providers.doctor-check';
import { AuthProvidersEgressContributor } from '../../../../src/identity/auth/doctor/egress/auth-providers.egress.contributor';
import { authProviderRegistry, type AuthProviderDefinition } from '../../../../src/identity/auth/providers/auth-provider.registry';
import type { AuthService } from '../../../../src/identity/auth/auth.service';
import '../../../../src/identity/auth/providers/google.provider';

const github: AuthProviderDefinition = {
  id: 'github',
  label: 'GitHub',
  isEnabled: () => true,
  createStrategy: () => ({ authenticate: () => undefined }) as never,
  egressHosts: ['github.com', 'api.github.com'],
  doctorRemedy: 'Store the GitHub OAuth app secret under auth_github.',
};

const auth = (providers: Array<{ name: string; enabled: boolean }>) =>
  ({ getEnabledProviders: jest.fn().mockResolvedValue(providers) }) as unknown as AuthService;

describe('auth.providers Doctor check (generic)', () => {
  it('lists every registered provider and its remedy while it is off, and still passes', async () => {
    await withTemporaryEntries(authProviderRegistry, [github], async () => {
      const outcome = await new AuthProvidersDoctorCheck(new DoctorCheckRegistry(), auth([{ name: 'google', enabled: true }])).run();
      expect(outcome).toMatchObject({
        status: 'pass',
        detail: 'Enabled: google',
        data: {
          providers: 1,
          'provider.google': 'enabled',
          'provider.github': 'not enabled',
          'remedy.github': 'Store the GitHub OAuth app secret under auth_github.',
        },
      });
    });
  });

  it('fails with every registered provider\'s own remedy when none is enabled', async () => {
    await withTemporaryEntries(authProviderRegistry, [github], async () => {
      const outcome = await new AuthProvidersDoctorCheck(new DoctorCheckRegistry(), auth([])).run();
      expect(outcome.status).toBe('fail');
      expect(outcome.remedy).toContain('GOOGLE_CLIENT_ID');
      expect(outcome.remedy).toContain('GitHub: Store the GitHub OAuth app secret under auth_github.');
    });
  });
});

describe('sign-in egress contributor (generic)', () => {
  it('adds one dependency per provider that declared hosts, after Google\'s two', async () => {
    await withTemporaryEntries(authProviderRegistry, [github], async () => {
      const deps = await new AuthProvidersEgressContributor(new EgressRegistry(), auth([{ name: 'github', enabled: true }])).describe();
      expect(deps.map((d) => d.id)).toEqual(['auth.google', 'auth.google.avatars', 'auth.github']);
      expect(deps[2]).toMatchObject({
        enabled: true,
        required: true,
        direction: 'both',
        hosts: ['github.com', 'api.github.com'],
        capability: 'GitHub sign-in',
      });
    });
  });

  it('is not required when another provider is enabled, and is disabled when off', async () => {
    await withTemporaryEntries(authProviderRegistry, [github], async () => {
      const both = await new AuthProvidersEgressContributor(
        new EgressRegistry(),
        auth([{ name: 'google', enabled: true }, { name: 'github', enabled: true }]),
      ).describe();
      expect(both[2]).toMatchObject({ enabled: true, required: false });
      const off = await new AuthProvidersEgressContributor(new EgressRegistry(), auth([])).describe();
      expect(off[2]).toMatchObject({ enabled: false, required: false });
    });
  });
});

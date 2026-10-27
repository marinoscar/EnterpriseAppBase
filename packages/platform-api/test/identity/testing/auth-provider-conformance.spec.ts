import { withTemporaryEntries } from '../../../src/core/index';
import { describeAuthProviderConformance } from '../../../src/identity/testing/index';
import { authProviderRegistry } from '../../../src/identity/auth/providers/auth-provider.registry';
import type { ExternalProfile } from '../../../src/identity/auth/external-profile';
import '../../../src/identity/auth/providers/google.provider';
import { setupExternalLoginHarness } from '../auth/external-login.helper';

// The kit run on the platform's own Google definition: Google proves the kit,
// and the kit proves Google behaves like any other provider.
describe('describeAuthProviderConformance on the Google definition', () => {
  let harness: Awaited<ReturnType<typeof setupExternalLoginHarness>>;

  beforeAll(async () => {
    harness = await setupExternalLoginHarness();
  });

  describeAuthProviderConformance(authProviderRegistry.require('google'), {
    describe,
    it,
    expect,
    rawProfile: { id: 'g-conf', email: 'google.conformance@example.com', displayName: 'G Conf', picture: 'https://example.com/g.png' },
    sparseRawProfile: { id: 'g-conf', email: 'google.conformance@example.com' },
    expectedSubject: 'g-conf',
    expectedEmail: 'google.conformance@example.com',
    enabledWith: { config: { 'google.clientId': 'id', 'google.clientSecret': 'secret' } },
    host: {
      completeLogin: (profile: ExternalProfile) => harness.service.completeExternalLogin(profile),
      hasIdentity: async (provider, subject) =>
        harness.prisma.user.create.mock.calls.some(
          (call) => {
            const create = (call[0] as any).data.identities.create;
            return create.provider === provider && create.providerSubject === subject;
          },
        ),
      withAllowlist: async (allowed, fn) => {
        harness.allowlist.isEmailAllowed.mockResolvedValue(allowed);
        try {
          await fn();
        } finally {
          harness.allowlist.isEmailAllowed.mockResolvedValue(true);
        }
      },
      withPolicy: async (policy, fn) => {
        // The harness binds its policy at construction; a one-off service carries this one.
        const withPolicy = await setupExternalLoginHarness({ policy });
        const original = harness;
        harness = withPolicy;
        try {
          await fn();
        } finally {
          harness = original;
        }
      },
    },
  });
});

// The kit reports a broken definition instead of passing it.
describe('describeAuthProviderConformance on a broken definition', () => {
  const results: Array<{ name: string; failed: boolean }> = [];

  const collectingDescribe = (_name: string, fn: () => void) => fn();
  const collectingIt = (name: string, fn: () => Promise<void>) => {
    results.push({ name, failed: false });
    const entry = results[results.length - 1]!;
    pending.push(fn().catch(() => { entry.failed = true; }));
  };
  const pending: Array<Promise<void>> = [];

  it('fails mapProfile when the subject is wrong and isEnabled when it is on without configuration', async () => {
    await withTemporaryEntries(authProviderRegistry, [], async () => {
      describeAuthProviderConformance(
        {
          id: 'broken',
          isEnabled: () => true,
          createStrategy: () => ({}) as never,
          mapProfile: () => ({ provider: 'broken', subject: 'wrong', email: 'a@b.co', emailVerified: true }),
        },
        {
          describe: collectingDescribe,
          it: collectingIt,
          expect,
          rawProfile: {},
          expectedSubject: 'right',
          enabledWith: { credentials: { client_secret: 'x' } },
        },
      );
      await Promise.all(pending);
    });
    const failed = results.filter((r) => r.failed).map((r) => r.name);
    expect(failed).toEqual(
      expect.arrayContaining([
        'maps the fixture to a valid ExternalProfile with the expected subject',
        'is not enabled with no configuration and no credentials',
        'builds a strategy with credentials',
      ]),
    );
    expect(results.find((r) => r.name === 'is a well-formed definition')?.failed).toBe(false);
  });
});

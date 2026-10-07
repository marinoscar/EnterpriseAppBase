import { EgressRegistry } from '@marinoscar/platform-api/doctor';

import { AuthService } from '../../auth.service';
import { GoogleAuthEgressContributor } from './google-auth.egress.contributor';

function contributor(providers: Array<{ name: string; enabled: boolean }>) {
  const auth = { getEnabledProviders: jest.fn().mockResolvedValue(providers) } as unknown as AuthService;
  const registry = new EgressRegistry();
  const subject = new GoogleAuthEgressContributor(registry, auth);
  return { subject, registry, auth };
}

describe('GoogleAuthEgressContributor (#773)', () => {
  it('registers itself from onModuleInit', () => {
    const { subject, registry } = contributor([]);
    subject.onModuleInit();

    expect(registry.list()).toEqual([subject]);
  });

  it('is enabled and required when Google is the only provider', async () => {
    const [google, avatars] = await contributor([{ name: 'google', enabled: true }]).subject.describe();

    expect(google).toMatchObject({
      id: 'auth.google',
      enabled: true,
      required: true,
      direction: 'both',
      scope: 'public',
      hosts: ['accounts.google.com', 'oauth2.googleapis.com', 'www.googleapis.com'],
    });
    expect(avatars).toMatchObject({
      id: 'auth.google.avatars',
      enabled: true,
      required: false,
      direction: 'browser',
      hosts: ['lh3.googleusercontent.com'],
    });
  });

  it('is not required when another provider is enabled too', async () => {
    const [google] = await contributor([
      { name: 'google', enabled: true },
      { name: 'oidc', enabled: true },
    ]).subject.describe();

    expect(google).toMatchObject({ enabled: true, required: false });
  });

  it('is disabled when Google is not configured', async () => {
    const deps = await contributor([]).subject.describe();

    expect(deps.map((d) => [d.id, d.enabled, d.required])).toEqual([
      ['auth.google', false, false],
      ['auth.google.avatars', false, false],
    ]);
  });

  it('reads only the provider list (no secret accessor)', async () => {
    const { subject, auth } = contributor([{ name: 'google', enabled: true }]);
    const text = JSON.stringify(await subject.describe());

    expect(auth.getEnabledProviders).toHaveBeenCalledTimes(1);
    expect(text).not.toMatch(/client|secret|https?:/i);
  });
});

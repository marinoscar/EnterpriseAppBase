import { Global, InternalServerErrorException, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { CredentialsService } from '../../src/credentials/credentials.service';
import { OrgCredentialsService } from '../../src/credentials/org-credentials.service';
import { type UserCredentialPurposeDef, userCredentialPurposeRegistry } from '../../src/credentials/registry';
import { USER_CREDENTIAL_PURPOSE_REGISTRY, UserCredentialResolver } from '../../src/credentials/user-credential.resolver';
import { UserCredentialsModule } from '../../src/credentials/user-credentials.module';
import { UserCredentialsService } from '../../src/credentials/user-credentials.service';
import { PLATFORM_PRISMA } from '../../src/core/index';
import { createMockCredentialsPrisma } from './fakes';
import './purposes';

// =============================================================================
// UserCredentialResolver — tests (issue #387; the org tier #735)
// =============================================================================
//
// The chain: the user's own key, then each tier of the purpose's `fallback`
// ('org' needs an orgId), then none. The default fallback (`['system']` with a
// system address, `[]` without) is the pre-organization behaviour, pinned by
// the "default parity" block.
// =============================================================================

const ALICE = '0b6f1d7e-3c2a-4f5b-9e8d-7a6c5b4d3e2f';
const ACME = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

const FIXTURE: UserCredentialPurposeDef[] = [
  {
    purpose: 'webhook',
    label: 'Webhook signing secret',
    description: 'Signs outbound webhooks sent on your behalf.',
    system: { purpose: 'webhook_org', name: 'default' },
  },
  {
    purpose: 'personal_token',
    label: 'Personal token',
    description: 'A token only you can supply.',
    system: null,
  },
  {
    purpose: 'partner_token',
    label: 'Partner API token',
    description: 'Your own partner token; your organization may supply one.',
    system: { purpose: 'partner_api', name: 'default' },
    org: { purpose: 'partner_api', name: 'default' },
    fallback: ['org', 'system'],
  },
  {
    purpose: 'org_first_no_system',
    label: 'Org-only fallback',
    description: 'Falls back to the organization only.',
    system: null,
    org: { purpose: 'org_only', name: 'default' },
    fallback: ['org'],
  },
];

describe('UserCredentialResolver', () => {
  let userGet: jest.Mock;
  let systemGet: jest.Mock;
  let orgGet: jest.Mock;

  async function build(registry: readonly UserCredentialPurposeDef[] = FIXTURE, withOrg = true) {
    const module = await Test.createTestingModule({
      providers: [
        UserCredentialResolver,
        { provide: UserCredentialsService, useValue: { getSecret: userGet } },
        { provide: CredentialsService, useValue: { getSecret: systemGet } },
        ...(withOrg ? [{ provide: OrgCredentialsService, useValue: { getSecret: orgGet } }] : []),
        { provide: USER_CREDENTIAL_PURPOSE_REGISTRY, useValue: registry },
      ],
    }).compile();
    return module.get(UserCredentialResolver);
  }

  beforeEach(() => {
    userGet = jest.fn().mockResolvedValue(null);
    systemGet = jest.fn().mockResolvedValue(null);
    orgGet = jest.fn().mockResolvedValue(null);
  });

  describe('default parity (no fallback declared: user, then system, then none)', () => {
    it("the user's own key wins, and the system store is not consulted", async () => {
      userGet.mockResolvedValue('user-key');
      systemGet.mockResolvedValue('deployment-key');
      const resolver = await build();

      await expect(resolver.resolve(ALICE, 'webhook')).resolves.toEqual({ source: 'user', purpose: 'webhook', secret: 'user-key' });
      expect(userGet).toHaveBeenCalledWith(ALICE, 'webhook', 'default');
      expect(systemGet).not.toHaveBeenCalled();
    });

    it("falls back to the deployment's key at the registry's system address", async () => {
      systemGet.mockResolvedValue('deployment-key');
      const resolver = await build();

      await expect(resolver.resolve(ALICE, 'webhook')).resolves.toEqual({ source: 'system', purpose: 'webhook', secret: 'deployment-key' });
      expect(systemGet).toHaveBeenCalledWith('webhook_org', 'default');
    });

    it('never consults the org store, even with an orgId and an org key', async () => {
      orgGet.mockResolvedValue('org-key');
      const resolver = await build();
      await expect(resolver.resolve(ALICE, 'webhook', undefined, { orgId: ACME })).resolves.toEqual({ source: 'none', purpose: 'webhook' });
      expect(orgGet).not.toHaveBeenCalled();
    });

    it('answers none when neither is configured', async () => {
      const resolver = await build();
      await expect(resolver.resolve(ALICE, 'webhook')).resolves.toEqual({ source: 'none', purpose: 'webhook' });
    });

    it('answers none without consulting the system store when there is no counterpart', async () => {
      const resolver = await build();
      await expect(resolver.resolve(ALICE, 'personal_token')).resolves.toEqual({ source: 'none', purpose: 'personal_token' });
      expect(systemGet).not.toHaveBeenCalled();
    });
  });

  describe("the chain with fallback ['org', 'system']", () => {
    it('user first', async () => {
      userGet.mockResolvedValue('user-key');
      orgGet.mockResolvedValue('org-key');
      systemGet.mockResolvedValue('deployment-key');
      const resolver = await build();
      await expect(resolver.resolve(ALICE, 'partner_token', undefined, { orgId: ACME })).resolves.toEqual({
        source: 'user',
        purpose: 'partner_token',
        secret: 'user-key',
      });
      expect(orgGet).not.toHaveBeenCalled();
    });

    it("then the organization's key at the org address", async () => {
      orgGet.mockResolvedValue('org-key');
      systemGet.mockResolvedValue('deployment-key');
      const resolver = await build();
      await expect(resolver.resolve(ALICE, 'partner_token', undefined, { orgId: ACME })).resolves.toEqual({
        source: 'org',
        purpose: 'partner_token',
        secret: 'org-key',
      });
      expect(orgGet).toHaveBeenCalledWith(ACME, 'partner_api', 'default');
      expect(systemGet).not.toHaveBeenCalled();
    });

    it("then the deployment's key", async () => {
      systemGet.mockResolvedValue('deployment-key');
      const resolver = await build();
      await expect(resolver.resolve(ALICE, 'partner_token', undefined, { orgId: ACME })).resolves.toEqual({
        source: 'system',
        purpose: 'partner_token',
        secret: 'deployment-key',
      });
      expect(orgGet).toHaveBeenCalled();
    });

    it('then none', async () => {
      const resolver = await build();
      await expect(resolver.resolve(ALICE, 'partner_token', undefined, { orgId: ACME })).resolves.toEqual({
        source: 'none',
        purpose: 'partner_token',
      });
    });

    it('skips the org tier without an orgId', async () => {
      orgGet.mockResolvedValue('org-key');
      systemGet.mockResolvedValue('deployment-key');
      const resolver = await build();
      await expect(resolver.resolve(ALICE, 'partner_token')).resolves.toMatchObject({ source: 'system' });
      expect(orgGet).not.toHaveBeenCalled();
    });

    it('skips the org tier when the app did not import OrgCredentialsModule', async () => {
      systemGet.mockResolvedValue('deployment-key');
      const resolver = await build(FIXTURE, false);
      await expect(resolver.resolve(ALICE, 'partner_token', undefined, { orgId: ACME })).resolves.toMatchObject({ source: 'system' });
    });

    it("an org-only fallback never reaches the deployment's store", async () => {
      systemGet.mockResolvedValue('deployment-key');
      const resolver = await build();
      await expect(resolver.resolve(ALICE, 'org_first_no_system', undefined, { orgId: ACME })).resolves.toEqual({
        source: 'none',
        purpose: 'org_first_no_system',
      });
      expect(systemGet).not.toHaveBeenCalled();
    });

    it("does NOT fall through when the org's key will not decrypt", async () => {
      orgGet.mockRejectedValue(new InternalServerErrorException('could not be decrypted'));
      systemGet.mockResolvedValue('deployment-key');
      const resolver = await build();
      await expect(resolver.resolve(ALICE, 'partner_token', undefined, { orgId: ACME })).rejects.toThrow(InternalServerErrorException);
      expect(systemGet).not.toHaveBeenCalled();
    });
  });

  it('passes a non-default user-side name through', async () => {
    userGet.mockResolvedValue('user-key');
    const resolver = await build();
    await resolver.resolve(ALICE, 'webhook', 'secondary');
    expect(userGet).toHaveBeenCalledWith(ALICE, 'webhook', 'secondary');
  });

  it('throws for a purpose not in the registry, before reading anything', async () => {
    const resolver = await build();
    await expect(resolver.resolve(ALICE, 'nope')).rejects.toThrow(InternalServerErrorException);
    expect(userGet).not.toHaveBeenCalled();
    expect(systemGet).not.toHaveBeenCalled();
  });

  it("does NOT fall back to the deployment key when the user's key will not decrypt", async () => {
    userGet.mockRejectedValue(new InternalServerErrorException('could not be decrypted'));
    systemGet.mockResolvedValue('deployment-key');
    const resolver = await build();

    await expect(resolver.resolve(ALICE, 'webhook')).rejects.toThrow(InternalServerErrorException);
    expect(systemGet).not.toHaveBeenCalled();
  });

  describe('registry validation at construction', () => {
    const base = FIXTURE[0];

    it.each([
      ['a duplicate purpose', [base, { ...base }]],
      ['a purpose containing ":"', [{ ...base, purpose: 'a:b' }]],
      ['a whitespace-padded purpose', [{ ...base, purpose: 'webhook ' }]],
      ['a system address naming an unregistered purpose', [{ ...base, system: { purpose: 'nowhere', name: 'default' } }]],
      ['an org address naming a system-only purpose', [{ ...base, org: { purpose: 'webhook_org', name: 'default' }, fallback: ['org'] }]],
      ['a missing label', [{ ...base, label: '' }]],
    ])('rejects %s', async (_label, registry) => {
      await expect(build(registry as UserCredentialPurposeDef[])).rejects.toThrow();
    });
  });

  describe('the production module', () => {
    it('binds the token to the registered user purposes and boots', async () => {
      @Global()
      @Module({ providers: [{ provide: PLATFORM_PRISMA, useValue: createMockCredentialsPrisma() }], exports: [PLATFORM_PRISMA] })
      class FakeHostModule {}

      const module = await Test.createTestingModule({ imports: [FakeHostModule, UserCredentialsModule] }).compile();
      expect(module.get(USER_CREDENTIAL_PURPOSE_REGISTRY)).toEqual(userCredentialPurposeRegistry.list());
      expect(module.get(UserCredentialResolver)).toBeInstanceOf(UserCredentialResolver);
    });

    it('does not declare the AI provider key, which already lives in user_ai_keys', () => {
      const purposes = userCredentialPurposeRegistry.ids();
      expect(purposes).not.toContain('ai');
      expect(purposes).not.toContain('ai_user_key');
    });
  });
});

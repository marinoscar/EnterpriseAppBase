import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PLATFORM_PRISMA, withTemporaryEntries } from '@marinoscar/platform-api/core';
import {
  CredentialsService,
  OrgCredentialsService,
  UserCredentialResolver,
  UserCredentialsModule,
  UserCredentialsService,
  credentialPurposeRegistry,
  userCredentialPurposeRegistry,
} from '@marinoscar/platform-api/credentials';

// Importing the app's binding runs the purpose manifest.
import '../../src/platform/credentials/credentials.config';
import {
  PARTNER_API_CREDENTIAL_PURPOSE,
  PARTNER_API_TOKEN_PURPOSE,
} from '../../src/platform-extensions/credentials/examples/partner-api-token.purpose';
import { WEBHOOK_SIGNING_KEY_PURPOSE } from '../../src/platform-extensions/credentials/examples/webhook-signing-key.purpose';
import { APP_CREDENTIAL_PURPOSES, APP_USER_CREDENTIAL_PURPOSES } from '../../src/app-registrations/credentials';

// =============================================================================
// The credentials slice's extension points, used by the reference app (PP-8.8)
// =============================================================================
//
//   registerCredentialPurpose      the manifest registers every platform
//                                  purpose; the partner example adds an org tier
//   registerUserCredentialPurpose  the two examples: no fallback, and
//                                  ['org', 'system']
//   UserCredentialResolver         user -> org -> system -> none
// =============================================================================

const API_ROOT = resolve(__dirname, '..', '..');
const ALICE = '0b6f1d7e-3c2a-4f5b-9e8d-7a6c5b4d3e2f';
const ACME = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

describe('the app registers its credential purposes', () => {
  it('declares every platform system purpose with its owner and tiers, and no app purpose upstream', () => {
    const byId = Object.fromEntries(credentialPurposeRegistry.list().map((d) => [d.purpose, `${d.owner}:${d.tiers.join('+')}`]));
    expect(byId).toEqual({
      ai: 'ai:system+org',
      storage: 'storage:system',
      smtp: 'email:system',
      email_ses: 'email:system',
      push_vapid: 'notifications:system',
      telemetry_greptime: 'telemetry:system',
    });
    expect(APP_CREDENTIAL_PURPOSES).toEqual([]);
    expect(APP_USER_CREDENTIAL_PURPOSES).toEqual([]);
    expect(userCredentialPurposeRegistry.ids()).toEqual([]);
  });
});

describe('the reference examples', () => {
  let userGet: jest.Mock;
  let orgGet: jest.Mock;
  let systemGet: jest.Mock;

  @Global()
  @Module({ providers: [{ provide: PLATFORM_PRISMA, useValue: {} }], exports: [PLATFORM_PRISMA] })
  class FakeHostModule {}

  async function resolver(): Promise<UserCredentialResolver> {
    const module = await Test.createTestingModule({ imports: [FakeHostModule, UserCredentialsModule] })
      .overrideProvider(UserCredentialsService)
      .useValue({ getSecret: userGet })
      .overrideProvider(OrgCredentialsService)
      .useValue({ getSecret: orgGet })
      .overrideProvider(CredentialsService)
      .useValue({ getSecret: systemGet })
      .compile();
    return module.get(UserCredentialResolver);
  }

  beforeEach(() => {
    userGet = jest.fn().mockResolvedValue(null);
    orgGet = jest.fn().mockResolvedValue(null);
    systemGet = jest.fn().mockResolvedValue(null);
  });

  const withExamples = <R>(fn: () => Promise<R>) =>
    withTemporaryEntries(credentialPurposeRegistry, [PARTNER_API_CREDENTIAL_PURPOSE], () =>
      withTemporaryEntries(userCredentialPurposeRegistry, [WEBHOOK_SIGNING_KEY_PURPOSE, PARTNER_API_TOKEN_PURPOSE], fn),
    );

  it("webhook_signing_key (system: null) answers the user's key or none, never anyone else's", () =>
    withExamples(async () => {
      orgGet.mockResolvedValue('org-key');
      systemGet.mockResolvedValue('deployment-key');
      const r = await resolver();
      await expect(r.resolve(ALICE, 'webhook_signing_key', undefined, { orgId: ACME })).resolves.toEqual({
        source: 'none',
        purpose: 'webhook_signing_key',
      });
      userGet.mockResolvedValue('alice-key');
      await expect(r.resolve(ALICE, 'webhook_signing_key')).resolves.toMatchObject({ source: 'user', secret: 'alice-key' });
      expect(orgGet).not.toHaveBeenCalled();
      expect(systemGet).not.toHaveBeenCalled();
    }));

  it("partner_api_token resolves user, then the organization's token, then the deployment's", () =>
    withExamples(async () => {
      const r = await resolver();
      systemGet.mockResolvedValue('deployment-token');
      await expect(r.resolve(ALICE, 'partner_api_token', undefined, { orgId: ACME })).resolves.toMatchObject({ source: 'system' });
      orgGet.mockResolvedValue('acme-token');
      await expect(r.resolve(ALICE, 'partner_api_token', undefined, { orgId: ACME })).resolves.toMatchObject({
        source: 'org',
        secret: 'acme-token',
      });
      expect(orgGet).toHaveBeenLastCalledWith(ACME, 'partner_api', 'default');
      userGet.mockResolvedValue('alice-token');
      await expect(r.resolve(ALICE, 'partner_api_token', undefined, { orgId: ACME })).resolves.toMatchObject({ source: 'user' });
    }));
});

describe('no local copy of the credentials slice', () => {
  it('apps/api/src/credentials and apps/api/src/user-credentials are gone', () => {
    expect(existsSync(join(API_ROOT, 'src', 'credentials'))).toBe(false);
    expect(existsSync(join(API_ROOT, 'src', 'user-credentials'))).toBe(false);
  });

  it('the BYOK AI key store takes deriveHint from the package, not from a copy', () => {
    // The AI slice is packaged (#739): it imports the credentials slice by its index.
    const source = readFileSync(
      join(API_ROOT, '..', '..', 'packages', 'platform-api', 'src', 'ai', 'keys', 'user-ai-keys.service.ts'),
      'utf8',
    );
    expect(source).toContain("from '../../credentials/index'");
    expect(source).not.toMatch(/function deriveHint\b/);
  });
});

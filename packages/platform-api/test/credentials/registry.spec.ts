import { InternalServerErrorException } from '@nestjs/common';

import { RegistryError, freezeDefinedRegistries } from '../../src/core/index';
import { withTemporaryEntries } from '../../src/core/registry/testing';
import { CredentialsService } from '../../src/credentials/credentials.service';
import {
  credentialPurposeRegistry,
  danglingCredentialAddresses,
  fallbackOf,
  registerCredentialPurpose,
  registerUserCredentialPurpose,
  userCredentialPurposeRegistry,
} from '../../src/credentials/registry';
import { UserCredentialsService } from '../../src/credentials/user-credentials.service';
import { createMockCredentialsPrisma } from './fakes';
import './purposes';

// =============================================================================
// The credential purpose registries (issue #735)
// =============================================================================

const USER = '0b6f1d7e-3c2a-4f5b-9e8d-7a6c5b4d3e2f';

describe('registerCredentialPurpose', () => {
  it('registers a system/org purpose', () => {
    expect(credentialPurposeRegistry.require('smtp')).toEqual({ purpose: 'smtp', owner: 'email', label: 'SMTP password', tiers: ['system'] });
  });

  it('throws DUPLICATE_ID, naming both owners, when a second owner claims a purpose', () => {
    let error: unknown;
    try {
      registerCredentialPurpose({ purpose: 'smtp', owner: 'my-app', label: 'Also SMTP', tiers: ['system'] });
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(RegistryError);
    expect((error as RegistryError).code).toBe('DUPLICATE_ID');
    expect((error as Error).message).toMatch(/already registered by "email"; "my-app" cannot claim it/);
  });

  it.each([
    ['a ":" in the purpose', { purpose: 'a:b', owner: 'x', label: 'x', tiers: ['system'] }, 'INVALID_ID'],
    ['no owner', { purpose: 'p1', owner: '', label: 'x', tiers: ['system'] }, 'INVALID_ENTRY'],
    ['no label', { purpose: 'p2', owner: 'x', label: ' ', tiers: ['system'] }, 'INVALID_ENTRY'],
    ['no tier', { purpose: 'p3', owner: 'x', label: 'x', tiers: [] }, 'INVALID_ENTRY'],
    ['an unknown tier', { purpose: 'p4', owner: 'x', label: 'x', tiers: ['user'] }, 'INVALID_ENTRY'],
  ])('rejects %s', (_label, def, code) => {
    expect(() => registerCredentialPurpose(def as never)).toThrow(expect.objectContaining({ code }));
  });
});

describe('registerUserCredentialPurpose', () => {
  it('throws DUPLICATE_ID for a purpose already declared', () => {
    expect(() =>
      registerUserCredentialPurpose({ purpose: 'webhook', label: 'x', description: 'x', system: null }),
    ).toThrow(expect.objectContaining({ code: 'DUPLICATE_ID' }));
  });

  it.each([
    ['fallback org without an org address', { fallback: ['org'], system: null }],
    ['fallback system without a system address', { fallback: ['system'], system: null }],
    ['a repeated fallback tier', { fallback: ['system', 'system'], system: { purpose: 'smtp', name: 'default' } }],
    ['a malformed org address', { org: { purpose: 'x:y', name: 'default' }, system: null }],
    ['no description', { description: '', system: null }],
  ])('rejects %s', (_label, overrides) => {
    expect(() =>
      registerUserCredentialPurpose({ purpose: 'bad_entry', label: 'Bad', description: 'Bad.', system: null, ...(overrides as object) } as never),
    ).toThrow(expect.objectContaining({ code: 'INVALID_ENTRY' }));
  });

  it('defaults the fallback to the pre-organization rule', () => {
    expect(fallbackOf({ purpose: 'a', label: 'a', description: 'a', system: { purpose: 'smtp', name: 'default' } })).toEqual(['system']);
    expect(fallbackOf({ purpose: 'a', label: 'a', description: 'a', system: null })).toEqual([]);
    expect(
      fallbackOf({
        purpose: 'a',
        label: 'a',
        description: 'a',
        system: { purpose: 'partner_api', name: 'default' },
        org: { purpose: 'partner_api', name: 'default' },
        fallback: ['org', 'system'],
      }),
    ).toEqual(['org', 'system']);
  });

  it('reports an address that names no registered purpose of its tier', () => {
    expect(
      danglingCredentialAddresses([
        { purpose: 'u1', label: 'u', description: 'u', system: { purpose: 'nowhere', name: 'default' } },
        { purpose: 'u2', label: 'u', description: 'u', system: null, org: { purpose: 'smtp', name: 'default' } },
        { purpose: 'u3', label: 'u', description: 'u', system: { purpose: 'partner_api', name: 'default' }, org: { purpose: 'partner_api', name: 'default' } },
      ]),
    ).toEqual([
      'user credential purpose "u1": its system address names "nowhere", which is not a registered credential purpose',
      'user credential purpose "u2": its org address names "smtp", which is not registered for the org tier',
    ]);
  });
});

describe('writing to an unregistered purpose', () => {
  it('the deployment store refuses it with a 500-class error before touching the database', async () => {
    const prisma = createMockCredentialsPrisma();
    const service = new CredentialsService(prisma as never);
    await expect(service.setSecret('smpt', 'default', 'typo-12345678')).rejects.toThrow(InternalServerErrorException);
    await expect(service.setSecret('org_only', 'default', 'org-tier-only')).rejects.toThrow(/not registered for the system tier/);
    expect(prisma.credential.upsert).not.toHaveBeenCalled();
  });

  it('the user store refuses an undeclared user purpose', async () => {
    const prisma = createMockCredentialsPrisma();
    const service = new UserCredentialsService(prisma as never);
    await expect(service.setSecret(USER, 'undeclared', 'default', 'x-12345678')).rejects.toThrow(InternalServerErrorException);
    expect(prisma.userCredential.upsert).not.toHaveBeenCalled();
  });

  it('reading an unregistered purpose stays allowed (only writes are refused)', async () => {
    const service = new CredentialsService(createMockCredentialsPrisma() as never);
    await expect(service.getSecret('never_registered', 'default')).resolves.toBeNull();
  });
});

describe('after bootstrap', () => {
  it('both registries are frozen; a late registration throws FROZEN, and withTemporaryEntries still works in tests', async () => {
    freezeDefinedRegistries();
    expect(credentialPurposeRegistry.frozen).toBe(true);
    expect(userCredentialPurposeRegistry.frozen).toBe(true);
    expect(() => registerCredentialPurpose({ purpose: 'late', owner: 'x', label: 'x', tiers: ['system'] })).toThrow(
      expect.objectContaining({ code: 'FROZEN' }),
    );
    expect(() => registerUserCredentialPurpose({ purpose: 'late', label: 'x', description: 'x', system: null })).toThrow(
      expect.objectContaining({ code: 'FROZEN' }),
    );
    await withTemporaryEntries(credentialPurposeRegistry, [{ purpose: 'temp', owner: 'test', label: 'Temp', tiers: ['system'] }], () => {
      expect(credentialPurposeRegistry.has('temp')).toBe(true);
    });
    expect(credentialPurposeRegistry.has('temp')).toBe(false);
  });
});

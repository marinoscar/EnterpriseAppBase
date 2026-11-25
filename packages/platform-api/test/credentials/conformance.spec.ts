import { z } from 'zod';

import { withCredentialPurposes } from '../../src/credentials/testing/index';
import {
  checkCredentialAddresses,
  checkCredentialInfoSchemas,
  checkCredentialOwners,
  credentialsConformanceSuite,
} from '../../src/credentials/testing/index';
import { credentialPurposeRegistry } from '../../src/credentials/registry';
import { conformanceSuites, runPlatformConformance } from '../../src/testing/index';
import './purposes';

// =============================================================================
// The credentials conformance suite (#735): it passes a conformant app and
// fails each fixture violation.
// =============================================================================

const context = { sourceRoots: [__dirname] };

describe('the credentials conformance suite', () => {
  it('is registered by importing the testing entry', () => {
    expect(conformanceSuites.get('credentials')).toBe(credentialsConformanceSuite);
  });

  it('passes the fixture registries (owner "test" declared as an app owner)', () => {
    const report = credentialsConformanceSuite.check(context, { appOwners: ['test'] });
    expect(report.findings).toEqual([]);
    expect(report.scanned).toEqual({ purposes: 5, userPurposes: 3, schemas: 3 });
  });

  it('fails an unknown owner', () => {
    expect(checkCredentialOwners([{ purpose: 'x', owner: 'mystery', label: 'X', tiers: ['system'] }], ['app'])).toEqual([
      expect.objectContaining({ file: 'credential-purposes', message: expect.stringContaining('owner "mystery"') }),
    ]);
    expect(checkCredentialOwners([{ purpose: 'x', owner: 'email', label: 'X', tiers: ['system'] }], [])).toEqual([]);
  });

  it('fails a user purpose whose fallback address names an unregistered or wrong-tier purpose', () => {
    expect(
      checkCredentialAddresses(
        [
          { purpose: 'u', label: 'u', description: 'u', system: { purpose: 'gone', name: 'default' } },
          { purpose: 'v', label: 'v', description: 'v', system: null, org: { purpose: 'smtp', name: 'default' }, fallback: ['org'] },
        ],
        credentialPurposeRegistry.list(),
      ).map((f) => f.message),
    ).toEqual([
      expect.stringContaining('"gone", which is not a registered credential purpose'),
      expect.stringContaining('"smtp", which is not registered for the org tier'),
    ]);
  });

  it('fails a response schema that carries a secret or an id', () => {
    const leaky = z.object({ purpose: z.string(), secret: z.string(), orgId: z.string() });
    expect(checkCredentialInfoSchemas({ leakyInfoSchema: leaky }).map((f) => f.message)).toEqual([
      expect.stringContaining('leakyInfoSchema declares "secret"'),
      expect.stringContaining('leakyInfoSchema declares "orgId"'),
    ]);
    expect(credentialsConformanceSuite.check(context, { appOwners: ['test'], infoSchemas: { leakyInfoSchema: leaky } }).findings).toHaveLength(2);
  });

  it('withCredentialPurposes declares purposes for one callback only', async () => {
    await withCredentialPurposes({ purposes: [{ purpose: 'temp_key', owner: 'app', label: 'Temp', tiers: ['org'] }] }, () => {
      expect(credentialPurposeRegistry.has('temp_key')).toBe(true);
    });
    expect(credentialPurposeRegistry.has('temp_key')).toBe(false);
  });
});

// The harness end to end, as an app runs it.
runPlatformConformance({ sourceRoots: [__dirname], suites: { credentials: { appOwners: ['test'] } } });

import { conformanceSuites } from '../../src/testing';
import { nodeCredentialCacheConformanceSuite } from '../../src/nodes/testing';

// The API half of the node-credential-cache suite (#1083) passes against the
// slice's own code, and registers under its id.
describe('the node-credential-cache conformance suite', () => {
  it('registers under its id', () => {
    expect(nodeCredentialCacheConformanceSuite.id).toBe('node-credential-cache');
    expect(conformanceSuites.has('node-credential-cache')).toBe(true);
  });

  const report = nodeCredentialCacheConformanceSuite.check({ sourceRoots: [] } as never, {});
  for (const testCase of nodeCredentialCacheConformanceSuite.cases({})) {
    it(testCase.name, async () => {
      await testCase.run(report, expect as never);
    });
  }
});

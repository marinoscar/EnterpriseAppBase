// The `webhooks` conformance suite (#1046) passes against the slice itself, and
// registers with the harness on import.
import { join } from 'node:path';

import { runPlatformConformance, conformanceSuites } from '../../src/testing/index';
import { webhooksConformanceSuite } from '../../src/webhooks/testing/index';

describe('webhooks conformance suite', () => {
  it('registers itself with the harness on import', () => {
    expect(conformanceSuites.has('webhooks')).toBe(true);
    expect(webhooksConformanceSuite.id).toBe('webhooks');
  });
});

runPlatformConformance({
  sourceRoots: [join(__dirname, '..', '..', 'src', 'webhooks')],
  suites: { webhooks: {} },
  summaryOutput: () => undefined,
});

// Runs the `shell-layout-variants` web conformance suite (issue #1080) inside
// the package, so it is green here before an app runs it through
// `runPlatformWebConformance`.

import { describe, expect, it } from 'vitest';

import { shellLayoutVariantsSuite } from '../../src/shell/testing/index.js';
import type { WebConformanceTestApi } from '../../src/testing/index.js';

shellLayoutVariantsSuite.register(
  { describe, it, expect } as unknown as WebConformanceTestApi,
  {} as never,
  undefined as never,
);

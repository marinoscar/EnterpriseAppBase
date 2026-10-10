// The AI slice's conformance suites (issue #742). Importing this module
// REGISTERS them with `runPlatformConformance` (option keys `aiKillSwitch`,
// `aiRbacMatrix`, `aiSecretEgress`, `aiKeyPolicy`, `aiJobsServerOnly`,
// `aiNoSdkLeak`, `aiOrchestrationBoundary`).

import { conformanceSuites } from '../../../testing/index';
import { aiJobsServerOnlySuite } from './ai-jobs-server-only.suite';
import type { AiJobsServerOnlyOptions } from './ai-jobs-server-only.suite';
import { aiKeyPolicySuite } from './ai-key-policy.suite';
import type { AiKeyPolicyOptions } from './ai-key-policy.suite';
import { aiKillSwitchSuite } from './ai-kill-switch.suite';
import type { AiKillSwitchOptions } from './ai-kill-switch.suite';
import { aiNoSdkLeakSuite } from './ai-no-sdk-leak.suite';
import type { AiNoSdkLeakOptions } from './ai-no-sdk-leak.suite';
import { aiOrchestrationBoundarySuite } from './ai-orchestration-boundary.registered';
import { aiRbacMatrixSuite } from './ai-rbac-matrix.suite';
import type { AiRbacMatrixOptions } from './ai-rbac-matrix.suite';
import { aiSecretEgressSuite } from './ai-secret-egress.suite';
import type { AiSecretEgressOptions } from './ai-secret-egress.suite';
import type { OrchestrationBoundaryOptions } from './orchestration-boundary.suite';

declare module '../../../testing/index' {
  interface PlatformConformanceSuiteOptions {
    /** The `ai-kill-switch` suite: its options, or `{ skip: 'reason' }`. Registered by importing `@marinoscar/platform-api/ai/testing`. */
    aiKillSwitch?: AiKillSwitchOptions;
    /** The `ai-rbac-matrix` suite: its options, or `{ skip: 'reason' }`. */
    aiRbacMatrix?: AiRbacMatrixOptions;
    /** The `ai-secret-egress` suite: its options, or `{ skip: 'reason' }`. */
    aiSecretEgress?: AiSecretEgressOptions;
    /** The `ai-key-policy` suite: its options, or `{ skip: 'reason' }`. */
    aiKeyPolicy?: AiKeyPolicyOptions;
    /** The `ai-jobs-server-only` suite: its options, or `{ skip: 'reason' }`. */
    aiJobsServerOnly?: AiJobsServerOnlyOptions;
    /** The `ai-no-sdk-leak` suite: its options, or `{ skip: 'reason' }`. */
    aiNoSdkLeak?: AiNoSdkLeakOptions;
    /** The `ai-orchestration-boundary` suite: its options, or `{ skip: 'reason' }`. */
    aiOrchestrationBoundary?: OrchestrationBoundaryOptions;
  }
}

for (const suite of [
  aiKillSwitchSuite,
  aiRbacMatrixSuite,
  aiSecretEgressSuite,
  aiKeyPolicySuite,
  aiJobsServerOnlySuite,
  aiNoSdkLeakSuite,
  aiOrchestrationBoundarySuite,
]) {
  if (!conformanceSuites.has(suite.id)) conformanceSuites.register(suite);
}

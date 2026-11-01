// `@marinoscar/platform-api/jobs/testing`: the jobs slice's test kit.
//   - the `on-event-no-io` conformance suite (issue #742): importing this entry
//     registers it with `runPlatformConformance` (option key `onEventNoIo`);
//   - the extension-author kit (PP-14.26): `createFakeJobQueue`, an in-memory
//     queue with the real dedup rule, claim order and retry budget, and
//     `describeJobHandlerConformance` / `findJobHandlerContractViolations`, which
//     prove a handler against the job contract.
// Never import it from production code. Documented in ../README.md.

export { eventListenerBodies, listenerIoMarkers, onEventNoIoSuite, stripListenerComments } from './on-event-no-io.suite';
export type { OnEventNoIoOptions } from './on-event-no-io.suite';

export { createFakeJobQueue } from './fake-job-queue';
export type { FakeJobDelete, FakeJobQueue, FakeJobQueueOptions, FakeJobRun } from './fake-job-queue';
export { describeJobHandlerConformance, findJobHandlerContractViolations } from './job-handler-conformance';
export type {
  JobCanDeleteScenario,
  JobHandlerConformanceOptions,
  JobHandlerContractOptions,
  JobPayloadScenario,
} from './job-handler-conformance';

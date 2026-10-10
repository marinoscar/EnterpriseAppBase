// `@marinoscar/platform-api/host/testing`: the host slice's conformance suite
// (issue #867). Importing this entry registers the `host` suite with
// `runPlatformConformance` (@marinoscar/platform-api/testing). Never import it
// from production code. Documented in ../README.md.

export { checkHostModuleGraph, discoverHostModuleGraph, hostConformanceSuite } from './conformance';
export type { HostConformanceOptions, HostGlobalEnhancer, HostModuleGraph } from './conformance';

// A multi-replica event bus double for an app's own tests (no database).
export { FakeEventBusNetwork, flushEventBus } from './fake-event-bus-network';

// The event bus adapter conformance kit (PP-14.2): run it on an adapter you register or bind.
export { describeEventBusConformance } from './event-bus-conformance';
export type { EventBusConformanceHarness, EventBusConformanceOptions } from './event-bus-conformance';

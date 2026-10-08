// `@marinoscar/platform-api/jobs/testing`: the jobs slice's conformance suite
// (issue #742). Importing this entry registers the `on-event-no-io` suite with
// `runPlatformConformance` (option key `onEventNoIo`). Never import it from
// production code. Documented in ../README.md.

export { eventListenerBodies, listenerIoMarkers, onEventNoIoSuite, stripListenerComments } from './on-event-no-io.suite';
export type { OnEventNoIoOptions } from './on-event-no-io.suite';

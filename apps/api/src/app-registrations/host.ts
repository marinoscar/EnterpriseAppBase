import { registerEventBusAdapter } from '@marinoscar/platform-api/host';

import { recordingEventBusAdapter } from '../platform-extensions/host/recording-event-bus';

// =============================================================================
// This app's host registrations (PP-14.2, issue #920)
// =============================================================================
//
// Event bus adapters. The platform ships `in-process` and `postgres`; an app
// registers its own here, AT IMPORT TIME (the bus is built while the container
// is created, and the registry freezes once the application has bootstrapped),
// then selects it by id: `EVENT_BUS_ADAPTER=<id>`, or
// `PlatformHostCoreModule.forRoot({ eventBusAdapter: '<id>' })`.
//
// `platform/host-core.config.ts` imports this file before `forRoot()`. Recipe:
// packages/platform-api/src/host/README.md, "Adding an event bus adapter".
//
// The reference app registers the worked example, an in-memory recording
// double (`platform-extensions/host/recording-event-bus.ts`). It is registered
// so the example is the real thing, not selected by default; a fork that does
// not want `EVENT_BUS_ADAPTER=recording` to be accepted deletes the line.
// =============================================================================

registerEventBusAdapter(recordingEventBusAdapter);

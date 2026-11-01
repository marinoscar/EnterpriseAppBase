import {
  registerAboutContributor,
  registerEventBusAdapter,
  registerHealthIndicator,
  registerMaintenanceBypass,
  registerResponseMetaContributor,
} from '@marinoscar/platform-api/host';

import { apiRevisionMeta } from '../platform-extensions/host/api-revision.response-meta';
import { registerByocExample } from '../platform-extensions/host/byoc.deployment-mode';
import { paymentsWebhookBypass } from '../platform-extensions/host/payments-webhook.bypass';
import { queueReadinessIndicator } from '../platform-extensions/host/queue-readiness.indicator';
import { recordingEventBusAdapter } from '../platform-extensions/host/recording-event-bus';
import { transcriptionAboutContributor } from '../platform-extensions/host/transcription.about-contributor';

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

// =============================================================================
// The host's other extension points (PP-14.13): worked examples, OPT-IN
// =============================================================================
//
// Unlike the recording event bus (selected by an id nobody sets by default),
// these would change what every fork serves: a new entry in the PUBLIC health
// response, a section on the About page, a key in every response's `meta`, a
// route that passes an open maintenance window. So the reference app does not
// register them. `registerHostExamples()` registers all of them (call it from
// this file, before the application is created, to try them), and
// `test/examples/host/` proves each one against the real host core.
//
//   registerHealthIndicator            platform-extensions/host/queue-readiness.indicator.ts
//   registerMaintenanceBypass          platform-extensions/host/payments-webhook.bypass.ts
//   registerAboutContributor           platform-extensions/host/transcription.about-contributor.ts
//   registerResponseMetaContributor    platform-extensions/host/api-revision.response-meta.ts
//   registerDeploymentMode/Capability  platform-extensions/host/byoc.deployment-mode.ts
//   an app-wide guard (allowedAppGuards)  platform-extensions/host/example-throttler.guard.ts
//
// Recipes: docs/EXTENDING.md, "Host".
// =============================================================================

/**
 * Registers every host example. Not called by the reference app.
 *
 * @throws RegistryError when called twice, or after the application bootstrapped.
 */
export function registerHostExamples(): void {
  registerHealthIndicator(queueReadinessIndicator);
  registerMaintenanceBypass(paymentsWebhookBypass);
  registerAboutContributor(transcriptionAboutContributor);
  registerResponseMetaContributor(apiRevisionMeta);
  registerByocExample();
}

// =============================================================================
// The notifications slice's conformance suite, run against this app (#738)
// =============================================================================
//
// `@marinoscar/platform-api/notifications/testing` registers the
// `notifications` suite; this file runs it over the reference app's sources and
// registrations (the app's manifest, through its barrel):
//
//   platform      the platform channels and notifications are registered
//   templates     every email-capable event has a registered template
//   after-commit  no notify() call sits inside a $transaction callback
//   no-secret     the Web Push shapes cannot carry the private key
// =============================================================================

import { runPlatformConformance } from '@marinoscar/platform-api/testing';
import '@marinoscar/platform-api/notifications/testing';

import { API_SOURCE_ROOT } from '../jobs/cron-source-roots';
import '../../src/platform/notifications';

runPlatformConformance({
  sourceRoots: [API_SOURCE_ROOT],
  suites: {
    notifications: {},
  },
});

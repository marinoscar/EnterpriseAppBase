import { runPlatformConformance } from '@marinoscar/platform-api/testing';
// Importing the testing entry REGISTERS the `email` suite with the harness.
import '@marinoscar/platform-api/email/testing';

import { API_SOURCE_ROOT } from '../jobs/cron-source-roots';
// The notification manifest configures rendering and registers every
// template, so the suite sees exactly what the application registers.
import '../notifications/support/notifications';

// =============================================================================
// The email slice's conformance suite, run in the reference app (PP-8.4)
// =============================================================================
//
// The invariants of the email slice (packages/platform-api/src/email/README.md,
// "Conformance suite"), checked against THIS application: the platform
// templates are registered, every sampled template renders a complete message
// with its data escaped, and no email settings shape can carry a secret. What
// stays here is the app's data: samples of the templates it registers itself.
// =============================================================================

const HOSTILE = '<script>alert(1)</script>';

runPlatformConformance({
  sourceRoots: [API_SOURCE_ROOT],
  suites: {
    email: {
      samples: {
        'org-invitation': { recipientEmail: 'a@example.test', orgName: HOSTILE, roleName: 'org_member' },
        'group-invitation': { recipientEmail: 'a@example.test', groupName: HOSTILE, role: 'viewer' },
        'shared-with-you': { resourceType: 'document', resourceId: 'doc-1', role: 'viewer', title: HOSTILE },
      },
    },
  },
});

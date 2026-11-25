/**
 * The app's onboarding registrations (issue #745): the feature notices this
 * app adds to the platform's three (`ai`, `storage`, `push`). Imported once,
 * for its side effect, by `App.tsx`, before the first render.
 *
 * `telemetry`: a control that needs the telemetry store renders
 * `<FeatureUnavailableNotice feature="telemetry" />` while it is off; a holder
 * of `telemetry:read` (the exact permission of the Telemetry card and its
 * controller) gets "Set it up".
 */

import { registerFeatureNotice } from '@marinoscar/platform-web/onboarding/headless';

registerFeatureNotice({
  feature: 'telemetry',
  label: 'Telemetry',
  adminPermission: 'telemetry:read',
  setupHref: '/admin/settings/telemetry',
});

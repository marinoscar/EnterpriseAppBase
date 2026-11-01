/**
 * Admin → Operations → About (`/admin/settings/about`).
 *
 * The page is `@marinoscar/platform-web/host/ui`'s (#891): what is deployed
 * here, the deploy document, the host, the history and a database liveness
 * fact. This file is the app's binding, nothing more. The registry card
 * (`config/adminSections.tsx`) and the route (`App.tsx`, gated on
 * `system_settings:read`, the literal the host slice's `about.controller.ts`
 * enforces) stay here, as the Settings UI Pattern requires.
 */

import { AboutPage as HostAboutPage } from '@marinoscar/platform-web/host/ui';

export default function AboutPage() {
  return <HostAboutPage />;
}

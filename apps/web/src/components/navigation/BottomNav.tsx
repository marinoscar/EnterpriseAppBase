/**
 * The phone bottom bar — this app's binding of the packaged `ShellBottomNav`
 * (`@marinoscar/platform-web/shell/ui`, issue #868), the ONLY navigation
 * chrome below `sm` (#55).
 *
 * FOUR ACTIONS IS THE CEILING, and this app has exactly four destinations
 * (`config/destinations.ts`) — which is what lets the labels stay on. Do not
 * add a fifth without resolving that first. Breakpoint gate 2 (its own
 * `down('sm')` self-gate) lives in the package.
 */
import { ShellBottomNav } from '@marinoscar/platform-web/shell/ui';

import { APP_NAVIGATION } from '../../config/shell';

export function BottomNav() {
  return <ShellBottomNav navigation={APP_NAVIGATION} />;
}

export default BottomNav;

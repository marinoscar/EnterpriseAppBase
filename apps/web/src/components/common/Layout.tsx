import { AndroidUpdateBanner } from '@marinoscar/platform-web/android-app/ui';
import { usePushSubscriptionSync } from '@marinoscar/platform-web/notifications/headless';
import { NotificationPermissionBanner } from '@marinoscar/platform-web/notifications/ui';
// The one-time welcome (#745): renders nothing until it should open.
import { WelcomeDialog } from '@marinoscar/platform-web/onboarding/ui';
import { ShellLayout } from '@marinoscar/platform-web/shell/ui';

import { ANDROID_TWA_KEY_PREFIX } from '../../config/androidApp';
import { AppBar } from '../navigation/AppBar';
import { BottomNav } from '../navigation/BottomNav';
import { NavigationRail } from '../navigation/NavigationRail';
import { MaintenanceBanner } from './MaintenanceBanner';

/**
 * The app shell — this app's binding of the packaged `ShellLayout`
 * (`@marinoscar/platform-web/shell/ui`, issue #868; the shell itself is #55,
 * epic #51).
 *
 *   compact (< sm)  →  bottom bar only. No drawer, no hamburger.
 *   medium  (sm–lg) →  a permanent collapsed rail (56px).
 *   expanded (≥ lg) →  the same rail, expanded to 220px with labelled rows.
 *
 * The chrome is chosen by MOUNTING, not by rendering-then-hiding, in the
 * package. This file fills its slots: this app's `AppBar`, `NavigationRail`
 * and `BottomNav` bindings, the shell-wide banners and the welcome dialog.
 *
 * ⚠️ FIVE BREAKPOINT GATES ARE COUPLED AND MUST MOVE TOGETHER, all at `sm`
 * (600px), never `md`, and there is deliberately no shared constant
 * (CLAUDE.md, Settings UI Pattern rule 5; docs/specs/settings-ui.md,
 * "Breakpoint gates"). All five now live in `@marinoscar/platform-web`:
 *   1. `ShellLayout`'s `showRail` (`up('sm')`)       shell/ui/ShellLayout.tsx
 *   2. `ShellBottomNav`'s `down('sm')` self-gate     shell/ui/ShellBottomNav.tsx
 *   3. `<main>`'s `pb: { xs: 10, sm: 3 }`            shell/ui/ShellLayout.tsx
 *   4. `SettingsHub`'s `isCompactWindow`             settings/ui/SettingsHub.tsx
 *   5. `ShellAppBar`'s `isCompactWindow`             shell/ui/ShellAppBar.tsx
 * The canonical list and the reasoning are in `ShellLayout.tsx`.
 */
export function Layout() {
  return (
    <ShellLayout
      appBar={<AppBar />}
      rail={<NavigationRail />}
      bottomNav={<BottomNav />}
      banners={<ShellBanners />}
      // Issue #745. Mounted ONCE, in the shell, under the app's
      // `OnboardingProvider` (App.tsx): it opens while the caller's
      // `onboarding.welcomeSeenAt` is unset, and every way out marks it
      // seen. Outside the five breakpoint gates; it renders nothing else.
      overlays={<WelcomeDialog />}
    />
  );
}

/**
 * Above the page rather than inside any one of them, because each is a
 * property of the shell. Every one renders NOTHING (no element, no spacing) on
 * an ordinary day, so the pixel baselines never see them.
 */
function ShellBanners() {
  // Issue #365. Mounted HERE, once, because the shell exists exactly for an
  // authenticated user: auto-prompts for notification permission when push is
  // on, and keeps this device's push subscription registered on every load.
  const pushSync = usePushSubscriptionSync();

  return (
    <>
      {/* Issue #258, epic #254. "This deployment is deliberately out of
          service" is a property of the shell. Nothing for anyone without
          `system_settings:read`, and whenever no window is open. */}
      <MaintenanceBanner />
      {/* Issue #746. Only inside the Android app's Trusted Web Activity, and
          only when the installed build is older than the hosted release. */}
      <AndroidUpdateBanner keyPrefix={ANDROID_TWA_KEY_PREFIX} />
      {/* Issue #365. Renders nothing unless this device still needs to allow
          (or unblock, or install for) notifications. */}
      <NotificationPermissionBanner
        config={pushSync.config}
        capability={pushSync.capability}
        onRequestPermission={() => void pushSync.requestPermission()}
        isRequestingPermission={pushSync.isRequestingPermission}
      />
    </>
  );
}

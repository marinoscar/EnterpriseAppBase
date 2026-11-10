/**
 * Keep this device's Web Push subscription alive — issue #365, epic #215.
 *
 * MOUNTED ONCE, in `components/common/Layout.tsx`, which only renders for an
 * authenticated user. It owns two automatic behaviours and one shared action:
 *
 *   1. THE AUTO-PROMPT. When the deployment offers push (and has not switched
 *      browser notifications off) and this device has never been asked, the
 *      permission prompt is requested as soon as the shell loads — at most once
 *      per page load (`claimAutoPermissionPrompt`). A product decision that
 *      replaces the earlier "only ever from a click" rule. Firefox and Safari
 *      ignore a gestureless request and Chrome may quiet it, which is why the
 *      app-wide `NotificationPermissionBanner` still offers a button.
 *   2. THE BOOT SYNC. Whenever permission is `granted` and push is enabled,
 *      subscribe if needed and POST the subscription (an idempotent upsert).
 *      Runs on every load and again the moment permission becomes `granted`.
 *   3. `requestPermission` — ask, then sync. The banner's button uses it.
 */

import { useCallback, useEffect, useState } from 'react';
import { useIsMounted } from './useIsMounted.js';
import { useNotificationCapability, type NotificationCapability } from './useNotificationCapability.js';
import { useNotificationConfig } from './useNotificationConfig.js';
import {
  claimAutoPermissionPrompt,
  requestPermissionAndSyncPush,
  syncPushSubscription,
} from './pushSubscription.js';
import type { NotificationConfigResponse } from './types.js';

/**
 * What {@link usePushSubscriptionSync} returns, for the permission banner.
 *
 * @stability experimental
 */
export interface UsePushSubscriptionSyncResult {
  /** `null` until `GET /api/notifications/config` resolves. */
  config: NotificationConfigResponse | null;
  /** What this device can do about browser notifications. */
  capability: NotificationCapability;
  /** Ask for permission (from a click), then subscribe and sync if granted. */
  requestPermission: () => Promise<void>;
  /** Whether the permission prompt is open. */
  isRequestingPermission: boolean;
}

/**
 * The shell's once-per-load push sync (#365): reads the deployment's
 * notification config, re-syncs this browser's Web Push subscription when
 * permission is granted, and offers the permission request the app-wide
 * banner shows. Call it once, from the app shell.
 *
 * @returns the config, the device capability and the request action.
 *
 * @example
 * ```tsx
 * const push = usePushSubscriptionSync();
 * <NotificationPermissionBanner config={push.config} capability={push.capability} onRequestPermission={push.requestPermission} />
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function usePushSubscriptionSync(): UsePushSubscriptionSyncResult {
  const { config } = useNotificationConfig();
  // `=== false`, never `!browserEnabled`: a `null` config is "not known yet".
  const { capability, permission, refresh } = useNotificationCapability({
    adminDisabled: config?.browserEnabled === false,
  });

  const isMounted = useIsMounted();
  const [isRequestingPermission, setIsRequestingPermission] = useState(false);

  const requestPermission = useCallback(async () => {
    setIsRequestingPermission(true);
    try {
      await requestPermissionAndSyncPush(config);
    } finally {
      if (isMounted()) {
        setIsRequestingPermission(false);
        refresh();
      }
    }
  }, [config, isMounted, refresh]);

  // 1. The auto-prompt. `capability === 'default'` already excludes every
  //    state where asking is impossible or pointless (admin-disabled,
  //    insecure, unsupported, iOS tab, denied, granted).
  useEffect(() => {
    if (!config?.pushEnabled || config.browserEnabled === false) return;
    if (capability !== 'default') return;
    if (!claimAutoPermissionPrompt()) return;
    void requestPermission();
  }, [config, capability, requestPermission]);

  // 2. The boot sync. Keyed on the primitives, so a config refetch returning
  //    the same values does not re-POST; a rotated key does.
  const vapidPublicKey = config?.pushEnabled ? config.vapidPublicKey : null;
  useEffect(() => {
    if (permission !== 'granted' || !vapidPublicKey) return;
    void syncPushSubscription(vapidPublicKey);
  }, [permission, vapidPublicKey]);

  return { config, capability, requestPermission, isRequestingPermission };
}

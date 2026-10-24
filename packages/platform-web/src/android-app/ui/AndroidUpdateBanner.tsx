// =============================================================================
// AndroidUpdateBanner (#746; from EvoPath #287)
// =============================================================================
//
// "A newer Android app is available". Shown ONLY inside the Android app's
// Trusted Web Activity, when the build the TWA launch URL reported
// (`appVersionCode`, captured by `captureTwaLaunch`) is older than the release
// this server hosts. It asks nothing of the API outside the TWA: the
// installed version is read from `sessionStorage` first, and only when there
// is one does it fetch the latest release, so an ordinary browser tab renders
// nothing and makes no request (which keeps it out of the visual baselines).
// Dismissal is remembered per versionCode in `localStorage`, so the next
// release raises it again; blocked storage only means it can come back.
// =============================================================================

import CloseIcon from '@mui/icons-material/Close';
import { Alert, Box, Button, IconButton } from '@mui/material';
import { useState, type ReactElement } from 'react';
import { Link as RouterLink, useLocation } from 'react-router-dom';

import { useAndroidRelease } from '../headless/hooks.js';
import { DEFAULT_TWA_KEY_PREFIX, getInstalledAppVersion } from '../headless/twa.js';
import { ANDROID_APP_PATH } from './copy.js';
import { DownloadApkButton } from './DownloadApkButton.js';

/**
 * What {@link AndroidUpdateBanner} takes.
 *
 * @stability experimental
 */
export interface AndroidUpdateBannerProps {
  /** The `sessionStorage` / `localStorage` key prefix (default `android`). */
  keyPrefix?: string;
  /** Where a "Details" button goes (none by default: the admin page needs `system_settings:read`). */
  detailsPath?: string;
}

function dismissedKey(prefix: string): string {
  return `${prefix}.androidUpdate.dismissedVersionCode`;
}

function readDismissed(prefix: string): number | null {
  try {
    const raw = window.localStorage.getItem(dismissedKey(prefix));
    return raw === null ? null : Number(raw);
  } catch {
    return null;
  }
}

/**
 * The update banner. Mount it once in the app's layout.
 *
 * @param props - see {@link AndroidUpdateBannerProps}.
 * @returns the banner, or null (outside the TWA, up to date, loading, failed, dismissed, or on the details page).
 *
 * @example
 * ```tsx
 * <main>
 *   <AndroidUpdateBanner />
 *   <Outlet />
 * </main>
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export function AndroidUpdateBanner({ keyPrefix = DEFAULT_TWA_KEY_PREFIX, detailsPath }: AndroidUpdateBannerProps = {}): ReactElement | null {
  const [installed] = useState(() => getInstalledAppVersion(keyPrefix));
  const { release } = useAndroidRelease(installed !== null);
  const [dismissed, setDismissed] = useState<number | null>(() => (installed ? readDismissed(keyPrefix) : null));
  const { pathname } = useLocation();

  if (!installed || !release) return null;
  if (installed.versionCode >= release.versionCode) return null;
  if (dismissed === release.versionCode) return null;
  if (pathname === ANDROID_APP_PATH || (detailsPath !== undefined && pathname === detailsPath)) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(dismissedKey(keyPrefix), String(release.versionCode));
    } catch {
      // Storage blocked: dismissed for this render tree only.
    }
    setDismissed(release.versionCode);
  };

  return (
    <Alert
      severity="info"
      sx={{ mb: 2, '& .MuiAlert-message': { flexGrow: 1, minWidth: 0 } }}
      data-testid="android-update-banner"
      action={
        <IconButton color="inherit" size="small" aria-label="Dismiss update notice" onClick={dismiss}>
          <CloseIcon fontSize="small" />
        </IconButton>
      }
    >
      Android app {release.versionName} is available.
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mt: 1 }}>
        <DownloadApkButton release={release} compact />
        {detailsPath !== undefined && (
          <Button color="inherit" size="small" component={RouterLink} to={detailsPath} sx={{ minHeight: 36 }}>
            Details
          </Button>
        )}
      </Box>
    </Alert>
  );
}

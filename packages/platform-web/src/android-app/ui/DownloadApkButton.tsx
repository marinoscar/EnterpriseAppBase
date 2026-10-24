import DownloadIcon from '@mui/icons-material/Download';
import { Button } from '@mui/material';
import { useState, type ReactElement } from 'react';
import type { PublicRelease } from '@marinoscar/platform-contract/android-app';

import { useAndroidAppClient } from '../headless/hooks.js';

/**
 * What {@link DownloadApkButton} takes.
 *
 * @stability experimental
 */
export interface DownloadApkButtonProps {
  /** The release to download. */
  release: Pick<PublicRelease, 'id' | 'versionName'>;
  /** A smaller button (the update banner). */
  compact?: boolean;
  /** Where to navigate; default `window.location.assign`. Tests pass a spy. */
  navigate?: (url: string) => void;
}

/**
 * Asks for a ten-minute signed link, then navigates to it so the browser (or
 * the Android package installer) downloads the APK natively. The link is
 * never shown or logged.
 *
 * @param props - see {@link DownloadApkButtonProps}.
 * @returns the button.
 *
 * @stability experimental
 */
export function DownloadApkButton({ release, compact, navigate }: DownloadApkButtonProps): ReactElement {
  const client = useAndroidAppClient();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const onClick = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const { url } = await client.downloadLink(release.id);
      (navigate ?? ((target: string) => window.location.assign(target)))(url);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button
      variant={compact ? 'outlined' : 'contained'}
      color={failed ? 'error' : 'primary'}
      size={compact ? 'small' : 'medium'}
      startIcon={<DownloadIcon />}
      disabled={busy}
      onClick={() => void onClick()}
      sx={{ minHeight: 36 }}
    >
      {failed ? 'Download failed, retry' : `Download ${release.versionName}`}
    </Button>
  );
}

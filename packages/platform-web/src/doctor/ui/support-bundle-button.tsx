// "Download support bundle" (issue #772): the Doctor page's second header
// action, next to "Run again". Visible to anyone who can see the page (the
// route needs the Doctor's own permission, `system_settings:read`); a section
// the viewer may not read (telemetry without `telemetry:query`) is omitted by
// the API, not hidden here.
//
// The download is a file; nothing here parses or renders the bundle.

import { Button, CircularProgress, Stack, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import { useId } from 'react';
import type { ReactElement } from 'react';

import { useSupportBundleDownload } from '../headless/index.js';
import type { UseSupportBundleDownloadOptions } from '../headless/index.js';

/**
 * The helper text under the button.
 *
 * @stability experimental
 */
export const SUPPORT_BUNDLE_HELPER_TEXT =
  'Includes the doctor report, versions and a 24-hour telemetry summary. Secrets and personal data are removed.';

/**
 * The props of {@link SupportBundleButton}.
 *
 * @stability experimental
 */
export interface SupportBundleButtonProps {
  /** Passed to `useSupportBundleDownload` (transport, route, save function). */
  options?: UseSupportBundleDownloadOptions;
  /** Styles for the outer stack. */
  sx?: SxProps<Theme>;
}

/**
 * A "Download support bundle" button with its helper text and, after a
 * failed download, the reason.
 *
 * @param props - see {@link SupportBundleButtonProps}.
 * @returns the button, its helper text and its error line.
 *
 * @example
 * ```tsx
 * <SupportBundleButton />
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export function SupportBundleButton(props: SupportBundleButtonProps = {}): ReactElement {
  const { download, isDownloading, error } = useSupportBundleDownload(props.options);
  const helperId = useId();

  return (
    <Stack spacing={0.5} sx={props.sx} data-testid="doctor-support-bundle">
      <Button
        variant="outlined"
        onClick={() => void download()}
        disabled={isDownloading}
        aria-describedby={helperId}
        startIcon={isDownloading ? <CircularProgress size={16} color="inherit" /> : <DownloadIcon />}
      >
        {isDownloading ? 'Preparing bundle…' : 'Download support bundle'}
      </Button>
      <Typography id={helperId} variant="caption" color="text.secondary" sx={{ maxWidth: 360 }}>
        {SUPPORT_BUNDLE_HELPER_TEXT}
      </Typography>
      {error && (
        <Typography variant="caption" color="error" role="alert" data-testid="doctor-support-bundle-error">
          {error}
        </Typography>
      )}
    </Stack>
  );
}

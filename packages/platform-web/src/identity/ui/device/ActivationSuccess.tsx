import { Box, Typography, Alert, Button, Stack } from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  Cancel as CancelIcon,
} from '@mui/icons-material';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { isAllowedReturnUri } from '@marinoscar/platform-contract/identity';
import { DEVICE_NAME_MAX_DISPLAY, sanitizeDeviceText } from '../../headless/index.js';

/** Delay before the automatic return, so the success state is seen first. */
const RETURN_DELAY_MS = 800;

interface ActivationSuccessProps {
  success: boolean;
  message: string;
  /**
   * Where to send the user after a successful approval (an app deep link or
   * App Link). Attacker-chosen until checked: it is followed only when
   * `success` is true and the scheme is `https:` or in `returnUriSchemes`.
   */
  returnUri?: string;
  /** Custom schemes accepted besides `https:` (the deployment's `returnUriSchemes`). */
  returnUriSchemes?: readonly string[];
  /** The requesting device's name, for the "Return to ..." button. */
  deviceName?: string;
}

export function ActivationSuccess({
  success,
  message,
  returnUri,
  returnUriSchemes,
  deviceName,
}: ActivationSuccessProps) {
  const navigate = useNavigate();

  // Never on deny or failure, and never for a scheme the deployment did not
  // allow: the API checked it at issuance, this is the second, independent check.
  const safeReturnUri =
    success && returnUri && isAllowedReturnUri(returnUri, returnUriSchemes) ? returnUri : undefined;
  const target = sanitizeDeviceText(deviceName, DEVICE_NAME_MAX_DISPLAY) || 'the app';

  useEffect(() => {
    if (!safeReturnUri) return;
    const timer = setTimeout(() => window.location.assign(safeReturnUri), RETURN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [safeReturnUri]);

  return (
    <Box sx={{ textAlign: 'center' }}>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          mb: 3,
        }}
      >
        {success ? (
          <CheckCircleIcon
            sx={{
              fontSize: 80,
              color: 'success.main',
            }}
          />
        ) : (
          <CancelIcon
            sx={{
              fontSize: 80,
              color: 'error.main',
            }}
          />
        )}
      </Box>

      <Typography variant="h5" sx={{ fontWeight: 'bold' }} gutterBottom>
        {success ? 'Device Authorized!' : 'Device Access Denied'}
      </Typography>

      <Alert severity={success ? 'success' : 'info'} sx={{ mb: 3, textAlign: 'left' }}>
        {message}
      </Alert>

      {success && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          You can now close this page and return to your device.
        </Typography>
      )}

      {safeReturnUri && (
        <Box sx={{ mb: 3 }}>
          <Button variant="contained" onClick={() => window.location.assign(safeReturnUri)}>
            Return to {target}
          </Button>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, wordBreak: 'break-all' }}>
            {safeReturnUri.split(/[?#]/)[0]}
          </Typography>
        </Box>
      )}

      <Stack direction="row" spacing={2} sx={{ justifyContent: 'center' }}>
        <Button variant="outlined" onClick={() => navigate('/')}>
          Go to Home
        </Button>
        {!success && (
          <Button variant="contained" onClick={() => window.location.reload()}>
            Try Another Code
          </Button>
        )}
      </Stack>
    </Box>
  );
}

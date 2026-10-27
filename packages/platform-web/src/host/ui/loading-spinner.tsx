// The page's loading state: the same DOM and sx as the reference app's
// `LoadingSpinner` (non-fullscreen), so a packaged page looks identical.
// Private to the slice; not exported.

import { Box, CircularProgress } from '@mui/material';

export function LoadingSpinner() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
      <CircularProgress size={40} />
    </Box>
  );
}

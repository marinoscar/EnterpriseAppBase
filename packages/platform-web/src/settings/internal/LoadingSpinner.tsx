// The centred spinner of the settings pages (moved with them from the
// reference app's `components/common/LoadingSpinner`, #892).

import { Box, CircularProgress } from '@mui/material';
import type { ReactElement } from 'react';

/** @internal */
export function LoadingSpinner({ size = 40 }: { size?: number }): ReactElement {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
      <CircularProgress size={size} />
    </Box>
  );
}

// The spinner the AI pages wait behind (issue #890): the app's, handed in
// through the AI adapters, else an MUI `CircularProgress` laid out the way
// the reference app's `LoadingSpinner` is. Slice-internal.

import { Box, CircularProgress } from '@mui/material';
import type { ReactElement } from 'react';

import { useAiWebAdapters } from '../../headless/adapters.js';
import type { AiSpinnerProps } from '../../headless/adapters.js';

function DefaultSpinner({ fullScreen = false }: AiSpinnerProps): ReactElement {
  if (fullScreen) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', width: '100vw' }}>
        <CircularProgress size={40} />
      </Box>
    );
  }
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
      <CircularProgress size={40} />
    </Box>
  );
}

/** The app's spinner, or the default. */
export function AiSpinner(props: AiSpinnerProps): ReactElement {
  const { Spinner } = useAiWebAdapters();
  const Component = Spinner ?? DefaultSpinner;
  return <Component {...props} />;
}

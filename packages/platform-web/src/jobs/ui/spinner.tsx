// The jobs pages' loading state (issue #854): the app's spinner from the jobs
// adapters (the reference app hands in its `LoadingSpinner`), else a centred
// MUI `CircularProgress`. Slice-internal.

import type { ReactElement } from 'react';
import { Box, CircularProgress } from '@mui/material';

import { useJobsWebAdapters } from '../headless/index.js';

export function JobsSpinner(): ReactElement {
  const { Spinner } = useJobsWebAdapters();
  if (Spinner) return <Spinner />;
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 4 }}>
      <CircularProgress size={40} />
    </Box>
  );
}

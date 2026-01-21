import { Box, Typography } from '@mui/material';
import { LoadingSpinner } from '../components/common/LoadingSpinner';

export default function AuthCallbackPage() {
  return (
    <Box>
      <LoadingSpinner fullScreen />
      <Typography>Processing authentication...</Typography>
    </Box>
  );
}

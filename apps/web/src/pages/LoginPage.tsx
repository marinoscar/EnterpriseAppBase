import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Stack,
  Divider,
  useTheme,
} from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import { OAuthButton } from '../components/auth/OAuthButton';
import { LoadingSpinner } from '../components/common/LoadingSpinner';

export default function LoginPage() {
  const { isAuthenticated, isLoading, providers, login } = useAuth();
  const navigate = useNavigate();
  const theme = useTheme();

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated && !isLoading) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, isLoading, navigate]);

  if (isLoading) {
    return <LoadingSpinner fullScreen />;
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: theme.palette.mode === 'dark'
          ? 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)'
          : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        p: 2,
      }}
    >
      <Card
        sx={{
          maxWidth: 400,
          width: '100%',
          boxShadow: theme.shadows[10],
        }}
      >
        <CardContent sx={{ p: 4 }}>
          {/* Logo/Header */}
          <Box sx={{ textAlign: 'center', mb: 4 }}>
            <Typography variant="h4" component="h1" fontWeight="bold">
              Welcome
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              Sign in to continue
            </Typography>
          </Box>

          <Divider sx={{ mb: 3 }}>
            <Typography variant="body2" color="text.secondary">
              Sign in with
            </Typography>
          </Divider>

          {/* OAuth Providers */}
          <Stack spacing={2}>
            {providers.length > 0 ? (
              providers.map((provider) => (
                <OAuthButton
                  key={provider.name}
                  provider={provider.name}
                  onClick={() => login(provider.name)}
                />
              ))
            ) : (
              <Typography color="text.secondary" textAlign="center">
                No authentication providers configured
              </Typography>
            )}
          </Stack>

          {/* Footer */}
          <Box sx={{ mt: 4, textAlign: 'center' }}>
            <Typography variant="caption" color="text.secondary">
              By signing in, you agree to our Terms of Service and Privacy Policy
            </Typography>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}

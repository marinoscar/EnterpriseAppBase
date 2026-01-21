import {
  Box,
  Typography,
  TextField,
  Button,
  Stack,
  Alert,
} from '@mui/material';
import { useState, useEffect } from 'react';

interface SecuritySettingsProps {
  settings: {
    jwtAccessTtlMinutes: number;
    refreshTtlDays: number;
  };
  onSave: (settings: SecuritySettingsProps['settings']) => Promise<void>;
  disabled?: boolean;
}

export function SecuritySettings({ settings, onSave, disabled }: SecuritySettingsProps) {
  const [accessTtl, setAccessTtl] = useState(settings.jwtAccessTtlMinutes);
  const [refreshTtl, setRefreshTtl] = useState(settings.refreshTtlDays);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAccessTtl(settings.jwtAccessTtlMinutes);
    setRefreshTtl(settings.refreshTtlDays);
  }, [settings]);

  const hasChanges =
    accessTtl !== settings.jwtAccessTtlMinutes ||
    refreshTtl !== settings.refreshTtlDays;

  const validate = (): boolean => {
    if (accessTtl < 1 || accessTtl > 60) {
      setError('Access token TTL must be between 1 and 60 minutes');
      return false;
    }
    if (refreshTtl < 1 || refreshTtl > 90) {
      setError('Refresh token TTL must be between 1 and 90 days');
      return false;
    }
    setError(null);
    return true;
  };

  const handleSave = async () => {
    if (!validate()) return;

    setIsSaving(true);
    try {
      await onSave({
        jwtAccessTtlMinutes: accessTtl,
        refreshTtlDays: refreshTtl,
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Security Settings
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Alert severity="warning" sx={{ mb: 3 }}>
        Changes to token TTL will affect new sessions only. Existing sessions
        will continue with their current tokens until they expire.
      </Alert>

      <Stack spacing={3} sx={{ maxWidth: 400 }}>
        <TextField
          label="Access Token TTL (minutes)"
          type="number"
          value={accessTtl}
          onChange={(e) => setAccessTtl(parseInt(e.target.value, 10) || 0)}
          inputProps={{ min: 1, max: 60 }}
          helperText="How long access tokens are valid (1-60 minutes)"
          disabled={disabled}
        />

        <TextField
          label="Refresh Token TTL (days)"
          type="number"
          value={refreshTtl}
          onChange={(e) => setRefreshTtl(parseInt(e.target.value, 10) || 0)}
          inputProps={{ min: 1, max: 90 }}
          helperText="How long refresh tokens are valid (1-90 days)"
          disabled={disabled}
        />

        <Button
          variant="contained"
          onClick={handleSave}
          disabled={disabled || !hasChanges || isSaving}
        >
          {isSaving ? 'Saving...' : 'Save Changes'}
        </Button>
      </Stack>
    </Box>
  );
}

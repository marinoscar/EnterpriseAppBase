/**
 * One AI provider on the admin AI page (`/admin/settings/ai`) — issue #429,
 * epic #419.
 *
 * Two kinds of control live on this card, and they save differently:
 *
 *   - `enabled` and `baseUrl` are part of the page's FORM. They are edited
 *     here but saved with the page's "Save changes" button, in the one
 *     `PUT /admin/ai/config` that carries every other policy field — a
 *     provider switch is policy, exactly like the master switch above it.
 */

import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Chip,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import type { AiAdminProvider } from '../../../services/ai';

/** The provider's slice of the page form. */
export interface AiProviderFormValue {
  enabled: boolean;
  baseUrl: string;
}

export interface AiProviderCardProps {
  provider: AiAdminProvider;
  value: AiProviderFormValue;
  onChange: (next: AiProviderFormValue) => void;
  canWrite: boolean;
  /** Field-level error for `baseUrl`, if the page's validation found one. */
  baseUrlError?: string;
}

export function AiProviderCard({
  provider,
  value,
  onChange,
  canWrite,
  baseUrlError,
}: AiProviderCardProps) {
  const switchId = `ai-provider-${provider.id}-enabled`;

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }} data-testid={`ai-provider-${provider.id}`}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
      >
        <Box>
          <Typography variant="h6" component="h3">
            {provider.displayName}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {provider.id}
          </Typography>
        </Box>
        <FormControlLabel
          control={
            <Switch
              id={switchId}
              checked={value.enabled}
              onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
              disabled={!canWrite}
              slotProps={{ input: { 'aria-label': `Enable ${provider.displayName}` } }}
            />
          }
          label={value.enabled ? 'Enabled' : 'Disabled'}
        />
      </Stack>

      {provider.supportedCapabilities.length > 0 && (
        <Stack direction="row" spacing={0.5} sx={{ mt: 1, flexWrap: 'wrap', rowGap: 0.5 }}>
          {provider.supportedCapabilities.map((capability) => (
            <Chip key={capability} size="small" variant="outlined" label={capability} />
          ))}
        </Stack>
      )}

      <Accordion
        disableGutters
        elevation={0}
        sx={{ mt: 2, '&::before': { display: 'none' }, backgroundColor: 'transparent' }}
      >
        <AccordionSummary
          expandIcon={<ExpandMoreIcon />}
          aria-controls={`ai-provider-${provider.id}-advanced`}
          sx={{ px: 0 }}
        >
          <Typography variant="subtitle2">Advanced</Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ px: 0 }} id={`ai-provider-${provider.id}-advanced`}>
          <TextField
            fullWidth
            label="Base URL"
            value={value.baseUrl}
            onChange={(e) => onChange({ ...value, baseUrl: e.target.value })}
            disabled={!canWrite}
            error={!!baseUrlError}
            helperText={
              baseUrlError ??
              "Leave blank to use the provider's default endpoint. Set one only for a proxy or a compatible gateway."
            }
          />
        </AccordionDetails>
      </Accordion>
    </Paper>
  );
}

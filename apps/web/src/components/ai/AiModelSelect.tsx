/**
 * Model picker over `GET /api/ai/models` — issue #434, epic #419.
 *
 * Presentational: the page loads the usable models (they also drive which
 * controls it shows and its empty state) and passes them in. Every usable
 * model is listed; one that cannot serve a text response (no `responses`
 * capability — an embeddings model, say) is shown DISABLED with the reason,
 * rather than hidden, so a user looking for it learns why they cannot pick it.
 */
import { Box, ListItemText, MenuItem, TextField, Typography } from '@mui/material';
import type { UsableAiModel } from '../../services/ai';
import { AiCapabilityChips } from './AiCapabilityChips';

/** Stable key for a provider/model pair. */
export function aiModelKey(model: { provider: string; modelId: string }): string {
  return `${model.provider}:${model.modelId}`;
}

export function aiModelLabel(model: UsableAiModel): string {
  return model.displayName || model.modelId;
}

export function hasAiCapability(model: UsableAiModel | null | undefined, capability: string): boolean {
  return model?.capabilities.capabilities.includes(capability) ?? false;
}

/** Why a model cannot be picked in the playground, or `null` when it can. */
export function aiModelDisabledReason(model: UsableAiModel): string | null {
  if (!hasAiCapability(model, 'responses')) return 'Does not support text responses';
  return null;
}

export interface AiModelSelectProps {
  models: UsableAiModel[];
  /** {@link aiModelKey} of the selection, or `''`. */
  value: string;
  onChange: (key: string) => void;
  disabled?: boolean;
}

export function AiModelSelect({ models, value, onChange, disabled }: AiModelSelectProps) {
  const selected = models.find((model) => aiModelKey(model) === value) ?? null;

  return (
    <Box>
      <TextField
        select
        fullWidth
        size="small"
        label="Model"
        value={selected ? value : ''}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        slotProps={{
          select: {
            renderValue: (key) => {
              const model = models.find((entry) => aiModelKey(entry) === key);
              return model ? aiModelLabel(model) : '';
            },
          },
        }}
      >
        {models.map((model) => {
          const reason = aiModelDisabledReason(model);
          return (
            <MenuItem key={aiModelKey(model)} value={aiModelKey(model)} disabled={reason !== null}>
              <ListItemText
                primary={aiModelLabel(model)}
                secondary={
                  reason ??
                  `${model.provider} · ${model.keySource === 'org' ? 'organisation key' : 'your key'}`
                }
              />
            </MenuItem>
          );
        })}
      </TextField>
      {selected && (
        <Box sx={{ mt: 1 }}>
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 0.5 }}>
            {selected.provider} · {selected.modelId} ·{' '}
            {selected.keySource === 'org' ? 'billed to the organisation key' : 'billed to your key'}
          </Typography>
          <AiCapabilityChips capabilities={selected.capabilities.capabilities} />
        </Box>
      )}
    </Box>
  );
}

export default AiModelSelect;

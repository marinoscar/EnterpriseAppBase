/**
 * Edit a model's capabilities — an administrator override (issue #429).
 *
 * `PATCH /admin/ai/models/:id { capabilities }` sets `capabilitySource:
 * 'admin_override'`, and a later catalogue refresh never touches an
 * overridden row (`docs/specs/ai-platform.md` §6). This is how an
 * `unclassified` model — one the provider's classifier did not recognise —
 * becomes enable-able, and how a wrong classification is corrected.
 *
 * Only the API's own vocabulary is offered (`AI_CAPABILITY_VALUES` and the
 * modality lists), so every save is schema-valid; a string the current row
 * carries that is not in that vocabulary is dropped rather than re-sent.
 */

import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormGroup,
  FormHelperText,
  FormLabel,
  Grid,
  TextField,
} from '@mui/material';
import type { AiModel, AiModelCapabilities } from '../../../services/ai';
import {
  AI_CAPABILITY_GROUPS,
  AI_CAPABILITY_LABELS,
  AI_CAPABILITY_VALUES,
  AI_INPUT_MODALITY_VALUES,
  AI_OUTPUT_MODALITY_VALUES,
  AI_REASONING_EFFORT_VALUES,
} from '../../ai/aiCapabilities';

interface OverrideForm {
  capabilities: string[];
  inputModalities: string[];
  outputModalities: string[];
  reasoningEfforts: string[];
  contextWindow: string;
  maxOutputTokens: string;
}

function only(values: readonly string[], allowed: readonly string[]): string[] {
  return values.filter((value) => allowed.includes(value));
}

/**
 * The form a model opens with. An unclassified model has `capabilities:
 * null` and starts empty; the row's own `contextWindow`/`maxOutputTokens`
 * (what discovery learned) seed the numbers when the capability set has none.
 */
function toForm(model: AiModel): OverrideForm {
  const capabilities = model.capabilities;
  const contextWindow = capabilities?.contextWindow ?? model.contextWindow;
  const maxOutputTokens = capabilities?.maxOutputTokens ?? model.maxOutputTokens;
  return {
    capabilities: only(capabilities?.capabilities ?? [], AI_CAPABILITY_VALUES),
    inputModalities: only(capabilities?.inputModalities ?? [], AI_INPUT_MODALITY_VALUES),
    outputModalities: only(capabilities?.outputModalities ?? [], AI_OUTPUT_MODALITY_VALUES),
    reasoningEfforts: only(capabilities?.reasoningEfforts ?? [], AI_REASONING_EFFORT_VALUES),
    contextWindow: contextWindow ? String(contextWindow) : '',
    maxOutputTokens: maxOutputTokens ? String(maxOutputTokens) : '',
  };
}

function positiveIntError(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  return /^\d+$/.test(value) && Number(value) > 0 ? null : 'A whole number greater than zero.';
}

function toCapabilities(form: OverrideForm): AiModelCapabilities {
  const contextWindow = form.contextWindow.trim();
  const maxOutputTokens = form.maxOutputTokens.trim();
  return {
    capabilities: form.capabilities,
    inputModalities: form.inputModalities,
    outputModalities: form.outputModalities,
    ...(form.capabilities.includes('reasoning') && form.reasoningEfforts.length > 0
      ? { reasoningEfforts: form.reasoningEfforts }
      : {}),
    ...(contextWindow ? { contextWindow: Number(contextWindow) } : {}),
    ...(maxOutputTokens ? { maxOutputTokens: Number(maxOutputTokens) } : {}),
  };
}

function CheckboxGroup({
  label,
  options,
  selected,
  onChange,
  labelFor = (value) => value,
  disabled,
}: {
  label: string;
  options: readonly string[];
  selected: string[];
  onChange: (next: string[]) => void;
  labelFor?: (value: string) => string;
  disabled?: boolean;
}) {
  const toggle = (value: string, checked: boolean) =>
    onChange(checked ? [...selected, value] : selected.filter((entry) => entry !== value));

  return (
    <FormControl component="fieldset" disabled={disabled} sx={{ mb: 2, display: 'block' }}>
      <FormLabel component="legend">{label}</FormLabel>
      <FormGroup row>
        {options.map((value) => (
          <FormControlLabel
            key={value}
            control={
              <Checkbox
                checked={selected.includes(value)}
                onChange={(e) => toggle(value, e.target.checked)}
              />
            }
            label={labelFor(value)}
          />
        ))}
      </FormGroup>
    </FormControl>
  );
}

export interface AiModelOverrideDialogProps {
  /** `null` closes the dialog. */
  model: AiModel | null;
  isSaving: boolean;
  error: string | null;
  onSave: (capabilities: AiModelCapabilities) => void;
  onClose: () => void;
}

export function AiModelOverrideDialog({
  model,
  isSaving,
  error,
  onSave,
  onClose,
}: AiModelOverrideDialogProps) {
  const [form, setForm] = useState<OverrideForm | null>(null);

  useEffect(() => {
    setForm(model ? toForm(model) : null);
  }, [model]);

  if (!model || !form) return null;

  const update = <K extends keyof OverrideForm>(key: K, value: OverrideForm[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  const contextError = positiveIntError(form.contextWindow);
  const maxOutputError = positiveIntError(form.maxOutputTokens);
  const missing =
    form.capabilities.length === 0
      ? 'Choose at least one capability.'
      : form.inputModalities.length === 0 || form.outputModalities.length === 0
        ? 'Choose at least one input and one output modality.'
        : null;
  const invalid = !!missing || !!contextError || !!maxOutputError;

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Edit capabilities — {model.modelId}</DialogTitle>
      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Alert severity="info" sx={{ mb: 2 }}>
          Saving marks this model as an admin override. Catalogue refreshes will not change it
          again.
        </Alert>

        {/* Grouped exactly as the table's chips are, so the dialog reads as
            the long form of what the row shows. */}
        {AI_CAPABILITY_GROUPS.map((group) => {
          const options = group.members.filter((member) =>
            (AI_CAPABILITY_VALUES as readonly string[]).includes(member),
          );
          if (options.length === 0) return null;
          return (
            <CheckboxGroup
              key={group.id}
              label={group.label}
              options={options}
              selected={form.capabilities.filter((value) => options.includes(value))}
              onChange={(next) =>
                update('capabilities', [
                  ...form.capabilities.filter((value) => !options.includes(value)),
                  ...next,
                ])
              }
              labelFor={(value) => AI_CAPABILITY_LABELS[value] ?? value}
            />
          );
        })}

        <CheckboxGroup
          label="Input modalities"
          options={AI_INPUT_MODALITY_VALUES}
          selected={form.inputModalities}
          onChange={(next) => update('inputModalities', next)}
        />
        <CheckboxGroup
          label="Output modalities"
          options={AI_OUTPUT_MODALITY_VALUES}
          selected={form.outputModalities}
          onChange={(next) => update('outputModalities', next)}
        />
        <CheckboxGroup
          label="Reasoning efforts"
          options={AI_REASONING_EFFORT_VALUES}
          selected={form.reasoningEfforts}
          onChange={(next) => update('reasoningEfforts', next)}
          disabled={!form.capabilities.includes('reasoning')}
        />

        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              fullWidth
              label="Context window (tokens)"
              value={form.contextWindow}
              onChange={(e) => update('contextWindow', e.target.value)}
              slotProps={{ htmlInput: { inputMode: 'numeric' } }}
              error={!!contextError}
              helperText={contextError ?? 'Optional.'}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              fullWidth
              label="Maximum output tokens"
              value={form.maxOutputTokens}
              onChange={(e) => update('maxOutputTokens', e.target.value)}
              slotProps={{ htmlInput: { inputMode: 'numeric' } }}
              error={!!maxOutputError}
              helperText={maxOutputError ?? 'Optional.'}
            />
          </Grid>
        </Grid>

        {missing && (
          <Box sx={{ mt: 1 }}>
            <FormHelperText error>{missing}</FormHelperText>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isSaving}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={invalid || isSaving}
          onClick={() => onSave(toCapabilities(form))}
        >
          {isSaving ? 'Saving…' : 'Save capabilities'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

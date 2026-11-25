// =============================================================================
// The event picker (issue #1046): the catalog grouped, searchable, with
// "every event" (`*`) and "every event in this group" (`group.*`)
// =============================================================================

import {
  Alert,
  Box,
  Checkbox,
  Chip,
  FormControlLabel,
  FormGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useMemo, useState, type ReactElement } from 'react';

import {
  WEBHOOK_ALL_EVENTS,
  isWebhookEventSelected,
  searchWebhookEventGroups,
  toggleAllWebhookEvents,
  toggleWebhookEvent,
  toggleWebhookGroup,
  unknownWebhookSubscriptions,
  webhookGroupSelectionState,
  type WebhookEventGroup,
} from '../headless/index.js';

/**
 * The props of {@link WebhookEventPicker}.
 *
 * @stability experimental
 */
export interface WebhookEventPickerProps {
  /** The grouped catalog (`useWebhookEventCatalog(scope).groups`). */
  groups: readonly WebhookEventGroup[];
  /** The subscription: exact keys, `group.*` wildcards or `*`. */
  value: readonly string[];
  /** Receives the new subscription. */
  onChange: (next: string[]) => void;
  /** Disables every control. */
  disabled?: boolean;
  /** Shown under the picker when the selection is invalid. */
  error?: string | null;
}

/**
 * The webhook event picker.
 *
 * @param props - see {@link WebhookEventPickerProps}.
 * @returns the picker.
 *
 * @extensionPoint component
 * @stability experimental
 */
export function WebhookEventPicker({ groups, value, onChange, disabled, error }: WebhookEventPickerProps): ReactElement {
  const [query, setQuery] = useState('');
  const visible = useMemo(() => searchWebhookEventGroups(groups, query), [groups, query]);
  const all = value.includes(WEBHOOK_ALL_EVENTS);
  const unknown = useMemo(() => unknownWebhookSubscriptions(value, groups), [value, groups]);
  const fullGroup = (name: string) => groups.find((group) => group.group === name)!;

  return (
    <Box component="fieldset" sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}>
      <Typography component="legend" variant="subtitle2" sx={{ mb: 1 }}>
        Events
      </Typography>
      <FormControlLabel
        control={
          <Checkbox checked={all} onChange={() => onChange(toggleAllWebhookEvents(value))} disabled={disabled} />
        }
        label="All events, including ones added later"
      />
      <TextField
        label="Search events"
        size="small"
        fullWidth
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        disabled={disabled}
        sx={{ my: 1 }}
      />
      {groups.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No events are available to you at this scope.
        </Typography>
      ) : visible.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No event matches “{query}”.
        </Typography>
      ) : (
        <Stack spacing={1.5} sx={{ maxHeight: 360, overflowY: 'auto', pr: 1 }}>
          {visible.map((shown) => {
            const group = fullGroup(shown.group);
            const state = webhookGroupSelectionState(value, group);
            const groupLabel = group.wildcard
              ? `All ${group.group} events (${group.wildcard})`
              : `All ${group.group} events`;
            return (
              <Box key={group.group} role="group" aria-label={group.group}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={state === 'all'}
                      indeterminate={state === 'some'}
                      onChange={() => onChange(toggleWebhookGroup(value, group, groups))}
                      disabled={disabled || all}
                    />
                  }
                  label={<Typography sx={{ fontWeight: 600 }}>{groupLabel}</Typography>}
                />
                <FormGroup sx={{ pl: 4 }}>
                  {shown.entries.map((entry) => (
                    <FormControlLabel
                      key={entry.key}
                      control={
                        <Checkbox
                          checked={isWebhookEventSelected(value, entry.key)}
                          onChange={() => onChange(toggleWebhookEvent(value, entry.key, groups))}
                          disabled={disabled || all}
                          slotProps={{ input: { 'aria-label': entry.label } }}
                        />
                      }
                      label={
                        <Box>
                          <Typography variant="body2">{entry.label}</Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                            {entry.key}
                          </Typography>
                          {entry.description ? (
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                              {entry.description}
                            </Typography>
                          ) : null}
                        </Box>
                      }
                      sx={{ alignItems: 'flex-start', '& .MuiCheckbox-root': { pt: 0.5 } }}
                    />
                  ))}
                </FormGroup>
              </Box>
            );
          })}
        </Stack>
      )}
      {unknown.length > 0 ? (
        <Box sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Also subscribed to events not listed here:
          </Typography>
          <Stack direction="row" spacing={1} useFlexGap sx={{ mt: 0.5, flexWrap: 'wrap' }}>
            {unknown.map((entry) => (
              <Chip
                key={entry}
                label={entry}
                size="small"
                onDelete={disabled ? undefined : () => onChange(value.filter((item) => item !== entry))}
              />
            ))}
          </Stack>
        </Box>
      ) : null}
      {error ? (
        <Alert severity="error" sx={{ mt: 1 }}>
          {error}
        </Alert>
      ) : null}
    </Box>
  );
}

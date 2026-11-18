// The compact time zone read-out of a form (the profile card): the current
// choice with its offset and local time, and a "Change time zone" link that
// opens the picker. The picker (and the map data it pulls) is code-split: a
// page that never opens it never downloads it.

import { Suspense, lazy, useId, useState } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import { Public as PublicIcon } from '@mui/icons-material';

// The store and the formatters by file, not through the headless index: the
// index also re-exports the catalog, which carries the map data.
import { formatTime, formatUtcOffset, getTimeZoneOffsetMinutes } from '../headless/format.js';
import { deviceTimeZone } from '../headless/store.js';
import { useNow } from '../internal/use-now.js';

const TimeZonePickerDialog = lazy(() =>
  import('./TimeZonePickerDialog.js').then((module) => ({ default: module.TimeZonePickerDialog })),
);

/**
 * Props of {@link TimeZoneField}.
 *
 * @stability experimental
 */
export interface TimeZoneFieldProps {
  /** The choice: an IANA id, or `null` / `undefined` for automatic (follow the device). */
  value: string | null | undefined;
  /** Called with the zone saved in the picker (`null`: automatic). */
  onChange: (id: string | null) => void;
  /** Disables the Change link. */
  disabled?: boolean;
  /** The label above the read-out. Default `'Time zone'`. */
  label?: string;
}

/**
 * The time zone row of a form: `America/Costa_Rica · UTC−06:00 · 10:42 AM`, or
 * `Automatic — follows this device (Europe/Paris)`, and a "Change time zone"
 * link that opens {@link TimeZonePickerDialog}. Stacks on a phone.
 *
 * @param props - see {@link TimeZoneFieldProps}.
 * @returns the row.
 *
 * @example
 * ```tsx
 * <TimeZoneField value={draft.timezone} onChange={(id) => setDraft({ ...draft, timezone: id })} />
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export function TimeZoneField({ value, onChange, disabled = false, label = 'Time zone' }: TimeZoneFieldProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const labelId = useId();
  const now = useNow(30_000);
  const choice = value ?? null;
  const zone = choice ?? deviceTimeZone();
  const time = formatTime(now, { timeZone: zone });
  const readout = choice
    ? `${choice} · ${formatUtcOffset(getTimeZoneOffsetMinutes(choice, now))} · ${time}`
    : `Automatic — follows this device (${zone}) · ${time}`;

  return (
    <Box role="group" aria-labelledby={labelId}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={{ xs: 0.5, sm: 2 }}
        sx={{ alignItems: { xs: 'flex-start', sm: 'center' }, justifyContent: 'space-between' }}
      >
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', minWidth: 0 }}>
          <PublicIcon aria-hidden sx={{ color: 'text.secondary' }} />
          <Box sx={{ minWidth: 0 }}>
            <Typography id={labelId} variant="subtitle2" component="div">
              {label}
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', overflowWrap: 'anywhere' }} data-testid="time-zone-readout">
              {readout}
            </Typography>
          </Box>
        </Stack>
        <Button
          variant="text"
          size="small"
          disabled={disabled}
          onClick={() => {
            setMounted(true);
            setOpen(true);
          }}
          sx={{ flexShrink: 0, ml: { xs: 4, sm: 0 } }}
        >
          Change time zone
        </Button>
      </Stack>
      {mounted && (
        <Suspense fallback={null}>
          <TimeZonePickerDialog
            open={open}
            value={choice}
            onClose={() => setOpen(false)}
            onSelect={(id) => {
              setOpen(false);
              onChange(id);
            }}
          />
        </Suspense>
      )}
    </Box>
  );
}

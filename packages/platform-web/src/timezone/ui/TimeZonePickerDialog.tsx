// The time zone picker: a search field, the world map and a summary of the
// pending choice with its live local time. The dialog holds the pending state;
// only Save reports it. Full screen below `sm`.

import { useEffect, useId, useMemo, useState } from 'react';
import {
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { Close as CloseIcon, MyLocation as MyLocationIcon, Search as SearchIcon } from '@mui/icons-material';

import {
  deviceTimeZone,
  findTimeZone,
  formatDate,
  formatTime,
  listTimeZones,
  searchTimeZones,
} from '../headless/index.js';
import type { TimeZoneOption } from '../headless/index.js';
import { useNow } from '../internal/use-now.js';
import { TimeZoneMap } from './TimeZoneMap.js';

/**
 * Props of {@link TimeZonePickerDialog}.
 *
 * @stability experimental
 */
export interface TimeZonePickerDialogProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** The current choice: an IANA id, or `null` for automatic (follow the device). */
  value: string | null;
  /** Called on Cancel, Escape or a backdrop click. */
  onClose: () => void;
  /** Called on Save with the pending choice (`null`: automatic). The caller closes the dialog. */
  onSelect: (id: string | null) => void;
}

function placeOf(option: TimeZoneOption): string {
  const parts = [option.countryName, option.region].filter((part): part is string => Boolean(part) && part !== option.city);
  return parts.length > 0 ? (parts[0] as string) : option.id;
}

/**
 * The time zone picker dialog: search by city, country or offset, or tap the
 * map; the summary shows the pending zone and its current local time.
 * "Automatic" (`null`) follows the device; "Use this device's time zone" pins
 * the device's zone explicitly.
 *
 * @param props - see {@link TimeZonePickerDialogProps}.
 * @returns the dialog.
 *
 * @example
 * ```tsx
 * <TimeZonePickerDialog open={open} value={zone} onClose={close} onSelect={(id) => { setZone(id); close(); }} />
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export function TimeZonePickerDialog({ open, value, onClose, onSelect }: TimeZonePickerDialogProps) {
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('sm'));
  const titleId = useId();
  const [pending, setPending] = useState<string | null>(value);
  const [query, setQuery] = useState('');
  const now = useNow(30_000);
  const device = deviceTimeZone();

  useEffect(() => {
    if (open) {
      setPending(value);
      setQuery('');
    }
  }, [open, value]);

  const zones = useMemo(() => listTimeZones(), []);
  const automatic = pending === null;
  const shownId = pending ?? device;
  const shown = useMemo(() => findTimeZone(shownId), [shownId]);
  const pendingOption = useMemo(() => (pending ? findTimeZone(pending) : null), [pending]);

  const summaryTitle = automatic ? 'Automatic' : (shown?.city ?? shownId);
  const summaryPlace = automatic
    ? `Follows this device · ${device}`
    : shown
      ? [shown.countryName && shown.countryName !== shown.city ? shown.countryName : null, shown.id].filter(Boolean).join(' · ')
      : shownId;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen={compact}
      fullWidth
      maxWidth="md"
      aria-labelledby={titleId}
      slotProps={{ paper: { sx: compact ? undefined : { borderRadius: 3 } } }}
    >
      <DialogTitle id={titleId} sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: compact ? 1 : 3 }}>
        <Box component="span" sx={{ flex: 1 }}>
          Select your time zone
        </Box>
        {compact && (
          <IconButton aria-label="Close" onClick={onClose} edge="end">
            <CloseIcon />
          </IconButton>
        )}
      </DialogTitle>
      <DialogContent sx={{ px: { xs: 2, sm: 3 } }}>
        <Stack spacing={{ xs: 2, sm: 2.5 }} sx={{ pt: 0.5 }}>
          <Autocomplete<TimeZoneOption, false, false, false>
            options={zones}
            value={pendingOption && zones.includes(pendingOption) ? pendingOption : null}
            inputValue={query}
            onInputChange={(_, next, reason) => {
              // Selecting an option writes its label back into the field; keep
              // the field a search box and show the choice in the summary.
              if (reason !== 'reset') setQuery(next);
            }}
            onChange={(_, option) => {
              if (option) {
                setPending(option.id);
                setQuery('');
              }
            }}
            filterOptions={(options, state) => searchTimeZones(options, state.inputValue, 60)}
            getOptionLabel={(option) => `${option.city} (${option.offsetLabel})`}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            autoHighlight
            blurOnSelect
            clearOnBlur={false}
            noOptionsText="No matching time zone"
            renderOption={({ key, ...props }, option) => (
              <Box component="li" key={key} {...props} sx={{ gap: 1.5 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
                    {option.city}
                  </Typography>
                  <Typography variant="caption" noWrap component="div" sx={{ color: 'text.secondary' }}>
                    {placeOf(option)}
                    {placeOf(option) !== option.id ? ` · ${option.id}` : ''}
                  </Typography>
                </Box>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                  {option.offsetLabel}
                </Typography>
              </Box>
            )}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Search time zones"
                placeholder="City, country or UTC offset"
                slotProps={{
                  ...params.slotProps,
                  input: {
                    ...params.slotProps.input,
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon fontSize="small" />
                      </InputAdornment>
                    ),
                  },
                }}
              />
            )}
          />

          <TimeZoneMap value={shownId} onChange={(id) => setPending(id)} zones={zones} />

          <Paper
            variant="outlined"
            sx={{
              p: { xs: 1.5, sm: 2 },
              borderRadius: 2,
              display: 'flex',
              flexDirection: { xs: 'column', sm: 'row' },
              alignItems: { xs: 'flex-start', sm: 'center' },
              gap: { xs: 1, sm: 2 },
              bgcolor: alpha(theme.palette.secondary.main, theme.palette.mode === 'dark' ? 0.08 : 0.04),
              borderColor: alpha(theme.palette.secondary.main, 0.3),
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }} aria-live="polite">
              <Typography variant="overline" sx={{ color: 'text.secondary', lineHeight: 1.6 }}>
                {automatic ? 'Following this device' : 'Selected time zone'}
              </Typography>
              <Typography variant="h6" component="p" sx={{ lineHeight: 1.25 }} data-testid="time-zone-summary-title">
                {summaryTitle}
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', overflowWrap: 'anywhere' }}>
                {summaryPlace}
              </Typography>
            </Box>
            <Box sx={{ textAlign: { xs: 'left', sm: 'right' } }}>
              <Typography variant="h5" component="p" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, lineHeight: 1.2 }}>
                {formatTime(now, { timeZone: shownId })}
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
                {`${formatDate(now, { timeZone: shownId, weekday: 'long' })} · ${shown?.offsetLabel ?? ''}`}
              </Typography>
            </Box>
          </Paper>

          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={{ xs: 0.5, sm: 2 }}
            sx={{ alignItems: { xs: 'flex-start', sm: 'center' }, justifyContent: 'space-between' }}
          >
            <FormControlLabel
              control={<Switch checked={automatic} onChange={(event) => setPending(event.target.checked ? null : device)} />}
              label={`Automatic (follow this device)`}
            />
            <Button
              size="small"
              startIcon={<MyLocationIcon />}
              onClick={() => setPending(device)}
              disabled={pending === device}
              sx={{ textAlign: 'left' }}
            >
              {`Use this device's time zone (${device})`}
            </Button>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: { xs: 2, sm: 3 }, pb: { xs: 2, sm: 2.5 } }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => onSelect(pending)}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}

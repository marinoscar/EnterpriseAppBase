import { useState, FormEvent } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Alert,
  Box,
  MenuItem,
  Typography,
} from '@mui/material';
import type { PatCreatedResponse, PatDurationUnit } from '../../headless/index.js';
import { addCalendarInZone, type CalendarDuration } from '@marinoscar/platform-contract/timezone';
import {
  NUMERIC_DATE,
  NUMERIC_TIME,
  formatDate,
  formatTime,
  getDisplayTimeZone,
  useDisplayTimeZone,
} from '../../../core/index.js';

interface CreatePatDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (response: PatCreatedResponse) => void;
  onCreate: (data: {
    name: string;
    durationValue: number;
    durationUnit: PatDurationUnit;
  }) => Promise<PatCreatedResponse>;
}

const DURATION_UNITS: { value: PatDurationUnit; label: string }[] = [
  { value: 'minutes', label: 'Minutes' },
  { value: 'days', label: 'Days' },
  { value: 'months', label: 'Months' },
];

/**
 * The expiry the server will compute for a token created now: minutes are a
 * plain duration; days and months are calendar steps on the wall clock of
 * `timeZone` (`addCalendarInZone` of `@marinoscar/platform-contract/timezone`,
 * the function the PAT service calls with the requester's zone), so the time
 * of day is kept across a DST change and a month step clamps to a shorter
 * month's end. Exported for tests only (not part of the package entry).
 *
 * @param durationValue - the whole number of units.
 * @param durationUnit - minutes, days or months.
 * @param now - the starting instant.
 * @param timeZone - the zone of the calendar steps; default the display zone.
 * @returns the expiry instant.
 *
 * @internal
 */
export function computeExpiresAt(
  durationValue: number,
  durationUnit: PatDurationUnit,
  now: Date = new Date(),
  timeZone: string = getDisplayTimeZone(),
): Date {
  switch (durationUnit) {
    case 'minutes':
      return new Date(now.getTime() + durationValue * 60 * 1000);
    case 'days':
      return inZone(now, { days: durationValue }, timeZone);
    case 'months':
      return inZone(now, { months: durationValue }, timeZone);
  }
}

function inZone(now: Date, duration: CalendarDuration, timeZone: string): Date {
  try {
    return addCalendarInZone(now, duration, timeZone);
  } catch {
    // A zone the runtime does not know: the server falls back to UTC too.
    return addCalendarInZone(now, duration, 'UTC');
  }
}

export function CreatePatDialog({ open, onClose, onCreated, onCreate }: CreatePatDialogProps) {
  // The expiry preview is computed and rendered in the display zone.
  const zone = useDisplayTimeZone();
  const [name, setName] = useState('');
  const [durationValue, setDurationValue] = useState('30');
  const [durationUnit, setDurationUnit] = useState<PatDurationUnit>('days');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const parsedDurationValue = parseInt(durationValue, 10);
  const isDurationValid =
    !isNaN(parsedDurationValue) &&
    Number.isInteger(parsedDurationValue) &&
    parsedDurationValue >= 1 &&
    parsedDurationValue <= 999;

  const expiresAt =
    isDurationValid ? computeExpiresAt(parsedDurationValue, durationUnit, new Date(), zone) : null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    if (name.trim().length > 100) {
      setError('Name must be at most 100 characters');
      return;
    }

    if (!isDurationValid) {
      setError('Duration must be an integer between 1 and 999');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await onCreate({
        name: name.trim(),
        durationValue: parsedDurationValue,
        durationUnit,
      });
      // Reset form
      setName('');
      setDurationValue('30');
      setDurationUnit('days');
      setError(null);
      onCreated(response);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create token');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setName('');
      setDurationValue('30');
      setDurationUnit('days');
      setError(null);
      onClose();
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <form onSubmit={handleSubmit}>
        <DialogTitle>Create Personal Access Token</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1 }}>
            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}
            <TextField
              label="Token Name"
              fullWidth
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isSubmitting}
              slotProps={{ htmlInput: { maxLength: 100 } }}
              sx={{ mb: 2 }}
              autoFocus
              placeholder="e.g. CI/CD Pipeline, Local Dev"
            />
            <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
              <TextField
                label="Duration"
                type="number"
                value={durationValue}
                onChange={(e) => setDurationValue(e.target.value)}
                disabled={isSubmitting}
                slotProps={{ htmlInput: { min: 1, max: 999, step: 1 } }}
                sx={{ flex: 1 }}
              />
              <TextField
                select
                label="Unit"
                value={durationUnit}
                onChange={(e) => setDurationUnit(e.target.value as PatDurationUnit)}
                disabled={isSubmitting}
                sx={{ flex: 1 }}
              >
                {DURATION_UNITS.map((u) => (
                  <MenuItem key={u.value} value={u.value}>
                    {u.label}
                  </MenuItem>
                ))}
              </TextField>
            </Box>
            {expiresAt && (
              <Typography variant="body2" color="text.secondary">
                Token will expire on {formatDate(expiresAt, NUMERIC_DATE)} at{' '}
                {formatTime(expiresAt, NUMERIC_TIME)}
              </Typography>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={isSubmitting}>
            {isSubmitting ? 'Creating...' : 'Create Token'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

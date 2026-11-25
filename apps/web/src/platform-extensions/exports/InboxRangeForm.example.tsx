/**
 * Reference example (#744): a source's own request form, through
 * `ExportDialog` / `DataExportPage` `slots.form`.
 *
 * The dialog draws a source's fields from its descriptor by default (a date
 * picker per `z.iso.date()`, a checkbox per `z.boolean()`); a source whose
 * request reads better as one control supplies its own. This one offers the
 * example inbox source's range as presets ("Last 7 days", "Last 30 days",
 * "Everything") and writes the same `{ from, to }` the API validates.
 *
 * The days are calendar days in the viewer's display zone: the API reads
 * `from`/`to` in the requester's zone (profile, else the `X-Time-Zone` header
 * the packaged client sends), so "today" here and there is the same day. Never
 * `toISOString().slice(0, 10)`, which is tomorrow's UTC date in the evening
 * west of Greenwich.
 *
 * Wire it with
 * `<DataExportPage slots={{ form: { 'example-notification-inbox': InboxRangeForm } }} />`.
 */
import { FormControl, FormControlLabel, FormLabel, Radio, RadioGroup } from '@mui/material';
import { useState, type ReactElement } from 'react';
import type { ExportFormSlotProps } from '@marinoscar/platform-web/exports/ui';
import { getDisplayTimeZone, zonedDateKey } from '@marinoscar/platform-web/core';
import { addDaysToDateKey } from '@marinoscar/platform-contract/timezone';

const PRESETS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: 'all', label: 'Everything' },
] as const;

/**
 * The last `days` calendar days ending today in `timeZone`, inclusive, as the
 * `YYYY-MM-DD` pair the source takes.
 */
export function inboxPresetRange(
  days: number,
  now: Date = new Date(),
  timeZone: string = getDisplayTimeZone(),
): { from: string; to: string } {
  const to = zonedDateKey(now, timeZone) ?? now.toISOString().slice(0, 10);
  return { from: addDaysToDateKey(to, -(days - 1)), to };
}

export function InboxRangeForm({ onChange }: ExportFormSlotProps): ReactElement {
  // The preset is the form's own state; the request carries only what the
  // source's strict schema accepts.
  const [current, setCurrent] = useState<string>('all');
  return (
    <FormControl>
      <FormLabel id="inbox-range">Range</FormLabel>
      <RadioGroup
        aria-labelledby="inbox-range"
        value={current}
        onChange={(event) => {
          const preset = event.target.value;
          setCurrent(preset);
          if (preset === 'all') return onChange({});
          onChange(inboxPresetRange(Number(preset)));
        }}
      >
        {PRESETS.map((preset) => (
          <FormControlLabel key={preset.value} value={preset.value} control={<Radio />} label={preset.label} />
        ))}
      </RadioGroup>
    </FormControl>
  );
}

/**
 * The Telemetry Dashboard's filter bar — issue #578, epic #576.
 *
 * Range (15m … 7d), service and instance (the values `/filters` reports for
 * the window), auto-refresh, "Updated Xs ago", and — while zoomed — a
 * "Reset zoom" chip that drops `from`/`to` and returns to the preset.
 */
import { useEffect, useState } from 'react';
import {
  Chip,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  OutlinedInput,
  Select,
  Stack,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import {
  DASHBOARD_RANGES,
  DASHBOARD_RANGE_LABELS,
  type DashboardRange,
} from '../../../services/telemetryDashboard';
import { isZoomed, type DashboardState } from './dashboardState';
import { formatTimestamp } from './format';

export type DashboardLayout = 'phone' | 'tablet' | 'desktop';

export interface DashboardFilterBarProps {
  state: DashboardState;
  onChange: (patch: Partial<DashboardState>) => void;
  services: string[];
  instances: string[];
  /** `Date.now()` of the latest summary, for "Updated Xs ago". */
  updatedAt: number | null;
  layout: DashboardLayout;
}

/** Re-renders itself once a second; the rest of the page does not. */
export function UpdatedAgo({ updatedAt }: { updatedAt: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (updatedAt === null) return null;
  const seconds = Math.max(0, Math.round((now - updatedAt) / 1000));
  const text = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m`;
  return (
    <Typography variant="caption" color="text.secondary" data-testid="updated-ago" sx={{ whiteSpace: 'nowrap' }}>
      Updated {text} ago
    </Typography>
  );
}

export function zoomLabel(state: DashboardState): string {
  return `${formatTimestamp(state.from)} – ${formatTimestamp(state.to)}`;
}

export function ResetZoomChip({ state, onChange }: Pick<DashboardFilterBarProps, 'state' | 'onChange'>) {
  if (!isZoomed(state)) return null;
  return (
    <Chip
      icon={<ZoomOutIcon aria-hidden />}
      label="Reset zoom"
      title={zoomLabel(state)}
      onClick={() => onChange({ from: null, to: null })}
      onDelete={() => onChange({ from: null, to: null })}
      color="primary"
      variant="outlined"
      sx={{ minHeight: 36 }}
    />
  );
}

interface SelectProps {
  label: string;
  allLabel: string;
  value: string | null;
  options: string[];
  onChange: (value: string | null) => void;
  fullWidth?: boolean;
}

export function FilterSelect({ label, allLabel, value, options, onChange, fullWidth }: SelectProps) {
  const id = `dashboard-${label.toLowerCase()}`;
  // A value from the URL that `/filters` does not (yet) list is still shown.
  const values = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <FormControl size="small" fullWidth={fullWidth} sx={{ minWidth: 160, maxWidth: fullWidth ? undefined : 240 }}>
      <InputLabel id={`${id}-label`} shrink>
        {label}
      </InputLabel>
      <Select
        labelId={`${id}-label`}
        id={id}
        input={<OutlinedInput notched label={label} />}
        value={value ?? ''}
        displayEmpty
        onChange={(event) => onChange(event.target.value ? String(event.target.value) : null)}
        renderValue={(selected) => (selected ? String(selected) : allLabel)}
      >
        <MenuItem value="">{allLabel}</MenuItem>
        {values.map((option) => (
          <MenuItem key={option} value={option}>
            {option}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

export function RefreshSwitch({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <FormControlLabel
      control={<Switch checked={checked} onChange={(event) => onChange(event.target.checked)} />}
      label="Auto-refresh"
      sx={{ mr: 0, whiteSpace: 'nowrap' }}
    />
  );
}

export function RangeToggle({ state, onChange }: Pick<DashboardFilterBarProps, 'state' | 'onChange'>) {
  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      aria-label="Time range"
      value={isZoomed(state) ? null : state.range}
      onChange={(_event, next: DashboardRange | null) => {
        if (next) onChange({ range: next, from: null, to: null });
        else if (isZoomed(state)) onChange({ from: null, to: null });
      }}
    >
      {DASHBOARD_RANGES.map((range) => (
        <ToggleButton key={range} value={range} aria-label={DASHBOARD_RANGE_LABELS[range]} sx={{ px: 1.5, textTransform: 'none' }}>
          {range}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

export function DashboardFilterBar({ state, onChange, services, instances, updatedAt }: DashboardFilterBarProps) {
  return (
    <Stack
      direction="row"
      spacing={1.5}
      useFlexGap
      role="toolbar"
      aria-label="Dashboard filters"
      sx={{ alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}
    >
      <RangeToggle state={state} onChange={onChange} />
      <ResetZoomChip state={state} onChange={onChange} />
      <FilterSelect
        label="Service"
        allLabel="All services"
        value={state.service}
        options={services}
        onChange={(service) => onChange({ service })}
      />
      <FilterSelect
        label="Instance"
        allLabel="All instances"
        value={state.instance}
        options={instances}
        onChange={(instance) => onChange({ instance })}
      />
      <RefreshSwitch checked={state.refresh} onChange={(refresh) => onChange({ refresh })} />
      <UpdatedAgo updatedAt={updatedAt} />
    </Stack>
  );
}

// One Doctor check, rendered as a row (issue #634; packaged by #696).
//
// Status icon, label, a status chip, the detail line, the remedy as its own
// sentence, and the underlying error VERBATIM in a `<pre>` (wrapping rather
// than truncating: a provider error's codes and quoted names are the
// diagnosis). When the check names a `settingsPath`, an "Open settings" link
// goes straight to the page that fixes it. Colours come from the theme's
// `palette.status` tokens (see ../internal/status-colors.ts).

import { Box, Button, Chip, Stack, Typography } from '@mui/material';
import type { ChipProps, SxProps, Theme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutlined';
import type { ReactElement } from 'react';
import { Link as RouterLink } from 'react-router-dom';

import type { DoctorCheckReport, DoctorStatus } from '../headless/index.js';
import { statusColor } from '../internal/status-colors.js';

/**
 * The label of each status, as the page shows it.
 *
 * @stability stable
 */
export const STATUS_LABELS: Readonly<Record<DoctorStatus, string>> = {
  pass: 'Pass',
  warn: 'Warning',
  fail: 'Fail',
  skip: 'Skipped',
};

/**
 * The MUI palette role of each status: the role its `palette.status` token
 * defaults to (`pass` `success`, `warn` `warning`, `fail` `error`; `skip` the
 * neutral default chip).
 *
 * @stability stable
 */
export const STATUS_CHIP_COLORS: Readonly<Record<DoctorStatus, ChipProps['color']>> = {
  pass: 'success',
  warn: 'warning',
  fail: 'error',
  skip: 'default',
};

/**
 * The `sx` that colours an outlined status chip from the theme's status token;
 * `skip` keeps the default chip.
 */
export function statusChipSx(status: DoctorStatus): SxProps<Theme> | undefined {
  if (STATUS_CHIP_COLORS[status] === 'default') return undefined;
  return (theme: Theme) => {
    const color = statusColor(theme, status);
    return { color, borderColor: alpha(color, 0.7), '& .MuiChip-icon': { color } };
  };
}

const ICONS = {
  pass: CheckCircleIcon,
  warn: WarningAmberIcon,
  fail: ErrorOutlineIcon,
  skip: RemoveCircleOutlineIcon,
} as const;

/**
 * The small icon of a status, coloured by the theme's `palette.status` token,
 * with the status label as its accessible title.
 *
 * @param props - `status`: the status to draw.
 * @returns the icon.
 *
 * @stability stable
 */
export function StatusIcon(props: { status: DoctorStatus }): ReactElement {
  const Icon = ICONS[props.status];
  return (
    <Icon
      fontSize="small"
      titleAccess={STATUS_LABELS[props.status]}
      sx={(theme) => ({ color: statusColor(theme, props.status) })}
    />
  );
}

/** Probe timings are milliseconds to a few seconds; a short, readable form is enough. */
function formatCheckDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/**
 * The props of {@link CheckRow}.
 *
 * @stability stable
 */
export interface CheckRowProps {
  /** The row to render. */
  check: DoctorCheckReport;
}

/**
 * One check: icon, label, status chip, duration, detail, remedy, verbatim
 * error and a link to the settings page that fixes it. Renders an `<li>`.
 *
 * @param props - see {@link CheckRowProps}.
 * @returns the row.
 *
 * @stability stable
 */
export function CheckRow({ check }: CheckRowProps): ReactElement {
  return (
    <Box
      component="li"
      sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', listStyle: 'none' }}
      data-testid={`doctor-check-${check.id}`}
    >
      <Box sx={{ pt: 0.25, display: 'flex' }}>
        <StatusIcon status={check.status} />
      </Box>
      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
        <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
          <Typography variant="subtitle2" component="h3">
            {check.label}
          </Typography>
          <Chip
            size="small"
            variant="outlined"
            label={STATUS_LABELS[check.status]}
            sx={statusChipSx(check.status)}
            data-testid={`doctor-check-status-${check.id}`}
          />
          <Typography variant="caption" color="text.secondary">
            {formatCheckDuration(check.durationMs)}
          </Typography>
        </Stack>
        {check.detail && (
          <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
            {check.detail}
          </Typography>
        )}
        {check.remedy && (
          <Typography variant="body2" sx={{ mt: 0.5 }} data-testid={`doctor-check-remedy-${check.id}`}>
            {check.remedy}
          </Typography>
        )}
        {check.error && (
          <Box
            component="pre"
            data-testid={`doctor-check-error-${check.id}`}
            sx={{
              m: 0,
              mt: 1,
              fontFamily: 'monospace',
              fontSize: '0.8125rem',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {check.error}
          </Box>
        )}
        {check.settingsPath && (
          <Button
            component={RouterLink}
            to={check.settingsPath}
            size="small"
            sx={{ mt: 0.5, ml: -0.5 }}
            aria-label={`Open settings for ${check.label}`}
          >
            Open settings
          </Button>
        )}
      </Box>
    </Box>
  );
}

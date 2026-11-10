/**
 * A node's power badge (issue #1045): a battery with its charge on battery, a
 * plug on AC, nothing when the node did not say.
 *
 * The words come from `describeNodePower` (`/nodes/headless`); the badge only
 * draws them. The charge is printed, the state is in the icon AND in the
 * accessible label ("On battery, 42%, discharging"), and the colour (warning at
 * 20% or under, error at 10% or under) is the secondary cue, never the only one.
 */

import BatteryAlertIcon from '@mui/icons-material/BatteryAlert';
import BatteryChargingFullIcon from '@mui/icons-material/BatteryChargingFull';
import BatteryFullIcon from '@mui/icons-material/BatteryFull';
import PowerIcon from '@mui/icons-material/Power';
import { Box, Tooltip } from '@mui/material';
import type { ReactElement } from 'react';

import { describeNodePower } from '../headless/index.js';
import type { NodePower } from '../headless/index.js';

interface NodePowerBadgeProps {
  /** `lastVitals.power`, if any. */
  power: NodePower | null | undefined;
  /** Dims the badge with the vitals of a node that is not healthy. */
  stale?: boolean;
  /** Beside a printed sentence: hidden from assistive technology, no tooltip. */
  decorative?: boolean;
  /** A test id for the badge's root. */
  'data-testid'?: string;
}

const LEVEL_COLOR = {
  normal: 'text.secondary',
  warning: 'warning.main',
  error: 'error.main',
} as const;

/**
 * The badge, or `null` when there is nothing to draw (no report, `unknown`).
 */
export function NodePowerBadge({
  power,
  stale = false,
  decorative = false,
  'data-testid': testId,
}: NodePowerBadgeProps): ReactElement | null {
  const description = describeNodePower(power);
  if (!description) return null;

  const Icon =
    description.source === 'ac'
      ? PowerIcon
      : description.charging === true
        ? BatteryChargingFullIcon
        : description.level === 'normal'
          ? BatteryFullIcon
          : BatteryAlertIcon;

  const badge = (
    <Box
      component="span"
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': description.label })}
      data-testid={testId}
      data-power-source={description.source}
      data-power-level={description.level}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.25,
        flexShrink: 0,
        typography: 'caption',
        fontWeight: description.level === 'normal' ? 400 : 600,
        color: stale ? 'text.disabled' : LEVEL_COLOR[description.level],
        whiteSpace: 'nowrap',
      }}
    >
      <Icon fontSize="inherit" aria-hidden sx={{ fontSize: 16 }} />
      {description.source === 'battery' && description.percent !== null && (
        <span aria-hidden>{description.text}</span>
      )}
    </Box>
  );
  return decorative ? badge : <Tooltip title={description.label}>{badge}</Tooltip>;
}

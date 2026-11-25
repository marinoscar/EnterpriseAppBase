// =============================================================================
// ActivationMetrics (issue #745): the Activation section of the Setup guide
// =============================================================================
//
// A SECTION of `/admin/settings/setup`, not a card or a tab (Settings UI
// Pattern). For the users who signed up in the chosen window (7, 30 or 90
// days): new users, per registered milestone the activation rate and the
// median time to it, and the step funnel. Every number is also text ("1 of 4,
// 25%"); bars only repeat it. Aggregates only: nothing per user is fetched.
// =============================================================================

import { Alert, Box, LinearProgress, Paper, Skeleton, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { useId, useState } from 'react';
import type { ReactElement } from 'react';

import { useOnboardingMetrics } from '../headless/use-onboarding-metrics.js';
import { ACTIVATION_HEADING, EMPTY_COHORT_TEXT } from './copy.js';

/**
 * The windows the section offers, in days.
 *
 * @stability experimental
 */
export const ACTIVATION_WINDOWS = [7, 30, 90] as const;

/**
 * `0.25` as `25%`; `null` as `null`.
 *
 * @param rate - the ratio.
 * @returns the percentage text.
 *
 * @stability experimental
 */
export function formatRate(rate: number | null): string | null {
  return rate === null || !Number.isFinite(rate) ? null : `${Math.round(rate * 100)}%`;
}

/**
 * Hours as words: under 48 in hours, otherwise in days.
 *
 * @param hours - the hours.
 * @returns the text.
 *
 * @stability experimental
 */
export function formatHours(hours: number): string {
  if (hours < 48) return `${Math.round(hours * 10) / 10} h`;
  return `${Math.round((hours / 24) * 10) / 10} days`;
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }): ReactElement {
  return (
    <Paper variant="outlined" sx={{ p: 2, flex: 1, minWidth: 0 }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h5" component="p">
        {value}
      </Typography>
      {sub ? (
        <Typography variant="body2" color="text.secondary">
          {sub}
        </Typography>
      ) : null}
    </Paper>
  );
}

/**
 * The Activation section: new users, milestone activation and the funnel.
 *
 * @returns the section.
 *
 * @example
 * ```tsx
 * <ActivationMetrics />
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export function ActivationMetrics(): ReactElement {
  const [days, setDays] = useState<number>(30);
  const { metrics, isLoading, error } = useOnboardingMetrics(days);
  const headingId = useId();

  return (
    <Box component="section" aria-labelledby={headingId} sx={{ mt: 4 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 2, alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
        <Typography id={headingId} variant="h5" component="h2">
          {ACTIVATION_HEADING}
        </Typography>
        <ToggleButtonGroup exclusive size="small" value={days} onChange={(_e, value: number | null) => value && setDays(value)} aria-label="Window">
          {ACTIVATION_WINDOWS.map((window) => (
            <ToggleButton key={window} value={window} sx={{ minHeight: 36, px: 2 }}>
              {`${window} days`}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Stack>

      {error ? <Alert severity="error">{error}</Alert> : null}
      {isLoading && !metrics ? <Skeleton variant="rounded" height={96} data-testid="activation-loading" /> : null}
      {metrics && metrics.cohortSize === 0 ? <Typography color="text.secondary">{EMPTY_COHORT_TEXT}</Typography> : null}
      {metrics && metrics.cohortSize > 0 ? (
        <>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
            <Tile label="New users" value={String(metrics.cohortSize)} sub={`in the last ${metrics.windowDays} days`} />
            {metrics.milestones.map((m) => (
              <Tile
                key={m.id}
                label={`${m.label} within ${m.windowDays} days`}
                value={formatRate(m.activationRate) ?? 'Not yet'}
                sub={
                  `${m.activated} of ${m.eligible} eligible` +
                  (m.medianHours === null ? '' : ` · median ${formatHours(m.medianHours)}`)
                }
              />
            ))}
          </Stack>
          {metrics.steps.length > 0 ? (
            <Box component="ul" aria-label="Step funnel" sx={{ listStyle: 'none', p: 0, m: 0 }}>
              {metrics.steps.map((step) => {
                const rate = formatRate(step.rate);
                const text = `${step.completed} of ${metrics.cohortSize}${rate ? `, ${rate}` : ''}`;
                return (
                  <Box component="li" key={step.id} sx={{ mb: 1.5 }}>
                    <Typography variant="body2">
                      {step.title}: {text}
                    </Typography>
                    <LinearProgress
                      variant="determinate"
                      value={Math.round((step.rate ?? 0) * 100)}
                      aria-label={step.title}
                      aria-valuetext={text}
                      sx={{ height: 6, borderRadius: 3 }}
                    />
                  </Box>
                );
              })}
            </Box>
          ) : null}
        </>
      ) : null}
    </Box>
  );
}

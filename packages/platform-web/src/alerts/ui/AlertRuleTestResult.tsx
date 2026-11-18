// The observations of a rule's dry run (issue #1047): what `POST
// /admin/alerts/rules/:id/test` saw, one row per label set, breached first.
// Nothing was stored and nothing was sent; the panel says so.

import { Alert, Box, Chip, List, ListItem, ListItemText, Stack, Typography } from '@mui/material';
import type { ReactElement } from 'react';

import type { AlertRuleTestResponse } from '@marinoscar/platform-contract/alerts';

import { formatAlertLabels } from '../headless/index.js';
import { when } from './parts.js';

/**
 * Props of {@link AlertRuleTestResult}.
 *
 * @stability experimental
 */
export interface AlertRuleTestResultProps {
  /** The dry run's answer. */
  result: AlertRuleTestResponse;
}

/**
 * A rule's dry-run observations: the error, or each label set with its value
 * and whether it breached, breached ones first.
 *
 * @param props - see {@link AlertRuleTestResultProps}.
 * @returns the panel.
 *
 * @extensionPoint component
 * @stability experimental
 */
export function AlertRuleTestResult({ result }: AlertRuleTestResultProps): ReactElement {
  const observations = [...result.observations].sort((a, b) => Number(b.breached) - Number(a.breached));
  const breached = observations.filter((observation) => observation.breached).length;
  return (
    <Box data-testid="alert-test-result">
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Evaluated {when(result.evaluatedAt)} in {result.durationMs} ms. Nothing was stored and no notification was sent.
      </Typography>
      {result.error ? (
        <Alert severity="error">The rule could not be evaluated: {result.error}</Alert>
      ) : observations.length === 0 ? (
        <Alert severity="info">No observations: nothing matched the rule right now.</Alert>
      ) : (
        <>
          <Alert severity={breached > 0 ? 'warning' : 'success'} sx={{ mb: 1 }}>
            {breached > 0
              ? `${breached} of ${observations.length} ${observations.length === 1 ? 'observation' : 'observations'} would fire.`
              : `None of the ${observations.length} ${observations.length === 1 ? 'observation' : 'observations'} would fire.`}
          </Alert>
          <List dense aria-label="Observations">
            {observations.map((observation, index) => (
              <ListItem key={`${formatAlertLabels(observation.labels)}-${index}`} divider>
                <ListItemText
                  primary={
                    <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                      <Chip
                        size="small"
                        label={observation.breached ? 'Breached' : 'OK'}
                        color={observation.breached ? 'warning' : 'success'}
                      />
                      <span>{observation.summary}</span>
                    </Stack>
                  }
                  secondary={[
                    formatAlertLabels(observation.labels) || 'No labels',
                    observation.value === null ? null : `value ${observation.value}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                />
              </ListItem>
            ))}
          </List>
        </>
      )}
    </Box>
  );
}

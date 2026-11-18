/**
 * A node's recent events (issue #1045), the "Events" section of the node's
 * detail dialog: newest first, a severity chip, the event's label, a one-line
 * summary of its attributes, and when it happened (relative, with the absolute
 * time on the node's clock and the server's receipt in the tooltip).
 *
 * Reads `GET /api/admin/nodes/:id/events` through `useNodeEvents`, page by page
 * ("Load more"). Re-reads the first page when the page's poll ticks (`now`
 * changes), but only while the first page is all that is shown: a poll must not
 * throw away the pages an operator asked for.
 *
 * ACCESSIBILITY: a labelled list; severity is a word in a chip (the colour is
 * the second cue); the relative time is a `<time>` with its ISO `dateTime`.
 */

import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { Alert, Box, Button, Chip, CircularProgress, Stack, Tooltip, Typography } from '@mui/material';
import type { ChipProps } from '@mui/material';
import type { ReactElement } from 'react';
import { useEffect, useId, useRef } from 'react';

import { formatDateTime, nodeEventLabel, nodeEventSummary, useNodeEvents } from '../headless/index.js';
import type { NodeEventSeverity, WorkerNodeEvent } from '../headless/index.js';
import { formatRelativeTime } from '../internal/relative-time.js';

/** Events per page in the dialog. */
export const NODE_EVENTS_PAGE_SIZE = 20;

/** How each severity is drawn: a word, a colour, an icon. */
export const NODE_EVENT_SEVERITY_CHIPS: Record<
  NodeEventSeverity,
  { label: string; color: ChipProps['color']; variant: ChipProps['variant']; Icon: typeof InfoOutlinedIcon }
> = {
  info: { label: 'Info', color: 'default', variant: 'outlined', Icon: InfoOutlinedIcon },
  warning: { label: 'Warning', color: 'warning', variant: 'filled', Icon: WarningAmberIcon },
  critical: { label: 'Critical', color: 'error', variant: 'filled', Icon: ErrorOutlineIcon },
};

function severityChip(severity: NodeEventSeverity) {
  // A severity the API does not know yet reads as info rather than crashing.
  const spec = NODE_EVENT_SEVERITY_CHIPS[severity] ?? NODE_EVENT_SEVERITY_CHIPS.info;
  const { Icon } = spec;
  return (
    <Chip size="small" label={spec.label} color={spec.color} variant={spec.variant} icon={<Icon fontSize="small" />} />
  );
}

function EventRow({ event, now }: { event: WorkerNodeEvent; now: Date }) {
  const summary = nodeEventSummary(event);
  const absolute = `Occurred ${formatDateTime(event.occurredAt)} (node clock) · received ${formatDateTime(event.receivedAt)}`;
  return (
    <Box
      component="li"
      data-testid={`node-event-${event.id}`}
      sx={{ py: 1, borderBottom: 1, borderColor: 'divider', '&:last-of-type': { borderBottom: 0 } }}
    >
      <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        {severityChip(event.severity)}
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {nodeEventLabel(event.type)}
        </Typography>
        <Tooltip title={absolute}>
          <Typography variant="caption" color="text.secondary" component="time" dateTime={event.occurredAt} sx={{ ml: 'auto' }}>
            {formatRelativeTime(event.occurredAt, now)}
          </Typography>
        </Tooltip>
      </Stack>
      {summary && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, overflowWrap: 'anywhere' }}>
          {summary}
        </Typography>
      )}
    </Box>
  );
}

interface NodeEventsTimelineProps {
  /** The node whose events to list. */
  nodeId: string;
  /** The page's render clock; a change re-reads the first page. */
  now: Date;
  /** Events per page. Default {@link NODE_EVENTS_PAGE_SIZE}. */
  pageSize?: number;
}

/** The "Events" section of a node's detail dialog. */
export function NodeEventsTimeline({ nodeId, now, pageSize = NODE_EVENTS_PAGE_SIZE }: NodeEventsTimelineProps): ReactElement {
  const headingId = useId();
  const { events, total, hasMore, isLoading, isLoadingMore, error, refresh, loadMore } = useNodeEvents(nodeId, { pageSize });

  // Follow the page's poll, but only while one page is shown (see the header).
  // The latest `refresh` and page count are read through a ref at the tick, so
  // the tick alone triggers the read.
  const latest = useRef({ refresh, onlyFirstPage: true });
  latest.current = { refresh, onlyFirstPage: events.length <= pageSize };
  const firstTick = useRef(true);
  const nowMs = now.getTime();
  useEffect(() => {
    if (firstTick.current) {
      firstTick.current = false;
      return;
    }
    if (latest.current.onlyFirstPage) void latest.current.refresh();
  }, [nowMs]);

  return (
    <Box component="section" aria-labelledby={headingId} data-testid="node-events">
      <Typography variant="subtitle2" component="h3" id={headingId} gutterBottom>
        Events
      </Typography>

      {isLoading && (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <CircularProgress size={16} aria-label="Loading events" />
          <Typography variant="body2" color="text.secondary">
            Loading events…
          </Typography>
        </Stack>
      )}

      {!isLoading && error && (
        <Alert severity="error" sx={{ mb: 1 }}>
          {error}
        </Alert>
      )}

      {!isLoading && !error && events.length === 0 && (
        <Typography variant="body2" color="text.secondary" data-testid="node-events-empty">
          This node has not reported any events. Nodes running an older CLI do not send them.
        </Typography>
      )}

      {!isLoading && events.length > 0 && (
        <>
          <Box component="ul" aria-labelledby={headingId} sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {events.map((event) => (
              <EventRow key={event.id} event={event} now={now} />
            ))}
          </Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 1 }}>
            <Typography variant="caption" color="text.secondary">
              Showing {events.length} of {total}
            </Typography>
            {hasMore && (
              <Button size="small" onClick={() => void loadMore()} disabled={isLoadingMore}>
                {isLoadingMore ? 'Loading…' : 'Load more'}
              </Button>
            )}
          </Stack>
        </>
      )}
    </Box>
  );
}

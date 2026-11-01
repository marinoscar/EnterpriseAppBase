// The default title block of the three jobs pages (issue #854): the `h1` and
// the subtitle, with " (read-only)" appended for a viewer without the page's
// write permission. The DOM and styles are the reference app's, unchanged; a
// page's `slots.Header` replaces it.

import type { ReactElement, ReactNode } from 'react';
import { Typography } from '@mui/material';

/**
 * What a jobs page hands its `slots.Header`.
 *
 * @stability experimental
 */
export interface JobsPageHeaderProps {
  /** The page title (the card's title). */
  title: string;
  /** The page subtitle (the card's description). */
  description: string;
  /** The viewer lacks the page's write permission (`jobs:write` or `nodes:write`). */
  readOnly: boolean;
  /**
   * The page's header-level actions: always `null` here, because the queue-wide
   * buttons stay in the page body (a custom header never loses them). Present so
   * the props extend the page-slot contract's `PageHeaderSlotProps`.
   */
  actions: ReactNode;
}

/** The default header: `h1`, then the subtitle (and " (read-only)"). */
export function DefaultPageHeader({ title, description, readOnly }: JobsPageHeaderProps): ReactElement {
  return (
    <>
      <Typography variant="h4" component="h1" gutterBottom>
        {title}
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        {description}
        {readOnly && ' (read-only)'}
      </Typography>
    </>
  );
}
